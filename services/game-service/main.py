import os
import random
import secrets
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, Field
from redis.asyncio import Redis

from common.db import SessionLocal, engine, Base
from common.models import User, PlinkoRound, Notification
from common.auth import hash_password
from common.redis_utils import get_user_id_from_session, publish_notify
from common.observability import instrument_fastapi

Base.metadata.create_all(bind=engine)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

# The "admin"/house account that every Plinko round settles against. Losing bets are
# credited here; winning bets (multiplier > 1) are paid out from here. It has no
# usable password (random, never returned) so nobody can log into it directly.
HOUSE_USERNAME = os.getenv("HOUSE_USERNAME", "casino_house")

redis: Redis | None = None

RiskLevel = Literal["low", "medium", "high"]
RowCount = Literal[8, 12, 16]

# Multiplier tables indexed by [risk][rows][slot_index], slot_index 0..rows.
# Mirrors the well known Stake-style Plinko layout: high multipliers on the edges,
# a multiplier below 1x in the middle, and higher variance for higher risk / more rows.
# Each table's expected value (weighted by true binomial landing probability) sits
# around 0.97-0.99, i.e. a small house edge, the same way real Plinko games are priced.
MULTIPLIER_TABLES: dict[str, dict[int, list[float]]] = {
    "low": {
        8:  [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
        12: [8.1, 3.0, 1.6, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 1.6, 3.0, 8.1],
        16: [16.0, 9.0, 2.0, 1.4, 1.4, 1.2, 1.1, 1.0, 0.5, 1.0, 1.1, 1.2, 1.4, 1.4, 2.0, 9.0, 16.0],
    },
    "medium": {
        8:  [13.0, 3.0, 1.3, 0.7, 0.4, 0.7, 1.3, 3.0, 13.0],
        12: [31.0, 7.6, 3.8, 2.3, 0.9, 0.6, 0.4, 0.6, 0.9, 2.3, 3.8, 7.6, 31.0],
        16: [110.0, 41.0, 10.0, 5.0, 3.0, 1.5, 1.0, 0.5, 0.3, 0.5, 1.0, 1.5, 3.0, 5.0, 10.0, 41.0, 110.0],
    },
    "high": {
        8:  [29.0, 4.0, 1.5, 0.3, 0.2, 0.3, 1.5, 4.0, 29.0],
        12: [73.0, 19.0, 8.8, 2.5, 0.6, 0.25, 0.13, 0.25, 0.6, 2.5, 8.8, 19.0, 73.0],
        16: [1000.0, 130.0, 26.0, 9.0, 4.0, 2.0, 0.2, 0.2, 0.2, 0.2, 0.2, 2.0, 4.0, 9.0, 26.0, 130.0, 1000.0],
    },
}

MIN_BET = 1_000
MAX_BET = 500_000


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis
    redis = Redis.from_url(REDIS_URL, decode_responses=True)
    _ensure_house_account()
    yield
    if redis:
        await redis.close()


app = FastAPI(title="Game Service (Plinko)", lifespan=lifespan)
instrument_fastapi(app, "game-service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in CORS_ORIGINS],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _ensure_house_account() -> None:
    """Create the house/admin ledger account once if it doesn't exist yet.
    Safe to call from multiple replicas: relies on the unique username constraint."""
    db = SessionLocal()
    try:
        exists = db.execute(select(User).where(User.username == HOUSE_USERNAME)).scalar_one_or_none()
        if exists:
            return
        house = User(
            username=HOUSE_USERNAME,
            password_hash=hash_password(secrets.token_hex(32)),  # random, unusable, never returned
            balance=0,  # house balance is the running result of all bets settled so far
        )
        db.add(house)
        db.commit()
    except IntegrityError:
        db.rollback()  # another replica created it concurrently, that's fine
    finally:
        db.close()


def _lock_two_users(db: Session, id_a: int, id_b: int) -> dict[int, User]:
    """Lock two user rows FOR UPDATE in a fixed (ascending id) order to avoid deadlocks
    when many players hit the same house account concurrently."""
    lo, hi = sorted([id_a, id_b])
    first = db.execute(select(User).where(User.id == lo).with_for_update()).scalar_one_or_none()
    second = db.execute(select(User).where(User.id == hi).with_for_update()).scalar_one_or_none()
    return {lo: first, hi: second}


class PlayReq(BaseModel):
    bet_amount: int = Field(gt=0)
    risk: RiskLevel = "medium"
    rows: RowCount = 16


@app.get("/plinko/config")
async def get_config():
    """Static config the frontend needs to render the board: risk levels, row options,
    and the full multiplier table for each combination."""
    return {
        "risk_levels": ["low", "medium", "high"],
        "row_options": [8, 12, 16],
        "min_bet": MIN_BET,
        "max_bet": MAX_BET,
        "starting_balance": 1_000_000,
        "tables": MULTIPLIER_TABLES,
    }


@app.get("/plinko/house")
async def house_balance(db: Session = Depends(get_db)):
    """Public, read-only view of the house/admin account balance, for demo transparency
    (shows the accumulated house edge across all players)."""
    house = db.execute(select(User).where(User.username == HOUSE_USERNAME)).scalar_one_or_none()
    if not house:
        raise HTTPException(404, "House account not initialized yet")
    return {"username": house.username, "balance": house.balance}


@app.post("/plinko/play")
async def play(body: PlayReq, x_session: str | None = Header(default=None), db: Session = Depends(get_db)):
    """Drop one Plinko ball. Simulates the board as `rows` independent 50/50 bounces
    (a Galton board / binomial distribution), looks up the multiplier for the landing
    slot, then settles bet_amount vs payout between the player and the house account
    in a single DB transaction, using row locks so concurrent plays stay consistent."""
    user_id = await get_user_id_from_session(redis, x_session)

    if body.bet_amount < MIN_BET or body.bet_amount > MAX_BET:
        raise HTTPException(400, f"Bet must be between {MIN_BET} and {MAX_BET}")

    table = MULTIPLIER_TABLES.get(body.risk, {}).get(body.rows)
    if not table:
        raise HTTPException(400, "Invalid risk/rows combination")

    house = db.execute(select(User).where(User.username == HOUSE_USERNAME)).scalar_one_or_none()
    if not house:
        raise HTTPException(503, "House account not ready, try again shortly")
    if house.id == user_id:
        raise HTTPException(400, "House account cannot play")

    locked = _lock_two_users(db, user_id, house.id)
    player = locked.get(user_id)
    house = locked.get(house.id)
    if not player:
        raise HTTPException(404, "User not found")

    if player.balance < body.bet_amount:
        raise HTTPException(400, "Insufficient balance")

    # Simulate the ball: one 50/50 bounce per row. 1 = bounce right, 0 = bounce left.
    path = [random.randint(0, 1) for _ in range(body.rows)]
    slot_index = sum(path)  # classic Galton board: slot = number of "right" bounces
    multiplier = table[slot_index]
    payout = round(body.bet_amount * multiplier)
    net = payout - body.bet_amount  # positive = player wins, negative = player loses

    player.balance += net
    house.balance -= net

    round_row = PlinkoRound(
        user_id=player.id,
        risk=body.risk,
        rows=body.rows,
        slot_index=slot_index,
        path="".join(str(b) for b in path),
        bet_amount=body.bet_amount,
        multiplier=multiplier,
        payout=payout,
        balance_after=player.balance,
    )
    db.add(round_row)

    # Only notify on genuinely notable wins, so normal play doesn't spam the feed.
    if multiplier >= 10:
        msg = f"Plinko: bạn trúng x{multiplier:g} và nhận {payout:,}đ!"
        db.add(Notification(user_id=player.id, message=msg))
        notify_msg = msg
    else:
        notify_msg = None

    db.commit()

    if notify_msg:
        await publish_notify(redis, player.id, notify_msg)

    return {
        "risk": body.risk,
        "rows": body.rows,
        "path": path,
        "slot_index": slot_index,
        "multiplier": multiplier,
        "bet_amount": body.bet_amount,
        "payout": payout,
        "net": net,
        "balance": player.balance,
    }


@app.get("/plinko/history")
async def history(x_session: str | None = Header(default=None), db: Session = Depends(get_db)):
    """Last 20 Plinko rounds for the current user."""
    user_id = await get_user_id_from_session(redis, x_session)
    rows = (
        db.execute(
            select(PlinkoRound)
            .where(PlinkoRound.user_id == user_id)
            .order_by(PlinkoRound.created_at.desc())
            .limit(20)
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": r.id,
            "risk": r.risk,
            "rows": r.rows,
            "slot_index": r.slot_index,
            "bet_amount": r.bet_amount,
            "multiplier": r.multiplier,
            "payout": r.payout,
            "net": r.payout - r.bet_amount,
            "balance_after": r.balance_after,
            "created_at": r.created_at.isoformat() + "Z",
        }
        for r in rows
    ]


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        if redis:
            await redis.ping()
        db = SessionLocal()
        try:
            db.execute(select(1))
            db_status = "ok"
        except Exception:
            db_status = "error"
        finally:
            db.close()

        redis_status = "ok" if redis else "error"

        if db_status == "ok" and redis_status == "ok":
            return {"status": "healthy", "service": "game-service", "database": db_status, "redis": redis_status}
        else:
            raise HTTPException(503, detail={"status": "unhealthy", "database": db_status, "redis": redis_status})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(503, detail=f"Health check failed: {str(e)}")

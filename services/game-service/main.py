import json
import os
import random
import uuid
from contextlib import asynccontextmanager
from typing import List

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from common.db import Base, SessionLocal, engine
from common.models import Notification, PlinkoGame, User
from common.observability import instrument_fastapi
from common.redis_utils import get_user_id_from_session, publish_notify

Base.metadata.create_all(bind=engine)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
HOUSE_USERNAME = os.getenv("HOUSE_USERNAME", "casino_house")

MIN_BET = 1_000
MAX_BET = 10_000_000

redis: Redis | None = None


def get_multipliers(risk: str, rows: int) -> List[float]:
    """Generates standard symmetric Plinko multiplier array based on risk and rows."""
    risk = risk.lower()
    if risk not in ["low", "medium", "high"]:
        risk = "medium"

    rows = max(8, min(16, rows))
    num_slots = rows + 1

    # Pre-defined base multiplier curves
    if risk == "high":
        # High risk: center drops to ~0.2x, edges soar to ~50x-100x
        multipliers = []
        for i in range(num_slots):
            dist_from_center = abs(i - (rows / 2))
            if dist_from_center == 0:
                val = 0.2
            elif dist_from_center <= 1:
                val = 0.3
            elif dist_from_center <= 2:
                val = 1.2
            elif dist_from_center <= 3:
                val = 3.0
            elif dist_from_center <= 4:
                val = 10.0
            elif dist_from_center <= 5:
                val = 25.0
            else:
                val = 75.0
            multipliers.append(val)
        return multipliers

    elif risk == "low":
        # Low risk: center drops to ~0.8x, edges go up to ~3x-5x
        multipliers = []
        for i in range(num_slots):
            dist_from_center = abs(i - (rows / 2))
            if dist_from_center == 0:
                val = 0.8
            elif dist_from_center <= 1:
                val = 0.9
            elif dist_from_center <= 2:
                val = 1.1
            elif dist_from_center <= 3:
                val = 1.5
            elif dist_from_center <= 4:
                val = 2.2
            else:
                val = 4.0
            multipliers.append(val)
        return multipliers

    else:
        # Medium risk (default): center ~0.4x, edges ~10x-20x
        multipliers = []
        for i in range(num_slots):
            dist_from_center = abs(i - (rows / 2))
            if dist_from_center == 0:
                val = 0.4
            elif dist_from_center <= 1:
                val = 0.7
            elif dist_from_center <= 2:
                val = 1.3
            elif dist_from_center <= 3:
                val = 2.5
            elif dist_from_center <= 4:
                val = 6.0
            else:
                val = 15.0
            multipliers.append(val)
        return multipliers


def _ensure_house_account(db: Session):
    """Ensure casino house account exists with initial balance."""
    house = db.execute(
        select(User).where(User.username == HOUSE_USERNAME)
    ).scalar_one_or_none()

    if not house:
        # Create house account
        house = User(
            username=HOUSE_USERNAME,
            password_hash="house_secret_hash_not_for_login",
            balance=100_000_000,  # 100M initial house balance
        )
        db.add(house)
        db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis
    redis = Redis.from_url(REDIS_URL, decode_responses=True)

    # Ensure house account exists on startup
    db = SessionLocal()
    try:
        _ensure_house_account(db)
    except Exception as e:
        print(f"Error initializing house account: {e}")
    finally:
        db.close()

    yield
    if redis:
        await redis.close()


app = FastAPI(title="Plinko Game Service", lifespan=lifespan)
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


class DropReq(BaseModel):
    bet_amount: int = Field(
        ..., ge=MIN_BET, le=MAX_BET, description="Bet amount in VND"
    )
    risk: str = Field(default="medium", description="Risk level: low, medium, high")
    rows: int = Field(default=10, ge=8, le=16, description="Number of peg rows (8-16)")


@app.post("/drop")
@app.post("/api/game/drop")
async def drop_ball(
    body: DropReq,
    x_session: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Plinko Ball Drop Endpoint (High Concurrency / Continuous Drop).
    Deducts bet_amount, calculates random path & multiplier, and awards payout atomically.
    """
    user_id = await get_user_id_from_session(redis, x_session)

    if body.bet_amount < MIN_BET or body.bet_amount > MAX_BET:
        raise HTTPException(
            400, f"Bet amount must be between {MIN_BET:,} ₫ and {MAX_BET:,} ₫"
        )

    # Atomic balance update with SELECT FOR UPDATE
    player = db.execute(
        select(User).where(User.id == user_id).with_for_update()
    ).scalar_one_or_none()
    if not player:
        raise HTTPException(404, "User not found")

    if player.balance < body.bet_amount:
        raise HTTPException(400, "Insufficient balance")

    house = db.execute(
        select(User).where(User.username == HOUSE_USERNAME).with_for_update()
    ).scalar_one_or_none()
    if not house:
        # Fallback if house was deleted
        house = User(
            username=HOUSE_USERNAME, password_hash="secret", balance=100_000_000
        )
        db.add(house)
        db.flush()

    # Generate Plinko trajectory (0 = left, 1 = right for each row)
    rows = max(8, min(16, body.rows))
    path = [random.choice([0, 1]) for _ in range(rows)]
    slot = sum(path)

    multipliers = get_multipliers(body.risk, rows)
    multiplier = multipliers[slot]
    payout = int(body.bet_amount * multiplier)

    # Balance transaction: player pays bet_amount, receives payout
    player.balance = player.balance - body.bet_amount + payout
    house.balance = house.balance + body.bet_amount - payout

    # Record game history
    game_rec = PlinkoGame(
        user_id=player.id,
        bet_amount=body.bet_amount,
        multiplier=multiplier,
        payout=payout,
        slot=slot,
        risk=body.risk,
        rows=rows,
        path_json=json.dumps(path),
    )
    db.add(game_rec)

    # Send notification if significant payout (>= 2x bet)
    if payout >= body.bet_amount * 2:
        msg = f"🎉 Plinko Win! You won {payout:,} ₫ ({multiplier}x multiplier)"
        db.add(Notification(user_id=player.id, message=msg))
        db.commit()
        await publish_notify(redis, player.id, msg)
    else:
        db.commit()

    return {
        "ok": True,
        "ball_id": str(uuid.uuid4()),
        "bet_amount": body.bet_amount,
        "multiplier": multiplier,
        "payout": payout,
        "slot": slot,
        "rows": rows,
        "risk": body.risk,
        "path": path,
        "multipliers": multipliers,
        "new_balance": player.balance,
    }


@app.get("/history")
@app.get("/api/game/history")
async def game_history(
    x_session: str | None = Header(default=None), db: Session = Depends(get_db)
):
    """Get last 20 Plinko games for the logged-in user."""
    user_id = await get_user_id_from_session(redis, x_session)
    games = (
        db.execute(
            select(PlinkoGame)
            .where(PlinkoGame.user_id == user_id)
            .order_by(PlinkoGame.created_at.desc())
            .limit(20)
        )
        .scalars()
        .all()
    )

    return [
        {
            "id": g.id,
            "bet_amount": g.bet_amount,
            "multiplier": g.multiplier,
            "payout": g.payout,
            "slot": g.slot,
            "risk": g.risk,
            "rows": g.rows,
            "created_at": g.created_at.isoformat() if g.created_at else "",
        }
        for g in games
    ]


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        redis_ok = False
        if redis:
            await redis.ping()
            redis_ok = True

        db_ok = False
        db = SessionLocal()
        try:
            db.execute(select(1))
            db_ok = True
        finally:
            db.close()

        if db_ok and redis_ok:
            return {
                "status": "healthy",
                "service": "game-service",
                "database": "ok",
                "redis": "ok",
            }
        raise HTTPException(
            503, detail={"status": "unhealthy", "database": db_ok, "redis": redis_ok}
        )
    except Exception as e:
        raise HTTPException(503, detail=f"Health check failed: {str(e)}")

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from common.db import Base


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    balance: Mapped[int] = mapped_column(
        Integer, default=1_000_000
    )  # demo: cấp 1.000.000đ khi đăng ký


class Transfer(Base):
    __tablename__ = "transfers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_user: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    to_user: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    amount: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    message: Mapped[str] = mapped_column(String(255))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class PlinkoRound(Base):
    """One ball drop. Money moves between the player and the house (admin) ledger account:
    net = payout - bet_amount is added to the player and subtracted from the house, so the
    system stays zero-sum (same pattern as Transfer, just with a fixed counterparty)."""

    __tablename__ = "plinko_rounds"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    risk: Mapped[str] = mapped_column(String(10))  # low | medium | high
    rows: Mapped[int] = mapped_column(Integer)  # 8 | 12 | 16
    slot_index: Mapped[int] = mapped_column(
        Integer
    )  # 0..rows, which bucket the ball landed in
    path: Mapped[str] = mapped_column(
        String(32)
    )  # e.g. "0101101..." (0=left,1=right) per row
    bet_amount: Mapped[int] = mapped_column(Integer)
    multiplier: Mapped[float] = mapped_column(Float)
    payout: Mapped[int] = mapped_column(Integer)  # bet_amount * multiplier, rounded
    balance_after: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class PlinkoGame(Base):
    __tablename__ = "plinko_games"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    bet_amount: Mapped[int] = mapped_column(Integer)
    multiplier: Mapped[float] = mapped_column(Integer)  # scaled by 100 or float
    payout: Mapped[int] = mapped_column(Integer)
    slot: Mapped[int] = mapped_column(Integer)
    risk: Mapped[str] = mapped_column(String(20), default="medium")
    rows: Mapped[int] = mapped_column(Integer, default=10)
    path_json: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )

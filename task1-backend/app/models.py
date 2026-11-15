import datetime as dt

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

ENDED_WHERE = text("event_type = 'call.ended'")
PENDING_WHERE = text("processed_at IS NULL AND dead = false")


class CallEvent(Base):
    __tablename__ = "call_events"
    __table_args__ = (
        Index(
            "uq_call_ended_call_id",
            "call_id",
            unique=True,
            postgresql_where=ENDED_WHERE,
        ),
        Index(
            "ix_call_events_pending",
            "next_attempt_at",
            postgresql_where=PENDING_WHERE,
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    account_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    call_id: Mapped[str] = mapped_column(String(64), nullable=False)
    occurred_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    destination_country: Mapped[str | None] = mapped_column(String(8), nullable=True)
    received_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    processed_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    dead: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_error: Mapped[str | None] = mapped_column(String(512), nullable=True)


class UsageMonthly(Base):
    __tablename__ = "usage_monthly"
    __table_args__ = (
        UniqueConstraint("account_id", "period_month", name="uq_usage_account_month"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    period_month: Mapped[dt.date] = mapped_column(Date, nullable=False)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    calls_started: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    calls_ended: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    calls_failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

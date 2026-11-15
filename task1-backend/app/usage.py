import datetime as dt
import hmac
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import processing
from app.config import API_AUTH_TOKEN, MONTHLY_CAP_SECONDS
from app.db import SessionLocal
from app.models import CallEvent, UsageMonthly

router = APIRouter()
logger = logging.getLogger("app.usage")


def require_auth(authorization: str | None = Header(default=None)) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[len("Bearer "):]
    if not hmac.compare_digest(token, API_AUTH_TOKEN):
        raise HTTPException(status_code=401, detail="invalid bearer token")


def parse_month(value: str | None) -> dt.date:
    if value is None:
        today = dt.datetime.now(dt.timezone.utc).date()
        return today.replace(day=1)
    try:
        year, month = value.split("-")
        if len(month) != 2:
            raise ValueError(month)
        return dt.date(int(year), int(month), 1)
    except ValueError:
        raise HTTPException(status_code=422, detail="month must be YYYY-MM")


def cap_status(duration_seconds: int, cap_seconds: int) -> dict:
    return {
        "cap_seconds": cap_seconds,
        "cap_exceeded": duration_seconds >= cap_seconds,
        "cap_usage_percent": round((duration_seconds / cap_seconds) * 100, 1)
        if cap_seconds > 0
        else 0.0,
    }


class UsageResponse(BaseModel):
    account_id: str
    month: str
    duration_seconds: int
    minutes: int
    cost_cents: int
    calls_started: int
    calls_ended: int
    calls_failed: int
    cap: dict


@router.get("/usage/{account_id}", dependencies=[Depends(require_auth)])
def get_account_usage(account_id: str, month: str | None = Query(default=None)):
    period = parse_month(month)
    with SessionLocal() as session:
        usage = session.scalars(
            select(UsageMonthly).where(
                UsageMonthly.account_id == account_id,
                UsageMonthly.period_month == period,
            )
        ).first()
        if usage is None:
            latest = session.scalars(
                select(func.max(UsageMonthly.period_month)).where(
                    UsageMonthly.account_id == account_id
                )
            ).first()
            if latest is None:
                raise HTTPException(status_code=404, detail="no usage found for account")
            period = latest
            usage = session.scalars(
                select(UsageMonthly).where(
                    UsageMonthly.account_id == account_id,
                    UsageMonthly.period_month == period,
                )
            ).first()

    return UsageResponse(
        account_id=account_id,
        month=usage.period_month.isoformat(),
        duration_seconds=usage.duration_seconds,
        minutes=usage.duration_seconds // 60,
        cost_cents=usage.cost_cents,
        calls_started=usage.calls_started,
        calls_ended=usage.calls_ended,
        calls_failed=usage.calls_failed,
        cap=cap_status(usage.duration_seconds, MONTHLY_CAP_SECONDS),
    )


@router.get("/usage", dependencies=[Depends(require_auth)])
def list_usage(month: str | None = Query(default=None)):
    period = parse_month(month)
    with SessionLocal() as session:
        rows = session.scalars(
            select(UsageMonthly)
            .where(UsageMonthly.period_month == period)
            .order_by(UsageMonthly.account_id)
        ).all()
    return {
        "month": period.isoformat(),
        "data": [
            {
                "account_id": r.account_id,
                "duration_seconds": r.duration_seconds,
                "minutes": r.duration_seconds // 60,
                "cost_cents": r.cost_cents,
                "calls_started": r.calls_started,
                "calls_ended": r.calls_ended,
                "calls_failed": r.calls_failed,
                "cap": cap_status(r.duration_seconds, MONTHLY_CAP_SECONDS),
            }
            for r in rows
        ],
    }


@router.get("/usage/{account_id}/history", dependencies=[Depends(require_auth)])
def get_account_history(account_id: str, limit: int = Query(default=6, le=24)):
    with SessionLocal() as session:
        rows = session.scalars(
            select(UsageMonthly)
            .where(UsageMonthly.account_id == account_id)
            .order_by(UsageMonthly.period_month.desc())
            .limit(limit)
        ).all()
    return {
        "account_id": account_id,
        "months": [
            {
                "month": r.period_month.isoformat(),
                "duration_seconds": r.duration_seconds,
                "cost_cents": r.cost_cents,
                "calls_started": r.calls_started,
                "calls_ended": r.calls_ended,
                "calls_failed": r.calls_failed,
            }
            for r in rows
        ],
    }


@router.post("/admin/reconcile", dependencies=[Depends(require_auth)])
def run_reconcile():
    with SessionLocal() as session:
        result = processing.reconcile(session)
    logger.info("reconciliation_run", extra=result)
    return {"status": "ok", **result}

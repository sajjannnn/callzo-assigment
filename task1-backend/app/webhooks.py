import datetime as dt
import hashlib
import hmac
import json
import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app import processing
from app.config import MONTHLY_CAP_SECONDS, WEBHOOK_SECRET
from app.db import SessionLocal
from app.logging_setup import incr
from app.models import CallEvent

router = APIRouter()
logger = logging.getLogger("app.webhooks")

EVENT_TYPES = frozenset({processing.START, processing.END, processing.FAIL})


class WebhookEvent(BaseModel):
    event_id: str = Field(min_length=1, max_length=64)
    event_type: str
    account_id: str = Field(min_length=1, max_length=64)
    call_id: str = Field(min_length=1, max_length=64)
    timestamp: dt.datetime
    duration_seconds: int = Field(default=0, ge=0)
    cost_cents: int = Field(default=0, ge=0)
    destination_country: str | None = Field(default=None, max_length=8)


def verify_signature(raw_body: bytes, signature: str | None, secret: str) -> bool:
    if not signature:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip().lower())


def _reject_constant(name: str) -> float:
    raise ValueError(f"non-finite number in body: {name}")


def insert_event(session, event: WebhookEvent) -> int | None:
    stmt = (
        pg_insert(CallEvent)
        .values(
            event_id=event.event_id,
            event_type=event.event_type,
            account_id=event.account_id,
            call_id=event.call_id,
            occurred_at=event.timestamp,
            duration_seconds=event.duration_seconds,
            cost_cents=event.cost_cents,
            destination_country=event.destination_country,
        )
        .on_conflict_do_nothing()
        .returning(CallEvent.id)
    )
    return session.execute(stmt).scalar_one_or_none()


@router.post("/webhooks/calls")
async def receive_call_event(request: Request):
    raw_body = await request.body()

    if not verify_signature(raw_body, request.headers.get("X-Signature"), WEBHOOK_SECRET):
        incr("webhook_rejected")
        logger.warning(
            "webhook_signature_rejected",
            extra={"client": request.client.host if request.client else None},
        )
        raise HTTPException(status_code=403, detail="invalid or missing signature")

    if not raw_body.strip():
        incr("webhook_rejected")
        raise HTTPException(status_code=400, detail="empty request body")

    try:
        payload = json.loads(raw_body, parse_constant=_reject_constant)
    except ValueError:
        incr("webhook_rejected")
        raise HTTPException(status_code=400, detail="malformed JSON body")

    try:
        event = WebhookEvent.model_validate(payload)
    except ValidationError as exc:
        incr("webhook_rejected")
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False))

    if event.event_type not in EVENT_TYPES:
        incr("webhook_rejected")
        raise HTTPException(
            status_code=422,
            detail=f"unknown event_type: {event.event_type}",
        )

    if event.timestamp.tzinfo is None:
        event.timestamp = event.timestamp.replace(tzinfo=dt.timezone.utc)

    with SessionLocal() as session:
        inserted_id = insert_event(session, event)
        if inserted_id is None:
            incr("webhook_duplicate")
            logger.info("webhook_duplicate_ignored", extra={"event_id": event.event_id})
            session.commit()
            return {"status": "accepted", "duplicate": True}

        session.commit()
        incr("webhook_accepted")

        stored = session.get(CallEvent, inserted_id)
        try:
            total_seconds = processing.apply_event(session, stored)
            session.commit()
            incr("events_processed")
            if (
                stored.event_type == processing.END
                and total_seconds >= MONTHLY_CAP_SECONDS
            ):
                logger.warning(
                    "monthly_cap_reached",
                    extra={
                        "account_id": event.account_id,
                        "month": processing.month_of(stored.occurred_at).isoformat(),
                        "duration_seconds": total_seconds,
                        "cap_seconds": MONTHLY_CAP_SECONDS,
                    },
                )
            return {"status": "accepted", "duplicate": False}
        except Exception as exc:
            session.rollback()
            processing.schedule_retry(session, stored, exc)
            incr("events_pending_retry")
            logger.exception(
                "event_stored_processing_failed",
                extra={"event_id": event.event_id},
            )
            raise HTTPException(status_code=503, detail="event stored; processing pending")

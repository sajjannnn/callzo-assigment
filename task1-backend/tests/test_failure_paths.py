import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app import processing
from app.db import SessionLocal
from app.models import CallEvent, UsageMonthly
from tests.conftest import SECRET, event_payload, post_event


def get_usage(account_id="acct_008"):
    with SessionLocal() as session:
        return session.scalars(
            select(UsageMonthly).where(UsageMonthly.account_id == account_id)
        ).first()


def get_event(event_id):
    with SessionLocal() as session:
        return session.scalars(
            select(CallEvent).where(CallEvent.event_id == event_id)
        ).first()


def test_aggregation_failure_preserves_raw_event(client, monkeypatch):
    def boom(session, event):
        raise RuntimeError("simulated aggregate write failure")

    monkeypatch.setattr(processing, "apply_event", boom)
    response = post_event(
        client,
        event_payload(
            event_id="evt_surv",
            account_id="acct_008",
            call_id="call_surv",
            duration_seconds=600,
            cost_cents=20,
        ),
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "event stored; processing pending"

    event = get_event("evt_surv")
    assert event is not None
    assert event.processed_at is None
    assert event.attempts == 1
    assert "simulated aggregate write failure" in event.last_error
    assert get_usage() is None

    def make_due(event_id):
        with SessionLocal() as session:
            session.execute(
                CallEvent.__table__.update()
                .where(CallEvent.__table__.c.event_id == event_id)
                .values(next_attempt_at=datetime.now(timezone.utc) - timedelta(seconds=1))
            )
            session.commit()

    make_due("evt_surv")
    assert processing.sweep_pending(lambda: SessionLocal()) == 0
    event = get_event("evt_surv")
    assert event.attempts == 2
    assert event.processed_at is None
    assert event.dead is False

    monkeypatch.undo()
    make_due("evt_surv")
    processing.sweep_pending(lambda: SessionLocal())

    event = get_event("evt_surv")
    assert event.processed_at is not None
    usage = get_usage()
    assert usage.duration_seconds == 600
    assert usage.cost_cents == 20
    assert usage.calls_ended == 1


def test_call_failed_counts_without_billing(client):
    response = post_event(
        client,
        event_payload(
            event_id="evt_f1",
            event_type="call.failed",
            account_id="acct_008",
            call_id="call_fail1",
        ),
    )
    assert response.status_code == 200
    assert response.json()["duplicate"] is False

    usage = get_usage()
    assert usage is not None
    assert usage.calls_failed == 1
    assert usage.calls_started == 0
    assert usage.calls_ended == 0
    assert usage.duration_seconds == 0
    assert usage.cost_cents == 0


def test_nan_body_rejected_as_400(client):
    body = json.dumps(event_payload(event_id="evt_nan", call_id="call_nan")).encode()
    broken = body.replace(b'"duration_seconds": 600', b'"duration_seconds": NaN')
    if broken == body:
        broken = body.replace(b'600', b'NaN')
    signature = hmac.new(SECRET.encode(), broken, hashlib.sha256).hexdigest()
    response = client.post(
        "/webhooks/calls",
        content=broken,
        headers={"X-Signature": signature, "Content-Type": "application/json"},
    )
    assert response.status_code == 400
    assert get_event("evt_nan") is None

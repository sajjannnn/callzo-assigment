import hashlib
import hmac
import json

from app.processing import sweep_pending
from tests.conftest import AUTH, SECRET, event_payload, post_event


def test_missing_signature_rejected(client):
    payload = event_payload()
    response = client.post(
        "/webhooks/calls",
        content=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 403


def test_invalid_signature_rejected(client):
    response = post_event(client, event_payload(), signature="deadbeef")
    assert response.status_code == 403


def test_signature_over_modified_body_rejected(client):
    payload = event_payload()
    body = json.dumps(payload, separators=(",", ":")).encode()
    tampered = body.replace(b'"duration_seconds":600', b'"duration_seconds":99999')
    assert tampered != body
    sig = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    response = client.post(
        "/webhooks/calls",
        content=tampered,
        headers={"X-Signature": sig, "Content-Type": "application/json"},
    )
    assert response.status_code == 403


def test_valid_event_accepted(client):
    response = post_event(client, event_payload(event_type="call.started", duration_seconds=0))
    assert response.status_code == 200
    assert response.json() == {"status": "accepted", "duplicate": False}


def test_duplicate_not_double_counted(client):
    payload = event_payload()
    first = post_event(client, payload)
    second = post_event(client, payload)
    assert first.json()["duplicate"] is False
    assert second.json()["duplicate"] is True
    usage = client.get("/usage/acct_001", headers=AUTH).json()
    assert usage["duration_seconds"] == 600
    assert usage["cost_cents"] == 20
    assert usage["calls_ended"] == 1


def test_out_of_order_ended_before_started(client):
    post_event(client, event_payload(event_id="evt_end", event_type="call.ended"))
    post_event(
        client,
        event_payload(
            event_id="evt_start",
            event_type="call.started",
            duration_seconds=0,
            cost_cents=0,
        ),
    )
    usage = client.get("/usage/acct_001", headers=AUTH).json()
    assert usage["duration_seconds"] == 600
    assert usage["calls_started"] == 1
    assert usage["calls_ended"] == 1


def test_late_event_counts_in_event_month(client):
    post_event(
        client,
        event_payload(
            event_id="evt_late",
            timestamp="2026-09-05T08:00:00+00:00",
            duration_seconds=300,
            cost_cents=10,
        ),
    )
    usage = client.get("/usage/acct_001?month=2026-09", headers=AUTH).json()
    assert usage["duration_seconds"] == 300
    assert usage["cost_cents"] == 10


def test_empty_body_rejected(client):
    sig = hmac.new(SECRET.encode(), b"", hashlib.sha256).hexdigest()
    response = client.post(
        "/webhooks/calls",
        content=b"",
        headers={"X-Signature": sig, "Content-Type": "application/json"},
    )
    assert response.status_code == 400


def test_truncated_json_rejected(client):
    body = b'{"event_id": "evt_x", "event_type": "call.st'
    sig = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    response = client.post(
        "/webhooks/calls",
        content=body,
        headers={"X-Signature": sig, "Content-Type": "application/json"},
    )
    assert response.status_code == 400


def test_missing_field_rejected(client):
    payload = event_payload()
    del payload["account_id"]
    response = post_event(client, payload)
    assert response.status_code == 422


def test_wrong_type_rejected(client):
    response = post_event(client, event_payload(duration_seconds="not-a-number"))
    assert response.status_code == 422


def test_unknown_event_type_rejected(client):
    response = post_event(client, event_payload(event_type="call.exploded"))
    assert response.status_code == 422


def test_cap_burst_exceeds_soft_cap(client):
    for i in range(40):
        response = post_event(
            client,
            event_payload(
                event_id=f"evt_burst_{i}",
                call_id=f"call_burst_{i}",
                duration_seconds=1000,
                cost_cents=33,
            ),
        )
        assert response.status_code == 200
    usage = client.get("/usage/acct_001", headers=AUTH).json()
    assert usage["duration_seconds"] == 40000
    assert usage["cap"]["cap_exceeded"] is True
    assert usage["cap"]["cap_usage_percent"] > 100


def test_usage_requires_auth(client):
    post_event(client, event_payload())
    assert client.get("/usage/acct_001").status_code == 401
    assert (
        client.get("/usage/acct_001", headers={"Authorization": "Bearer wrong"})
        .status_code
        == 401
    )


def test_reconcile_repairs_corrupted_usage(client):
    post_event(
        client,
        event_payload(event_id="evt_a", call_id="call_ra", duration_seconds=600, cost_cents=20),
    )
    post_event(
        client,
        event_payload(event_id="evt_b", call_id="call_rb", duration_seconds=300, cost_cents=10),
    )

    from sqlalchemy import update

    from app.db import SessionLocal
    from app.models import UsageMonthly

    with SessionLocal() as session:
        session.execute(
            update(UsageMonthly).values(duration_seconds=999999, cost_cents=999999)
        )
        session.commit()

    response = client.post("/admin/reconcile", headers=AUTH)
    assert response.status_code == 200

    usage = client.get("/usage/acct_001", headers=AUTH).json()
    assert usage["duration_seconds"] == 900
    assert usage["cost_cents"] == 30
    assert usage["calls_ended"] == 2


def test_retry_sweep_processes_unprocessed_event(client):
    from datetime import datetime, timezone

    from sqlalchemy import select
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from app.db import SessionLocal
    from app.models import CallEvent, UsageMonthly

    with SessionLocal() as session:
        session.execute(
            pg_insert(CallEvent)
            .values(
                event_id="evt_sweep",
                event_type="call.ended",
                account_id="acct_002",
                call_id="call_sweep",
                occurred_at=datetime(2026, 11, 2, tzinfo=timezone.utc),
                duration_seconds=300,
                cost_cents=10,
            )
            .on_conflict_do_nothing(index_elements=["event_id"])
        )
        session.commit()

    processed = sweep_pending(lambda: SessionLocal())
    assert processed == 1

    with SessionLocal() as session:
        usage = session.scalars(
            select(UsageMonthly).where(UsageMonthly.account_id == "acct_002")
        ).first()
        assert usage.duration_seconds == 300
        assert usage.cost_cents == 10
        event = session.scalars(
            select(CallEvent).where(CallEvent.event_id == "evt_sweep")
        ).first()
        assert event.processed_at is not None


def test_invalid_month_format_rejected(client):
    response = client.get("/usage/acct_001?month=not-a-month", headers=AUTH)
    assert response.status_code == 422

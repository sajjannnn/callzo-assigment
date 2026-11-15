from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app import processing
from app.db import SessionLocal
from app.models import CallEvent, UsageMonthly
from tests.conftest import event_payload, post_event


def insert_raw_event(event_id, call_id, duration_seconds=300, cost_cents=10):
    with SessionLocal() as session:
        session.execute(
            pg_insert(CallEvent)
            .values(
                event_id=event_id,
                event_type="call.ended",
                account_id="acct_009",
                call_id=call_id,
                occurred_at=datetime(2026, 11, 2, tzinfo=timezone.utc),
                duration_seconds=duration_seconds,
                cost_cents=cost_cents,
            )
            .on_conflict_do_nothing()
        )
        session.commit()


def get_usage(account_id="acct_009"):
    with SessionLocal() as session:
        return session.scalars(
            select(UsageMonthly).where(UsageMonthly.account_id == account_id)
        ).first()


def get_event(event_id):
    with SessionLocal() as session:
        return session.scalars(
            select(CallEvent).where(CallEvent.event_id == event_id)
        ).first()


def test_two_distinct_event_ids_same_call_billed_once(client):
    first = post_event(
        client,
        event_payload(
            event_id="evt_c1",
            account_id="acct_009",
            call_id="call_dup",
            duration_seconds=600,
            cost_cents=20,
        ),
    )
    second = post_event(
        client,
        event_payload(
            event_id="evt_c2",
            account_id="acct_009",
            call_id="call_dup",
            duration_seconds=600,
            cost_cents=20,
        ),
    )
    assert first.json()["duplicate"] is False
    assert second.json()["duplicate"] is True

    usage = get_usage()
    assert usage.duration_seconds == 600
    assert usage.cost_cents == 20
    assert usage.calls_ended == 1


def test_distinct_call_ids_still_bill_independently(client):
    post_event(
        client,
        event_payload(event_id="evt_x1", account_id="acct_009", call_id="call_a", duration_seconds=100),
    )
    post_event(
        client,
        event_payload(event_id="evt_x2", account_id="acct_009", call_id="call_b", duration_seconds=200),
    )
    usage = get_usage()
    assert usage.duration_seconds == 300
    assert usage.calls_ended == 2


def make_event_due(event_id):
    with SessionLocal() as session:
        session.execute(
            CallEvent.__table__.update()
            .where(CallEvent.__table__.c.event_id == event_id)
            .values(next_attempt_at=datetime.now(timezone.utc) - timedelta(seconds=1))
        )
        session.commit()


def test_dead_letter_after_max_attempts(client, monkeypatch):
    insert_raw_event("evt_fail", "call_fail")

    def boom(session, event):
        raise RuntimeError("db down")

    monkeypatch.setattr(processing, "apply_event", boom)

    for _ in range(5):
        make_event_due("evt_fail")
        assert processing.sweep_pending(lambda: SessionLocal()) == 0

    event = get_event("evt_fail")
    assert event.dead is True
    assert event.attempts == 5
    assert "db down" in event.last_error

    monkeypatch.undo()

    make_event_due("evt_fail")
    assert processing.sweep_pending(lambda: SessionLocal()) == 0
    assert get_event("evt_fail").dead is True


def test_retry_backoff_grows_between_attempts(client, monkeypatch):
    insert_raw_event("evt_backoff", "call_backoff")

    def boom(session, event):
        raise RuntimeError("transient")

    monkeypatch.setattr(processing, "apply_event", boom)
    delays = []
    original_schedule = processing.schedule_retry

    def spy_schedule(session, event, error):
        original_schedule(session, event, error)
        delays.append(event.next_attempt_at - datetime.now(timezone.utc))

    monkeypatch.setattr(processing, "schedule_retry", spy_schedule)

    processing.sweep_pending(lambda: SessionLocal())
    make_event_due("evt_backoff")
    processing.sweep_pending(lambda: SessionLocal())

    assert len(delays) == 2
    assert delays[1] > delays[0]
    assert abs(delays[0] - timedelta(seconds=2)) < timedelta(milliseconds=500)
    assert abs(delays[1] - timedelta(seconds=4)) < timedelta(milliseconds=500)

    event = get_event("evt_backoff")
    assert event.dead is False
    assert event.attempts == 2

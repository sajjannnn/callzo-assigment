import datetime as dt
import logging

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import (
    RETRY_BACKOFF_BASE_SECONDS,
    RETRY_BACKOFF_CAP_SECONDS,
    RETRY_MAX_ATTEMPTS,
)
from app.logging_setup import incr
from app.models import CallEvent, UsageMonthly

logger = logging.getLogger(__name__)

END = "call.ended"
START = "call.started"
FAIL = "call.failed"


def month_of(occurred_at: dt.datetime) -> dt.date:
    return occurred_at.astimezone(dt.timezone.utc).date().replace(day=1)


def usage_deltas(event: CallEvent) -> dict[str, int]:
    if event.event_type == END:
        return {
            "duration_seconds": event.duration_seconds,
            "cost_cents": event.cost_cents,
            "calls_ended": 1,
        }
    if event.event_type == START:
        return {"calls_started": 1}
    if event.event_type == FAIL:
        return {"calls_failed": 1}
    return {}


def apply_event(session: Session, event: CallEvent) -> int:
    deltas = usage_deltas(event)
    if not deltas:
        raise ValueError(f"unsupported event_type: {event.event_type}")

    stmt = (
        pg_insert(UsageMonthly)
        .values(
            account_id=event.account_id,
            period_month=month_of(event.occurred_at),
            **deltas,
        )
        .returning(UsageMonthly.duration_seconds)
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_usage_account_month",
        set_={
            col: getattr(UsageMonthly, col) + deltas[col] for col in deltas
        }
        | {"updated_at": dt.datetime.now(dt.timezone.utc)},
    )
    total_seconds = session.execute(stmt).scalar_one()
    event.processed_at = dt.datetime.now(dt.timezone.utc)
    event.attempts += 1
    return total_seconds


def _backoff_seconds(attempts: int) -> float:
    delay = RETRY_BACKOFF_BASE_SECONDS * (2 ** max(0, attempts - 1))
    return min(delay, RETRY_BACKOFF_CAP_SECONDS)


def schedule_retry(session: Session, event: CallEvent, error: Exception) -> None:
    event.attempts += 1
    event.last_error = str(error)[:512]
    if event.attempts >= RETRY_MAX_ATTEMPTS:
        event.dead = True
        incr("events_dead_lettered")
        logger.error(
            "event_dead_lettered",
            extra={"event_id": event.event_id, "attempts": event.attempts},
        )
    else:
        delay = _backoff_seconds(event.attempts)
        event.next_attempt_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=delay)
        logger.warning(
            "event_retry_scheduled",
            extra={
                "event_id": event.event_id,
                "attempts": event.attempts,
                "delay_seconds": delay,
            },
        )
    session.commit()


def claim_due_event_ids(session_factory, batch: int) -> list[int]:
    with session_factory() as session:
        rows = session.scalars(
            select(CallEvent.id)
            .where(
                CallEvent.processed_at.is_(None),
                CallEvent.dead.is_(False),
                CallEvent.next_attempt_at <= dt.datetime.now(dt.timezone.utc),
            )
            .order_by(CallEvent.next_attempt_at)
            .limit(batch)
            .with_for_update(skip_locked=True)
        ).all()
        session.commit()
        return list(rows)


def sweep_pending(session_factory, batch: int = 200) -> int:
    event_ids = claim_due_event_ids(session_factory, batch)
    processed = 0
    for event_id in event_ids:
        with session_factory() as session:
            event = session.scalars(
                select(CallEvent)
                .where(CallEvent.id == event_id, CallEvent.processed_at.is_(None))
                .with_for_update()
            ).first()
            if event is None:
                continue
            try:
                apply_event(session, event)
                session.commit()
                processed += 1
            except Exception as exc:
                session.rollback()
                logger.exception("event_apply_failed", extra={"event_id": event.event_id})
                schedule_retry(session, event, exc)
    return processed


RECONCILE_SQL = text(
    """
    INSERT INTO usage_monthly
        (account_id, period_month, duration_seconds, cost_cents,
         calls_started, calls_ended, calls_failed, updated_at)
    SELECT
        e.account_id,
        date_trunc('month', e.occurred_at AT TIME ZONE 'UTC')::date,
        COALESCE(SUM(CASE WHEN e.event_type = 'call.ended'
                          THEN e.duration_seconds ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN e.event_type = 'call.ended'
                          THEN e.cost_cents ELSE 0 END), 0),
        COUNT(*) FILTER (WHERE e.event_type = 'call.started'),
        COUNT(*) FILTER (WHERE e.event_type = 'call.ended'),
        COUNT(*) FILTER (WHERE e.event_type = 'call.failed'),
        now()
    FROM call_events e
    GROUP BY e.account_id, 2
    ON CONFLICT (account_id, period_month) DO UPDATE SET
        duration_seconds = EXCLUDED.duration_seconds,
        cost_cents = EXCLUDED.cost_cents,
        calls_started = EXCLUDED.calls_started,
        calls_ended = EXCLUDED.calls_ended,
        calls_failed = EXCLUDED.calls_failed,
        updated_at = now()
    """
)

DELETE_ORPHANS_SQL = text(
    """
    DELETE FROM usage_monthly um
    WHERE NOT EXISTS (
        SELECT 1 FROM call_events e
        WHERE e.account_id = um.account_id
          AND date_trunc('month', e.occurred_at AT TIME ZONE 'UTC')::date
              = um.period_month
    )
    """
)


def reconcile(session: Session) -> dict[str, int]:
    session.execute(text("LOCK TABLE usage_monthly IN EXCLUSIVE MODE"))
    result = session.execute(RECONCILE_SQL)
    rowcount = result.rowcount or 0
    orphans = session.execute(DELETE_ORPHANS_SQL)
    session.execute(
        CallEvent.__table__.update().values(processed_at=dt.datetime.now(dt.timezone.utc))
    )
    session.commit()
    incr("reconciliations")
    return {"usage_rows_upserted": rowcount, "orphan_rows_deleted": orphans.rowcount or 0}

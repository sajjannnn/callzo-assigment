import logging
import threading

from app.config import RETRY_INTERVAL_SECONDS
from app.db import SessionLocal
from app.logging_setup import incr
from app.processing import sweep_pending

logger = logging.getLogger("app.retry")


def retry_loop(stop_event: threading.Event) -> None:
    logger.info(
        "retry_worker_started", extra={"interval_seconds": RETRY_INTERVAL_SECONDS}
    )
    while not stop_event.is_set():
        try:
            count = sweep_pending(SessionLocal)
            if count:
                incr("events_retried", count)
                logger.info("retry_sweep_processed", extra={"events": count})
        except Exception:
            logger.exception("retry_sweep_failed")
        stop_event.wait(RETRY_INTERVAL_SECONDS)
    logger.info("retry_worker_stopped")

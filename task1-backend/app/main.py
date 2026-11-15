from contextlib import asynccontextmanager
from threading import Event, Thread

from fastapi import FastAPI, Depends
from sqlalchemy import func, select, text

from app import usage, webhooks
from app.config import LOG_LEVEL
from app.db import SessionLocal
from app.logging_setup import incr, setup_logging, snapshot
from app.models import CallEvent, UsageMonthly
from app.retry_job import retry_loop

setup_logging(LOG_LEVEL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    stop = Event()
    worker = Thread(target=retry_loop, args=(stop,), daemon=True)
    worker.start()
    yield
    stop.set()
    worker.join(timeout=5)


app = FastAPI(title="Callzo Usage Metering Service", lifespan=lifespan)
app.include_router(webhooks.router)
app.include_router(usage.router)


@app.get("/health")
def health():
    with SessionLocal() as session:
        session.execute(text("SELECT 1"))
        pending = session.scalar(
            select(func.count()).select_from(CallEvent).where(
                CallEvent.processed_at.is_(None)
            )
        )
        usage_rows = session.scalar(select(func.count()).select_from(UsageMonthly))
    return {
        "status": "ok",
        "pending_events": pending,
        "usage_rows": usage_rows,
    }


@app.get("/metrics", dependencies=[Depends(usage.require_auth)])
def metrics():
    return snapshot()

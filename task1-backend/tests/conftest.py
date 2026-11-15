import hashlib
import hmac
import json
import os
import subprocess
import sys

os.environ["DATABASE_URL"] = (
    "postgresql+psycopg://callzo:callzo@localhost:5432/callzo_test"
)
os.environ.setdefault("API_AUTH_TOKEN", "test_token")
os.environ.setdefault("WEBHOOK_SECRET", "callzo_test_secret_change_me")
os.environ.setdefault("MONTHLY_CAP_SECONDS", "36000")
os.environ.setdefault("RETRY_INTERVAL_SECONDS", "3600")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, text

from app.db import Base, SessionLocal, engine
from app.main import app
from app.models import CallEvent, UsageMonthly
from app.processing import sweep_pending

SECRET = os.environ["WEBHOOK_SECRET"]
AUTH = {"Authorization": "Bearer test_token"}


@pytest.fixture(scope="session", autouse=True)
def schema():
    with engine.connect() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
        connection.commit()
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        check=True,
        cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        env={**os.environ},
    )
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def clean_db():
    with SessionLocal() as session:
        session.execute(delete(CallEvent))
        session.execute(delete(UsageMonthly))
        session.commit()
    yield


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def event_payload(**overrides):
    base = {
        "event_id": "evt_1",
        "event_type": "call.ended",
        "account_id": "acct_001",
        "call_id": "call_1",
        "timestamp": "2026-11-01T10:15:30.123456+00:00",
        "duration_seconds": 600,
        "cost_cents": 20,
        "destination_country": "US",
    }
    base.update(overrides)
    return base


def post_event(client, payload, signature=None, secret=SECRET):
    body = json.dumps(payload).encode()
    if signature is None:
        signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    headers = {"X-Signature": signature, "Content-Type": "application/json"}
    return client.post("/webhooks/calls", content=body, headers=headers)

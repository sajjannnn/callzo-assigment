import os


def _get(name: str, default: str) -> str:
    return os.environ.get(name, default)


WEBHOOK_SECRET = _get("WEBHOOK_SECRET", "callzo_test_secret_change_me")
API_AUTH_TOKEN = _get("API_AUTH_TOKEN", "callzo_dev_token")
DATABASE_URL = _get(
    "DATABASE_URL",
    "postgresql+psycopg://callzo:callzo@db:5432/callzo",
)
MONTHLY_CAP_SECONDS = int(_get("MONTHLY_CAP_SECONDS", "18000"))
RETRY_INTERVAL_SECONDS = float(_get("RETRY_INTERVAL_SECONDS", "5"))
RETRY_MAX_ATTEMPTS = int(_get("RETRY_MAX_ATTEMPTS", "5"))
RETRY_BACKOFF_BASE_SECONDS = float(_get("RETRY_BACKOFF_BASE_SECONDS", "2"))
RETRY_BACKOFF_CAP_SECONDS = float(_get("RETRY_BACKOFF_CAP_SECONDS", "300"))
LOG_LEVEL = _get("LOG_LEVEL", "INFO")

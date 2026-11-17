# Task 1 — Usage Metering Service

Receives call events from the telephony provider webhook, stores raw events in
Postgres, computes per-account monthly usage, enforces a monthly cap, and
exposes usage through an authenticated API.

## Run

```bash
docker compose up
```

This starts Postgres, the API (port 8000), and the provided simulator running
the `all` scenario. To target one scenario at a time, edit the simulator's
`command` in `docker-compose.yml` (e.g. `--scenario duplicates`).

```bash
cp .env.example .env   # optional; compose already has working defaults
```

The webhook secret and API token are read from the environment, never
hardcoded in the source. `.env.example` lists every variable.

## Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /webhooks/calls` | HMAC signature | Receive provider events |
| `GET /health` | none | Liveness + pending-event count |
| `GET /metrics` | Bearer | Counters: accepted/duplicate/rejected events |
| `GET /usage/{account_id}?month=YYYY-MM` | Bearer | One account's month usage + cap status. With no row for the requested month, returns the latest month that has one (documented fallback, not an error) |
| `GET /usage?month=YYYY-MM` | Bearer | All accounts for a month |
| `GET /usage/{account_id}/history` | Bearer | Recent months |
| `POST /admin/reconcile` | Bearer | Recompute all usage from raw events |

Usage API auth: `Authorization: Bearer $API_AUTH_TOKEN`.

## Design decisions

**Schema.** Two tables:
- `call_events` — append-only raw events, `event_id` UNIQUE. This is the
  source of truth. `processed_at` NULL means "stored but not yet applied to
  aggregates" and drives the retry job. Retries are tracked with
  `attempts`, `next_attempt_at`, `dead`, and `last_error`.
- `usage_monthly` — one row per (account, month) with integer
  `duration_seconds` and `cost_cents`. A cache of the aggregate; always
  recomputable from `call_events` via `/admin/reconcile`.

Indexing: a partial unique index on `call_id WHERE event_type =
'call.ended'` makes double-billing the same call impossible even across
different `event_id`s; a partial index on pending, non-dead events keeps
the sweeper's due-event scan cheap.

**Idempotency.** Two layers:
- *Event level* — duplicate deliveries (same `event_id`) are dropped by a
  Postgres `INSERT ... ON CONFLICT DO NOTHING` before any aggregation, so
  replayed events never double-count. First delivery wins; a duplicate
  with different content but same `event_id` is still ignored.
- *Call level* — a second `call.ended` for a call we already billed (new
  `event_id`, same `call_id`) hits the partial unique index and is
  dropped the same way.

**Out-of-order.** Usage is derived from `call.ended` events only
(`duration_seconds`, `cost_cents` travel on the ended event), so totals are
independent of arrival order. `call.started`/`call.failed` only increment
counters. An ended-before-started pair lands in the right place automatically.

**Late events.** An event is assigned to the month of its own `timestamp`
(not the arrival date): a call that happened last month counts as last
month's usage. This matches how a billing report would look up a call by
when it happened, and makes the rule a one-liner (`date_trunc('month',
occurred_at)`) instead of a special case.

**Monthly cap — SOFT.** `MONTHLY_CAP_SECONDS` (default 18000 = 5h/month).
Usage is always recorded even past the cap; nothing is dropped. The cap
surfaces as `cap_exceeded` / `cap_usage_percent` in the usage API, and a
`monthly_cap_reached` structured warning is logged when a `call.ended`
crosses the threshold. Rationale: silently dropping metered calls risks
billing disputes; flagging lets the product decide (throttle, alert, bill
overage) without losing data. Hard-capping would be a product decision, not
a metering one.

**Retries.** The webhook stores the raw event and commits that insert
*before* attempting aggregation — two separate transactions. If applying
fails, the insert is already durable: the row stays `processed_at = NULL`,
the failure is scheduled in `next_attempt_at`, and the request answers
`503` so the provider knows delivery isn't fully handled yet (a resend is
deduplicated safely). A background sweeper (thread, every
`RETRY_INTERVAL_SECONDS`) retries with fresh transactions. Each attempt
backs off exponentially (`RETRY_BACKOFF_BASE_SECONDS` × 2^(n−1), capped at
`RETRY_BACKOFF_CAP_SECONDS`); the next due time is stored in
`next_attempt_at` so restarts don't reset the schedule. After
`RETRY_MAX_ATTEMPTS` (5) failures the event is dead-lettered (`dead =
true`, error kept in `last_error`) instead of retrying forever — poison
events surface in logs and metrics rather than churning the DB. The
sweeper claims due events with `FOR UPDATE SKIP LOCKED`, so even a stale
or racing sweeper can't double-apply an event. A failure-injection test
pins this guarantee: a forced aggregate-write failure leaves the row in
place and the sweeper applies it later. Schema is managed by Alembic
(`alembic upgrade head` runs before the API starts in compose).

**Reconciliation.** `POST /admin/reconcile` recomputes `usage_monthly`
entirely from `call_events` (upsert + deletes orphan rows), so drift from
bugs or manual edits is self-healing. In production this would be scheduled
instead of on-demand.

**Signature verification.** HMAC-SHA256 over the *raw* request bytes, read
before any JSON parsing, compared with `hmac.compare_digest`. Invalid or
missing `X-Signature` → `403` before the payload is touched.

**Error handling.** Empty body / truncated JSON → `400`; missing fields,
wrong types, unknown `event_type` → `422`. The process never crashes on bad
input; the simulator's malformed/bad_signature scenarios all get clean 4xx
responses.

## What I'd do next with more time

- Move the sweeper to a separate process/queue (e.g. a worker service) so
  API pods stay stateless.
- Per-account caps in a table instead of one global env value.
- Rate limiting and payload size limits on the webhook.
- OpenTelemetry tracing; the metrics endpoint is deliberately minimal.

## Tests

```bash
docker run -d --name callzo-test-db -e POSTGRES_USER=callzo \
  -e POSTGRES_PASSWORD=callzo -e POSTGRES_DB=callzo_test -p 5432:5432 \
  postgres:16-alpine
python -m venv .venv && .venv/bin/pip install -r requirements.txt pytest httpx
.venv/bin/pytest
```

24 tests cover: signature verification (missing/invalid/tampered body),
event-level and call-level duplicates, out-of-order, late events,
malformed payloads (empty, truncated, missing field, wrong type, unknown
type, NaN body), cap burst, auth, reconciliation repair, retry backoff
timing, dead-lettering after max attempts, `call.failed` counting, and
the store-then-apply failure path (forced aggregate-write failure keeps
the raw event; the sweeper applies it later).

## Simulator note

`meetrj/callzo-webhook-simulator` is published for `linux/arm64` only. On
amd64 hosts, register qemu emulation first (one-time):

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm64
```

Docker Desktop already includes this.

# Architecture

Both tasks are small on purpose. This document explains the shared
thinking and the load-bearing decisions; each task's README covers the
task-specific behavior in depth.

## One idea per layer

```
Provider webhooks ──▶ call_events (append-only, raw)  ──▶ usage_monthly (derived cache)
                              │                                     │
                              └── retries / reconcile ──────────────┘
                                                                      │
                                              GET /usage/*  ──▶  Admin console (Task 2)
```

- `call_events` is the only source of truth: raw provider payloads, stored
  verbatim, append-only. Nothing aggregates away history.
- `usage_monthly` is a cache. Any bug or manual edit can be healed by
  recomputing it from `call_events` (`POST /admin/reconcile`), so the cache
  is never trusted as truth.
- The console (Task 2) is a thin view over the usage API. It holds view
  state (filters, sort, selection) in the URL and zero business state.

## Invariants

1. **Money and seconds are integers.** `duration_seconds` and `cost_cents`
   are `INTEGER` end to end (DB → API → UI). No floats anywhere; `$123.45`
   is rendered as `floor(cents/100)` + padded remainder.
2. **First delivery wins.** `event_id` has a UNIQUE constraint and the
   insert is `ON CONFLICT DO NOTHING` — duplicates are dropped before any
   aggregation can see them. A partial unique index on `call_id WHERE
   event_type = 'call.ended'` additionally prevents the same call being
   billed twice under different `event_id`s.
3. **Events are applied at their own timestamp.** A `call.ended` row feeds
   `date_trunc('month', occurred_at)`, so late/out-of-order arrivals land
   in the month the call happened, not the month they arrived.
4. **Store-then-apply.** The webhook validates, inserts the raw event, and
   commits — in its own transaction — before attempting aggregation. If
   aggregation fails, the row stays `processed_at = NULL` and the request
   answers `503`; the sweeper retries. A failure-injection test pins this:
   a forced apply failure leaves the row in place. A DB blip costs delay,
   never data.
5. **Usage is derived from `call.ended` only.** Totals are independent of
   arrival order; `started`/`failed` events only touch counters.

## Failure handling (backend)

- Signature is verified over raw bytes with `hmac.compare_digest` before
  parsing: bad signature → `403`, truncated/malformed JSON → `400`,
  unknown fields/types → `422`. Bad input never reaches the DB and never
  crashes the process.
- Retries use attempt-based exponential backoff (2s × 2^(n−1), capped at
  300s). After `RETRY_MAX_ATTEMPTS` (5) failures the event is dead-lettered
  (`dead = true`, `last_error` set) instead of retrying forever; the
  sweeper claims due events with `FOR UPDATE SKIP LOCKED`, so stale
  threads can't double-apply.
- The monthly cap is soft: usage is always recorded; crossing the cap sets
  `cap_exceeded` + `cap_usage_percent` in the API and logs a
  `monthly_cap_reached` warning inside the same transaction that applied
  the event.

## Failure handling (frontend)

- Every fetch runs under an `AbortController`; stale responses (user
  typed a new filter) are aborted, never raced.
- Background polls (5s) don't replace table rows — they merge row updates
  into the current order and set a flag when the server's ordering
  differs, letting the user opt in to the resort instead of having rows
  jump under their cursor. Polls are skipped entirely while the tab is
  hidden.
- The chart endpoint fails ~1 in 5: one quiet automatic retry (≈400ms)
  covers most blips; persistent failure degrades to an inline error with a
  manual Retry, and the rest of the page keeps working.
- Poll failures against the table show a non-blocking banner and keep the
  last good data.
- An `ErrorBoundary` catches render-time crashes and offers a reload
  instead of a white screen.

## Testing strategy

- **Backend:** pytest against a real Postgres (schema created by the same
  Alembic migration the container runs, so tests and prod share DDL).
  24 tests: signature/duplicate/order/late/cap/auth coverage plus
  dead-letter, backoff timing, and call-level dedup.
- **Frontend:** pure logic is extracted into `src/lib/` (money format,
  URL param round-trip, poll merge, settings schema) and tested with
  Node's built-in test runner; components get render-level tests via
  `react-dom/server`. No test framework dependency, which the
  assignment's library restriction makes the right trade-off.

## Deliberate limits

- No Redis/queue: Postgres row locks + a sweeper thread cover the volume
  this service will see; a real queue is the first thing to add when
  webhook throughput grows (documented in the task READMEs).
- No per-account cap table: one env value is enough for the assessment's
  scenario; the schema change is mechanical.
- No component/data-fetching libraries in Task 2 beyond React + Tailwind
  + Recharts, per the assignment constraints.

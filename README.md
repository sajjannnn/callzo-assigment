# Callzo Engineering Assessment

Two-task take-home submission:

- **[task1-backend](./task1-backend)** — Usage metering service (FastAPI +
  Postgres): signed webhooks, idempotency, out-of-order/late events, monthly
  cap, retries, reconciliation, authenticated usage API.
- **[task2-frontend](./task2-frontend)** — Usage admin console (React +
  Tailwind + Recharts): server-side table over a flaky mock API, 4-step
  autosaving settings form, resilient polling.

## Run

```bash
cd task1-backend && docker compose up     # API on :8000, simulator included
cd task2-frontend && docker compose up    # UI on :3000, mock API on :8001
```

> **Note for amd64 / plain Linux hosts:** the provider images used by both
> tasks (`meetrj/callzo-webhook-simulator` and
> `meetrj/callzo-mock-usage-api`) are published for `linux/arm64` only. Run
> this once before `docker compose up`:
>
> ```bash
> docker run --privileged --rm tonistiigi/binfmt --install arm64
> ```
> Docker Desktop handles this automatically; plain Linux needs the command
> above once. After that, `docker compose up` works normally.

See each task's README for design decisions, failure behavior, and what I
would do next with more time. [ARCHITECTURE.md](./ARCHITECTURE.md) covers
the cross-cutting invariants (money as integer cents, first-delivery-wins
idempotency, store-then-apply retries, derived-cache reconciliation) and
how the two tasks fit together.

# Task 2 — Usage Admin Console

React (Vite + TypeScript) + Tailwind + Recharts admin console over the
provided mock usage API. Everything runs with one command:

```bash
docker compose up
```

Then open http://localhost:3000. The mock API is also exposed on
http://localhost:8001 for direct inspection.

The `frontend` service references the pre-built image
`sajjannnn/callzo-task2-frontend` (no `build:`), so `docker compose up` works
without cloning the source. Note: `meetrj/callzo-mock-usage-api` is published
for `linux/arm64` only; on amd64 hosts Docker Desktop handles this via
emulation automatically (plain Linux needs
`docker run --privileged --rm tonistiigi/binfmt --install arm64` once).

## What's in the app

- **Accounts table** — server-side search (debounced), status/country/plan
  filters, sortable columns, pagination. All of it lives in the URL, so a
  filtered/sorted view can be shared or refreshed.
- **Summary chart** — daily minutes + signups (Recharts), driven by the same
  date-range filter as the table. The mock API fails this endpoint ~1 in 5
  calls; the chart panel shows an inline error with a Retry button and the
  rest of the page keeps working. Background polls that fail show a
  non-blocking banner and keep the last good data.
- **4-step settings form** — autosaving drafts, back/forward navigation,
  draft restore on reopen, server-side errors shown on the step they belong
  to, and final submit with missing-step feedback.
- **Polling** — the table refetches every 5s. New data is merged into state
  without a loading phase, so the UI doesn't jump and selection survives.
  When a poll reports that the server's sort order would change, a small
  "refresh view" affordance appears instead of silently reordering rows
  under the cursor. Polls are skipped while the tab is hidden, and every
  fetch is abortable so stale responses can't overwrite newer state.

## Where state lives

| State | Where | Why |
|---|---|---|
| Search/sort/filters/page/page size | URL query params | Shareable, survives refresh, back button works; the server owns the data so the client only owns the view |
| Row selection | URL (`sel=`) | Selection must stay stable across pages and refreshes; URL makes that trivial and visible |
| Table/chart data | Server (fetched) | Always fresh from the API; the client never caches beyond one render cycle |
| Form drafts | Client + server | Local edits live in component state; each step autosaves (800ms debounce) via PUT, so a refresh loses at most 800ms of typing; saved values restored from `GET /settings` |
| Current form step | Client | Transient UI state, not worth URL surface |

## Deliberate API quirks and how they're handled

**Summary endpoint fails ~1 in 5 (500).** One quiet automatic retry
(≈400ms later) absorbs most blips without any UI noise. If it still
fails, the chart hook keeps table state untouched, renders an inline
error panel with Retry, and shows the last good chart if a later poll
fails.

**Step 2 starts rejecting `billing_country` after step 4 exists.** The 422
is displayed as a field-level error on step 2, nothing crashes, and values
on other steps are never lost. If the data being re-saved is identical to
what the server already has (the common case), the modal explains that the
earlier save is still intact and lets the user continue without being
stuck. If the user actually changed step 2, they see the server's error and
must adjust — the change simply won't persist until the server accepts it.

**Failed saves roll back cleanly.** A failed step save never marks the step
as saved (the step indicator stays unsaved), local edits are kept so the
user doesn't retype, and submit reports exactly which steps still need a
successful save (parsed from the API's `missing_steps`).

## Accessibility & responsive

- Every control has a real label; sortable headers are buttons with
  `aria-sort`; selection uses native checkboxes (keyboard-operable);
  focus is visible via Tailwind focus rings; a skip link jumps straight
  to the main content.
- The modal is a native `<dialog>` (`showModal()` gives focus trapping
  and Escape-to-close for free), autofocuses its first field, and closes
  cleanly if the component unmounts.
- Async states announced with `aria-live` (saving/saved/error, refresh
  banner, totals).
- Render-time crashes are caught by an `ErrorBoundary` that offers a
  reload instead of a white screen.
- Usable at 375px: filters and table wrapper scroll horizontally instead of
  breaking layout; the modal scrolls within the viewport.

## What I cut and why

- **No data-fetching library** (React Query etc.) — the assignment limits
  dependencies to React + Tailwind + a chart lib. A 60-line hook covers
  fetch/poll/error for two endpoints; a library would add weight, not value.
  (`oxlint` is dev-only lint tooling in the same spirit — it never ships in
  the app bundle.)
- **No router** — one page + one modal; URL params via `history` API are
  enough, and a router would violate the same constraint.
- **No optimistic updates on form saves** — saves are tiny and fast;
  optimistic UI would complicate the rollback story for little gain.
- **No bulk actions on selection** — nothing in the spec needs it; the
  selection is kept stable because the spec demands it survives refresh,
  not because there's something to do with it yet.
- **Chart shows two series, not four** — minutes and signups cover "usage
  and growth"; plotting all four at once made the chart unreadable at
  375px. Cost per day is shown in the footer line as a number instead.

## Local development

```bash
npm install
npm run dev      # proxies /api -> http://localhost:8001
npm test         # tsc-compile + node --test — zero test-framework dependencies
```

The API base is `/api` everywhere (no CORS involved): Vite's dev server
proxies it in dev; nginx proxies it in the container via `MOCK_API_URL`
(see `.env.example`).

Pure logic (money formatting, URL param parsing/round-trip, poll merge
semantics, settings schema/validation) lives in `src/lib/` and is tested
with Node's built-in test runner. Components get render-level tests via
`react-dom/server` (`renderToStaticMarkup` asserts table markup, money
formatting, `aria-sort`, empty/loading states, and filter labels) — both
without adding a test framework, which the assignment's library
restriction makes the right trade-off. Relative imports in `src` use
explicit `.ts`/`.tsx` extensions so the same sources compile for both
Vite and the Node test runner.

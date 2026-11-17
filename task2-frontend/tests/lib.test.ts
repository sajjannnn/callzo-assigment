import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatDollars } from '../src/lib/money.ts'
import { mergeRefreshedPage, type Page } from '../src/lib/tableMerge.ts'
import {
  buildQuery,
  parseTableState,
  SORTABLE_FIELDS,
} from '../src/lib/urlParams.ts'
import {
  clientValidate,
  samePayload,
  settingsFromApi,
  toApiPayload,
} from '../src/lib/settingsSchema.ts'

function page(rows: { id: number; [key: string]: unknown }[]): Page<{ id: number }> {
  return { data: rows, total: rows.length, page: 1, page_size: rows.length }
}

test('formatDollars uses integer math only', () => {
  assert.equal(formatDollars(0), '$0.00')
  assert.equal(formatDollars(5), '$0.05')
  assert.equal(formatDollars(149900), '$1499.00')
  assert.equal(formatDollars(12345), '$123.45')
  assert.equal(formatDollars(-250), '-$2.50')
})

test('mergeRefreshedPage keeps row order and reports change', () => {
  const current = page([{ id: 1 }, { id: 2 }, { id: 3 }])
  const fresh = page([{ id: 3 }, { id: 1 }, { id: 2 }])
  const merged = mergeRefreshedPage(current, fresh)
  assert.deepEqual(merged.data.map((row) => row.id), [1, 2, 3])
  assert.equal(merged.orderChanged, true)
})

test('mergeRefreshedPage updates values in place without reordering', () => {
  const current = page([
    { id: 1, minutes: 10 },
    { id: 2, minutes: 20 },
  ])
  const fresh = page([
    { id: 1, minutes: 99 },
    { id: 2, minutes: 20 },
  ])
  const merged = mergeRefreshedPage(current, fresh)
  assert.equal((merged.data[0] as { minutes?: unknown }).minutes, 99)
  assert.equal((merged.data[1] as { minutes?: unknown }).minutes, 20)
  assert.equal(merged.orderChanged, false)
})

test('mergeRefreshedPage keeps rows missing from the fresh page', () => {
  const current = page([{ id: 1 }, { id: 2 }])
  const fresh = page([{ id: 1 }])
  const merged = mergeRefreshedPage(current, fresh)
  assert.deepEqual(merged.data.map((row) => row.id), [1, 2])
  assert.equal(merged.orderChanged, true)
})

test('parseTableState validates and clamps', () => {
  const params = new URLSearchParams(
    'sort=cost_cents&dir=desc&page=3&page_size=100&sel=4,2,2,bad&from=2025-01-01',
  )
  const state = parseTableState(params)
  assert.equal(state.sortBy, 'cost_cents')
  assert.equal(state.sortDir, 'desc')
  assert.equal(state.page, 3)
  assert.equal(state.pageSize, 100)
  assert.deepEqual(state.selection, [2, 4])
  assert.equal(state.dateFrom, '2025-01-01')
})

test('parseTableState falls back to defaults on bad input', () => {
  const params = new URLSearchParams('sort=hack;drop&page=-5&page_size=9999')
  const state = parseTableState(params)
  assert.equal(state.sortBy, 'id')
  assert.equal(state.sortDir, 'asc')
  assert.equal(state.page, 1)
  assert.equal(state.pageSize, 200)
  assert.deepEqual(state.selection, [])
  assert.ok(SORTABLE_FIELDS.has('cost_cents'))
})

test('buildQuery emits spec param names and round-trips', () => {
  const state = parseTableState(new URLSearchParams('q=liam&status=active&page=2'))
  const query = buildQuery(state)
  assert.equal(query, 'search=liam&status=active&sort_by=id&sort_dir=asc&page=2&page_size=50')
  const reparsed = parseTableState(new URLSearchParams('q=liam&page=2'))
  assert.equal(reparsed.search, 'liam')
  assert.equal(reparsed.page, 2)
  const dated = buildQuery({
    ...parseTableState(new URLSearchParams()),
    dateFrom: '2020-01-01',
    dateTo: '2020-12-31',
  })
  assert.ok(dated.includes('date_from=2020-01-01') && dated.includes('date_to=2020-12-31'))
})

test('clientValidate mirrors server rules', () => {
  const step0 = clientValidate(0, { name: '', email: 'nope' })
  assert.equal(step0.name, 'Name is required')
  assert.equal(step0.email, 'Email must contain an @')

  const step3 = clientValidate(3, { webhook_url: 'ftp://x' })
  assert.match(step3.webhook_url ?? '', /http/)

  assert.deepEqual(clientValidate(2, { minutes_cap: '12' }), {})
  assert.equal(clientValidate(2, { minutes_cap: '-5' }).minutes_cap, 'Minutes cap must be a whole number')
})

test('toApiPayload coerces numbers and omits empties', () => {
  const payload = toApiPayload(2, { minutes_cap: '120', sms_cap: '' })
  assert.deepEqual(payload, { minutes_cap: 120 })
  assert.deepEqual(toApiPayload(0, {}), {})
})

test('samePayload compares serialized payloads', () => {
  assert.equal(samePayload({ a: 1 }, { a: 1 }), true)
  assert.equal(samePayload({ a: 1 }, { a: 2 }), false)
})

test('settingsFromApi restores drafts and saved steps', () => {
  const restored = settingsFromApi({
    '1': { name: 'Liam', email: 'liam@x.com' },
    '2': { plan: 'pro', billing_country: 'IN' },
    '9': { ignored: true },
  })
  assert.deepEqual(restored.savedSteps, [1, 2])
  assert.equal(restored.values[1]?.name, 'Liam')
  assert.equal(restored.values[2]?.billing_country, 'IN')
})

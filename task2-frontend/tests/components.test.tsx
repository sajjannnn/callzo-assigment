import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { type Account } from '../src/api.ts'
import { AccountsTable } from '../src/components/AccountsTable.tsx'
import { FilterBar } from '../src/components/FilterBar.tsx'

const noop = () => {}

const account: Account = {
  id: 7,
  name: 'Liam Patel',
  email: 'liam.patel1@example.com',
  company: 'Orbit Group',
  country: 'CA',
  plan: 'basic',
  status: 'active',
  signup_date: '2025-05-16',
  current_month_minutes: 706,
  current_month_sms: 391,
  cost_cents: 237652,
  last_active: '2025-06-19',
}

test('AccountsTable renders rows, money, and checkboxes', () => {
  const html = renderToStaticMarkup(
    h(AccountsTable, {
      accounts: [account],
      total: 10500,
      page: 1,
      pageSize: 50,
      sortBy: 'name',
      sortDir: 'asc',
      selected: new Set<number>([7]),
      loading: false,
      onSortChange: noop,
      onPageChange: noop,
      onToggleRow: noop,
      onToggleAll: noop,
      onOpenSettings: noop,
    }),
  )
  assert.ok(html.includes('Liam Patel'))
  assert.ok(html.includes('$2376.52'))
  assert.ok(html.includes('aria-sort="ascending"'))
  assert.ok(html.includes('type="checkbox"'))
  assert.ok(html.includes('checked'))
})

test('AccountsTable shows empty state and no aria-sort when unsorted', () => {
  const html = renderToStaticMarkup(
    h(AccountsTable, {
      accounts: [],
      total: 0,
      page: 1,
      pageSize: 50,
      sortBy: 'id',
      sortDir: 'asc',
      selected: new Set<number>(),
      loading: false,
      onSortChange: noop,
      onPageChange: noop,
      onToggleRow: noop,
      onToggleAll: noop,
      onOpenSettings: noop,
    }),
  )
  assert.ok(html.includes('No accounts match your filters'))
  assert.ok(!html.includes('aria-sort='))
})

test('AccountsTable renders loading skeleton instead of rows', () => {
  const html = renderToStaticMarkup(
    h(AccountsTable, {
      accounts: [],
      total: 0,
      page: 1,
      pageSize: 50,
      sortBy: 'id',
      sortDir: 'asc',
      selected: new Set<number>(),
      loading: true,
      onSortChange: noop,
      onPageChange: noop,
      onToggleRow: noop,
      onToggleAll: noop,
      onOpenSettings: noop,
    }),
  )
  assert.ok(html.includes('animate-pulse'))
  assert.ok(!html.includes('No accounts match your filters'))
})

test('FilterBar labels every control and reflects the search value', () => {
  const html = renderToStaticMarkup(
    h(FilterBar, {
      values: {
        search: 'liam',
        status: 'active',
        country: '',
        plan: '',
        dateFrom: '',
        dateTo: '',
      },
      onChange: noop,
      onClear: noop,
      hasActiveFilters: true,
    }),
  )
  for (const label of ['Search', 'Status', 'Country', 'Plan', 'From', 'To']) {
    assert.ok(html.includes(label), `missing label: ${label}`)
  }
  assert.ok(html.includes('value="liam"'))
  assert.ok(html.includes('Clear filters'))
  assert.ok(html.includes('<option value="active"'))
})

test('FilterBar hides the clear button when nothing is active', () => {
  const html = renderToStaticMarkup(
    h(FilterBar, {
      values: {
        search: '',
        status: '',
        country: '',
        plan: '',
        dateFrom: '',
        dateTo: '',
      },
      onChange: noop,
      onClear: noop,
      hasActiveFilters: false,
    }),
  )
  assert.ok(!html.includes('Clear filters'))
})

import { useMemo, useState } from 'react'
import { type Account } from './api.ts'
import { AccountsTable } from './components/AccountsTable.tsx'
import { FilterBar, type FilterValues } from './components/FilterBar.tsx'
import { SettingsModal } from './components/SettingsModal.tsx'
import { SummaryChart } from './components/SummaryChart.tsx'
import { useUrlState } from './hooks.ts'
import { useAccounts } from './useAccounts.ts'
import { useSummary } from './useSummary.ts'
import { buildQuery, parseTableState } from './lib/urlParams.ts'

function readFilters(state: ReturnType<typeof parseTableState>): FilterValues {
  return {
    search: state.search,
    status: state.status,
    country: state.country,
    plan: state.plan,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
  }
}

export default function App() {
  const { params, setParam, setMany } = useUrlState()

  const table = useMemo(() => parseTableState(params), [params])
  const filters = useMemo(() => readFilters(table), [table])
  const selection = useMemo(() => new Set(table.selection), [table])

  const query = useMemo(() => buildQuery(table), [table])
  const accountsState = useAccounts(query)
  const summaryState = useSummary(filters.dateFrom || null, filters.dateTo || null)

  const [settingsAccount, setSettingsAccount] = useState<Account | null>(null)

  const hasActiveFilters = Object.values(filters).some(Boolean)

  const updateFilters = (key: keyof FilterValues, value: string) => {
    const urlKey =
      key === 'search' ? 'q' : key === 'dateFrom' ? 'from' : key === 'dateTo' ? 'to' : key
    setMany({ [urlKey]: value, page: '1' })
  }

  const clearFilters = () => {
    setMany({ q: null, status: null, country: null, plan: null, from: null, to: null, page: '1' })
  }

  const handleSortChange = (field: string) => {
    if (table.sortBy === field) {
      setMany({ dir: table.sortDir === 'asc' ? 'desc' : 'asc', page: '1' })
    } else {
      setMany({ sort: field, dir: 'asc', page: '1' })
    }
  }

  const handleToggleRow = (id: number) => {
    const next = new Set(selection)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setParam('sel', next.size === 0 ? null : [...next].sort((a, b) => a - b).join(','))
  }

  const handleToggleAll = () => {
    const pageIds = accountsState.data?.data.map((account) => account.id) ?? []
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selection.has(id))
    const next = new Set(selection)
    for (const id of pageIds) {
      if (allSelected) next.delete(id)
      else next.add(id)
    }
    setParam('sel', next.size === 0 ? null : [...next].sort((a, b) => a - b).join(','))
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-1.5 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      <header className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
          <h1 className="text-base font-semibold sm:text-lg">Callzo Usage Admin Console</h1>
          {accountsState.refreshError && (
            <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900" role="alert">
              Last auto-refresh failed — showing cached data
            </span>
          )}
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl space-y-4 px-3 py-4 sm:px-6">
        <section aria-labelledby="summary-heading" className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 id="summary-heading" className="mb-3 text-sm font-medium text-slate-700">
            Usage summary
          </h2>
          <SummaryChart state={summaryState} />
        </section>

        <section aria-labelledby="table-heading" className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="table-heading" className="text-sm font-medium text-slate-700">
              Accounts
            </h2>
            {accountsState.orderChanged && (
              <button
                type="button"
                onClick={accountsState.reload}
                className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100"
              >
                Values changed the order — refresh view
              </button>
            )}
          </div>
          <div className="mb-4">
            <FilterBar
              values={filters}
              onChange={updateFilters}
              onClear={clearFilters}
              hasActiveFilters={hasActiveFilters}
            />
          </div>
          {accountsState.loadError && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">
              {accountsState.loadError}
            </div>
          )}
          <AccountsTable
            accounts={accountsState.data?.data ?? []}
            total={accountsState.data?.total ?? 0}
            page={table.page}
            pageSize={table.pageSize}
            sortBy={table.sortBy}
            sortDir={table.sortDir}
            selected={selection}
            loading={accountsState.loading}
            onSortChange={handleSortChange}
            onPageChange={(next) => setParam('page', String(Math.max(1, next)))}
            onToggleRow={handleToggleRow}
            onToggleAll={handleToggleAll}
            onOpenSettings={setSettingsAccount}
          />
        </section>
      </main>

      {settingsAccount && (
        <SettingsModal account={settingsAccount} onClose={() => setSettingsAccount(null)} />
      )}
    </div>
  )
}

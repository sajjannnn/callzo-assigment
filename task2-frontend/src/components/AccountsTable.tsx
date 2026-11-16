import { useEffect, useRef } from 'react'
import { type Account } from '../api.ts'
import { formatDollars } from '../lib/money.ts'

interface Props {
  accounts: Account[]
  total: number
  page: number
  pageSize: number
  sortBy: string
  sortDir: 'asc' | 'desc'
  selected: Set<number>
  loading: boolean
  onSortChange: (field: string) => void
  onPageChange: (page: number) => void
  onToggleRow: (id: number) => void
  onToggleAll: () => void
  onOpenSettings: (account: Account) => void
}

const SORTABLE_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'company', label: 'Company' },
  { key: 'country', label: 'Country' },
  { key: 'plan', label: 'Plan' },
  { key: 'status', label: 'Status' },
  { key: 'signup_date', label: 'Signup date' },
  { key: 'current_month_minutes', label: 'Minutes' },
  { key: 'current_month_sms', label: 'SMS' },
  { key: 'cost_cents', label: 'Cost' },
  { key: 'last_active', label: 'Last active' },
]

const statusStyles: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  trial: 'bg-blue-100 text-blue-800',
  suspended: 'bg-red-100 text-red-800',
}

const arrow = { asc: ' ▲', desc: ' ▼' } as const

export function AccountsTable({
  accounts,
  total,
  page,
  pageSize,
  sortBy,
  sortDir,
  selected,
  loading,
  onSortChange,
  onPageChange,
  onToggleRow,
  onToggleAll,
  onOpenSettings,
}: Props) {
  const headerCheckRef = useRef<HTMLInputElement>(null)
  const pageIds = accounts.map((account) => account.id)
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length
  const allSelected = pageIds.length > 0 && selectedOnPage === pageIds.length

  useEffect(() => {
    if (headerCheckRef.current) {
      headerCheckRef.current.indeterminate = selectedOnPage > 0 && !allSelected
    }
  }, [selectedOnPage, allSelected])

  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="relative">
      {loading ? (
        <div className="flex h-64 flex-col justify-center gap-2 px-4">
          {[...Array(6)].map((_, index) => (
            <div key={index} className="h-6 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="w-full min-w-3xl text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2">
                  <input
                    ref={headerCheckRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={onToggleAll}
                    aria-label="Select all rows on this page"
                  />
                </th>
                {SORTABLE_COLUMNS.map((column) => (
                  <th
                    scope="col"
                    key={column.key}
                    className="px-3 py-2"
                    aria-sort={
                      sortBy === column.key
                        ? sortDir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      onClick={() => onSortChange(column.key)}
                      className="hover:text-slate-900 focus-visible:underline"
                    >
                      {column.label}
                      {sortBy === column.key ? arrow[sortDir] : ''}
                    </button>
                  </th>
                ))}
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.map((account) => (
                <tr
                  key={account.id}
                  className={selected.has(account.id) ? 'bg-blue-50' : 'hover:bg-slate-50'}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(account.id)}
                      onChange={() => onToggleRow(account.id)}
                      aria-label={`Select ${account.name}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{account.name}</div>
                    <div className="text-xs text-slate-500">{account.email}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{account.company}</td>
                  <td className="px-3 py-2 text-slate-700">{account.country}</td>
                  <td className="px-3 py-2 text-slate-700">{account.plan}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[account.status] ?? 'bg-slate-100'}`}
                    >
                      {account.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{account.signup_date}</td>
                  <td className="px-3 py-2 text-slate-700">{account.current_month_minutes}</td>
                  <td className="px-3 py-2 text-slate-700">{account.current_month_sms}</td>
                  <td className="px-3 py-2 text-slate-700">{formatDollars(account.cost_cents)}</td>
                  <td className="px-3 py-2 text-slate-700">{account.last_active}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onOpenSettings(account)}
                      className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 focus:ring-2 focus:ring-blue-500"
                    >
                      Settings
                    </button>
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-12 text-center text-slate-500">
                    No accounts match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate-600" aria-live="polite">
          {total} accounts · selected {selected.size} across all pages
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || loading}
            className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-40 hover:bg-slate-100"
          >
            Previous
          </button>
          <span>
            Page {page} of {lastPage}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= lastPage || loading}
            className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-40 hover:bg-slate-100"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

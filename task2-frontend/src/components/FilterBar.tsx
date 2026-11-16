import { useState } from 'react'
import { useDebouncedCallback } from '../hooks.ts'

export interface FilterValues {
  search: string
  status: string
  country: string
  plan: string
  dateFrom: string
  dateTo: string
}

interface Props {
  values: FilterValues
  onChange: (key: keyof FilterValues, value: string) => void
  onClear: () => void
  hasActiveFilters: boolean
}

const labelClass = 'block text-xs font-medium text-slate-600 mb-1'
const inputClass =
  'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

export function FilterBar({ values, onChange, onClear, hasActiveFilters }: Props) {
  const [searchText, setSearchText] = useState(values.search)
  const [lastCommitted, setLastCommitted] = useState(values.search)
  if (lastCommitted !== values.search) {
    setLastCommitted(values.search)
    setSearchText(values.search)
  }

  const debouncedSearch = useDebouncedCallback((value: string) => {
    onChange('search', value)
  }, 300)

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="grow min-w-40">
        <label className={labelClass} htmlFor="filter-search">
          Search
        </label>
        <input
          id="filter-search"
          type="search"
          className={inputClass}
          value={searchText}
          placeholder="Name, email or company"
          onChange={(event) => {
            setSearchText(event.target.value)
            debouncedSearch(event.target.value)
          }}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="filter-status">
          Status
        </label>
        <select
          id="filter-status"
          className={inputClass}
          value={values.status}
          onChange={(event) => onChange('status', event.target.value)}
        >
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="filter-country">
          Country
        </label>
        <select
          id="filter-country"
          className={inputClass}
          value={values.country}
          onChange={(event) => onChange('country', event.target.value)}
        >
          <option value="">All</option>
          <option value="US">US</option>
          <option value="IN">IN</option>
          <option value="GB">GB</option>
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="filter-plan">
          Plan
        </label>
        <select
          id="filter-plan"
          className={inputClass}
          value={values.plan}
          onChange={(event) => onChange('plan', event.target.value)}
        >
          <option value="">All</option>
          <option value="basic">Basic</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="filter-from">
          From
        </label>
        <input
          id="filter-from"
          type="date"
          className={inputClass}
          value={values.dateFrom}
          max={values.dateTo || undefined}
          onChange={(event) => onChange('dateFrom', event.target.value)}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="filter-to">
          To
        </label>
        <input
          id="filter-to"
          type="date"
          className={inputClass}
          value={values.dateTo}
          min={values.dateFrom || undefined}
          onChange={(event) => onChange('dateTo', event.target.value)}
        />
      </div>
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClear}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
        >
          Clear filters
        </button>
      )}
    </div>
  )
}

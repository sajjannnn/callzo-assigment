import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { type SummaryPoint } from '../api.ts'
import { formatDollars } from '../lib/money.ts'
import type { SummaryState } from '../useSummary.ts'

interface Props {
  state: SummaryState
}

function shortDate(value: string): string {
  const [, month, day] = value.split('-')
  return `${day}/${month}`
}

export function SummaryChart({ state }: Props) {
  if (state.loading) {
    return <div className="h-64 animate-pulse rounded bg-slate-100" aria-live="polite" />
  }
  if (state.error || !state.data) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 rounded border border-amber-300 bg-amber-50 text-sm text-amber-900">
        <p role="alert">Chart failed to load{state.error ? `: ${state.error}` : ''}.</p>
        <button
          type="button"
          onClick={state.retry}
          className="rounded border border-amber-400 px-3 py-1 font-medium hover:bg-amber-100"
        >
          Retry
        </button>
      </div>
    )
  }
  if (state.data.series.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded bg-slate-50 text-sm text-slate-500">
        No usage data in the selected date range.
      </div>
    )
  }

  const series = state.data.series as SummaryPoint[]

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={shortDate} fontSize={12} />
          <YAxis yAxisId="minutes" fontSize={12} />
          <YAxis yAxisId="signups" orientation="right" fontSize={12} width={32} />
          <Tooltip
            formatter={(value, name) =>
              name === 'Cost' ? formatDollars(value as number) : (value as number)
            }
          />
          <Legend />
          <Bar yAxisId="minutes" dataKey="minutes" name="Minutes" fill="#2563eb" />
          <Bar yAxisId="signups" dataKey="signups" name="Signups" fill="#16a34a" />
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-xs text-slate-500">
        {series.length} days, {state.data.total_accounts} accounts with activity · total{' '}
        {formatDollars(series.reduce((sum, point) => sum + point.cost_cents, 0))}
      </p>
    </div>
  )
}

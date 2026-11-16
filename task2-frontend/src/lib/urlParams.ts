export const SORTABLE_FIELDS = new Set([
  'id',
  'name',
  'company',
  'country',
  'plan',
  'status',
  'signup_date',
  'current_month_minutes',
  'current_month_sms',
  'cost_cents',
  'last_active',
])

export interface TableState {
  search: string
  status: string
  country: string
  plan: string
  dateFrom: string
  dateTo: string
  sortBy: string
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
  selection: number[]
}

export function parseTableState(params: URLSearchParams): TableState {
  const sortParam = params.get('sort') ?? ''
  const sortBy = SORTABLE_FIELDS.has(sortParam) ? sortParam : 'id'
  const rawPage = Number(params.get('page') ?? '1')
  const rawPageSize = Number(params.get('page_size') ?? '50')
  const selection = (params.get('sel') ?? '')
    .split(',')
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0)

  return {
    search: params.get('q') ?? '',
    status: params.get('status') ?? '',
    country: params.get('country') ?? '',
    plan: params.get('plan') ?? '',
    dateFrom: params.get('from') ?? '',
    dateTo: params.get('to') ?? '',
    sortBy,
    sortDir: params.get('dir') === 'desc' ? 'desc' : 'asc',
    page: Math.max(1, rawPage || 1),
    pageSize: Math.min(200, Math.max(10, rawPageSize || 50)),
    selection: [...new Set(selection)].sort((a, b) => a - b),
  }
}

export function buildQuery(state: TableState): string {
  const query = new URLSearchParams()
  const pairs: [string, string][] = [
    ['search', state.search],
    ['status', state.status],
    ['country', state.country],
    ['plan', state.plan],
    ['date_from', state.dateFrom],
    ['date_to', state.dateTo],
    ['sort_by', state.sortBy],
    ['sort_dir', state.sortDir],
    ['page', String(state.page)],
    ['page_size', String(state.pageSize)],
  ]
  for (const [key, value] of pairs) {
    if (value) query.set(key, value)
  }
  return query.toString()
}

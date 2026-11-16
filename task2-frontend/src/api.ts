const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

export interface Account {
  id: number
  name: string
  email: string
  company: string
  country: string
  plan: 'basic' | 'pro' | 'enterprise'
  status: 'active' | 'trial' | 'suspended'
  signup_date: string
  current_month_minutes: number
  current_month_sms: number
  cost_cents: number
  last_active: string
}

export interface AccountsResponse {
  data: Account[]
  total: number
  page: number
  page_size: number
}

export interface SummaryPoint {
  date: string
  minutes: number
  sms: number
  cost_cents: number
  signups: number
}

export interface SummaryResponse {
  series: SummaryPoint[]
  total_accounts: number
}

export type Settings = Record<string, Record<string, unknown>>

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown) {
    super(`API request failed with status ${status}`)
    this.status = status
    this.detail = detail
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ApiError(0, 'network error')
  }
  const text = await response.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    throw new ApiError(response.status, body)
  }
  return body as T
}

export function fetchAccounts(query: string, signal?: AbortSignal): Promise<AccountsResponse> {
  return request<AccountsResponse>(`/accounts?${query}`, { signal })
}

export function fetchSummary(
  dateFrom: string | null,
  dateTo: string | null,
  signal?: AbortSignal,
): Promise<SummaryResponse> {
  const query = new URLSearchParams()
  if (dateFrom) query.set('date_from', dateFrom)
  if (dateTo) query.set('date_to', dateTo)
  const suffix = query.toString() ? `?${query}` : ''
  return request<SummaryResponse>(`/accounts/summary${suffix}`, { signal })
}

export function fetchSettings(accountId: number): Promise<Settings> {
  return request<Settings>(`/accounts/${accountId}/settings`)
}

export function saveSettingsStep(
  accountId: number,
  step: number,
  data: Record<string, unknown>,
): Promise<{ step: number; saved: boolean; data: Record<string, unknown> }> {
  return request(`/accounts/${accountId}/settings/step/${step}`, {
    method: 'PUT',
    body: JSON.stringify({ data }),
  })
}

export function submitSettings(accountId: number): Promise<{ status: string }> {
  return request(`/accounts/${accountId}/settings/submit`, { method: 'POST' })
}

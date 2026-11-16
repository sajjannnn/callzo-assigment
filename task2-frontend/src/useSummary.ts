import { useEffect, useState } from 'react'
import { ApiError, fetchSummary, type SummaryResponse } from './api.ts'

export interface SummaryState {
  data: SummaryResponse | null
  loading: boolean
  error: string | null
  retry: () => void
}

const QUIET_RETRY_DELAY_MS = 400

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status === 0 ? 'Network error' : `Request failed (${error.status})`
  }
  return 'Unexpected error'
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function useSummary(dateFrom: string | null, dateTo: string | null): SummaryState {
  const [data, setData] = useState<SummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    const load = async (): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetchSummary(dateFrom, dateTo, controller.signal)
        if (!cancelled) setData(response)
      } catch (firstError) {
        if (cancelled || isAbort(firstError)) return
        let finalError = firstError
        if (firstError instanceof ApiError && firstError.status >= 500) {
          await new Promise((resolve) => setTimeout(resolve, QUIET_RETRY_DELAY_MS))
          try {
            const response = await fetchSummary(dateFrom, dateTo, controller.signal)
            if (!cancelled) setData(response)
            return
          } catch (retryError) {
            if (cancelled || isAbort(retryError)) return
            finalError = retryError
          }
        }
        if (!cancelled) setError(describeError(finalError))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [dateFrom, dateTo, attempt])

  return {
    data,
    loading,
    error,
    retry: () => setAttempt((current) => current + 1),
  }
}

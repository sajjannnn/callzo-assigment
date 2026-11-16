import { useCallback, useEffect, useState } from 'react'
import { ApiError, fetchAccounts, type AccountsResponse } from './api.ts'
import { mergeRefreshedPage } from './lib/tableMerge.ts'

export interface AccountsState {
  data: AccountsResponse | null
  loading: boolean
  loadError: string | null
  refreshError: string | null
  orderChanged: boolean
  reload: () => void
}

const POLL_INTERVAL_MS = 5000

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status === 0 ? 'Network error' : `Request failed (${error.status})`
  }
  return 'Unexpected error'
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function useAccounts(query: string): AccountsState {
  const [state, setState] = useState<AccountsState>({
    data: null,
    loading: true,
    loadError: null,
    refreshError: null,
    orderChanged: false,
    reload: () => {},
  })
  const [reloadCounter, setReloadCounter] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    const load = async (mode: 'initial' | 'poll') => {
      try {
        const response = await fetchAccounts(query, controller.signal)
        if (cancelled) return
        setState((previous) => {
          const canMerge =
            mode === 'poll' &&
            previous.data !== null &&
            previous.data.page === response.page &&
            previous.data.data.length > 0
          if (!canMerge) {
            return {
              data: response,
              loading: false,
              loadError: null,
              refreshError: null,
              orderChanged: false,
              reload: previous.reload,
            }
          }
          const merged = mergeRefreshedPage(previous.data!, response)
          return {
            ...previous,
            data: { ...merged, data: merged.data },
            loading: false,
            refreshError: null,
            orderChanged: merged.orderChanged,
          }
        })
      } catch (error) {
        if (cancelled || isAbort(error)) return
        const message = describeError(error)
        setState((previous) => ({
          ...previous,
          loading: false,
          ...(previous.data === null
            ? { loadError: message }
            : { refreshError: message }),
        }))
      }
    }

    void load('initial')
    const timer = setInterval(() => {
      if (document.hidden) return
      void load('poll')
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      controller.abort()
      clearInterval(timer)
    }
  }, [query, reloadCounter])

  const reload = useCallback(() => setReloadCounter((current) => current + 1), [])

  return { ...state, reload }
}

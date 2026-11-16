import { useCallback, useEffect, useRef, useState } from 'react'

export function useUrlState() {
  const [params, setParams] = useState<URLSearchParams>(
    () => new URLSearchParams(window.location.search),
  )

  useEffect(() => {
    const onPopState = () => setParams(new URLSearchParams(window.location.search))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const setParam = useCallback((key: string, value: string | null) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      if (value === null || value === '') {
        next.delete(key)
      } else {
        next.set(key, value)
      }
      window.history.replaceState(null, '', `${window.location.pathname}?${next}`)
      return next
    })
  }, [])

  const setMany = useCallback((updates: Record<string, string | null>) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
      }
      window.history.replaceState(null, '', `${window.location.pathname}?${next}`)
      return next
    })
  }, [])

  return { params, setParam, setMany }
}

export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  })

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return useCallback(
    (...args: Args) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => callbackRef.current(...args), delay)
    },
    [delay],
  )
}

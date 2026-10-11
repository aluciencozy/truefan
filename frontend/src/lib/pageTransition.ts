import { createContext, useContext, useLayoutEffect } from 'react'

export const PageTransitionContext = createContext<((ready: boolean) => void) | null>(null)

// Pages own their loading/error decisions; the transition only hides a brief initial wait.
export function usePageReady(ready: boolean): void {
  const report = useContext(PageTransitionContext)
  useLayoutEffect(() => { report?.(ready) }, [report, ready])
}

export function pageDestination(location: { pathname: string; search: string }): string {
  if (location.pathname !== '/explore') return location.pathname
  const params = new URLSearchParams(location.search)
  return `${location.pathname}:${params.get('media') || params.get('universe') || ''}`
}

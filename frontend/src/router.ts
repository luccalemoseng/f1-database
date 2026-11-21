import { useCallback, useEffect, useState } from 'react'

// Tiny hash router: "#/compare?y=2024&r=16&s=Qualifying&d=NOR,LEC".
// Keeping state in the URL makes every view shareable and bookmarkable.

function parse() {
  const [path, query = ''] = window.location.hash.replace(/^#/, '').split('?')
  return { path: path || '/compare', params: Object.fromEntries(new URLSearchParams(query)) as Record<string, string> }
}

export function useRoute() {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const on = () => setRoute(parse())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export function useHashParams(): [Record<string, string>, (patch: Record<string, string>) => void] {
  const { params } = useRoute()
  const set = useCallback((patch: Record<string, string>) => {
    const cur = parse()
    const next = { ...cur.params, ...patch }
    for (const k of Object.keys(next)) if (next[k] === '') delete next[k]
    const q = new URLSearchParams(next).toString()
    window.history.replaceState(null, '', `#${cur.path}${q ? `?${q}` : ''}`)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }, [])
  return [params, set]
}

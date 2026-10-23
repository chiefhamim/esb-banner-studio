import { useCallback, useRef, useState } from 'react'

/**
 * Width of an element, kept current; previews size themselves to their panel instead of a fixed guess.
 * A callback ref, so it also tracks elements that mount later (a tab that is not open yet).
 */
export function useWidth<T extends HTMLElement>(initial: number) {
  const [w, setW] = useState(initial)
  const ro = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect()
    ro.current = null
    if (!el) return
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    ro.current = new ResizeObserver(() => setW(el.clientWidth))
    ro.current.observe(el)
  }, [])
  return [ref, w] as const
}

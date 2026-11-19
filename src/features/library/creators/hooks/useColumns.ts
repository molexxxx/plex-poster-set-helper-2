import { useCallback, useRef, useState } from 'react'
/**
 * How many columns an auto-fill grid currently shows, so a full-width panel
 * can be placed after the row that holds a given tile.
 *
 * @param min - The grid's minimum column width.
 * @param gap - The grid's column gap.
 * @returns The column count and a ref callback for the grid element.
 */
export function useColumns(min: number, gap: number): [number, (el: HTMLElement | null) => void] {
  const [columns, setColumns] = useState(1)
  const observer = useRef<ResizeObserver | null>(null)
  const attach = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    const measure = (width: number) => setColumns(Math.max(1, Math.floor((width + gap) / (min + gap))))
    measure(el.clientWidth)
    observer.current = new ResizeObserver(entries => measure(entries[0].contentRect.width))
    observer.current.observe(el)
  }, [min, gap])
  return [columns, attach]
}

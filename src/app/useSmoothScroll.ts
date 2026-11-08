import { useEffect, type RefObject } from 'react'
import Lenis from 'lenis'
import { useAppContext } from './AppContext'

/** Longest frame step handed to Lenis, so the first frame after an idle gap eases instead of jumping. */
const MAX_STEP_MS = 34

/**
 * Smooths wheel scrolling inside a scroll container with Lenis.
 *
 * The frame loop runs only while a smoothed scroll is in motion, so an idle
 * scroller costs nothing. Nested scrollers keep native scrolling, and the limit
 * is read live because the scrollers swap their children as content loads.
 * Disabled in the web UI and when the system asks for reduced motion.
 *
 * @param ref - The scroll container.
 */
export function useSmoothScroll(ref: RefObject<HTMLElement | null>): void {
  const { smoothScroll } = useAppContext()

  useEffect(() => {
    const wrapper = ref.current
    if (!smoothScroll || !wrapper) return

    const lenis = new Lenis({
      wrapper,
      content: wrapper,
      lerp: 0.16,
      allowNestedScroll: true,
      naiveDimensions: true,
      autoResize: false,
    })

    let frame = 0
    let last = 0
    let clock = 0
    const tick = (now: number) => {
      clock += last ? Math.min(now - last, MAX_STEP_MS) : 1000 / 60
      last = now
      lenis.raf(clock)
      if (lenis.isScrolling === 'smooth') {
        frame = requestAnimationFrame(tick)
      } else {
        frame = 0
        last = 0
      }
    }
    const start = () => {
      if (!frame) frame = requestAnimationFrame(tick)
    }

    wrapper.addEventListener('wheel', start, { passive: true })
    return () => {
      wrapper.removeEventListener('wheel', start)
      cancelAnimationFrame(frame)
      lenis.destroy()
    }
  }, [ref, smoothScroll])
}

import { createContext, useEffect } from 'react'
import type { RefObject } from 'react'
import { useMotionValue, useReducedMotion } from 'motion/react'
import type { MotionValue } from 'motion/react'
import type { CursorPoint } from './cursorBend'

export const CanvasPointerContext = createContext<MotionValue<CursorPoint | null> | null>(null)

export function useCanvasParallax(container: RefObject<HTMLDivElement | null>, active = true) {
  const reduced = useReducedMotion()
  const pointer = useMotionValue<CursorPoint | null>(null)
  useEffect(() => {
    const element = container.current
    if (!element || !active || reduced) return
    const reset = () => {
      pointer.set(null)
      element.style.setProperty('--parallax-x', '0px')
      element.style.setProperty('--parallax-y', '0px')
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.buttons
        || (event.target as Element).closest('.react-flow__panel, .universe-inspector')) {
        reset()
        return
      }
      const rect = element.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      // Screen-space translation keeps nodes and their edges aligned without moving the camera.
      const x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1))
      const y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1))
      element.style.setProperty('--parallax-x', `${x * 12}px`)
      element.style.setProperty('--parallax-y', `${y * 9}px`)
      pointer.set({ x: event.clientX, y: event.clientY })
    }
    element.addEventListener('pointermove', move, { passive: true })
    element.addEventListener('pointerleave', reset)
    element.addEventListener('pointerdown', reset)
    return () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', reset)
      element.removeEventListener('pointerdown', reset)
      reset()
    }
  }, [container, active, reduced, pointer])
  return pointer
}

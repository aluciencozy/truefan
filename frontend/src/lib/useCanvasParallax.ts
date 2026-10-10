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
    const stars = Array.from(element.querySelectorAll<HTMLElement>('.cursor-stars i'))
    let nextStar = 0
    let lastSpark = -Infinity
    const reset = () => {
      pointer.set(null)
      lastSpark = -Infinity
      element.style.setProperty('--parallax-x', '0px')
      element.style.setProperty('--parallax-y', '0px')
      stars.forEach(star => star.getAnimations().forEach(animation => animation.cancel()))
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
      if (stars.length && event.timeStamp - lastSpark >= 85) {
        lastSpark = event.timeStamp
        const star = stars[nextStar++ % stars.length]
        star.getAnimations().forEach(animation => animation.cancel())
        const angle = Math.random() * Math.PI * 2, radius = 8 + Math.random() * 30
        star.style.left = `${Math.round(event.clientX - rect.left + Math.cos(angle) * radius)}px`
        star.style.top = `${Math.round(event.clientY - rect.top + Math.sin(angle) * radius)}px`
        star.animate([
          { opacity: 0, transform: 'translate(0, 0)' },
          { opacity: .5, offset: .15 },
          { opacity: .14, offset: .35 },
          { opacity: .32, offset: .5 },
          { opacity: 0, transform: `translate(${Math.cos(angle) * 12}px, ${Math.sin(angle) * 12}px)` },
        ], { duration: 750 + Math.random() * 450, easing: 'ease-out' })
      }
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

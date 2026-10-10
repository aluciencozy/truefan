import { createContext, useEffect } from 'react'
import type { RefObject } from 'react'
import { useMotionValue, useReducedMotion } from 'motion/react'
import type { MotionValue } from 'motion/react'
import type { CursorPoint } from './cursorBend'

export const CanvasPointerContext = createContext<MotionValue<CursorPoint | null> | null>(null)

export function useCanvasParallax(container: RefObject<HTMLDivElement | null>, active = true, followCursor = false) {
  const reduced = useReducedMotion()
  const pointer = useMotionValue<CursorPoint | null>(null)
  useEffect(() => {
    const element = container.current
    if (!element || !active || reduced) return
    const stars = Array.from(element.querySelectorAll<HTMLElement>('.cursor-stars i'))
    let nextStar = 0
    let lastSpark = -Infinity
    const hold = () => {
      const viewport = element.querySelector('.react-flow__viewport')
      const offset = viewport ? getComputedStyle(viewport).translate.split(' ') : []
      if (offset.length && offset[0] !== 'none') {
        element.style.setProperty('--parallax-x', offset[0])
        element.style.setProperty('--parallax-y', offset[1] ?? '0px')
      }
    }
    const reset = () => {
      pointer.set(null)
      lastSpark = -Infinity
      element.style.setProperty('--parallax-x', '0px')
      element.style.setProperty('--parallax-y', '0px')
      stars.forEach(star => star.getAnimations().forEach(animation => animation.cancel()))
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.buttons && followCursor) return
      if (event.pointerType !== 'mouse' || event.buttons
        || (event.target as Element).closest('.react-flow__panel, .universe-inspector')) {
        reset()
        return
      }
      const rect = element.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1))
      const y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1))
      // Hold clickable targets still; moving the scene opposite the cursor looks toward it.
      if (!followCursor || !(event.target as Element).closest('.react-flow__node-destination, .react-flow__edge')) {
        element.style.setProperty('--parallax-x', `${x * (followCursor ? -Math.min(rect.width * .18, 240) : 12)}px`)
        element.style.setProperty('--parallax-y', `${y * (followCursor ? -Math.min(rect.height * .18, 160) : 9)}px`)
      } else hold()
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
    const down = () => { if (followCursor) { hold(); pointer.set(null) } else reset() }
    element.addEventListener('pointermove', move, { passive: true })
    element.addEventListener('pointerleave', reset)
    element.addEventListener('pointerdown', down)
    return () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', reset)
      element.removeEventListener('pointerdown', down)
      reset()
    }
  }, [container, active, reduced, pointer, followCursor])
  return pointer
}

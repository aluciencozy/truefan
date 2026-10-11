import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'motion/react'

export default function CursorStars() {
  const container = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    const element = container.current
    if (!element || reduced) return
    const stars = Array.from(element.querySelectorAll<HTMLElement>('i'))
    let nextStar = 0
    let lastSpark = -Infinity
    const reset = () => {
      lastSpark = -Infinity
      stars.forEach(star => star.getAnimations().forEach(animation => animation.cancel()))
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.buttons) {
        reset()
        return
      }
      if (event.timeStamp - lastSpark >= 85) {
        lastSpark = event.timeStamp
        const star = stars[nextStar++ % stars.length]
        star.getAnimations().forEach(animation => animation.cancel())
        const angle = Math.random() * Math.PI * 2, radius = 8 + Math.random() * 30
        star.style.left = `${Math.round(event.clientX + Math.cos(angle) * radius)}px`
        star.style.top = `${Math.round(event.clientY + Math.sin(angle) * radius)}px`
        star.animate([
          { opacity: 0, transform: 'translate(0, 0)' },
          { opacity: .5, offset: .15 },
          { opacity: .14, offset: .35 },
          { opacity: .32, offset: .5 },
          { opacity: 0, transform: `translate(${Math.cos(angle) * 12}px, ${Math.sin(angle) * 12}px)` },
        ], { duration: 750 + Math.random() * 450, easing: 'ease-out' })
      }
    }
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerleave', reset)
    document.addEventListener('pointerdown', reset)
    window.addEventListener('blur', reset)
    return () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', reset)
      document.removeEventListener('pointerdown', reset)
      window.removeEventListener('blur', reset)
      reset()
    }
  }, [reduced])
  return <div ref={container} className="cursor-stars" aria-hidden="true">
    {Array.from({ length: 10 }, (_, index) => <i key={index} />)}
  </div>
}

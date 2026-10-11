import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { useReducedMotion } from 'motion/react'
import './GlitterStars.css'

// Deterministic positions and orbital phases keep navigation and hydration stable.
const stars = Array.from({ length: 120 }, (_, index) => {
  const jitter = ((index * 73 + 19) % 101) / 101
  return {
    left: `${((index % 12) + .15 + jitter * .7) / 12 * 100}%`,
    top: `${(Math.floor(index / 12) + .15 + ((index * 37 + 11) % 97) / 97 * .7) / 10 * 100}%`,
    '--star-size': `${index % 7 === 0 ? 2.8 : index % 3 === 0 ? 2 : 1.5}px`,
    '--star-duration': `${4 + index % 7}s`,
    '--star-delay': `${-(index * .83)}s`,
    '--orbit-radius': `${18 + index % 21}vmax`,
    '--orbit-delay': `${-index * 17.3}s`,
  } as CSSProperties
})

const accentStars = [
  { left: '2%', top: '17%', size: 16 },
  { left: '59%', top: '13%', size: 12 },
  { left: '96%', top: '29%', size: 18 },
  { left: '34%', top: '79%', size: 13 },
  { left: '83%', top: '91%', size: 16 },
  { left: '7%', top: '93%', size: 11 },
]

export default function GlitterStars() {
  const container = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (reduced || !container.current) return
    const points = Array.from(container.current.querySelectorAll('i'))
    const accents = ['--teal', '--peach', '--pink', '--blue', '--yellow', '--mauve']
    let flicker: Animation | undefined
    const timer = window.setInterval(() => {
      if (document.hidden) return
      const star = points[Math.floor(Math.random() * points.length)]
      const color = getComputedStyle(star).getPropertyValue(accents[Math.floor(Math.random() * accents.length)]).trim()
      flicker = star.animate([
        { background: '#cdd6f4', opacity: .4, boxShadow: '0 0 4px #cba6f726' },
        { background: color, opacity: .9, boxShadow: `0 0 7px ${color}`, offset: .3 },
        { background: color, opacity: .45, boxShadow: `0 0 3px ${color}`, offset: .5 },
        { background: color, opacity: .75, boxShadow: `0 0 5px ${color}`, offset: .65 },
        { background: '#cdd6f4', opacity: .4, boxShadow: '0 0 4px #cba6f726' },
      ], { duration: 1800, easing: 'ease-in-out' })
    }, 20_000)
    return () => { window.clearInterval(timer); flicker?.cancel() }
  }, [reduced])
  return <div ref={container} className="glitter-stars" aria-hidden="true">
    {stars.map((style, index) => <i key={index} style={style} />)}
    {accentStars.map((star, index) => <span key={index} className="glitter-star-accent" style={{
      left: star.left, top: star.top, fontSize: star.size,
      '--star-duration': `${6 + index}s`, '--star-delay': `${-index * 1.7}s`,
      '--orbit-radius': `${24 + index * 2}vmax`, '--orbit-delay': `${-index * 43}s`,
    } as CSSProperties}>✦</span>)}
  </div>
}

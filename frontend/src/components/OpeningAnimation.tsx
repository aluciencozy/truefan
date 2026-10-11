import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAnimate } from 'motion/react'
import type { AnimationPlaybackControls } from 'motion/react'
import './OpeningAnimation.css'

const lavender = '#cba6f7'
const white = '#f5f5ff'
const sweep = [.76, 0, .24, 1] as const

type Point = { x: number; y: number }
function curve(t: number, a: Point, b: Point, c: Point, d: Point): Point & { heading: number } {
  const u = 1 - t
  const vx = 3 * u ** 2 * (b.x - a.x) + 6 * u * t * (c.x - b.x) + 3 * t ** 2 * (d.x - c.x)
  const vy = 3 * u ** 2 * (b.y - a.y) + 6 * u * t * (c.y - b.y) + 3 * t ** 2 * (d.y - c.y)
  return {
    x: u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y,
    heading: Math.atan2(vy, vx) * 180 / Math.PI,
  }
}

export default function OpeningAnimation({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(true)
  const [scope, animate] = useAnimate<HTMLDivElement>()

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const controls: AnimationPlaybackControls[] = []
    const finish = () => { if (!cancelled) setActive(false) }
    const deadline = window.setTimeout(finish, 3000)
    const stage = scope.current.querySelector<HTMLElement>('.opening-logo')!
    const position = scope.current.querySelector<HTMLElement>('.opening-position')!

    function land() {
      const target = scope.current.querySelector<HTMLImageElement>('.navbar-brand img')
      controls.push(animate('.opening-backdrop', { opacity: [1, 0] }, { delay: .15, duration: .75, ease: 'easeInOut' }))
      if (!target) {
        const fade = animate(stage, { opacity: [1, 0] }, { duration: .35 })
        controls.push(fade)
        void Promise.resolve(fade).then(finish, finish)
        return
      }
      const trail = scope.current.querySelectorAll<HTMLElement>('.opening-trail-star')
      const history: Array<Point & { time: number }> = []
      // Re-measure during flight so resizing never leaves the logo at an old destination.
      const flight = animate(0, 1, { duration: 1.05, ease: [.45, 0, .25, 1], onUpdate: progress => {
        const destination = target.getBoundingClientRect()
        const frame = position.getBoundingClientRect()
        const dx = destination.left + destination.width / 2 - (frame.left + frame.width / 2)
        const dy = destination.top + destination.height / 2 - (frame.top + frame.height / 2)
        const radius = Math.min(140, frame.width * .22, frame.height * .22)
        const turn = { x: radius * .6, y: radius * .9 }
        const tangentScale = .65 / .35
        const returnHandle = { x: turn.x - radius * .6 * tangentScale, y: turn.y + radius * .1 * tangentScale }
        const approach = Math.min(80, Math.max(20, destination.left * .65))
        // The incoming dots push right, then down; both curves share a tangent at the turn.
        const point = progress < .35
          ? curve(progress / .35, { x: 0, y: 0 }, { x: radius * .8, y: 0 }, { x: radius * 1.2, y: radius * .8 }, turn)
          : curve((progress - .35) / .65, turn, returnHandle,
            { x: dx - approach * .5, y: dy + approach * Math.sqrt(3) / 2 }, { x: dx, y: dy })
        const shrink = Math.max(0, (progress - .2) / .8)
        const scale = 1 + (destination.width / stage.offsetWidth - 1) * shrink
        // The artwork's nose points at -60°. Bank into the curve and land at 360° (upright).
        const heading = (point.heading + 360) % 360
        const rotation = (heading + 60) * Math.min(1, progress / .08)
        stage.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) rotate(${rotation}deg) scale(${scale})`
        const angle = rotation * Math.PI / 180
        const unit = stage.offsetWidth / 300 * scale
        const now = performance.now()
        history.unshift({ time: now,
          x: frame.width / 2 + point.x + (-20 * Math.cos(angle) - 65 * Math.sin(angle)) * unit,
          y: frame.height / 2 + point.y + (-20 * Math.sin(angle) + 65 * Math.cos(angle)) * unit })
        while (history.length > 1 && history[history.length - 1].time < now - 300) history.pop()
        trail.forEach((star, index) => {
          const sample = history.find(item => item.time <= now - (index + 1) * 30)
          const fade = Math.min(1, progress / .12, (1 - progress) / .15)
          const blink = .15 + .85 * ((Math.sin(now / 85 - index * 1.3) + 1) / 2) ** 2
          star.style.opacity = sample ? String(.95 * (1 - index / (trail.length * 1.7)) * fade * blink) : '0'
          if (sample) star.style.transform = `translate(${sample.x}px, ${sample.y}px) rotate(${index * 23}deg) scale(${1 - index * .07})`
        })
      } })
      controls.push(flight)
      void Promise.resolve(flight).then(finish, finish)
    }

    try {
      controls.push(animate('.opening-star-fall', { y: [-window.innerHeight * 300 / stage.offsetWidth, 8, 0] }, {
        duration: .45, times: [0, .85, 1], ease: [[.55, 0, .25, 1], [.2, .7, .3, 1]],
      }))
      controls.push(animate('.opening-star-spin', { rotate: [0, 720] }, { delay: .35, duration: .7, ease: sweep }))
      const svg = stage.querySelector('svg')!
      for (let index = 0; index < 3; index++) {
        const path = stage.querySelector<SVGPathElement>(`.opening-arc-${index}`)!
        const particle = stage.querySelector<SVGCircleElement>(`.opening-particle-${index}`)!
        const matrix = svg.getScreenCTM()!.inverse().multiply(path.getScreenCTM()!)
        const length = path.getTotalLength()
        const tail = path.getPointAtLength(0).matrixTransform(matrix)
        const tangent = path.getPointAtLength(1).matrixTransform(matrix)
        const frame = position.getBoundingClientRect()
        const start = { x: 150 + frame.width * .28 * 300 / stage.offsetWidth + index * 30,
          y: 150 + frame.height * .28 * 300 / stage.offsetWidth + index * 20 }
        const delay = .8 + index * .07
        controls.push(animate(0, 1, { delay, duration: .6, ease: 'easeInOut', onUpdate: progress => {
          const arcProgress = Math.max(0, (progress - .4) / .6)
          const point = progress < .4
            ? curve(progress / .4, start, { x: start.x - 120, y: start.y },
              { x: tail.x - (tangent.x - tail.x) * 80, y: tail.y - (tangent.y - tail.y) * 80 }, tail)
            : path.getPointAtLength(length * arcProgress).matrixTransform(matrix)
          particle.setAttribute('cx', String(point.x))
          particle.setAttribute('cy', String(point.y))
          particle.style.opacity = String(Math.min(1, progress / .08, (1 - progress) / .08))
          path.style.strokeDashoffset = String(1 - arcProgress)
        } }))
        controls.push(animate(`.opening-arc-${index}`, { stroke: [lavender, white, lavender] }, {
          delay: delay + .2, duration: .42, times: [0, .45, 1], ease: 'easeInOut',
        }))
        controls.push(animate(`.opening-dot-${index}`, { opacity: [0, 1] }, { delay: delay + .45, duration: .16 }))
      }
    } catch {
      finish()
    }
    const landing = window.setTimeout(() => { try { land() } catch { finish() } }, 1400)
    return () => {
      cancelled = true
      window.clearTimeout(deadline)
      window.clearTimeout(landing)
      controls.forEach(control => control.stop())
    }
  }, [active, animate, scope])

  return <div ref={scope} className="app-opening" data-opening={active ? 'active' : undefined}>
    <div className="opening-content" inert={active} aria-hidden={active ? true : undefined}>{children}</div>
    {active && <div className="opening-overlay" aria-hidden="true">
      <div className="opening-backdrop" />
      <div className="opening-trail">{Array.from({ length: 7 }, (_, index) => <span key={index} className="opening-trail-star">✦</span>)}</div>
      <div className="opening-position">
        <div className="opening-logo">
          {/* Geometry matches the static navbar SVG, including its enlarged star. */}
          <svg viewBox="0 0 300 300" fill="none">
            <path className="opening-arc opening-arc-0" pathLength="1" strokeDasharray="1" strokeDashoffset="1" stroke={lavender} strokeWidth="8"
              d="M102.599889,209.909839c-39.987675-54.476529,9.251302-107.448553,55.218407-102.928011" transform="matrix(1 0 0 0.917269 -7.818296 14.958607)" />
            <path className="opening-arc opening-arc-1" pathLength="1" strokeDasharray="1" strokeDashoffset="1" stroke={lavender} strokeWidth="8"
              d="M166.923883,186.807641c40.184826-14.183841,52.696876-63.233634-.370269-83.055539" transform="matrix(-0.974078 0 0 0.999655 305.772929 9.126356)" />
            <g transform="matrix(1 0 0 0.918603 -0.000015 13.317462)">
              <path className="opening-arc opening-arc-2" pathLength="1" strokeDasharray="1" strokeDashoffset="1" stroke={lavender} strokeWidth="8"
                d="M167.211485,227.481024c54.754148-37.718558,54.085569-93.310588-17.413918-110.571097" transform="matrix(-0.974078 0 0 0.999655 295.914514 -8.525508)" />
            </g>
            <ellipse className="opening-dot opening-dot-0" rx="16.239977" ry="16.585509" transform="matrix(0.542868 0 0 0.50467 100.465423 212.000974)" fill={lavender} />
            <ellipse className="opening-dot opening-dot-1" rx="16.239977" ry="16.585509" transform="matrix(0.5 0 0 0.495337 143.536718 195.415482)" fill={lavender} />
            <ellipse className="opening-dot opening-dot-2" rx="16.239977" ry="16.585509" transform="matrix(0.795437 0 0 0.829165 143.176047 225.753098)" fill={lavender} />
            {[6, 5, 8].map((radius, index) => <circle key={index} className={`opening-particle opening-particle-${index}`} r={radius} fill={white} />)}
            <g className="opening-star-fall">
              <g transform="translate(137.593926 57.842664) translate(50 55) scale(1.15)">
                <g className="opening-star-spin">
                  <path transform="translate(-50 -55)" fill={lavender}
                    d="M81.5,55C63.18,62.28,57.28,68.18,50,86.5C42.72,68.18,36.82,62.28,18.5,55C36.82,47.72,42.72,41.82,50,23.5C57.28,41.82,63.18,47.72,81.5,55Z" />
                </g>
              </g>
            </g>
          </svg>
        </div>
      </div>
    </div>}
  </div>
}

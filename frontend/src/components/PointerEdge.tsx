import { useContext, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { motion, useMotionValue, useTransform } from 'motion/react'
import { CanvasPointerContext } from '../lib/useCanvasParallax'
import { cursorBend } from '../lib/cursorBend'
import type { CursorPoint } from '../lib/cursorBend'

export default function PointerEdge({ id, sourceX, sourceY, targetX, targetY, style, label, bend = true }: {
  id: string; sourceX: number; sourceY: number; targetX: number; targetY: number
  style?: CSSProperties; label?: ReactNode; bend?: boolean
}) {
  const group = useRef<SVGGElement>(null)
  const pointer = useContext(CanvasPointerContext)
  const idle = useMotionValue<CursorPoint | null>(null)
  const shape = useTransform(pointer ?? idle, cursor => {
    const matrix = bend && cursor ? group.current?.getScreenCTM() : null
    const point = matrix && cursor ? new DOMPoint(cursor.x, cursor.y).matrixTransform(matrix.inverse()) : null
    return cursorBend({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, point, matrix ? Math.hypot(matrix.a, matrix.b) : 1)
  })
  const path = useTransform(shape, value => value.path)
  const labelX = useTransform(shape, value => value.labelX)
  const labelY = useTransform(shape, value => value.labelY - 12)
  return <g ref={group}>
    <motion.path id={id} className="react-flow__edge-path" d={path} fill="none" style={style} />
    <motion.path className="react-flow__edge-interaction" d={path} fill="none" stroke="transparent" strokeWidth={28} style={{ pointerEvents: 'stroke' }} />
    {label && <motion.text x={labelX} y={labelY} textAnchor="middle" className="orbit-relation">{label}</motion.text>}
  </g>
}

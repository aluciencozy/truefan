// Stable breadth-first rings preserve branches without a physics loop during interaction.
export function constellationLayout(ids: string[], links: { source: string; target: string }[], root = ids[0]) {
  const neighbors = new Map(ids.map(id => [id, [] as string[]]))
  for (const link of links) {
    if (neighbors.has(link.source) && neighbors.has(link.target)) {
      neighbors.get(link.source)!.push(link.target)
      neighbors.get(link.target)!.push(link.source)
    }
  }
  const levels = new Map<string, number>()
  const queue: string[] = []
  if (root && neighbors.has(root)) { queue.push(root); levels.set(root, 0) }
  for (let i = 0; i < queue.length; i++) {
    for (const next of neighbors.get(queue[i]) ?? []) {
      if (!levels.has(next)) { levels.set(next, levels.get(queue[i])! + 1); queue.push(next) }
    }
  }
  const outer = Math.max(0, ...levels.values()) + 1
  for (const id of ids) if (!levels.has(id)) levels.set(id, outer)
  const rings = new Map<number, string[]>()
  for (const id of ids) { const level = levels.get(id)!; rings.set(level, [...(rings.get(level) ?? []), id]) }
  const positions = new Map<string, { x: number; y: number }>()
  let radius = 0
  for (const [level, ring] of [...rings].sort(([a], [b]) => a - b)) {
    if (level > 0) radius = Math.max(radius + 290, ring.length * 230 / (2 * Math.PI))
    ring.forEach((id, i) => {
      const angle = i * Math.PI * 2 / Math.max(3, ring.length) - Math.PI / 2 + level * .38
      positions.set(id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius })
    })
  }
  return positions
}

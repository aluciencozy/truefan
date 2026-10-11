import type { Media, UserMediaState } from './types'
import { compareRelease } from './universeModel.ts'
export { compareRelease } from './universeModel.ts'
import type { UniverseModel } from './universeModel.ts'

export type WatchStatus = 'locked' | 'available' | 'completed'
export interface ReleaseGuide {
  status: WatchStatus; branchId: string; branchNumber: number; number: number
  previousId: string | null; approximateDate: boolean; suggested: boolean; visible: boolean
}
export type MediaStates = Record<string, UserMediaState>

export function worldTitle(media: Media, guide: ReleaseGuide | undefined): string {
  return guide?.status === 'locked' ? 'Undiscovered' : media.title
}

export function releaseLabel(media: Media): string {
  const date = media.release_date
  if (!date?.year) return 'Release date unknown'
  if (!date.month) return `${date.year} (year only)`
  const month = String(date.month).padStart(2, '0')
  return date.day ? `${date.year}-${month}-${String(date.day).padStart(2, '0')}` : `${date.year}-${month} (month only)`
}

export function buildReleaseGuide(model: UniverseModel, states: MediaStates): Record<string, ReleaseGuide> {
  const media = new Map(model.media.map(item => [item.id, item]))
  const guide: Record<string, ReleaseGuide> = {}
  const parents = new Map(model.progression.map(link => [link.target, link.source]))
  model.branches.forEach((branch, branchIndex) => {
    const ordered = branch.mediaIds.map(id => media.get(id)!).sort(compareRelease)
    let suggested = false
    ordered.forEach((item, index) => {
      const saved = states[item.id]
      const previousId = parents.get(item.id) ?? null
      const status: WatchStatus = saved?.completed ? 'completed'
        : saved?.manual_unlocked || (saved?.progress?.unit ?? 0) > 0 || item.id === model.startId
          || (previousId && states[previousId]?.completed) ? 'available' : 'locked'
      guide[item.id] = {
        status, branchId: branch.id, branchNumber: branchIndex + 1, number: index + 1,
        previousId, approximateDate: !item.release_date?.day || !item.release_date?.month || !item.release_date?.year,
        suggested: !suggested && status === 'available', visible: status !== 'locked',
      }
      if (status === 'available') suggested = true
    })
  })
  // Only available/completed entries expose children. Locked context never expands the frontier.
  for (const link of model.progression) {
    if (guide[link.source].status !== 'locked') guide[link.target].visible = true
  }
  for (const item of model.media) {
    if (!guide[item.id].visible) continue
    let ancestor = parents.get(item.id)
    while (ancestor) { guide[ancestor].visible = true; ancestor = parents.get(ancestor) }
  }
  return guide
}

/** With one prerequisite per entry, these are exactly the locked → available changes. */
export function unlocksAfter(model: UniverseModel, guide: Record<string, ReleaseGuide>, id: string): string[] {
  if (guide[id]?.status !== 'available') return []
  return model.progression.filter(link => link.source === id && guide[link.target]?.status === 'locked').map(link => link.target)
}

/** Confirmed history is independent of rewinding the character spoiler lens. */
export function confirmProgress(states: MediaStates, item: Media, unit: number): MediaStates {
  const previous = states[item.id]
  return { ...states, [item.id]: {
    media_id: item.id, progress: { unit: Math.max(previous?.progress?.unit ?? 0, unit) },
    completed: previous?.completed === true || (item.total_units_known === true && unit >= item.total_units),
    manual_unlocked: previous?.manual_unlocked ?? false,
  } }
}
export function unlockMedia(states: MediaStates, id: string): MediaStates {
  const previous = states[id]
  return { ...states, [id]: { media_id: id, progress: previous?.progress ?? null, completed: previous?.completed ?? false, manual_unlocked: true } }
}

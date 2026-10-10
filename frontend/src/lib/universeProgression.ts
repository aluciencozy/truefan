import type { Media, UserMediaState } from './types'
import { compareId } from './universeModel.ts'
import type { UniverseModel } from './universeModel.ts'

export type WatchStatus = 'locked' | 'available' | 'completed'
export interface ReleaseGuide {
  status: WatchStatus; branchId: string; branchNumber: number; number: number
  previousId: string | null; approximateDate: boolean; suggested: boolean
}
export type MediaStates = Record<string, UserMediaState>

export function worldTitle(media: Media, guide: ReleaseGuide | undefined): string {
  return guide?.status === 'locked' ? 'Undiscovered' : media.title
}

/** Unknown components sort after known components at the same precision; no date is invented. */
export function compareRelease(a: Media, b: Media): number {
  for (const part of ['year', 'month', 'day'] as const) {
    const difference = (a.release_date?.[part] ?? Infinity) - (b.release_date?.[part] ?? Infinity)
    if (!Number.isNaN(difference) && difference) return difference
  }
  return compareId(a.id, b.id)
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
  const main = model.groups.find(group => group.id === 'group:main')
  const mainIds = new Set(main?.mediaIds ?? [])
  const startingPoint = model.media.filter(item => mainIds.has(item.id)).sort(compareRelease)[0]
  model.branches.forEach((branch, branchIndex) => {
    const ordered = branch.mediaIds.map(id => media.get(id)!).sort(compareRelease)
    const connections = model.links.filter(link => branch.mediaIds.includes(link.source) && mainIds.has(link.target)
      || branch.mediaIds.includes(link.target) && mainIds.has(link.source))
    const parent = connections.find(link => ['SPIN_OFF', 'SIDE_STORY', 'PARENT'].includes(link.kind)) ?? connections[0]
    const prerequisite = main?.branchIds.includes(branch.id) ? null
      : parent ? media.get(mainIds.has(parent.source) ? parent.source : parent.target)! : startingPoint
    let suggested = false
    ordered.forEach((item, index) => {
      const saved = states[item.id]
      const previous = index ? ordered[index - 1] : prerequisite
      const status: WatchStatus = saved?.completed ? 'completed'
        : saved?.manual_unlocked || (saved?.progress?.unit ?? 0) > 0 || !previous || states[previous.id]?.completed ? 'available' : 'locked'
      guide[item.id] = {
        status, branchId: branch.id, branchNumber: branchIndex + 1, number: index + 1,
        previousId: previous?.id ?? null, approximateDate: !item.release_date?.day || !item.release_date?.month || !item.release_date?.year,
        suggested: !suggested && status === 'available',
      }
      if (status === 'available') suggested = true
    })
  })
  return guide
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

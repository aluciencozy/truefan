import type { Media, SurprisePick } from './types'

export interface ExploreDeepLink { view: 'characters' | null; progress: number | null; fromSurprise: boolean }

// `view` and `progress` are optional deep-link params applied once on load. Invalid values are ignored,
// and an over-large progress is clamped later against the loaded media's total_units.
export function parseExploreParams(params: URLSearchParams): ExploreDeepLink {
  const raw = params.get('progress')
  const progress = raw !== null && /^\d{1,9}$/.test(raw) ? Number(raw) : null
  return { view: params.get('view') === 'characters' ? 'characters' : null, progress, fromSurprise: params.get('from') === 'surprise' }
}
export function clampProgress(progress: number, totalUnits: number): number {
  return Math.min(Math.max(0, Math.trunc(progress)), Math.max(0, totalUnits))
}

const enc = encodeURIComponent
export const startUrl = (pick: Pick<SurprisePick, 'media' | 'start_progress'>) =>
  `/explore?media=${enc(pick.media.id)}&progress=${pick.start_progress}&view=characters&from=surprise`
export const universeUrl = (pick: Pick<SurprisePick, 'media'>) => `/explore?media=${enc(pick.media.id)}`
export const demoStartUrl = '/explore?media=lantern-harbor&progress=1&view=characters&from=surprise'

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
export function describePick(pick: SurprisePick): { meta: string; characters: string; start: string } {
  const { media } = pick
  const prologue = media.has_prologue && pick.start_progress === 1
  const episodes = media.total_units_known && media.progress_unit === 'episode' ? plural(media.total_units - (media.has_prologue ? 1 : 0), 'episode') : null
  const meta = [media.format?.replaceAll('_', ' ') ?? media.type.toUpperCase(), media.release_date?.year, episodes].filter(Boolean).join(' · ')
  const where = prologue ? 'the prologue' : `episode ${pick.start_progress}`
  return { meta, characters: `${plural(pick.characters_at_start, 'character')} to meet in ${where}`, start: `Start at ${where}` }
}

// The explainer is remembered per browser only; storage may be blocked, so it must never throw.
export const tipKey = 'truefan:surprise-tip-dismissed'
export function tipDismissed(storage: Pick<Storage, 'getItem'> | null): boolean {
  try { return storage?.getItem(tipKey) === '1' } catch { return false }
}
export function dismissTip(storage: Pick<Storage, 'setItem'> | null): void {
  try { storage?.setItem(tipKey, '1') } catch { /* storage unavailable */ }
}
export function browserStorage(): Storage | null {
  try { return window.localStorage } catch { return null }
}

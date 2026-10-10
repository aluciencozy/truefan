import type { Media } from '../lib/types'

export default function ProgressControl({ media, progress, onProgress, disabled }: {
  media: Media; progress: number; onProgress: (unit: number) => void; disabled: boolean
}) {
  const offset = media.has_prologue ? 1 : 0
  return <div className="progress-control">
    <label htmlFor="canvas-progress">{progress === 0 ? 'Not started' : media.has_prologue && progress === 1 ? 'Prologue' : `Finished ${media.progress_unit}`}</label>
    <div className="progress-stepper">
      <button aria-label={`Previous ${media.progress_unit}`} disabled={disabled || progress === 0} onClick={() => onProgress(progress - 1)}>−</button>
      <input id="canvas-progress" aria-label={`Finished ${media.progress_unit}`} type="number" min={0} max={media.total_units - offset}
        value={Math.max(0, progress - offset)} disabled={disabled} onChange={event => {
          if (event.target.value === '') return
          const unit = event.target.valueAsNumber + offset
          if (Number.isInteger(unit) && unit >= 0 && unit <= media.total_units) onProgress(unit)
        }} onBlur={event => { event.target.value = String(Math.max(0, progress - offset)) }} />
      <span className="progress-total">/ {media.total_units - offset}</span>
      <button aria-label={`Next ${media.progress_unit}`} disabled={disabled || progress === media.total_units} onClick={() => onProgress(progress + 1)}>+</button>
    </div>
  </div>
}

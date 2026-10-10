import type { Media } from '../lib/types'

export default function ProgressControl({ media, progress, onProgress, disabled }: {
  media: Media; progress: number; onProgress: (unit: number) => void; disabled: boolean
}) {
  const offset = media.has_prologue ? 1 : 0
  return <div className="progress-control">
    <label htmlFor="canvas-progress">{progress === 0 ? 'Not started' : media.has_prologue && progress === 1 ? 'Prologue' : `Finished ${media.progress_unit}`}</label>
    <div className="progress-stepper">
      <button aria-label={`Previous ${media.progress_unit}`} disabled={disabled || progress === 0} onClick={() => onProgress(progress - 1)}>−</button>
      <input key={`${media.id}-${progress}`} id="canvas-progress" aria-label={`Finished ${media.progress_unit}`} type="number" inputMode="numeric" min={0} max={media.total_units - offset}
        defaultValue={Math.max(0, progress - offset)} disabled={disabled} onFocus={event => event.currentTarget.select()}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} onBlur={event => {
          const unit = event.currentTarget.valueAsNumber + offset
          if (Number.isInteger(unit) && unit >= offset && unit <= media.total_units) {
            if (unit !== progress) onProgress(unit)
          }
          else event.currentTarget.value = String(Math.max(0, progress - offset))
        }} />
      <span className="progress-total">/ {media.total_units - offset}</span>
      <button aria-label={`Next ${media.progress_unit}`} disabled={disabled || progress === media.total_units} onClick={() => onProgress(progress + 1)}>+</button>
    </div>
  </div>
}

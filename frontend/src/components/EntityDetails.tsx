import type { Entity, Media } from '../lib/types'

export default function EntityDetails({ entity, media }: { entity?: Entity; media: Media }) {
  return <aside className="details panel" aria-label="Selected entity details">
    <h2>In focus</h2>
    {entity ? <>
      <span className="tag">{entity.type}</span>
      <h3 className="mt-4 text-2xl font-semibold">{entity.name}</h3>
      <p>{entity.description}</p>
      <dl className="mt-6 text-sm"><dt>First revealed</dt><dd>{media.progress_unit} {entity.revealed_at.unit}</dd>
        <dt className="mt-4">Source</dt><dd>{entity.provenance.source}</dd></dl>
    </> : <p>Select a node to see what you know about it at this point in the story.</p>}
  </aside>
}

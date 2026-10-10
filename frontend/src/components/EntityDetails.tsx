import type { Entity, Media } from '../lib/types'

export default function EntityDetails({ entity, media }: { entity?: Entity; media: Media }) {
  return <aside className="details panel" aria-label="Selected entity details">
    <h2>In focus</h2>
    {entity ? <>
      <span className="tag">{entity.type}</span>
      <h3 className="mt-4 text-2xl font-semibold">{entity.name}</h3>
      <p>{entity.description}</p>
      <dl className="mt-6 text-sm"><dt>{entity.provenance.verified ? 'First revealed' : 'Description supported at'}</dt><dd>{media.has_prologue ? entity.provenance.episode_number === 0 ? 'Prologue' : `Episode ${entity.provenance.episode_number}` : `${media.progress_unit} ${entity.revealed_at.unit}`}</dd>
        <dt className="mt-4">Source</dt><dd>{entity.provenance.source.startsWith('https://') ? <a href={entity.provenance.source} target="_blank" rel="noreferrer">{entity.provenance.source_title || 'Episode source'}</a> : entity.provenance.source}</dd>
        {!entity.provenance.verified && <><dt className="mt-4">Experimental AI</dt><dd>Unverified source-derived information. Spoiler safety is approximate.</dd></>}</dl>
    </> : <p>Select a node to see what you know about it at this point in the story.</p>}
  </aside>
}

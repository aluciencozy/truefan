import UniverseSearch from './UniverseSearch'

export default function MediaControls({ initialQuery }: { initialQuery: string }) {
  return <aside className="panel controls" aria-label="Story search">
    <h2>Your story</h2>
    <UniverseSearch key={initialQuery} initialQuery={initialQuery} />
  </aside>
}

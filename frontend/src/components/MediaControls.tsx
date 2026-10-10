import UniverseSearch from './UniverseSearch'

export default function MediaControls({ initialQuery }: { initialQuery: string }) {
  return <aside className="controls" aria-label="Story search">
    <h2 id="story-search-title">Find your story</h2>
    <UniverseSearch key={initialQuery} initialQuery={initialQuery} />
  </aside>
}

import { browserStorage, dismissTip } from '../lib/explore'
import './SurprisePick.css'

/** One-time Explore explainer shown after arriving from Surprise me. */
export default function SurpriseTip({ onDismiss }: { onDismiss: () => void }) {
  return <aside className="surprise-tip" aria-label="How progress works">
    <p><b>You’re seeing only what’s revealed by episode 1.</b> Move the episode slider to reveal more, and nothing past your episode is ever shown.</p>
    <button className="surprise-tip-dismiss" onClick={() => { dismissTip(browserStorage()); onDismiss() }}>Got it</button>
  </aside>
}

import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { communityAssets as assets } from '../lib/communityAssets'

export interface CommunityViewer { name: string }
export function CommunityIcon({ name, className = '' }: { name: keyof typeof assets; className?: string }) {
  return <img src={assets[name]} className={`community-icon ${className}`} alt="" />
}

export function LittleUniverse() {
  return <div className="community-planet" aria-hidden="true">
    <img className="planet-orbit" src={assets.imgOrbit} /><img className="planet-body" src={assets.imgPlanet} />
    <i /><span>✦</span><span>✦</span><img className="planet-star" src={assets.imgStar10} />
  </div>
}

const stars = ['imgStar','imgStar1','imgStar2','imgStar3','imgStar4','imgStar5','imgStar3','imgStar','imgStar6','imgStar7','imgStar2','imgStar4','imgStar7','imgStar1','imgStar8','imgStar3','imgStar','imgStar4','imgStar6','imgStar9','imgStar'] as const
export default function CommunityShell({ viewer, children }: { viewer: CommunityViewer | null; children: ReactNode }) {
  const initials = viewer?.name.split(/\s+/).map(word => word[0]).slice(0,2).join('') || '✦'
  return <div className="community-page">
    <div className="community-stars" aria-hidden="true">{stars.map((name,index) => <img key={index} src={assets[name]} />)}
      {Array.from({length: 8}, (_,index) => <span key={index}>✦</span>)}
    </div>
    <aside className="community-sidebar">
      <Link className="community-brand" to="/">TRUE FAN ✦</Link>
      <nav aria-label="Main navigation">
        <NavLink to="/explore"><CommunityIcon name="imgCompass" />Explore</NavLink>
        <NavLink to="/library"><CommunityIcon name="imgLibrary" />Saved universes</NavLink>
        <NavLink to="/community"><CommunityIcon name="imgMessagesSquare" />Community</NavLink>
      </nav>
      <div className="community-invitation"><LittleUniverse /><h2>Your people.<br />Your universe.</h2><p>A little space for the things<br />you love a lot.</p></div>
      <Link className="community-account" to={viewer ? '/account/settings' : '/auth/sign-in'}>
        <span className="fan-avatar">{initials}</span><span><strong>{viewer?.name || 'Join the universe'}</strong>
          <small>{viewer ? 'My account' : 'Sign in with Google'}</small></span><CommunityIcon name="imgChevronDown" />
      </Link>
    </aside>
    <main className="community-content">{children}</main>
  </div>
}

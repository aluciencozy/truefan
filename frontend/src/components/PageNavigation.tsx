import { Link, NavLink } from 'react-router-dom'
import { communityAssets as assets } from '../lib/communityAssets'
import './PageNavigation.css'

export default function PageNavigation({ viewer }: { viewer: { name: string } | null }) {
  const initials = viewer?.name.split(/\s+/).map(word => word[0]).slice(0,2).join('') || '✦'
  return (
    <header className="page-navigation">
      <nav aria-label="Main navigation">
        <NavLink to="/explore"><img src={assets.imgCompass} alt="" />Explore</NavLink>
        <NavLink to="/community"><img src={assets.imgMessagesSquare} alt="" />Community</NavLink>
        <NavLink to="/library"><img src={assets.imgLibrary} alt="" />Saved universes</NavLink>
      </nav>
      <Link className="page-navigation-account" aria-label={viewer ? `${viewer.name} — My account` : 'Sign in to True Fan'} to={viewer ? '/account/settings' : '/auth/sign-in'}>
        <span className="page-navigation-avatar">{initials}</span><span><strong>{viewer?.name || 'Join the universe'}</strong>
          <small>{viewer ? 'My account' : 'Sign in'}</small></span><img src={assets.imgChevronDown} alt="" />
      </Link>
    </header>
  )
}

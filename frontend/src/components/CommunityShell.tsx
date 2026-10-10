import type { ReactNode } from 'react'
import PageNavigation from './PageNavigation'
import GlitterStars from './GlitterStars'
import { communityAssets as assets } from '../lib/communityAssets'

export interface CommunityViewer { id?: string; name: string }
export function CommunityIcon({ name, className = '' }: { name: keyof typeof assets; className?: string }) {
  return <img src={assets[name]} className={`community-icon ${className}`} alt="" />
}

export function LittleUniverse() {
  return <div className="community-planet" aria-hidden="true">
    <img className="planet-orbit" src={assets.imgOrbit} /><img className="planet-body" src={assets.imgPlanet} />
    <i /><span>✦</span><span>✦</span><img className="planet-star" src={assets.imgStar10} />
  </div>
}

export default function CommunityShell({ viewer, children }: { viewer: CommunityViewer | null; children: ReactNode }) {
  return <div className="community-page">
    <GlitterStars />
    <PageNavigation viewer={viewer} />
    <main className="community-content">{children}</main>
  </div>
}

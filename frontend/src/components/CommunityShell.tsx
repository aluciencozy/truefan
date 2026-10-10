import type { ReactNode } from 'react'
import AppNavbar from './AppNavbar'
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
export default function CommunityShell({ children }: { children: ReactNode }) {
  return <div className="community-page">
    <div className="community-stars" aria-hidden="true">{stars.map((name,index) => <img key={index} src={assets[name]} />)}
      {Array.from({length: 8}, (_,index) => <span key={index}>✦</span>)}
    </div>
    <AppNavbar />
    <main className="community-content">{children}</main>
  </div>
}

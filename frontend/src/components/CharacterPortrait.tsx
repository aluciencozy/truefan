import { useState } from 'react'

export default function CharacterPortrait({ name, src, loading = 'lazy' }: {
  name: string; src?: string | null; loading?: 'lazy' | 'eager'
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  return src && src !== failedSrc
    ? <img src={src} alt="" loading={loading} decoding="async" draggable={false} onError={() => setFailedSrc(src)} />
    : <span>{name.split(' ').map(word => word[0]).slice(0, 2).join('')}</span>
}

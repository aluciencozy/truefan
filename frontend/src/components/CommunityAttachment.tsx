import { useEffect, useRef, useState } from 'react'

export async function readCommunityImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5_000_000) throw Error('Choose a PNG, JPEG, or WebP image under 5 MB.')
  const original = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(Error('Could not read this image.'))
    reader.readAsDataURL(file)
  })
  const picture = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(Error('This file could not be opened as an image.'))
    image.src = original
  })
  if (file.size <= 500_000) return original
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw Error('Could not prepare the image. Try a smaller image.')
  let scale = Math.min(1, 1600 / Math.max(picture.width, picture.height))
  for (let attempt = 0; attempt < 5; attempt++) {
    canvas.width = Math.max(1, Math.round(picture.width * scale))
    canvas.height = Math.max(1, Math.round(picture.height * scale))
    context.drawImage(picture, 0, 0, canvas.width, canvas.height)
    const result = canvas.toDataURL('image/webp', 0.85)
    if (result.length < 666_600) return result
    scale *= 0.7
  }
  throw Error('This image is too large. Try a smaller image.')
}
interface Props { value: string; disabled?: boolean; onChange: (value: string) => void; onError: (message: string) => void; onBusyChange?: (busy: boolean) => void }
export default function CommunityAttachment({value, disabled, onChange, onError, onBusyChange}: Props) {
  const input = useRef<HTMLInputElement>(null)
  const active = useRef(true)
  const [loading, setLoading] = useState(false)
  useEffect(() => { active.current = true; return () => { active.current = false; onBusyChange?.(false) } }, [])
  async function attach(file?: File) {
    if (!file) return
    setLoading(true); onBusyChange?.(true); onError('')
    try { const image = await readCommunityImage(file); if (active.current) onChange(image) }
    catch (error) { if (active.current) onError(error instanceof Error ? error.message : 'Could not attach image.') }
    finally { if (active.current) { setLoading(false); onBusyChange?.(false) }; if (input.current) input.current.value = '' }
  }
  return <div className="community-attachment">
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Choose image attachment" disabled={disabled || loading} onChange={event => void attach(event.target.files?.[0])}/>
    <button className="attachment-clip" type="button" aria-label="Attach an image" title="Attach an image (PNG, JPEG, WebP · up to 5 MB)" disabled={disabled || loading} onClick={() => input.current?.click()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7L13 2a7 7 0 0 1 10 10L12 23"/></svg></button>
    {loading && <span role="status">Preparing image…</span>}
    {value && <div className="attachment-preview"><img src={value} alt="Attached image preview"/><button type="button" aria-label="Remove attached image" disabled={disabled || loading} onClick={() => onChange('')}>×</button></div>}
  </div>
}

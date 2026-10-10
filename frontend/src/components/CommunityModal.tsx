import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

/** Native focus trapping, Escape dismissal, and focus return for community dialogs. */
export default function CommunityModal({ title, subtitle, children, onClose, className = '' }: {
  title: string; subtitle: string; children: ReactNode; onClose: () => void; className?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); if (origin?.isConnected) origin.focus() }
  }, [])
  return <dialog ref={ref} className={`community-modal ${className}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose() }} onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <header className="community-modal-header"><div><h2 id={titleId}>{title}</h2><p>{subtitle}</p></div>
      <button className="community-modal-close" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose} autoFocus>×</button>
    </header>
    {children}
  </dialog>
}

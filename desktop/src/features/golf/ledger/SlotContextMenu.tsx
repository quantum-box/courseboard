import { CalendarPlus, CalendarX, Settings2, Users } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/** What the desk right-clicked, and therefore what it can do next. */
export type SlotContextTarget = {
  x: number
  y: number
  golfCourseId: string
  courseName: string
  teeTime: string
  /** Set when the row holds a booking; absent on an open row. */
  reservationId?: string
  reservationName?: string
  canBook: boolean
}

/**
 * The right-click menu on a ledger row.
 *
 * A menu rather than more buttons in the row: the board is dense enough that
 * per-row controls would crowd out the thing being read, and the desk already
 * knows where a context menu lives.
 */
export function SlotContextMenu({
  target,
  onClose,
  onBook,
  onEditParty,
  onCancelReservation,
  onSlotSettings,
}: {
  target: SlotContextTarget | null
  onClose: () => void
  onBook: (golfCourseId: string, teeTime: string) => void
  onEditParty: (reservationId: string) => void
  onCancelReservation: (reservationId: string) => void
  onSlotSettings: (golfCourseId: string, teeTime: string) => void
}) {
  const { t } = useTranslation(['ledger'])
  const menuRef = useRef<HTMLDivElement>(null)

  // Any click outside, Escape, or a scroll dismisses it: a menu left hanging
  // over the board would sit on top of the rows the desk is trying to read.
  useEffect(() => {
    if (!target) return
    const dismiss = () => onClose()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [target, onClose])

  if (!target) return null

  // Clamped so a row near the right or bottom edge still opens a whole menu.
  const left = Math.min(target.x, Math.max(window.innerWidth - 240, 8))
  const top = Math.min(target.y, Math.max(window.innerHeight - 200, 8))

  const run = (action: () => void) => {
    onClose()
    action()
  }

  return (
    <div
      ref={menuRef}
      className="ledger-context-menu"
      role="menu"
      style={{ left, top }}
      onPointerDown={event => event.stopPropagation()}
    >
      <p className="ledger-context-menu-head">
        {target.courseName} · {target.teeTime}
      </p>

      {target.canBook ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => run(() => onBook(target.golfCourseId, target.teeTime))}
        >
          <CalendarPlus aria-hidden="true" />
          {t('ledger:contextMenu.book')}
        </button>
      ) : null}

      {target.reservationId ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => run(() => onEditParty(target.reservationId!))}
        >
          <Users aria-hidden="true" />
          {t('ledger:contextMenu.editParty')}
        </button>
      ) : null}

      {target.reservationId ? (
        <button
          type="button"
          role="menuitem"
          className="is-danger"
          onClick={() => run(() => onCancelReservation(target.reservationId!))}
        >
          <CalendarX aria-hidden="true" />
          {t('ledger:contextMenu.cancelReservation')}
        </button>
      ) : null}

      <button
        type="button"
        role="menuitem"
        onClick={() => run(() => onSlotSettings(target.golfCourseId, target.teeTime))}
      >
        <Settings2 aria-hidden="true" />
        {t('ledger:contextMenu.slotSettings')}
      </button>
    </div>
  )
}

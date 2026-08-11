import { Button, Input } from '@tachyon-sdk/native-ui'
import { CalendarPlus, Lock, Tag, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Field, Notice } from '../../../components/Page'
import { Sheet } from '../../../components/Sheet'
import type { SlotSelection } from './LedgerBoard'
import type { SlotMarkKind } from './models'

/**
 * Close a stretch of tee times, or price it specially.
 *
 * A sheet rather than a strip above the board: the controls used to sit in the
 * page chrome, where they pushed the whole ledger down the moment a row was
 * selected — the operator picked a time and the time moved. The board stays
 * put behind this, which also keeps the selected rows in view while the mark
 * is described.
 */
export function SlotMarkEditor({
  selection,
  label,
  saving,
  canBook,
  reservationBlockMessage,
  onOpenBlockFix,
  onLabelChange,
  onClose,
  onSpecial,
  onClear,
  onCancel,
  onBook,
}: {
  selection: SlotSelection | null
  label: string
  saving: boolean
  /** A booking goes on one tee time, so a range selection cannot offer it. */
  canBook: boolean
  reservationBlockMessage: string | null
  /** Opens the screen that fixes the block, for the reasons that have one. */
  onOpenBlockFix: (() => void) | null
  onLabelChange: (value: string) => void
  onClose: () => void
  onSpecial: () => void
  onClear: () => void
  onCancel: () => void
  onBook: () => void
}) {
  const { t } = useTranslation(['ledger'])
  return (
    <Sheet
      open={selection !== null}
      onOpenChange={open => {
        if (!open) onCancel()
      }}
      title={t('ledger:marks.title')}
      description={t('ledger:marks.selected', {
        n: String(selection?.teeTimes.length ?? 0),
      })}
      className="ledger-mark-editor-sheet"
    >
      <div className="ledger-mark-sheet">
        {selection?.teeTimes.length === 1 ? (
          <div className="ledger-mark-reservation">
            {reservationBlockMessage ? (
              <Notice tone="warning" title={t('ledger:newReservation.blockedTitle')}>
                {reservationBlockMessage}
                {onOpenBlockFix ? (
                  <>
                    {' '}
                    <button type="button" className="link-button" onClick={onOpenBlockFix}>
                      {t('ledger:source.openCourseSetup')}
                    </button>
                  </>
                ) : null}
              </Notice>
            ) : canBook ? (
              <Button type="button" variant="primary" disabled={saving} onClick={onBook}>
                <CalendarPlus />
                {t('ledger:newReservation.open')}
              </Button>
            ) : null}
          </div>
        ) : null}

        <Field label={t('ledger:marks.label')} requirement="none">
          <Input
            value={label}
            placeholder={t('ledger:marks.labelPlaceholder')}
            onChange={event => onLabelChange(event.target.value)}
          />
        </Field>

        <div className="ledger-mark-actions">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            <Lock />
            {t('ledger:marks.close')}
          </Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={onSpecial}>
            <Tag />
            {t('ledger:marks.special')}
          </Button>
          <Button type="button" variant="ghost" disabled={saving} onClick={onClear}>
            <Trash2 />
            {t('ledger:marks.clear')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

export type { SlotMarkKind }

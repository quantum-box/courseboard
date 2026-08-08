import { Button, Input } from '@tachyon-sdk/native-ui'
import { Lock, Tag, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Field } from '../../../components/Page'
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
  onLabelChange,
  onClose,
  onSpecial,
  onClear,
  onCancel,
}: {
  selection: SlotSelection | null
  label: string
  saving: boolean
  onLabelChange: (value: string) => void
  onClose: () => void
  onSpecial: () => void
  onClear: () => void
  onCancel: () => void
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
    >
      <div className="ledger-mark-sheet">
        <Field label={t('ledger:marks.label')} requirement="none">
          <Input
            value={label}
            placeholder={t('ledger:marks.labelPlaceholder')}
            onChange={event => onLabelChange(event.target.value)}
          />
        </Field>

        <div className="ledger-mark-actions">
          <Button type="button" variant="primary" disabled={saving} onClick={onClose}>
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

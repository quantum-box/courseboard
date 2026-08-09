import { Button } from '@tachyon-sdk/native-ui'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import { Field, Notice } from '../../../components/Page'
import { Sheet } from '../../../components/Sheet'
import { showToast } from '../../../lib/toast'
import type { TeeReservation } from '../timeline/models'

export function CancelReservationDialog({
  reservation,
  onClose,
  onCancelled,
}: {
  reservation: TeeReservation | null
  onClose: () => void
  onCancelled: () => void
}) {
  const { t } = useTranslation(['ledger'])
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (reservation) setReason('')
  }, [reservation])

  if (!reservation) return null

  const cancel = async () => {
    setSaving(true)
    try {
      await courseboardApiJson(
        `/v1/course/reservations/${encodeURIComponent(reservation.id)}/cancel`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() || null }),
        },
      )
      showToast({ tone: 'success', message: t('ledger:cancelReservation.done') })
      onCancelled()
      onClose()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('ledger:cancelReservation.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open
      onOpenChange={open => {
        if (!open && !saving) onClose()
      }}
      title={t('ledger:cancelReservation.title')}
      description={t('ledger:cancelReservation.description', {
        name: reservation.partyName,
        time: reservation.teeTime.slice(11, 16),
      })}
    >
      <div className="ledger-party-editor">
        <Notice tone="warning" title={t('ledger:cancelReservation.warnTitle')}>
          {t('ledger:cancelReservation.warnBody')}
        </Notice>

        <Field label={t('ledger:cancelReservation.reason')} requirement="none">
          <textarea
            className="native-textarea"
            rows={3}
            maxLength={500}
            value={reason}
            placeholder={t('ledger:cancelReservation.reasonPlaceholder')}
            onChange={event => setReason(event.target.value)}
          />
        </Field>

        <div className="ledger-party-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t('ledger:cancelReservation.keep')}
          </Button>
          <Button type="button" variant="destructive" onClick={cancel} disabled={saving}>
            {saving
              ? t('ledger:cancelReservation.saving')
              : t('ledger:cancelReservation.confirm')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

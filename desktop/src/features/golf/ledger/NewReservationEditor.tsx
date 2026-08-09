import { Button, Input } from '@tachyon-sdk/native-ui'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import { Field, FormGrid } from '../../../components/Page'
import { Sheet } from '../../../components/Sheet'
import { showToast } from '../../../lib/toast'
import { DiscardGuard } from './DiscardGuard'
import { MAX_PARTY_PLAYERS } from './ledgerLayout'

/** Plans the desk can book this tee time under. */
export type BookablePlan = {
  reservationServiceId: string
  label: string
  expectedDurationMinutes: number
  golfCourseId?: string | null
}

export type NewReservationTarget = {
  golfCourseId: string
  courseName: string
  teeTime: string
}

/** Falls back when the chosen plan carries no duration of its own. */
const DEFAULT_DURATION_MINUTES = 270

export function NewReservationEditor({
  target,
  date,
  plans,
  onClose,
  onCreated,
}: {
  target: NewReservationTarget | null
  date: string
  plans: BookablePlan[]
  onClose: () => void
  onCreated: () => void
}) {
  const { t } = useTranslation(['ledger'])
  const [customerName, setCustomerName] = useState('')
  const [quantity, setQuantity] = useState('4')
  const [planId, setPlanId] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  // Plans are filtered to the course being booked; a plan sold on another
  // course would put the round on a tee sheet the desk is not looking at.
  const coursePlans = plans.filter(
    plan => !plan.golfCourseId || plan.golfCourseId === target?.golfCourseId,
  )

  useEffect(() => {
    if (!target) return
    setCustomerName('')
    setQuantity('4')
    setPlanId(coursePlans[0]?.reservationServiceId ?? '')
    setConfirmingDiscard(false)
  }, [target])

  if (!target) return null

  // Only what the desk typed counts as work worth guarding; the pre-filled
  // party size and default plan are not something anyone would mourn.
  const dirty = customerName.trim().length > 0
  const requestClose = () => {
    if (saving) return
    if (dirty) {
      setConfirmingDiscard(true)
      return
    }
    onClose()
  }

  const parsedQuantity = Number.parseInt(quantity, 10)
  const validQuantity =
    Number.isFinite(parsedQuantity) && parsedQuantity > 0 && parsedQuantity <= MAX_PARTY_PLAYERS
  const canSave = customerName.trim().length > 0 && validQuantity && !saving

  const save = async () => {
    const plan = coursePlans.find(entry => entry.reservationServiceId === planId)
    setSaving(true)
    try {
      await courseboardApiJson('/v1/course/reservations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          golfCourseId: target.golfCourseId,
          reservationServiceId: plan?.reservationServiceId ?? null,
          date,
          teeTime: target.teeTime,
          durationMinutes: plan?.expectedDurationMinutes || DEFAULT_DURATION_MINUTES,
          quantity: parsedQuantity,
          customerName: customerName.trim(),
        }),
      })
      showToast({ tone: 'success', message: t('ledger:newReservation.saved') })
      onCreated()
      onClose()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('ledger:newReservation.failed'),
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
        if (!open) requestClose()
      }}
      title={t('ledger:newReservation.title')}
      description={t('ledger:newReservation.description', {
        course: target.courseName,
        time: target.teeTime,
      })}
    >
      <div className="ledger-party-editor">
        <FormGrid columns={2}>
          <Field label={t('ledger:newReservation.customerName')}>
            <Input
              value={customerName}
              placeholder={t('ledger:newReservation.customerNamePlaceholder')}
              onChange={event => setCustomerName(event.target.value)}
            />
          </Field>
          <Field label={t('ledger:newReservation.quantity')}>
            <Input
              type="number"
              min={1}
              max={MAX_PARTY_PLAYERS}
              value={quantity}
              onChange={event => setQuantity(event.target.value)}
            />
          </Field>
          {coursePlans.length > 0 ? (
            <Field label={t('ledger:newReservation.plan')} requirement="none">
              <select
                className="native-select"
                value={planId}
                onChange={event => setPlanId(event.target.value)}
              >
                {coursePlans.map(plan => (
                  <option key={plan.reservationServiceId} value={plan.reservationServiceId}>
                    {plan.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </FormGrid>

        <div className="ledger-party-actions">
          <Button type="button" variant="ghost" onClick={requestClose} disabled={saving}>
            {t('ledger:newReservation.cancel')}
          </Button>
          <Button type="button" variant="primary" onClick={save} disabled={!canSave}>
            {saving ? t('ledger:newReservation.saving') : t('ledger:newReservation.save')}
          </Button>
        </div>

        <DiscardGuard
          open={confirmingDiscard}
          onKeepEditing={() => setConfirmingDiscard(false)}
          onDiscard={() => {
            setConfirmingDiscard(false)
            onClose()
          }}
        />
      </div>
    </Sheet>
  )
}

import { Button, Input } from '@tachyon-sdk/native-ui'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError, courseboardApiJson } from '../../../api'
import { Field, FormGrid, Notice } from '../../../components/Page'
import { Sheet } from '../../../components/Sheet'
import { showToast } from '../../../lib/toast'
import { DiscardGuard } from './DiscardGuard'
import { MAX_PARTY_PLAYERS } from './ledgerLayout'
import {
  hasUnnamedReservationPlayer,
  reservationPlayerRows,
  resizeReservationPlayerRows,
  toReservationPlayers,
  type DraftReservationPlayer,
} from './newReservationPlayers'
import { PlayerTagInput } from './PlayerTagInput'

/** Plans the desk can book this tee time under. */
export type BookablePlan = {
  reservationServiceId: string
  label: string
  /** Whether the round is sold with a caddie. Drives the badge on the list. */
  playType: 'caddie' | 'self'
  expectedDurationMinutes: number
  golfCourseId?: string | null
  /** Players this plan sells in one group; absent means the general cap. */
  maxPlayersPerGroup?: number | null
}

export type NewReservationTarget = {
  golfCourseId: string
  courseName: string
  teeTime: string
  resourceId: string | null
}

/** Falls back when the chosen plan carries no duration of its own. */
const DEFAULT_DURATION_MINUTES = 270

export function NewReservationEditor({
  target,
  date,
  plans,
  playerTagOptions,
  onClose,
  onCreated,
}: {
  target: NewReservationTarget | null
  date: string
  plans: BookablePlan[]
  playerTagOptions: string[]
  onClose: () => void
  onCreated: () => void
}) {
  const { t } = useTranslation(['ledger'])
  const [customerName, setCustomerName] = useState('')
  const [quantity, setQuantity] = useState('4')
  const [planId, setPlanId] = useState('')
  const [players, setPlayers] = useState<DraftReservationPlayer[]>(() => reservationPlayerRows(4))
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
    setPlayers(reservationPlayerRows(4))
    setConfirmingDiscard(false)
  }, [target])

  // The plans list loads on its own clock, so the sheet can open before it
  // arrives. Picking the default once it does — and not overwriting a plan the
  // desk already chose — keeps a caddie round from being sent as self-play.
  const defaultPlanId = coursePlans[0]?.reservationServiceId ?? ''
  useEffect(() => {
    if (!target) return
    setPlanId(current =>
      coursePlans.some(plan => plan.reservationServiceId === current) ? current : defaultPlanId,
    )
  }, [target, defaultPlanId])

  const selectedPlan = coursePlans.find(entry => entry.reservationServiceId === planId)
  const maxQuantity = Math.min(selectedPlan?.maxPlayersPerGroup ?? MAX_PARTY_PLAYERS, MAX_PARTY_PLAYERS)
  const parsedQuantity = Number.parseInt(quantity, 10)
  const validQuantity =
    Number.isFinite(parsedQuantity) && parsedQuantity > 0 && parsedQuantity <= maxQuantity

  useEffect(() => {
    if (!validQuantity) return
    setPlayers(current => resizeReservationPlayerRows(current, parsedQuantity))
  }, [parsedQuantity, validQuantity])

  if (!target) return null

  // Only what the desk typed counts as work worth guarding; the pre-filled
  // party size and default plan are not something anyone would mourn.
  const dirty = customerName.trim().length > 0 || players.some(player =>
    Boolean(player.name.trim() || player.tag.trim() || player.memberNumber.trim()),
  )
  const requestClose = () => {
    if (saving) return
    if (dirty) {
      setConfirmingDiscard(true)
      return
    }
    onClose()
  }

  // A plan may sell a smaller group than a four-ball — a two-ball twilight
  // round, say — and that limit is the club's rule, so it wins over the
  // general cap rather than being checked only after Field accepts the booking.
  const namedPlayers = toReservationPlayers(players)
  const hasUnnamedPlayer = hasUnnamedReservationPlayer(players)
  const hasTooManyPlayers = validQuantity && namedPlayers.length > parsedQuantity
  const canSave = customerName.trim().length > 0
    && validQuantity
    && !hasUnnamedPlayer
    && !hasTooManyPlayers
    && Boolean(target.resourceId)
    && !saving

  const save = async () => {
    const plan = selectedPlan
    if (!target.resourceId) return
    setSaving(true)
    try {
      await courseboardApiJson('/v1/course/reservations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          golfCourseId: target.golfCourseId,
          resourceId: target.resourceId,
          reservationServiceId: plan?.reservationServiceId ?? null,
          date,
          teeTime: target.teeTime,
          durationMinutes: plan?.expectedDurationMinutes || DEFAULT_DURATION_MINUTES,
          quantity: parsedQuantity,
          customerName: customerName.trim(),
          players: namedPlayers,
        }),
      })
      showToast({ tone: 'success', message: t('ledger:newReservation.saved') })
      onCreated()
      onClose()
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        showToast({ tone: 'warning', message: t('ledger:newReservation.justFilled') })
        onCreated()
        onClose()
        return
      }
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
              max={maxQuantity}
              value={quantity}
              onChange={event => setQuantity(event.target.value)}
            />
          </Field>
        </FormGrid>

        {/* Every booking is sold under a plan, so the choice is on the sheet
            rather than behind a dropdown: opening a menu to reach a field the
            desk always has to touch is one click on every phone call. */}
        {coursePlans.length > 0 ? (
          <fieldset className="ledger-plan-picker">
            <legend>{t('ledger:newReservation.plan')}</legend>
            <div className="ledger-plan-list">
              {coursePlans.map(plan => (
                <label
                  key={plan.reservationServiceId}
                  className={`ledger-plan-option${
                    planId === plan.reservationServiceId ? ' is-selected' : ''
                  }`}
                >
                  <input
                    type="radio"
                    name="courseboard-new-reservation-plan"
                    value={plan.reservationServiceId}
                    checked={planId === plan.reservationServiceId}
                    onChange={() => setPlanId(plan.reservationServiceId)}
                  />
                  <span className="ledger-plan-label">{plan.label}</span>
                  {/* Caddie or self is what the desk is really choosing between,
                      and a plan name does not always say which. The colours are
                      the board's, so the badge reads the same in both places. */}
                  <span className={`ledger-plan-badge ledger-play-type-${plan.playType}`}>
                    {t(`ledger:cell.playType.${plan.playType}`)}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {hasUnnamedPlayer ? (
          <Notice tone="danger">{t('ledger:party.emptyPlayerName')}</Notice>
        ) : null}
        {hasTooManyPlayers ? (
          <Notice tone="warning" title={t('ledger:party.partySizeTitle')}>
            {t('ledger:party.partySizeNotice', {
              booked: String(parsedQuantity),
              named: String(namedPlayers.length),
            })}
          </Notice>
        ) : null}

        <section className="ledger-party-players" aria-label={t('ledger:party.players')}>
          <h3>{t('ledger:party.players')}</h3>
          {players.map((player, index) => (
            <div className="ledger-party-player ledger-party-player--new" key={index}>
              <Field className="ledger-party-field-name" label={t('ledger:party.playerName')}>
                <Input
                  value={player.name}
                  placeholder={t('ledger:party.playerNamePlaceholder')}
                  onChange={event =>
                    setPlayers(rows => rows.map((row, at) =>
                      at === index ? { ...row, name: event.target.value } : row,
                    ))
                  }
                />
              </Field>
              <Field className="ledger-party-field-tag" label={t('ledger:party.playerTag')}>
                <PlayerTagInput
                  value={player.tag}
                  options={playerTagOptions}
                  onChange={value =>
                    setPlayers(rows => rows.map((row, at) =>
                      at === index ? { ...row, tag: value } : row,
                    ))
                  }
                />
              </Field>
              <Field className="ledger-party-field-member" label={t('ledger:party.memberNumber')}>
                <Input
                  value={player.memberNumber}
                  onChange={event =>
                    setPlayers(rows => rows.map((row, at) =>
                      at === index ? { ...row, memberNumber: event.target.value } : row,
                    ))
                  }
                />
              </Field>
            </div>
          ))}
        </section>

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

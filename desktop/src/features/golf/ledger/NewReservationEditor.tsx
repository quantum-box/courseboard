import { Button, Input } from '@tachyon-sdk/native-ui'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError, courseboardApiJson } from '../../../api'
import { Field, FormGrid, Notice } from '../../../components/Page'
import { Sheet } from '../../../components/Sheet'
import { showToast } from '../../../lib/toast'
import { CustomerPicker } from '../customers/CustomerPicker'
import type { CourseCaddieSupply } from '../caddieCourseSupply'
import { plansForCourse, type BookablePlan } from './bookablePlan'
import { unregisteredNames, type UnregisteredName } from './unregisteredNames'
import { DiscardGuard } from './DiscardGuard'
import { caddieRoundsSoldOut, MAX_PARTY_PLAYERS } from './ledgerLayout'
import {
  hasUnnamedReservationPlayer,
  linkedReservationPlayerCount,
  reservationPlayerRows,
  resizeReservationPlayerRows,
  toReservationPlayers,
  type DraftReservationPlayer,
} from './newReservationPlayers'
import { PlanPicker } from './PlanPicker'
import { PlayerTagInput } from './PlayerTagInput'

export type { BookablePlan } from './bookablePlan'

export type NewReservationTarget = {
  golfCourseId: string
  courseName: string
  teeTime: string
  resourceId: string | null
}

/** Falls back when the chosen plan carries no duration of its own. */
const DEFAULT_DURATION_MINUTES = 270

/** What a completed booking hands back so the ledger question can follow it. */
export type CreatedBooking = {
  reservationId: string
  names: UnregisteredName[]
  players: DraftReservationPlayer[]
}

export function NewReservationEditor({
  target,
  date,
  plans,
  plansLoading = false,
  playerTagOptions,
  onClose,
  onCreated,
  caddieSupply = null,
}: {
  target: NewReservationTarget | null
  date: string
  plans: BookablePlan[]
  /** Distinguishes "still arriving" from "this course sells nothing". */
  plansLoading?: boolean
  playerTagOptions: string[]
  onClose: () => void
  /**
   * Reports the saved booking so the page can refresh and, if any names went
   * in without an identity, ask about them once this sheet has closed.
   */
  onCreated: (booking?: CreatedBooking) => void
  /**
   * Today's caddie room on the course being booked, or null when the lookup
   * has not landed. Absent means the caddie plans stay selectable.
   */
  caddieSupply?: CourseCaddieSupply | null
}) {
  const { t } = useTranslation(['ledger'])
  const [customerName, setCustomerName] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [quantity, setQuantity] = useState('4')
  const [competitionName, setCompetitionName] = useState('')
  const [organizer, setOrganizer] = useState('')
  const [groupNumber, setGroupNumber] = useState('')
  const [planId, setPlanId] = useState('')
  const [players, setPlayers] = useState<DraftReservationPlayer[]>(() => reservationPlayerRows(4))
  const [saving, setSaving] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  // Plans are filtered to the course being booked; a plan sold on another
  // course would put the round on a tee sheet the desk is not looking at.
  const coursePlans = plansForCourse(plans, target?.golfCourseId)

  useEffect(() => {
    if (!target) return
    setCustomerName('')
    setCustomerId(null)
    setQuantity('4')
    setCompetitionName('')
    setOrganizer('')
    setGroupNumber('')
    setPlayers(reservationPlayerRows(4))
    setConfirmingDiscard(false)
  }, [target])

  // Today's caddies are already spoken for, so a caddie round cannot be sold
  // on this course. Self-play still can, which is why this narrows the plan
  // list rather than closing the sheet.
  const caddieSoldOut = caddieRoundsSoldOut(caddieSupply)
  const sellablePlans = coursePlans.filter(
    plan => !(caddieSoldOut && plan.playType === 'caddie'),
  )

  // The plans list loads on its own clock, so the sheet can open before it
  // arrives. Picking the default once it does — and not overwriting a plan the
  // desk already chose — keeps a caddie round from being sent as self-play.
  // The default comes from the sellable ones: opening on a plan the desk is
  // not allowed to book would put the sheet in a state Save refuses.
  const defaultPlanId = sellablePlans[0]?.reservationServiceId ?? ''
  useEffect(() => {
    if (!target) return
    setPlanId(current =>
      sellablePlans.some(plan => plan.reservationServiceId === current) ? current : defaultPlanId,
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
  const dirty = customerName.trim().length > 0
    || competitionName.trim().length > 0
    || organizer.trim().length > 0
    || groupNumber.trim().length > 0
    || players.some(player =>
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
  // A booking with no plan reaches Field as a round nobody can price, and
  // nothing downstream — the fee simulation, the monthly settlement, the
  // caddie split — can say what it was sold as. The list always has one
  // picked, so this only bites when the course sells nothing at all.
  const missingPlan = !planId
  // The picker disables the caddie rows, but the state can still hold one: the
  // supply lands on its own clock, so a plan chosen a moment before the last
  // caddie round sold would otherwise sail through Save.
  const planSoldOut = caddieSoldOut && selectedPlan?.playType === 'caddie'
  const canSave = customerName.trim().length > 0
    && validQuantity
    && !hasUnnamedPlayer
    && !hasTooManyPlayers
    && !missingPlan
    && !planSoldOut
    && Boolean(target.resourceId)
    && !saving

  const parsedGroupNumber = Number.parseInt(groupNumber, 10)

  const save = async () => {
    const plan = selectedPlan
    if (!target.resourceId) return
    setSaving(true)
    try {
      const created = await courseboardApiJson<{ id: string }>('/v1/course/reservations', {
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
          customerId,
          competitionName: competitionName.trim() || null,
          organizer: organizer.trim() || null,
          groupNumber: Number.isFinite(parsedGroupNumber) && parsedGroupNumber > 0
            ? parsedGroupNumber
            : null,
          players: namedPlayers,
        }),
      })
      showToast({ tone: 'success', message: t('ledger:newReservation.saved') })
      // Close first, and report the unregistered names to the page rather than
      // holding them here. The booking is done, and it has to *look* done —
      // a prompt over a still-open booking form reads as "the booking is not
      // finished until you answer this", which is the opposite of true.
      onClose()
      onCreated(created?.id
        ? {
          reservationId: created.id,
          names: unregisteredNames({ name: customerName, customerId }, players),
          players,
        }
        : undefined)
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
      className="ledger-reservation-sheet"
    >
      <div className="ledger-party-editor">
        <FormGrid columns={2}>
          {/* Both are what `canSave` already insists on. Marked as such, because
              a field labelled 任意 that greys out the save button is the screen
              disagreeing with itself. */}
          <Field label={t('ledger:newReservation.customerName')} required>
            <CustomerPicker
              name={customerName}
              customerId={customerId}
              placeholder={t('ledger:newReservation.customerNamePlaceholder')}
              onNameChange={setCustomerName}
              onSelect={customer => setCustomerId(customer?.id ?? null)}
            />
          </Field>
          <Field label={t('ledger:newReservation.quantity')} required>
            <Input
              type="number"
              min={1}
              max={maxQuantity}
              value={quantity}
              onChange={event => setQuantity(event.target.value)}
            />
          </Field>
        </FormGrid>

        {/* The same group detail the edit sheet holds. Asked for while the
            caller is still on the phone rather than after the booking exists:
            a compe name that has to be added afterwards is one the desk has to
            remember to come back for, and the board reads it off the row. */}
        <FormGrid columns={2}>
          <Field label={t('ledger:party.competition')}>
            <Input
              value={competitionName}
              placeholder={t('ledger:party.competitionPlaceholder')}
              onChange={event => setCompetitionName(event.target.value)}
            />
          </Field>
          <Field label={t('ledger:party.organizer')}>
            <Input
              value={organizer}
              placeholder={t('ledger:party.organizerPlaceholder')}
              onChange={event => setOrganizer(event.target.value)}
            />
          </Field>
          <Field label={t('ledger:party.groupNumber')}>
            <Input
              type="number"
              min={1}
              value={groupNumber}
              onChange={event => setGroupNumber(event.target.value)}
            />
          </Field>
        </FormGrid>

        {/* Every booking is sold under a plan, so the choice is on the sheet
            rather than behind a dropdown: opening a menu to reach a field the
            desk always has to touch is one click on every phone call. */}
        {missingPlan && !plansLoading ? (
          <Notice tone="danger" title={t('ledger:newReservation.noPlanTitle')}>
            {t('ledger:newReservation.noPlanBody', { course: target.courseName })}
          </Notice>
        ) : null}

        <PlanPicker
          plans={coursePlans}
          value={planId}
          name="courseboard-new-reservation-plan"
          onChange={setPlanId}
          caddieSoldOut={caddieSoldOut}
        />

        {/* The picker greys the caddie rows out, but a course that sells
            nothing else leaves the desk staring at a list it cannot use. Say
            what to do about it: the tee time is free, the caddie room is not. */}
        {caddieSoldOut && sellablePlans.length === 0 ? (
          <Notice tone="warning" title={t('ledger:newReservation.caddieSoldOutTitle')}>
            {t('ledger:newReservation.caddieSoldOutBody', { course: target.courseName })}
          </Notice>
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
          {/* How much of the group made it into the ledger. Shown as a count
              rather than a warning: taking the booking comes first, and a
              banner on every phone call would train the desk to ignore it. */}
          {namedPlayers.length > 0 ? (
            <p className="ledger-party-players__ledger-note">
              {t('ledger:customer.linkedPlayers', {
                linked: String(linkedReservationPlayerCount(players)),
                named: String(namedPlayers.length),
              })}
            </p>
          ) : null}
          {players.map((player, index) => (
            <div className="ledger-party-player ledger-party-player--new" key={index}>
              <Field className="ledger-party-field-name" label={t('ledger:party.playerName')}>
                <CustomerPicker
                  name={player.name}
                  customerId={player.customerId}
                  placeholder={t('ledger:party.playerNamePlaceholder')}
                  onNameChange={value =>
                    setPlayers(rows => rows.map((row, at) =>
                      at === index ? { ...row, name: value } : row,
                    ))
                  }
                  onSelect={customer =>
                    setPlayers(rows => rows.map((row, at) =>
                      at === index ? { ...row, customerId: customer?.id ?? null } : row,
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

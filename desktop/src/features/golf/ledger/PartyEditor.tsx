import { Button, Input } from '@tachyon-sdk/native-ui'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import { Field, FormGrid, Notice } from '../../../components/Page'
import { Sheet } from '../../../components/Sheet'
import { showToast } from '../../../lib/toast'
import { CustomerPicker } from '../customers/CustomerPicker'
import type { TeeReservation } from '../timeline/models'
import { plansForCourse, type BookablePlan } from './bookablePlan'
import { DiscardGuard } from './DiscardGuard'
import { MAX_PARTY_PLAYERS, MAX_SEAT_COLUMNS } from './ledgerLayout'
import type { PartyDetails, PartyPlayer } from './models'
import { resizeReservationPlayerRows } from './newReservationPlayers'
import { PlanPicker } from './PlanPicker'
import { PlayerTagInput } from './PlayerTagInput'

/** A row being edited. Blank rows are dropped on save rather than refused. */
type DraftPlayer = {
  name: string
  tag: string
  memberNumber: string
  /** Ledger identity already on the booking, or one the desk just picked. */
  customerId: string | null
}

function toDraft(party: PartyDetails | null | undefined, partySize: number): DraftPlayer[] {
  const players = party?.players ?? []
  // Start with one row per booked seat so the desk types into a shape that
  // already matches the booking instead of clicking "add" four times. A
  // booking that already carries more than a four-ball still opens with every
  // player it has: the cap is on what the desk adds, not on what it can read.
  const rows = Math.max(players.length, Math.min(partySize, MAX_PARTY_PLAYERS), 1)
  return Array.from({ length: Math.min(rows, MAX_SEAT_COLUMNS) }, (_, index) => ({
    name: players[index]?.name ?? '',
    tag: players[index]?.tag ?? '',
    memberNumber: players[index]?.memberNumber ?? '',
    customerId: players[index]?.customerId ?? null,
  }))
}

function toPlayers(draft: DraftPlayer[]): PartyPlayer[] {
  return draft
    .filter(row => row.name.trim().length > 0)
    .map(row => ({
      name: row.name.trim(),
      ...(row.tag.trim() ? { tag: row.tag.trim() } : {}),
      ...(row.memberNumber.trim() ? { memberNumber: row.memberNumber.trim() } : {}),
      ...(row.customerId ? { customerId: row.customerId } : {}),
    }))
}

/**
 * Edit one booking: who it is for, how many are playing, what it is sold as,
 * and the group detail the desk keeps against it.
 *
 * Everything the booking was taken with opens already filled in. A sheet that
 * showed only the golf group detail read as an empty form over a booking that
 * plainly had a name and a headcount on the board behind it, and the two
 * fields the desk corrects most — a group that turns up as three, a name taken
 * down wrong — could only be fixed by cancelling and rebooking.
 *
 * The whole roster is sent on save. Patching one seat would need a stable id
 * per player, and the desk works the cell as one thing — it retypes the group,
 * it does not amend seat three.
 */
export function PartyEditor({
  reservation,
  plans,
  playerTagOptions,
  onClose,
  onSaved,
  onReservationChanged,
}: {
  reservation: TeeReservation | null
  plans: BookablePlan[]
  playerTagOptions: string[]
  onClose: () => void
  onSaved: (reservationId: string, party: PartyDetails) => void
  /**
   * The board carries the play type, the booked name, and the seat count, so
   * a change to any of them has to be refetched rather than patched in place.
   */
  onReservationChanged: () => void
}) {
  const { t } = useTranslation(['ledger', 'common'])
  const [customerName, setCustomerName] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [quantity, setQuantity] = useState('')
  const [competitionName, setCompetitionName] = useState('')
  const [organizer, setOrganizer] = useState('')
  const [groupNumber, setGroupNumber] = useState('')
  const [players, setPlayers] = useState<DraftPlayer[]>([])
  const [planId, setPlanId] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  /** What the sheet opened with, so "changed" means changed by the desk. */
  const [opened, setOpened] = useState('')

  const coursePlans = plansForCourse(plans, reservation?.golfCourseId)
  /** Empty when the booking predates plans or its plan is no longer sold. */
  const openedPlanId = reservation?.reservationServiceId ?? ''

  // Reset from the booking whenever a different one is opened, so the sheet
  // never shows the previous group's names against this group's tee time.
  useEffect(() => {
    if (!reservation) return
    const booked = reservation.partyName ?? ''
    const identity = reservation.customerId ?? null
    const seats = String(reservation.partySize)
    const competition = reservation.party?.competitionName ?? ''
    const host = reservation.party?.organizer ?? ''
    const number =
      typeof reservation.party?.groupNumber === 'number'
        ? String(reservation.party.groupNumber)
        : ''
    const draft = toDraft(reservation.party, reservation.partySize)
    setCustomerName(booked)
    setCustomerId(identity)
    setQuantity(seats)
    setCompetitionName(competition)
    setOrganizer(host)
    setGroupNumber(number)
    setPlayers(draft)
    setPlanId(reservation.reservationServiceId ?? '')
    setOpened(JSON.stringify([booked, identity, seats, competition, host, number, draft]))
    setConfirmingDiscard(false)
  }, [reservation])

  const selectedPlan = coursePlans.find(entry => entry.reservationServiceId === planId)
  // The cap is on what the desk may add, not on what a booking may already be:
  // a five-ball Field accepted has to stay editable, or its group detail could
  // never be corrected either.
  const maxQuantity = Math.max(
    Math.min(selectedPlan?.maxPlayersPerGroup ?? MAX_PARTY_PLAYERS, MAX_PARTY_PLAYERS),
    reservation?.partySize ?? 1,
  )
  const parsedQuantity = Number.parseInt(quantity, 10)
  const validQuantity =
    Number.isFinite(parsedQuantity) && parsedQuantity > 0 && parsedQuantity <= maxQuantity

  // A group that grew gets the seats to type the extra names into. Shrinking
  // leaves a row that already has a name on it alone — dropping it here would
  // throw the name away before the desk has said which player left.
  useEffect(() => {
    if (!validQuantity) return
    setPlayers(current => resizeReservationPlayerRows(current, parsedQuantity))
  }, [parsedQuantity, validQuantity])

  if (!reservation) return null

  const named = toPlayers(players)
  const parsedGroupNumber = Number.parseInt(groupNumber, 10)
  const planChanged = planId !== openedPlanId
  const bookingChanged =
    customerName.trim() !== (reservation.partyName ?? '').trim()
    || customerId !== (reservation.customerId ?? null)
    || (validQuantity && parsedQuantity !== reservation.partySize)
  const dirty =
    planChanged
    || JSON.stringify([
      customerName,
      customerId,
      quantity,
      competitionName,
      organizer,
      groupNumber,
      players,
    ]) !== opened
  const canSave = customerName.trim().length > 0 && validQuantity && !saving
  const requestClose = () => {
    if (saving) return
    if (dirty) {
      setConfirmingDiscard(true)
      return
    }
    onClose()
  }

  const save = async () => {
    setSaving(true)
    try {
      // The plan first: it is the write that can be refused — a plan sold on
      // another course, or one seating fewer than the group. Failing before
      // the names are sent leaves the booking exactly as the desk found it.
      if (planChanged && planId) {
        await courseboardApiJson(
          `/v1/course/reservations/${encodeURIComponent(reservation.id)}/plan`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reservationServiceId: planId }),
          },
        )
        onReservationChanged()
      }
      // Then the booking itself, so a headcount is checked against the plan the
      // round is now sold under rather than the one it is leaving.
      if (bookingChanged) {
        await courseboardApiJson(
          `/v1/course/reservations/${encodeURIComponent(reservation.id)}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              customerName: customerName.trim(),
              customerId,
              quantity: parsedQuantity,
            }),
          },
        )
        onReservationChanged()
      }
      const party = await courseboardApiJson<PartyDetails>(
        `/v1/course/reservations/${encodeURIComponent(reservation.id)}/party`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            competitionName: competitionName.trim() || null,
            organizer: organizer.trim() || null,
            groupNumber: Number.isFinite(parsedGroupNumber) && parsedGroupNumber > 0
              ? parsedGroupNumber
              : null,
            players: named,
          }),
        },
      )
      showToast({ tone: 'success', message: t('ledger:party.saved') })
      onSaved(reservation.id, party)
      onClose()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('ledger:party.failed'),
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
      title={t('ledger:party.title')}
      description={t('ledger:party.description')}
    >
      <div className="ledger-party-editor">
        {/* Only once names exist. A booking nobody has typed into is the normal
            starting state, and warning about it would put a banner on every
            group the desk opens for the first time. */}
        {named.length > 0 && validQuantity && named.length !== parsedQuantity ? (
          <Notice tone="warning" title={t('ledger:party.partySizeTitle')}>
            {t('ledger:party.partySizeNotice', {
              booked: String(parsedQuantity),
              named: String(named.length),
            })}
          </Notice>
        ) : null}

        {/* What the booking was taken with. Shown first and already filled in:
            it is what the desk reads off the board before it clicks the row. */}
        <FormGrid columns={2}>
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

        {/* A round booked as self that turns up wanting a caddie is changed
            here rather than cancelled and rebooked. */}
        <PlanPicker
          plans={coursePlans}
          value={planId}
          name="courseboard-party-plan"
          onChange={setPlanId}
        />

        <section className="ledger-party-players" aria-label={t('ledger:party.players')}>
          <h3>{t('ledger:party.players')}</h3>
          {players.map((player, index) => (
            <div className="ledger-party-player" key={index}>
              <Field className="ledger-party-field-name" label={t('ledger:party.playerName')}>
                <CustomerPicker
                  name={player.name}
                  customerId={player.customerId}
                  placeholder={t('ledger:party.playerNamePlaceholder')}
                  onNameChange={value =>
                    setPlayers(rows =>
                      rows.map((row, at) => (at === index ? { ...row, name: value } : row)),
                    )
                  }
                  onSelect={customer =>
                    setPlayers(rows =>
                      rows.map((row, at) =>
                        at === index ? { ...row, customerId: customer?.id ?? null } : row,
                      ),
                    )
                  }
                />
              </Field>
              <Field className="ledger-party-field-tag" label={t('ledger:party.playerTag')}>
                <PlayerTagInput
                  value={player.tag}
                  options={playerTagOptions}
                  onChange={value =>
                    setPlayers(rows =>
                      rows.map((row, at) =>
                        at === index ? { ...row, tag: value } : row,
                      ),
                    )
                  }
                />
              </Field>
              <Field className="ledger-party-field-member" label={t('ledger:party.memberNumber')}>
                <Input
                  value={player.memberNumber}
                  onChange={event =>
                    setPlayers(rows =>
                      rows.map((row, at) =>
                        at === index ? { ...row, memberNumber: event.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ledger-party-remove"
                aria-label={t('ledger:party.removePlayer')}
                onClick={() => setPlayers(rows => rows.filter((_, at) => at !== index))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={players.length >= MAX_PARTY_PLAYERS}
            onClick={() =>
              setPlayers(rows => [...rows, { name: '', tag: '', memberNumber: '', customerId: null }])
            }
          >
            <Plus />
            {t('ledger:party.addPlayer')}
          </Button>
        </section>

        <div className="ledger-party-actions">
          <Button type="button" variant="ghost" onClick={requestClose} disabled={saving}>
            {t('ledger:party.cancel')}
          </Button>
          <Button type="button" variant="primary" onClick={save} disabled={!canSave}>
            {saving ? t('ledger:party.saving') : t('ledger:party.save')}
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

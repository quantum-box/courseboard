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
 * Edit the competition, group number, and named players on one booking.
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
  onPlanChanged,
}: {
  reservation: TeeReservation | null
  plans: BookablePlan[]
  playerTagOptions: string[]
  onClose: () => void
  onSaved: (reservationId: string, party: PartyDetails) => void
  /** The board carries the play type, so it has to be refetched, not patched. */
  onPlanChanged: () => void
}) {
  const { t } = useTranslation(['ledger', 'common'])
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
    const competition = reservation.party?.competitionName ?? ''
    const host = reservation.party?.organizer ?? ''
    const number =
      typeof reservation.party?.groupNumber === 'number'
        ? String(reservation.party.groupNumber)
        : ''
    const draft = toDraft(reservation.party, reservation.partySize)
    setCompetitionName(competition)
    setOrganizer(host)
    setGroupNumber(number)
    setPlayers(draft)
    setPlanId(reservation.reservationServiceId ?? '')
    setOpened(JSON.stringify([competition, host, number, draft]))
    setConfirmingDiscard(false)
  }, [reservation])

  if (!reservation) return null

  const named = toPlayers(players)
  const parsedGroupNumber = Number.parseInt(groupNumber, 10)
  const planChanged = planId !== openedPlanId
  const dirty =
    planChanged
    || JSON.stringify([competitionName, organizer, groupNumber, players]) !== opened
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
        onPlanChanged()
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
        {named.length > 0 && named.length !== reservation.partySize ? (
          <Notice tone="warning" title={t('ledger:party.partySizeTitle')}>
            {t('ledger:party.partySizeNotice', {
              booked: String(reservation.partySize),
              named: String(named.length),
            })}
          </Notice>
        ) : null}

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
          <Button type="button" variant="primary" onClick={save} disabled={saving}>
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

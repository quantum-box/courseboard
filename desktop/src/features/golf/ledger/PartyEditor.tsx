import { Button, Input } from '@tachyon-sdk/native-ui'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import { Field, FormGrid, Notice } from '../../../components/Page'
import { Sheet } from '../../../components/Sheet'
import { showToast } from '../../../lib/toast'
import type { TeeReservation } from '../timeline/models'
import { MAX_SEAT_COLUMNS } from './ledgerLayout'
import type { PartyDetails, PartyPlayer } from './models'

/** A row being edited. Blank rows are dropped on save rather than refused. */
type DraftPlayer = { name: string; tag: string; memberNumber: string }

function toDraft(party: PartyDetails | null | undefined, partySize: number): DraftPlayer[] {
  const players = party?.players ?? []
  // Start with one row per booked seat so the desk types into a shape that
  // already matches the booking instead of clicking "add" four times.
  const rows = Math.max(players.length, partySize, 1)
  return Array.from({ length: Math.min(rows, MAX_SEAT_COLUMNS) }, (_, index) => ({
    name: players[index]?.name ?? '',
    tag: players[index]?.tag ?? '',
    memberNumber: players[index]?.memberNumber ?? '',
  }))
}

function toPlayers(draft: DraftPlayer[]): PartyPlayer[] {
  return draft
    .filter(row => row.name.trim().length > 0)
    .map(row => ({
      name: row.name.trim(),
      ...(row.tag.trim() ? { tag: row.tag.trim() } : {}),
      ...(row.memberNumber.trim() ? { memberNumber: row.memberNumber.trim() } : {}),
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
  onClose,
  onSaved,
}: {
  reservation: TeeReservation | null
  onClose: () => void
  onSaved: (reservationId: string, party: PartyDetails) => void
}) {
  const { t } = useTranslation(['ledger', 'common'])
  const [competitionName, setCompetitionName] = useState('')
  const [organizer, setOrganizer] = useState('')
  const [groupNumber, setGroupNumber] = useState('')
  const [players, setPlayers] = useState<DraftPlayer[]>([])
  const [saving, setSaving] = useState(false)

  // Reset from the booking whenever a different one is opened, so the sheet
  // never shows the previous group's names against this group's tee time.
  useEffect(() => {
    if (!reservation) return
    setCompetitionName(reservation.party?.competitionName ?? '')
    setOrganizer(reservation.party?.organizer ?? '')
    setGroupNumber(
      typeof reservation.party?.groupNumber === 'number'
        ? String(reservation.party.groupNumber)
        : '',
    )
    setPlayers(toDraft(reservation.party, reservation.partySize))
  }, [reservation])

  if (!reservation) return null

  const named = toPlayers(players)
  const parsedGroupNumber = Number.parseInt(groupNumber, 10)

  const save = async () => {
    setSaving(true)
    try {
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
        if (!open) onClose()
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

        <section className="ledger-party-players" aria-label={t('ledger:party.players')}>
          <h3>{t('ledger:party.players')}</h3>
          {players.map((player, index) => (
            <div className="ledger-party-player" key={index}>
              <Field label={t('ledger:party.playerName')}>
                <Input
                  value={player.name}
                  placeholder={t('ledger:party.playerNamePlaceholder')}
                  onChange={event =>
                    setPlayers(rows =>
                      rows.map((row, at) =>
                        at === index ? { ...row, name: event.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>
              <Field label={t('ledger:party.playerTag')}>
                <Input
                  value={player.tag}
                  placeholder={t('ledger:party.playerTagPlaceholder')}
                  onChange={event =>
                    setPlayers(rows =>
                      rows.map((row, at) =>
                        at === index ? { ...row, tag: event.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>
              <Field label={t('ledger:party.memberNumber')}>
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
            disabled={players.length >= MAX_SEAT_COLUMNS}
            onClick={() =>
              setPlayers(rows => [...rows, { name: '', tag: '', memberNumber: '' }])
            }
          >
            <Plus />
            {t('ledger:party.addPlayer')}
          </Button>
        </section>

        <div className="ledger-party-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t('ledger:party.cancel')}
          </Button>
          <Button type="button" variant="primary" onClick={save} disabled={saving}>
            {saving ? t('ledger:party.saving') : t('ledger:party.save')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

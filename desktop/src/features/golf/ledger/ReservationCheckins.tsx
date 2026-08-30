import { Button } from '@tachyon-sdk/native-ui'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Notice } from '../../../components/Page'
import { useTenantTimezone } from '../../../context/TenantTimezoneProvider'
import { showToast } from '../../../lib/toast'
import { visitTime } from '../customers/visits'
import {
  checkinsBySeat,
  listReservationCheckins,
  recordReservationCheckins,
  type VisitCheckin,
} from './checkins'
import type { PartyPlayer } from './models'

/**
 * The desk saying this group turned up.
 *
 * Without it a visit is only inferred: a tee time that has passed on a booking
 * nobody cancelled counts as a round played, which is wrong for a group that
 * never came and says nothing at all about the three people who played in
 * somebody else's booking. Those three are the reason this is per seat rather
 * than per booking — Field records one customer per reservation, and the rest
 * of the group only exists in the party detail beside this list.
 *
 * Reads the saved roster, not the draft above it. Seats are identified by their
 * place in that roster, so checking in against unsaved edits would file people
 * under seats that do not exist yet.
 */
export function ReservationCheckins({
  reservationId,
  players,
  dirty,
}: {
  reservationId: string
  /** The roster as saved. Blank rows are already gone by the time it is here. */
  players: readonly PartyPlayer[]
  /** Whether the form above has edits the roster below does not reflect yet. */
  dirty: boolean
}) {
  const { t } = useTranslation(['ledger', 'common'])
  const timezone = useTenantTimezone()
  const [existing, setExisting] = useState<VisitCheckin[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setExisting([])
    setSelected(new Set())
    // A failed read leaves the list empty rather than blocking the desk. The
    // worst case is a seat checked in twice, which upstream folds into one.
    void (async () => {
      try {
        const answer = await listReservationCheckins(reservationId)
        if (!cancelled) setExisting(answer?.items ?? [])
      } catch {
        // Left empty on purpose; the section still works.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reservationId])

  const done = checkinsBySeat(existing)
  const waiting = players
    .map((player, index) => ({ player, index }))
    .filter(({ index }) => !done.has(index))

  const toggle = (index: number) =>
    setSelected(current => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })

  const submit = async () => {
    setSaving(true)
    try {
      const answer = await recordReservationCheckins(
        reservationId,
        [...selected]
          .sort((a, b) => a - b)
          .map(index => ({
            playerIndex: index,
            customerId: players[index]?.customerId ?? null,
            playerName: players[index]?.name ?? '',
          })),
      )
      setExisting(answer.items)
      setSelected(new Set())
      showToast({ tone: 'success', message: t('ledger:checkin.saved') })
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('ledger:checkin.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="ledger-party-checkins" aria-label={t('ledger:checkin.title')}>
      <h3>{t('ledger:checkin.title')}</h3>

      {players.length === 0 ? (
        // Not an error: a booking taken over the phone has a booker and a
        // headcount, and the four names arrive when the group does.
        <p className="muted">{t('ledger:checkin.noNames')}</p>
      ) : (
        <>
          {/* Said before anything is pressed. Seats are numbered by the saved
              roster, so an unsaved rename would file somebody under a seat the
              server has never seen. */}
          {dirty ? <Notice tone="warning">{t('ledger:checkin.unsaved')}</Notice> : null}

          <ul className="ledger-checkin-list">
            {players.map((player, index) => {
              const recorded = done.get(index)
              return (
                <li key={index} className="ledger-checkin-row">
                  {recorded ? (
                    <span className="ledger-checkin-done">
                      {player.name}
                      <span className="muted">
                        {' '}
                        {t('ledger:checkin.at', {
                          time: visitTime(recorded.checkedInAt, timezone),
                        })}
                      </span>
                    </span>
                  ) : (
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.has(index)}
                        disabled={dirty || saving}
                        onChange={() => toggle(index)}
                      />
                      {player.name}
                      {/* Worth saying on the row: an unlinked seat still
                          records an arrival, but it reaches nobody's page. */}
                      {player.customerId ? null : (
                        <span className="muted"> {t('ledger:checkin.unlinked')}</span>
                      )}
                    </label>
                  )}
                </li>
              )
            })}
          </ul>

          {waiting.length === 0 ? (
            <p className="muted">{t('ledger:checkin.allDone')}</p>
          ) : (
            <Button
              type="button"
              variant="secondary"
              disabled={dirty || saving || selected.size === 0}
              onClick={() => void submit()}
            >
              {saving
                ? t('ledger:checkin.saving')
                : t('ledger:checkin.submit', { count: selected.size })}
            </Button>
          )}
        </>
      )}
    </section>
  )
}

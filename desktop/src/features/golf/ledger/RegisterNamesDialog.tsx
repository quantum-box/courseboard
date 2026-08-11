import { Button } from '@tachyon-sdk/native-ui'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import { Notice } from '../../../components/Page'
import { showToast } from '../../../lib/toast'
import { customersPath, type Customer } from '../customers/models'
import { rememberRegisteredCustomer } from '../customers/recentlyRegistered'
import type { DraftReservationPlayer } from './newReservationPlayers'
import type { UnregisteredName } from './unregisteredNames'

/**
 * Asked after the booking is already saved: should these names go in the
 * ledger?
 *
 * The booking never waits on this. Taking a booking is done under a phone call
 * and a queue, and making the desk search the ledger for four people before the
 * tee time can be held is how a ledger stops being filled in at all. So the
 * booking goes in as free text and the question comes afterwards, when the
 * pressure is off and the answer is cheap.
 *
 * Skipping is a first-class answer. The names stay on the booking either way;
 * only the ledger entry is lost, and the desk can add it later from the
 * customer ledger screen.
 */
export function RegisterNamesDialog({
  reservationId,
  names,
  players,
  onDone,
}: {
  reservationId: string
  names: readonly UnregisteredName[]
  /** The roster as saved, so a linked player can be written back in place. */
  players: readonly DraftReservationPlayer[]
  onDone: () => void
}) {
  const { t } = useTranslation(['ledger', 'common'])
  // Everything checked to start with: the desk asked for this booking to be in
  // the ledger by taking it, and unchecking is the rarer intent.
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(names.map(entry => entry.name)))
  const [saving, setSaving] = useState(false)

  const toggle = (name: string) => {
    setChosen(current => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const register = async () => {
    const picked = names.filter(entry => chosen.has(entry.name))
    if (picked.length === 0) {
      onDone()
      return
    }
    setSaving(true)
    try {
      const linkedPlayers = [...players]
      let registered = 0
      for (const entry of picked) {
        const created = await courseboardApiJson<Customer>(customersPath, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: entry.name }),
        })
        registered += 1
        // Listed on the customer ledger screen afterwards: this dialog gives
        // the desk no way back to the people it just wrote down.
        rememberRegisteredCustomer(created)
        if (entry.role === 'player' && typeof entry.playerIndex === 'number') {
          const row = linkedPlayers[entry.playerIndex]
          if (row) linkedPlayers[entry.playerIndex] = { ...row, customerId: created.id }
        }
      }

      // Players live in the booking's custom fields, so they can be linked
      // after the fact. The booker lives in `reservations.customer_id`, which
      // Field only accepts at creation — PLT-3379 is what makes that half
      // possible. Until then a booker registered here is in the ledger and
      // will be offered as a candidate next time, but this booking stays
      // unlinked to them.
      const hasLinkedPlayer = linkedPlayers.some((row, index) =>
        row.customerId !== players[index]?.customerId)
      if (hasLinkedPlayer) {
        await courseboardApiJson(
          `/v1/course/reservations/${encodeURIComponent(reservationId)}/party`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              players: linkedPlayers
                .filter(row => row.name.trim())
                .map(row => ({
                  name: row.name.trim(),
                  tag: row.tag.trim() || null,
                  memberNumber: row.memberNumber.trim() || null,
                  ...(row.customerId ? { customerId: row.customerId } : {}),
                })),
            }),
          },
        )
      }

      showToast({ tone: 'success', message: t('ledger:register.saved', { count: registered }) })
      onDone()
    } catch (error) {
      // The booking is already saved, so a failure here costs the ledger entry
      // and nothing else. Say so, rather than leaving the desk wondering
      // whether the tee time went in.
      showToast({
        tone: 'danger',
        title: t('ledger:register.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ledger-register-dialog" role="dialog" aria-modal="true">
      <div className="ledger-register-dialog__panel">
        <h2 className="ledger-register-dialog__title">{t('ledger:register.title')}</h2>
        <p className="ledger-register-dialog__lead">{t('ledger:register.lead')}</p>

        <ul className="ledger-register-dialog__names">
          {names.map(entry => (
            <li key={`${entry.role}:${entry.name}`}>
              <label>
                <input
                  type="checkbox"
                  checked={chosen.has(entry.name)}
                  onChange={() => toggle(entry.name)}
                />
                <span className="ledger-register-dialog__name">{entry.name}</span>
                <span className="ledger-register-dialog__role">
                  {entry.role === 'booker'
                    ? t('ledger:register.roleBooker')
                    : t('ledger:register.rolePlayer')}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <Notice tone="info">{t('ledger:register.note')}</Notice>

        <div className="ledger-register-dialog__actions">
          <Button type="button" variant="ghost" onClick={onDone} disabled={saving}>
            {t('ledger:register.skip')}
          </Button>
          <Button type="button" variant="primary" onClick={register} disabled={saving}>
            {saving ? t('common:action.saving') : t('ledger:register.confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}

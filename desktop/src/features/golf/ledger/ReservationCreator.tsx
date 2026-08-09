import { Button, Input } from '@tachyon-sdk/native-ui'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import { Field, Notice, resourceErrorText } from '../../../components/Page'
import { Sheet } from '../../../components/Sheet'
import { showToast } from '../../../lib/toast'
import type { GolfReservationProduct, PlayType } from '../models'
import { reservationProduct, type ReservationTarget } from './newReservation'

type DraftPlayer = { name: string; tag: string; memberNumber: string }

const EMPTY_PLAYER: DraftPlayer = { name: '', tag: '', memberNumber: '' }
const MAX_FORM_PLAYERS = 8

function trimmedPlayer(player: DraftPlayer) {
  return {
    name: player.name.trim(),
    ...(player.tag.trim() ? { tag: player.tag.trim() } : {}),
    ...(player.memberNumber.trim() ? { memberNumber: player.memberNumber.trim() } : {}),
  }
}

export function ReservationCreator({
  target,
  date,
  products,
  productsLoading,
  productsUnavailable,
  onClose,
  onCreated,
}: {
  target: ReservationTarget | null
  date: string
  products: GolfReservationProduct[]
  productsLoading: boolean
  productsUnavailable: boolean
  onClose: () => void
  onCreated: (reservationId: string) => void
}) {
  const { t } = useTranslation(['ledger'])
  const [playType, setPlayType] = useState<PlayType>('caddie')
  const [players, setPlayers] = useState<DraftPlayer[]>([{ ...EMPTY_PLAYER }])
  const [saving, setSaving] = useState(false)

  const targetKey = target
    ? `${target.column.golfCourseId}:${date}:${target.slot.teeTime}`
    : null
  const caddieProduct = target
    ? reservationProduct(products, target.column.golfCourseId, 'caddie')
    : null
  const selfProduct = target
    ? reservationProduct(products, target.column.golfCourseId, 'self')
    : null
  const selectedProduct = playType === 'caddie' ? caddieProduct : selfProduct
  const playerMaximum = Math.min(
    selectedProduct?.maxPlayersPerGroup ?? 4,
    MAX_FORM_PLAYERS,
  )

  useEffect(() => {
    if (!targetKey) return
    setPlayers([{ ...EMPTY_PLAYER }])
    setPlayType('caddie')
  }, [targetKey])

  useEffect(() => {
    if (playType === 'caddie' && !caddieProduct && selfProduct) setPlayType('self')
    if (playType === 'self' && !selfProduct && caddieProduct) setPlayType('caddie')
  }, [caddieProduct, playType, selfProduct])

  if (!target) return null

  const hasBlankName = players.some(player => player.name.trim().length === 0)
  const tooManyPlayers = players.length > playerMaximum
  const cannotSave = saving
    || productsLoading
    || productsUnavailable
    || !selectedProduct
    || hasBlankName
    || tooManyPlayers

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (cannotSave || !target.column.resourceId) return
    setSaving(true)
    try {
      const created = await courseboardApiJson<{ reservationId: string }>(
        '/v1/course/reservations',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            golfCourseId: target.column.golfCourseId,
            resourceId: target.column.resourceId,
            date,
            teeTime: target.slot.teeTime,
            playType,
            players: players.map(trimmedPlayer),
          }),
        },
      )
      showToast({ tone: 'success', message: t('ledger:reservation.saved') })
      onCreated(created.reservationId)
      onClose()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('ledger:reservation.failed'),
        message: resourceErrorText(error),
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
      title={t('ledger:reservation.title')}
      description={t('ledger:reservation.description')}
      className="ledger-reservation-sheet"
    >
      <form className="ledger-reservation-form" onSubmit={save}>
        <dl className="ledger-reservation-target">
          <div>
            <dt>{t('ledger:reservation.course')}</dt>
            <dd>{target.column.courseName}</dd>
          </div>
          <div>
            <dt>{t('ledger:reservation.dateTime')}</dt>
            <dd>{t('ledger:reservation.dateTimeValue', { date, time: target.slot.teeTime })}</dd>
          </div>
        </dl>

        {productsLoading ? (
          <Notice tone="info" title={t('ledger:reservation.productsLoadingTitle')}>
            {t('ledger:reservation.productsLoading')}
          </Notice>
        ) : null}

        {productsUnavailable ? (
          <Notice tone="danger" title={t('ledger:reservation.productsUnavailableTitle')}>
            {t('ledger:reservation.productsUnavailable')}
          </Notice>
        ) : null}

        <fieldset className="ledger-reservation-play-types">
          <legend>{t('ledger:reservation.playType')}</legend>
          <button
            type="button"
            aria-pressed={playType === 'caddie'}
            disabled={!caddieProduct || saving}
            onClick={() => setPlayType('caddie')}
          >
            {t('ledger:cell.playType.caddie')}
          </button>
          <button
            type="button"
            aria-pressed={playType === 'self'}
            disabled={!selfProduct || saving}
            onClick={() => setPlayType('self')}
          >
            {t('ledger:cell.playType.self')}
          </button>
        </fieldset>

        {!productsLoading && !productsUnavailable && !caddieProduct && !selfProduct ? (
          <Notice tone="danger" title={t('ledger:reservation.noProductTitle')}>
            {t('ledger:reservation.noProduct')}
          </Notice>
        ) : null}

        <section className="ledger-reservation-players" aria-label={t('ledger:reservation.players')}>
          <div className="ledger-reservation-section-head">
            <h3>{t('ledger:reservation.players')}</h3>
            <span>{t('ledger:reservation.playerCount', {
              count: players.length,
              maximum: String(playerMaximum),
            })}</span>
          </div>

          {tooManyPlayers ? (
            <Notice tone="warning" title={t('ledger:reservation.tooManyPlayersTitle')}>
              {t('ledger:reservation.tooManyPlayers', { maximum: String(playerMaximum) })}
            </Notice>
          ) : null}

          {players.map((player, index) => (
            <div className="ledger-reservation-player" key={index}>
              <div className="ledger-reservation-player-head">
                <strong>{t('ledger:reservation.playerNumber', { n: String(index + 1) })}</strong>
                {players.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ledger-reservation-remove"
                    aria-label={t('ledger:reservation.removePlayer', { n: String(index + 1) })}
                    disabled={saving}
                    onClick={() => setPlayers(current => current.filter((_, at) => at !== index))}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
              <Field label={t('ledger:reservation.playerName')} required>
                <Input
                  value={player.name}
                  autoComplete="name"
                  placeholder={t('ledger:reservation.playerNamePlaceholder')}
                  disabled={saving}
                  onChange={event => setPlayers(current => current.map((entry, at) => (
                    at === index ? { ...entry, name: event.target.value } : entry
                  )))}
                />
              </Field>
              <div className="ledger-reservation-player-extra">
                <Field label={t('ledger:reservation.playerTag')} requirement="none">
                  <Input
                    value={player.tag}
                    placeholder={t('ledger:reservation.playerTagPlaceholder')}
                    disabled={saving}
                    onChange={event => setPlayers(current => current.map((entry, at) => (
                      at === index ? { ...entry, tag: event.target.value } : entry
                    )))}
                  />
                </Field>
                <Field label={t('ledger:reservation.memberNumber')} requirement="none">
                  <Input
                    value={player.memberNumber}
                    disabled={saving}
                    onChange={event => setPlayers(current => current.map((entry, at) => (
                      at === index ? { ...entry, memberNumber: event.target.value } : entry
                    )))}
                  />
                </Field>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="ghost"
            className="ledger-reservation-add"
            disabled={saving || players.length >= playerMaximum || players.length >= MAX_FORM_PLAYERS}
            onClick={() => setPlayers(current => [...current, { ...EMPTY_PLAYER }])}
          >
            <Plus />
            {t('ledger:reservation.addPlayer')}
          </Button>
        </section>

        {hasBlankName ? (
          <p className="ledger-reservation-validation" role="status">
            {t('ledger:reservation.playerNameRequired')}
          </p>
        ) : null}

        <div className="ledger-reservation-actions">
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
            {t('ledger:reservation.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={cannotSave}>
            {saving ? t('ledger:reservation.saving') : t('ledger:reservation.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

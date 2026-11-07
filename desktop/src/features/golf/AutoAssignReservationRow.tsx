import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TeeSheetRow } from './UnassignedRounds'

export function AutoAssignReservationRow({ round, timeLabel, children }: {
  round?: TeeSheetRow
  timeLabel: string
  children: ReactNode
}) {
  const { t } = useTranslation('caddies')
  if (!round) return <div className="auto-assign-booking-fallback"><time>{timeLabel}</time>{children}</div>
  const title = round.party?.competitionName || round.partyName || round.reservationNumber
  return (
    <details className="auto-assign-booking">
      <summary aria-label={t('autoAssign.booking.open', { name: title, time: timeLabel })}>
        <time>{timeLabel}</time>
        <span className="auto-assign-booking-title">
          <strong>{title}{round.party?.groupNumber ? ` · ${t('autoAssign.booking.group', { n: String(round.party.groupNumber) })}` : ''}</strong>
          <small>{round.courseName} · {t('autoAssign.booking.playersCount', { n: String(round.partySize) })}</small>
        </span>
        {children}
        <ChevronDown className="auto-assign-booking-chevron" aria-hidden="true" />
      </summary>
      <div className="auto-assign-booking-detail">
        <dl>
          <div><dt>{t('autoAssign.booking.number')}</dt><dd>{round.reservationNumber}</dd></div>
          {round.displayName ? <div><dt>{t('autoAssign.booking.product')}</dt><dd>{round.displayName}</dd></div> : null}
          {round.party?.organizer ? <div><dt>{t('autoAssign.booking.organizer')}</dt><dd>{round.party.organizer}</dd></div> : null}
        </dl>
        <p className="font-medium">{t('autoAssign.booking.players')}</p>
        <ol>
          {Array.from({ length: Math.max(round.partySize, round.party?.players.length ?? 0) }, (_, index) => (
            <li key={index}>{round.party?.players[index]?.name || t('autoAssign.booking.unnamed')}</li>
          ))}
        </ol>
        {round.party?.remarks?.note ? <p>{round.party.remarks.note}</p> : null}
      </div>
    </details>
  )
}

import { Badge } from '@tachyon-sdk/native-ui'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import { Panel } from '../../../components/Page'
import { useResource } from '../../../hooks/useResource'
import { navigateFromClick } from '../../../lib/router'
import {
  cancellationsPath,
  type ReservationCancellationPage,
} from '../customers/cancellations'

/**
 * What came off today's board, and why.
 *
 * Cancelling a booking removes it from the tee sheet — that is what the desk
 * asked for — but it also removed every trace that anybody had ever held the
 * slot. The next shift saw an empty ten o'clock and had no way to tell a tee
 * time nobody booked from a foursome that rang off at eight.
 *
 * So the day's cancellations sit under the board rather than on it. Putting
 * them back in their slots would say the tee time is taken, which is the one
 * thing that is no longer true; keeping them beside it says what happened
 * without lying about what is free.
 *
 * Absent entirely on a day with none. This is the busiest screen in the club,
 * and an empty panel repeated every morning is a panel nobody reads.
 */
export function DayCancellations({ date }: { date: string }) {
  const { t } = useTranslation(['ledger', 'customers'])
  const query = `${cancellationsPath}?from=${encodeURIComponent(date)}&to=${encodeURIComponent(date)}`
  const resource = useResource(
    () => courseboardApiJson<ReservationCancellationPage>(query),
    [query],
    { cacheKey: `course:cancellations:day:${date}` },
  )

  const rows = resource.data?.items ?? []
  // A day with none, a day still loading, and a day whose read failed all show
  // nothing: none of them is worth a strip of the board, and the failure is not
  // one the desk can act on from here.
  if (rows.length === 0) return null

  return (
    <Panel
      className="ledger-panel"
      title={t('ledger:cancellations.title', { count: rows.length })}
      description={t('ledger:cancellations.description')}
    >
      <ul className="day-cancellation-list">
        {rows.map(row => (
          <li key={row.reservationId}>
            <Badge variant={row.feeExpected ? 'warning' : 'neutral'}>
              {t(`customers:cancellations.reason.${row.reason}`, {
                defaultValue: t('customers:cancellations.reason.other'),
              })}
            </Badge>
            <strong>
              {row.customerId
                ? (
                  <a
                    href={`#/golf/customers/${encodeURIComponent(row.customerId)}`}
                    onClick={event =>
                      navigateFromClick(event, `golf/customers/${row.customerId}`)}
                  >
                    {row.customerName ?? row.customerId}
                  </a>
                )
                : (row.customerName ?? t('customers:callList.unnamed'))}
            </strong>
            {row.teeTime ? <span>{row.teeTime.slice(11, 16)}</span> : null}
            {row.players ? (
              <span className="muted">
                {t('ledger:cancellations.players', { count: row.players })}
              </span>
            ) : null}
            {row.reasonNote ? <span className="muted">{row.reasonNote}</span> : null}
            {row.feeState === 'invoiced' ? (
              <Badge variant="success">
                {t('customers:cancellations.feeState.invoiced')}
              </Badge>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

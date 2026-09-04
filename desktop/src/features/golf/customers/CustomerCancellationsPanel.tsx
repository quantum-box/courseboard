import { Badge } from '@tachyon-sdk/native-ui'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson, yen } from '../../../api'
import { LoadingState, Panel } from '../../../components/Page'
import { useTenantTimezone } from '../../../context/TenantTimezoneProvider'
import { useResource } from '../../../hooks/useResource'
import { navigateFromClick } from '../../../lib/router'
import {
  cancellationsPath,
  type ReservationCancellationPage,
} from './cancellations'
import { visitDate } from './visits'

/**
 * What this person has given up, and what was done about it.
 *
 * The visits panel above already counts their cancellations, which is the
 * figure that puts somebody on a collection list. This is the other half of
 * that number: which bookings, for what reason, and whether the club billed
 * for them or let them go. Reading it is how the desk answers the question
 * that actually comes up on the phone — "you charged me last time and not the
 * time before" — and how they decide what to do this time.
 *
 * Absent on a person who has never cancelled. An empty panel on every other
 * customer page would be a permanent implication that they should have one.
 */
export function CustomerCancellationsPanel({ customerId }: { customerId: string }) {
  const { t } = useTranslation(['customers'])
  const timezone = useTenantTimezone()
  const query = `${cancellationsPath}?customerId=${encodeURIComponent(customerId)}`
  const resource = useResource(
    () => courseboardApiJson<ReservationCancellationPage>(query),
    [query],
    { cacheKey: `course:cancellations:customer:${customerId}` },
  )

  const rows = resource.data?.items ?? []
  if (resource.loading) return <LoadingState />
  // A read that failed says nothing rather than putting a red box on a page
  // that is otherwise fine: the cancellations are context, not the reason the
  // page was opened, and the desk cannot act on the failure from here.
  if (rows.length === 0) return null

  return (
    <Panel
      title={t('customers:cancellations.customer.title')}
      description={t('customers:cancellations.customer.description', {
        count: resource.data?.total ?? rows.length,
      })}
    >
      <ul className="day-cancellation-list">
        {rows.map(row => (
          <li key={row.reservationId}>
            <span>{row.playedOn ? visitDate(row.playedOn, timezone) : ''}</span>
            <Badge variant={row.feeExpected ? 'warning' : 'neutral'}>
              {t(`customers:cancellations.reason.${row.reason}`, {
                defaultValue: t('customers:cancellations.reason.other'),
              })}
            </Badge>
            {row.reasonNote ? <span className="muted">{row.reasonNote}</span> : null}
            {/* The fee is the part the desk is looking for. An invoiced row
                links straight to the invoice, because the next question is
                always whether it was paid — and that answer is Field's. */}
            {row.feeState === 'invoiced' && row.feeInvoiceId ? (
              <a
                href={`#/cancellation-fees/${encodeURIComponent(row.feeInvoiceId)}`}
                onClick={event =>
                  navigateFromClick(event, `cancellation-fees/${row.feeInvoiceId}`)}
              >
                {t('customers:cancellations.feeState.invoiced')}
                {row.feeAmount ? ` ${yen(row.feeAmount)}` : ''}
              </a>
            ) : (
              <span className="muted">
                {t(`customers:cancellations.feeState.${row.feeState}`, {
                  defaultValue: String(row.feeState),
                })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

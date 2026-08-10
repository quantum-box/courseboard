import { Button } from '@tachyon-sdk/native-ui'
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import { LoadingState, Notice, Panel, ResourceError } from '../../../components/Page'
import { useResource } from '../../../hooks/useResource'
import { navigateFromClick } from '../../../lib/router'
import { MembershipBadge } from './MembershipBadge'
import { customerPath, type Customer } from './models'

/**
 * One person's page in the ledger.
 *
 * Its own route rather than a panel under the search results, so a customer can
 * be linked to, opened in a second tab, and come back to on reload — the desk
 * refers to a regular's page across a shift, not only in the seconds after
 * searching for them.
 */
export function CustomerDetailPage({ customerId }: { customerId: string }) {
  const { t } = useTranslation(['customers', 'common'])
  // Read by id rather than re-running the search that led here: the page has
  // to survive a reload and a pasted link, where no search has been typed.
  const resource = useResource(
    () => courseboardApiJson<Customer>(customerPath(customerId)),
    [customerId],
    { cacheKey: `customer:${customerId}` },
  )

  const customer = resource.data ?? null

  return (
    <div className="page-stack">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={event => navigateFromClick(event, 'golf/customers')}
      >
        <ChevronLeft />
        {t('customers:detail.back')}
      </Button>

      {resource.loading ? <LoadingState /> : null}
      {resource.error ? (
        <ResourceError error={resource.error} onRetry={() => void resource.refresh()} />
      ) : null}

      {!resource.loading && !resource.error && !customer ? (
        <Notice tone="warning">{t('customers:detail.missing')}</Notice>
      ) : null}

      {customer ? (
        <>
          <Panel title={customer.name} description={t('customers:detail.description')}>
            <dl className="customer-ledger-detail">
              <dt>{t('customers:field.nameKana')}</dt>
              <dd>{customer.nameKana || t('common:state.unset')}</dd>
              <dt>{t('customers:field.phone')}</dt>
              <dd>{customer.phone || t('common:state.unset')}</dd>
              <dt>{t('customers:field.email')}</dt>
              <dd>{customer.email || t('common:state.unset')}</dd>
            </dl>
          </Panel>

          <Panel
            title={t('customers:detail.membershipTitle')}
            description={t('customers:detail.membershipDescription')}
          >
            {/* The one place a membership is granted or changed: this page is
                about who somebody is, not about a booking they are making. */}
            <MembershipBadge customerId={customer.id} editable />
          </Panel>

          {/* Visits belong here — this is the page the desk opens to ask how
              often somebody comes. Reading them needs a CourseBoard endpoint
              over Field's `ReservationFilter.customer_id`, which is not built
              yet, so the promise is not made in the UI until it can be kept. */}
        </>
      ) : null}
    </div>
  )
}

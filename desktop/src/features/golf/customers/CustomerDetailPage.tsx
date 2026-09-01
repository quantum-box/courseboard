import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@tachyon-sdk/native-ui'
import { ChevronLeft, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import { LoadingState, Notice, Panel, ResourceError } from '../../../components/Page'
import { clearResourceCache, useResource } from '../../../hooks/useResource'
import { navigate, navigateFromClick } from '../../../lib/router'
import { showToast } from '../../../lib/toast'
import { CustomerRegistrationNote } from './CustomerRegistrationNote'
import { CustomerVisitsPanel } from './CustomerVisitsPanel'
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
  const [confirmingDelete, setConfirmingDelete] = useState(false)
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
          <Panel
            title={customer.name}
            description={t('customers:detail.description')}
            actions={(
              <Button
                type="button"
                variant="destructive"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 />
                {t('customers:delete.open')}
              </Button>
            )}
          >
            <dl className="customer-ledger-detail">
              <dt>{t('customers:field.nameKana')}</dt>
              <dd>{customer.nameKana || t('common:state.unset')}</dd>
              <dt>{t('customers:field.phone')}</dt>
              <dd>{customer.phone || t('common:state.unset')}</dd>
              <dt>{t('customers:field.email')}</dt>
              <dd>{customer.email || t('common:state.unset')}</dd>
            </dl>
            {/* Under the details rather than beside them: how the entry was
                created is what the desk reaches for when two of these pages
                look like the same person. */}
            <CustomerRegistrationNote customerId={customer.id} />
          </Panel>

          <Panel
            title={t('customers:detail.membershipTitle')}
            description={t('customers:detail.membershipDescription')}
          >
            {/* The one place a membership is granted or changed: this page is
                about who somebody is, not about a booking they are making. */}
            <MembershipBadge customerId={customer.id} editable />
          </Panel>

          {/* Below the membership, because how often somebody comes is read
              after who they are — and it is the reason the page gets opened. */}
          <CustomerVisitsPanel customerId={customer.id} />

          {confirmingDelete ? (
            <DeleteCustomerDialog
              customer={customer}
              onOpenChange={setConfirmingDelete}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function DeleteCustomerDialog({
  customer,
  onOpenChange,
}: {
  customer: Customer
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation(['customers', 'common'])
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setDeleting(true)
    setError(null)
    try {
      await courseboardApiJson<void>(customerPath(customer.id), { method: 'DELETE' })
      clearResourceCache(`customer:${customer.id}`)
      showToast({ tone: 'success', message: t('customers:delete.saved') })
      navigate('golf/customers')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('customers:delete.failed'))
      setDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('customers:delete.title', { name: customer.name })}</DialogTitle>
          <DialogDescription>{t('customers:delete.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Notice tone="warning">{t('customers:delete.warning')}</Notice>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={deleting}
            >
              {t('customers:delete.keep')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void remove()}
              disabled={deleting}
            >
              <Trash2 />
              {deleting ? t('customers:delete.submitting') : t('customers:delete.submit')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import {
  ArrowLeft,
  ClipboardCopy,
  Download,
  ExternalLink,
  Mail,
  MessageSquareText,
  Plus,
  Save,
  Send,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { downloadBlob, fieldApiJson, yen } from '../../api'
import { useTenantTimezone } from '../../context/TenantTimezoneProvider'
import { i18next } from '../../i18n'
import {
  DataTable,
  EmptyState,
  Field,
  FormGrid,
  LoadingState,
  Metric,
  MetricGrid,
  NativeSelect,
  NativeTextarea,
  Notice,
  PageHeader,
  Panel,
  ResourceError,
} from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { useRegisterPageReload } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'
import { openExternal } from '../../lib/platform'
import { currentRouteSearchParams, navigate } from '../../lib/router'
import { CustomerPicker } from '../golf/customers/CustomerPicker'
import type { Customer } from '../golf/customers/models'
import { DEFAULT_TIME_ZONE, normalizeIsoDate, today } from '../../lib/clock'
import { Sheet } from '../../components/Sheet'
import {
  cancellationFeeIdempotencyKey,
  cancellationFeeInvoiceRequestBody,
  customerRegistrationRequestBody,
  invoiceBillTo,
  normalizePhone,
  CANCELLATION_FEE_MARKER,
  isCancellationFeeInvoice,
  type BillToKind,
  type InvoiceBillTo,
  type InvoiceSource,
} from './models'
import { renderSmsPreview, smsCharacterCount, smsPartCount } from './smsMessage'

// Re-exported so the existing tests and any importer of this screen keep
// reaching them at the name they already use.
export {
  cancellationFeeInvoiceRequestBody,
  customerRegistrationRequestBody,
  invoiceBillTo,
  normalizePhone,
  type InvoiceBillTo,
}

type InvoiceStatus = 'Draft' | 'Sent' | 'SendFailed' | 'Paid' | 'Overdue'

type InvoiceLineItem = {
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

type InvoiceData = {
  id: string
  tenantId?: string
  invoiceNumber: string
  clientId: string
  clientName?: string | null
  clientEmail?: string | null
  clientPhone?: string | null
  /**
   * The recipient as the invoice records them.
   *
   * For somebody who is not in the ledger this is the only place their name
   * and number live: Field fills `clientPhone` from it when an SMS is asked
   * for and leaves it empty otherwise, so a fee raised by email — or by no
   * notice at all — would show no way to reach the guest.
   */
  billTo?: {
    kind: string
    snapshot?: { name?: string | null; phone?: string | null; email?: string | null } | null
  } | null
  lineItems: InvoiceLineItem[]
  dueDate: string
  status: InvoiceStatus
  currency: string
  subtotalAmount: number
  taxAmount: number
  totalAmount: number
  paymentLinkUrl?: string | null
  squarePaymentLinkId?: string | null
  paymentLinkStatus?: 'Pending' | 'Ready' | 'Failed' | null
  emailDeliveryStatus?: 'Pending' | 'Sent' | 'Failed' | null
  smsDeliveryStatus?: 'Pending' | 'Sent' | 'Failed' | null
  /**
   * Why the send failed, per channel (PLT-3707). Field records the status but
   * used to drop the reason, so an operator saw `Failed` and nothing else —
   * and the three causes need three different fixes (an admin grants the send
   * permission, the tenant tops up SMS credit, or the destination is wrong).
   * Absent while Field has not shipped the field yet; the copy falls back to
   * naming all three.
   */
  emailDeliveryFailureCode?: string | null
  smsDeliveryFailureCode?: string | null
  notes?: string | null
  /** What this invoice was raised from (PLT-4158). Empty on older invoices. */
  sources?: InvoiceSource[] | null
  sentAt?: string | null
  paidAt?: string | null
  createdAt: string
  updatedAt?: string
}

type OrderData = {
  id: string
  orderNumber: string
  clientId: string
  clientName?: string | null
  clientEmail?: string | null
  totalAmount: number
  currency: string
  status: string
}

const INVOICE_STATUSES: InvoiceStatus[] = ['Draft', 'Sent', 'SendFailed', 'Paid', 'Overdue']

/**
 * Paid is an accounting fact, not an ordinary operator-editable invoice
 * state. It may be displayed and filtered, but it must come from the Field
 * payment flow (or a future audited manual-payment contract).
 */
export const EDITABLE_INVOICE_STATUSES: InvoiceStatus[] = [
  'Draft',
  'Sent',
  'SendFailed',
  'Overdue',
]

export function invoiceDisplayStatus(
  invoice: Pick<InvoiceData, 'status' | 'dueDate'>,
  timezone: string,
  businessDate = today(timezone),
): InvoiceStatus {
  // A paid invoice remains paid even when its due date is in the past. The
  // stored Overdue state is also preserved so this function is idempotent
  // when it is called for rows that Field has already marked overdue.
  if (invoice.status === 'Paid' || invoice.status === 'Overdue') return invoice.status

  // dueDate is a date-only contract. Validate it before comparing strings so
  // malformed upstream data does not turn into a false overdue badge.
  const dueDate = normalizeIsoDate(invoice.dueDate)
  return dueDate !== null && dueDate < businessDate ? 'Overdue' : invoice.status
}

function withDisplayStatus(invoice: InvoiceData, timezone: string, businessDate: string) {
  return {
    ...invoice,
    status: invoiceDisplayStatus(invoice, timezone, businessDate),
  }
}

export function filterDisplayedInvoices<T extends Pick<InvoiceData, 'status'>>(
  invoices: T[],
  status: 'all' | InvoiceStatus,
) {
  return status === 'all' ? invoices : invoices.filter(invoice => invoice.status === status)
}

export function isInvoiceUpdateAllowed(invoice: Pick<InvoiceData, 'status'>) {
  return invoice.status !== 'Paid'
}

function statusLabel(status: InvoiceStatus) {
  return i18next.t(`cancellationFees:status.${status}` as 'cancellationFees:status.Draft')
}

/**
 * The ERP order status is a pass-through string rather than a closed enum, so
 * anything outside this set falls back to a label that still shows the raw
 * value instead of leaking bare English into the UI.
 */
const ORDER_STATUS_KEYS = new Set([
  'draft',
  'pending',
  'confirmed',
  'processing',
  'completed',
  'fulfilled',
  'paid',
  'unpaid',
  'canceled',
  'cancelled',
  'refunded',
  'failed',
])

function orderStatusLabel(status: string) {
  const key = status.trim().toLowerCase()
  if (ORDER_STATUS_KEYS.has(key)) {
    return i18next.t(`cancellationFees:orderStatus.${key}` as 'cancellationFees:orderStatus.draft')
  }
  return i18next.t('cancellationFees:orderStatus.unknown', { value: status.trim() || '—' })
}

const statusVariants: Record<InvoiceStatus, 'neutral' | 'accent' | 'warning' | 'success' | 'destructive'> = {
  Draft: 'neutral',
  Sent: 'accent',
  SendFailed: 'destructive',
  Paid: 'success',
  Overdue: 'warning',
}

/**
 * Since PLT-4158 an invoice declares what it was raised from, so the honest
 * reading is its `sources`. The two older readings stay because every invoice
 * raised before then has one of them and nothing else: dropping either would
 * empty this list of its own history. See `isCancellationFeeInvoice`.
 */

export function CancellationFeesPage() {
  const { t } = useTranslation(['cancellationFees', 'common'])
  const timezone = useTenantTimezone()
  const businessDate = today(timezone)
  const [status, setStatus] = useState<'all' | InvoiceStatus>('all')
  const loader = useCallback(async () => {
    // Do not pass the saved status filter to Field. A Sent invoice can be
    // overdue according to the tenant's business date even while Field still
    // stores it as Sent, so filtering happens after deriving the display state.
    const response = await fieldApiJson<{ items: InvoiceData[] }>('/v1/invoices')
    return response.items.filter(isCancellationFeeInvoice)
  }, [])
  const resource = useResource(loader, [])
  const displayedInvoices = useMemo(
    () => (resource.data ?? []).map(invoice => withDisplayStatus(invoice, timezone, businessDate)),
    [businessDate, resource.data, timezone],
  )
  const visibleInvoices = useMemo(
    () => filterDisplayedInvoices(displayedInvoices, status),
    [displayedInvoices, status],
  )
  const summary = useMemo(
    () => summarize(visibleInvoices, timezone, businessDate),
    [businessDate, timezone, visibleInvoices],
  )
  useRegisterPageReload(resource.refresh)

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <Button type="button" variant="primary" onClick={() => navigate('cancellation-fees/new')}>
          <Plus /> {t('cancellationFees:create')}
        </Button>
      </div>

      <MetricGrid>
        <Metric
          label={t('cancellationFees:metrics.shown')}
          value={t('cancellationFees:metrics.shownValue', { n: String(summary.count) })}
        />
        <Metric
          label={t('cancellationFees:metrics.unpaid')}
          value={yen(summary.unpaid)}
          tone={summary.unpaid > 0 ? 'warning' : 'neutral'}
        />
        <Metric
          label={t('cancellationFees:metrics.overdue')}
          value={t('cancellationFees:metrics.overdueValue', { n: String(summary.overdue) })}
          tone={summary.overdue > 0 ? 'danger' : 'neutral'}
        />
        <Metric
          label={t('cancellationFees:metrics.paid')}
          value={yen(summary.paid)}
          tone="success"
        />
      </MetricGrid>

      <Panel
        title={t('cancellationFees:list.title')}
        description={t('cancellationFees:list.description')}
        actions={(
          <div className="toolbar-row">
            <NativeSelect
              aria-label={t('cancellationFees:status.label')}
              value={status}
              onChange={event => setStatus(event.target.value as typeof status)}
            >
              <option value="all">{t('cancellationFees:status.all')}</option>
              {INVOICE_STATUSES.map(value => (
                <option key={value} value={value}>{statusLabel(value)}</option>
              ))}
            </NativeSelect>
          </div>
        )}
      >
        {resource.loading ? <LoadingState label={t('cancellationFees:list.loading')} /> : null}
        {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
        {resource.data ? (
          <DataTable
            rows={visibleInvoices}
            rowKey={invoice => invoice.id}
            onRowClick={invoice => navigate(`cancellation-fees/${invoice.id}`)}
            empty={(
              <EmptyState
                title={t('cancellationFees:list.empty.title')}
                description={t('cancellationFees:list.empty.description')}
              />
            )}
            columns={[
              {
                key: 'number',
                header: t('cancellationFees:list.table.number'),
                cell: invoice => <div className="primary-cell"><strong>{invoice.invoiceNumber}</strong></div>,
              },
              {
                key: 'client',
                header: t('cancellationFees:list.table.client'),
                cell: invoice => invoice.clientName ?? invoice.clientId,
              },
              {
                key: 'status',
                header: t('cancellationFees:list.table.status'),
                cell: invoice => (
                  <Badge variant={statusVariants[invoice.status]}>{statusLabel(invoice.status)}</Badge>
                ),
              },
              {
                key: 'due',
                header: t('cancellationFees:list.table.due'),
                cell: invoice => invoice.dueDate.slice(0, 10),
              },
              {
                key: 'amount',
                header: t('cancellationFees:list.table.amount'),
                align: 'right',
                cell: invoice => yen(invoice.totalAmount, invoice.currency),
              },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  )
}

/**
 * Who the desk says it is billing, which is all it is asked to decide.
 *
 * A person is one answer, not two: whether the name typed into the box turns
 * out to be in the customer ledger is what the picker answers, not a choice
 * made before anything has been typed. A company is genuinely different — it
 * is billed against an account Field holds, and the order it came from names
 * that account.
 */
type RecipientKind = 'person' | 'client'

/**
 * What the confirmation step is holding: everything the send will use, read
 * off the form once so the operator confirms the same values that go upstream.
 */
type PendingSubmission = {
  billTo: InvoiceBillTo
  /** Whether the recipient still has to be put in the ledger before invoicing. */
  registerCustomer: boolean
  recipientName: string
  clientEmail?: string
  clientPhone?: string
  dueDate: string
  taxAmount: number
  notes: string
  description: string
  amount: number
  sendEmail: boolean
  sendSms: boolean
  smsMessage?: string
}

export function NewCancellationFeePage() {
  const { t } = useTranslation(['cancellationFees', 'common'])
  const timezone = useTenantTimezone()
  /**
   * One key per visit to this screen, not per attempt. A retry after a timeout
   * has to carry the key of the attempt that may already have landed, or the
   * recipient gets a second ledger entry and a second invoice.
   *
   * Kept short because Field spells it into the invoice number (`INV-{key}`),
   * and that number is what the desk reads out over the phone. Half a UUID is
   * 64 bits, which is far more than one club's cancellation fees can collide
   * across.
   */
  const requestKey = useRef(cancellationFeeIdempotencyKey([crypto.randomUUID()]))
  /** Set once the recipient is in the ledger, so a retry skips that call. */
  const registeredCustomerId = useRef<string | null>(null)
  const orderId = currentRouteSearchParams().get('orderId')?.trim() ?? ''
  const orderLoader = useCallback(async () => {
    if (!orderId) return null
    return fieldApiJson<OrderData>(`/v1/erp/orders/${encodeURIComponent(orderId)}`)
  }, [orderId])
  const orderResource = useResource(orderLoader, [orderId])
  const order = orderResource.data
  const [year, month, day] = today(timezone).split('-').map(Number)
  const due = new Date(Date.UTC(year!, month! - 1, day! + 7)).toISOString().slice(0, 10)
  const [sendEmail, setSendEmail] = useState(true)
  const [sendSms, setSendSms] = useState(false)
  // An order names a company, so it arrives with an identifier. Everything else
  // is a person, and which kind of person is not something the desk can answer
  // before it has typed the name.
  const [recipientKind, setRecipientKind] = useState<RecipientKind>(orderId ? 'client' : 'person')
  // The person being billed, chosen from the ledger rather than typed as an
  // id. A cancellation fee is always somebody the club already has a booking
  // for, and asking the desk to copy `cus_01j…` off another screen is how the
  // wrong person gets invoiced.
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [customerName, setCustomerName] = useState(order?.clientName ?? '')
  const [registerCustomer, setRegisterCustomer] = useState(false)
  const [amount, setAmount] = useState(5000)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingSubmission | null>(null)
  const [created, setCreated] = useState<InvoiceData | null>(null)
  const [sent, setSent] = useState<PendingSubmission | null>(null)
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  const [resending, setResending] = useState(false)

  /**
   * Which of Field's three recipients this invoice is actually addressed to.
   *
   * Derived, never chosen: a person the desk recognised in the ledger is billed
   * as that customer, and the same person typed in and left unrecognised is
   * billed by name. Both are ordinary — a caller who has never paid the club
   * anything has no ledger entry to pick, and being asked for one is what used
   * to stop the desk mid-call.
   */
  const billToKind: BillToKind = recipientKind === 'client'
    ? 'client'
    : customer ? 'customer' : 'unregistered'

  function changeRecipientKind(kind: RecipientKind) {
    setRecipientKind(kind)
    // The picked entry answered "who is this person in the ledger"; it means
    // nothing once the form is addressing a company account.
    if (kind === 'client') setCustomer(null)
  }

  /**
   * Read the form, check it, and hand it to the confirmation step.
   *
   * Nothing is sent here. The desk gets one look at the recipient, the amount,
   * the due date and whether this also creates a ledger entry, because all four
   * are hard to walk back once the payment link is out.
   */
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError(null)
    setDeliveryError(null)
    if (!sendEmail && !sendSms) {
      setError(t('cancellationFees:new.validation.channel'))
      return
    }
    if (sendSms && form.get('smsConsent') !== 'on') {
      setError(t('cancellationFees:new.validation.consent'))
      return
    }
    const reference = String(form.get('reference') ?? '').trim()
    const clientName = (billToKind === 'client'
      ? String(form.get('clientName') ?? '')
      : (customer?.name ?? customerName)).trim()
    const clientEmail = String(form.get('clientEmail') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()
    const notes = String(form.get('notes') ?? '').trim()
    const typedPhone = String(form.get('clientPhone') ?? '').trim()
    const customerPhone = normalizePhone(typedPhone)
    // The number is part of the recipient itself for somebody who is not in the
    // ledger, so an unreadable one is refused here rather than upstream: Field
    // rejects the whole invoice for it, and the desk would see that as a
    // failure with no field to fix.
    const phoneIsSent = sendSms || billToKind === 'unregistered'
    const billTo = invoiceBillTo({
      kind: billToKind,
      customerId: customer?.id ?? '',
      clientId: String(form.get('clientId') ?? ''),
      affiliationId: String(form.get('affiliationId') ?? ''),
      name: clientName,
      phone: customerPhone,
      email: clientEmail,
    })
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('cancellationFees:new.validation.amount'))
      return
    }
    if (phoneIsSent && typedPhone && !customerPhone) {
      setError(t('cancellationFees:new.validation.phone'))
      return
    }
    if (sendSms && !customerPhone) {
      setError(t('cancellationFees:new.validation.phone'))
      return
    }
    if (!billTo) {
      setError(t('cancellationFees:new.validation.billTo'))
      return
    }

    setPending({
      billTo,
      registerCustomer: billTo.kind === 'unregistered' && registerCustomer,
      recipientName: clientName,
      clientEmail: sendEmail ? clientEmail : undefined,
      clientPhone: sendSms ? customerPhone : undefined,
      dueDate: String(form.get('dueDate') ?? ''),
      taxAmount: Number(form.get('taxAmount') ?? 0),
      notes: [
        CANCELLATION_FEE_MARKER,
        t('cancellationFees:new.message.intro'),
        reference ? t('cancellationFees:new.message.reference', { reference }) : null,
        reason ? t('cancellationFees:new.message.reason', { reason }) : null,
        notes || null,
      ].filter(Boolean).join('\n'),
      description: reference
        ? t('cancellationFees:new.message.lineItem', { reference })
        : t('cancellationFees:lineItemLabel'),
      amount,
      sendEmail,
      sendSms,
      smsMessage: sendSms ? String(form.get('smsMessage') ?? '') : undefined,
    })
  }

  async function send(submission: PendingSubmission) {
    setSubmitting(true)
    setError(null)
    setDeliveryError(null)
    let billTo = submission.billTo
    if (submission.registerCustomer && submission.billTo.kind === 'unregistered') {
      try {
        const customerId = registeredCustomerId.current ?? (await fieldApiJson<{ id: string }>(
          '/v1/erp/customers',
          {
            method: 'POST',
            body: JSON.stringify(customerRegistrationRequestBody({
              name: submission.billTo.name,
              phone: submission.billTo.phone,
              email: submission.billTo.email,
              // A different namespace from the invoice: Field derives the
              // customer id from this key, and reusing one string for both
              // would tie two unrelated records to the same value.
              idempotencyKey: `customer-${requestKey.current}`,
            })),
          },
        )).id
        registeredCustomerId.current = customerId
        billTo = { kind: 'customer', customerId }
      } catch (reason) {
        // Stop rather than quietly invoicing an unregistered recipient: the
        // operator asked for a ledger entry, and the usual cause is a missing
        // permission that an administrator has to grant.
        setPending(null)
        setError(reason instanceof Error
          ? reason.message
          : t('cancellationFees:new.error.registerCustomer'))
        setSubmitting(false)
        return
      }
    }
    try {
      const invoice = await fieldApiJson<InvoiceData>('/v1/invoices', {
        method: 'POST',
        body: JSON.stringify(cancellationFeeInvoiceRequestBody({
          billTo,
          clientName: submission.recipientName,
          clientEmail: submission.clientEmail,
          clientPhone: submission.clientPhone,
          dueDate: submission.dueDate,
          taxAmount: submission.taxAmount,
          notes: submission.notes,
          description: submission.description,
          amount: submission.amount,
          sendEmail: submission.sendEmail,
          sendSms: submission.sendSms,
          smsMessage: submission.smsMessage,
          idempotencyKey: requestKey.current,
        })),
      })
      setPending(null)
      setCreated(invoice)
      setSent(submission)
      try {
        const fulfilled = await fieldApiJson<InvoiceData>(`/v1/invoices/${encodeURIComponent(invoice.id)}/fulfill`, {
          method: 'POST',
          body: JSON.stringify({}),
        })
        setCreated(fulfilled)
        const incomplete = fulfillmentIssue(fulfilled, {
          sendEmail: submission.sendEmail,
          sendSms: submission.sendSms,
        })
        if (incomplete) {
          setDeliveryError(incomplete)
        } else {
          navigate(`cancellation-fees/${fulfilled.id}`)
        }
      } catch (reason) {
        setDeliveryError(reason instanceof Error
          ? reason.message
          : t('cancellationFees:new.error.delivery'))
      }
    } catch (reason) {
      setPending(null)
      setError(reason instanceof Error ? reason.message : t('cancellationFees:new.error.create'))
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Send the notification again for an invoice that already exists.
   *
   * The invoice, the payment link and the ledger entry all survived; only the
   * delivery failed. Creating the invoice a second time would leave the club
   * chasing two payments for one cancellation.
   */
  async function resendDelivery() {
    if (!created || !sent) return
    setResending(true)
    try {
      const fulfilled = await fieldApiJson<InvoiceData>(
        `/v1/invoices/${encodeURIComponent(created.id)}/payment-link/resend`,
        {
          method: 'POST',
          body: JSON.stringify({
            sendEmail: sent.sendEmail,
            sendSms: sent.sendSms,
            clientPhone: sent.clientPhone,
            smsMessage: sent.smsMessage,
          }),
        },
      )
      setCreated(fulfilled)
      const incomplete = fulfillmentIssue(fulfilled, {
        sendEmail: sent.sendEmail,
        sendSms: sent.sendSms,
      })
      setDeliveryError(incomplete ?? null)
      if (!incomplete) navigate(`cancellation-fees/${fulfilled.id}`)
    } catch (reason) {
      setDeliveryError(reason instanceof Error
        ? reason.message
        : t('cancellationFees:new.error.delivery'))
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="page-stack page-narrow">
      <PageHeader
        title={t('cancellationFees:new.title')}
        description={t('cancellationFees:new.description')}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => navigate('cancellation-fees')}>
              <ArrowLeft /> {t('cancellationFees:new.backToList')}
            </Button>
          </div>
        )}
      />

      {error ? (
        <Notice tone="danger" title={t('cancellationFees:new.createFailed')}>{error}</Notice>
      ) : null}
      {created && deliveryError ? (
        <Notice tone="warning" title={t('cancellationFees:new.partial.title')}>
          {t('cancellationFees:new.partial.description', { message: deliveryError })}
          <div className="notice-inline-action">
            <Button type="button" size="sm" disabled={resending} onClick={() => void resendDelivery()}>
              {resending
                ? t('cancellationFees:new.partial.resending')
                : t('cancellationFees:new.partial.resend')}
            </Button>
            <Button type="button" size="sm" onClick={() => navigate(`cancellation-fees/${created.id}`)}>
              {t('cancellationFees:new.partial.openDetail')}
            </Button>
          </div>
        </Notice>
      ) : null}

      {orderId && orderResource.loading ? (
        <LoadingState label={t('cancellationFees:new.orderLoading')} />
      ) : null}
      {orderId && orderResource.error ? (
        <Notice tone="warning" title={t('cancellationFees:new.orderFailed.title')}>
          {t('cancellationFees:new.orderFailed.description')}
        </Notice>
      ) : null}

      {order ? (
        <Panel
          title={t('cancellationFees:new.order.title')}
          description={t('cancellationFees:new.order.description')}
        >
          <dl className="detail-list">
            <div><dt>{t('cancellationFees:new.order.number')}</dt><dd>{order.orderNumber}</dd></div>
            <div>
              <dt>{t('cancellationFees:new.order.amount')}</dt>
              <dd>{yen(order.totalAmount, order.currency)}</dd>
            </div>
            <div>
              <dt>{t('cancellationFees:new.order.status')}</dt>
              <dd>{orderStatusLabel(order.status)}</dd>
            </div>
          </dl>
        </Panel>
      ) : null}

      {orderId && orderResource.loading ? null : <form className="collection-editor" onSubmit={review}>
        <Panel
          title={t('cancellationFees:new.detail.title')}
          description={t('cancellationFees:new.detail.description')}
        >
          <FormGrid>
            <Field label={t('cancellationFees:new.detail.reference')}>
              <Input
                name="reference"
                placeholder="RSV-1001 / ORD-1001"
                defaultValue={order ? order.orderNumber : ''}
              />
            </Field>
            <Field label={t('cancellationFees:new.detail.amount')} required>
              <Input name="amount" type="number" min={1} required value={amount} onChange={event => setAmount(Number(event.target.value))} />
            </Field>
            <Field label={t('cancellationFees:new.detail.tax')}>
              <Input name="taxAmount" type="number" min={0} defaultValue={0} />
            </Field>
            <Field label={t('cancellationFees:new.detail.reason')}>
              <Input name="reason" placeholder={t('cancellationFees:new.detail.reasonPlaceholder')} />
            </Field>
          </FormGrid>
          <Field label={t('cancellationFees:new.detail.notes')}>
            <NativeTextarea
              name="notes"
              rows={4}
              placeholder={t('cancellationFees:new.detail.notesPlaceholder')}
            />
          </Field>
        </Panel>

        <Panel
          title={t('cancellationFees:new.client.title')}
          description={t('cancellationFees:new.client.description')}
        >
          <FormGrid>
            <Field label={t('cancellationFees:new.client.kind')} required>
              <NativeSelect
                name="recipientKind"
                value={recipientKind}
                onChange={event => changeRecipientKind(event.target.value as RecipientKind)}
              >
                <option value="person">{t('cancellationFees:new.client.person')}</option>
                <option value="client">{t('cancellationFees:new.client.company')}</option>
              </NativeSelect>
            </Field>
            {recipientKind === 'person' ? (
              // One box for the whole question. The desk types the name it was
              // given, the ledger offers whoever answers to it, and picking is
              // optional — an identifier the caller would have to be looked up
              // by is not something anybody has on the phone.
              <Field
                label={t('cancellationFees:new.client.name')}
                hint={t('cancellationFees:new.client.nameHint')}
                required
              >
                <CustomerPicker
                  name={customerName}
                  customerId={customer?.id ?? null}
                  required
                  // The ledger entry is written by the checkbox below, when the
                  // invoice goes out, so the picker does not offer to write one
                  // of its own here.
                  allowRegister={false}
                  onNameChange={value => {
                    setCustomerName(value)
                    // Editing the name after a pick means the desk is looking
                    // for somebody else; keeping the old link would invoice
                    // the person whose name is no longer on screen.
                    if (customer && value !== customer.name) setCustomer(null)
                  }}
                  onSelect={picked => {
                    setCustomer(picked)
                    if (picked) setCustomerName(picked.name)
                  }}
                />
              </Field>
            ) : (
              <>
                <Field label={t('cancellationFees:new.client.name')} required>
                  <Input name="clientName" required defaultValue={order?.clientName ?? ''} />
                </Field>
                <Field label={t('cancellationFees:new.client.id')}>
                  <Input
                    name="clientId"
                    placeholder={t('cancellationFees:new.client.idPlaceholder')}
                    defaultValue={order?.clientId ?? ''}
                  />
                </Field>
                <Field
                  label={t('cancellationFees:new.client.affiliationId')}
                  hint={t('cancellationFees:new.client.affiliationIdHint')}
                >
                  <Input
                    name="affiliationId"
                    placeholder={t('cancellationFees:new.client.affiliationIdPlaceholder')}
                  />
                </Field>
              </>
            )}
            <Field label={t('cancellationFees:new.client.due')} required>
              <Input name="dueDate" type="date" required defaultValue={due} />
            </Field>
          </FormGrid>

          {/* Only offered for somebody the ledger does not already hold: a
              recipient picked from it is in there by definition. */}
          {billToKind === 'unregistered' ? (
            <label className="consent-check">
              <input
                type="checkbox"
                checked={registerCustomer}
                onChange={event => setRegisterCustomer(event.target.checked)}
              />
              <span>
                <strong>{t('cancellationFees:new.client.register')}</strong>
                <small>{t('cancellationFees:new.client.registerDetail')}</small>
              </span>
            </label>
          ) : null}
        </Panel>

        <Panel
          title={t('cancellationFees:new.delivery.title')}
          description={t('cancellationFees:new.delivery.description')}
        >
          <div className="delivery-choices">
            <label className={sendEmail ? 'delivery-choice selected' : 'delivery-choice'}>
              <input type="checkbox" checked={sendEmail} onChange={event => setSendEmail(event.target.checked)} />
              <Mail />
              <span>
                <strong>{t('cancellationFees:new.delivery.email')}</strong>
                <small>{t('cancellationFees:new.delivery.emailDetail')}</small>
              </span>
            </label>
            <label className={sendSms ? 'delivery-choice selected' : 'delivery-choice'}>
              <input type="checkbox" checked={sendSms} onChange={event => setSendSms(event.target.checked)} />
              <MessageSquareText />
              <span>
                <strong>{t('cancellationFees:new.delivery.sms')}</strong>
                <small>{t('cancellationFees:new.delivery.smsDetail')}</small>
              </span>
            </label>
          </div>
          <FormGrid>
            <Field label={t('cancellationFees:new.delivery.emailTo')} required={sendEmail}>
              <Input
                name="clientEmail"
                type="email"
                required={sendEmail}
                disabled={!sendEmail}
                placeholder="guest@example.com"
                key={customer?.id ?? order?.id ?? 'blank'}
                defaultValue={customer?.email ?? order?.clientEmail ?? ''}
              />
            </Field>
            <Field
              label={t('cancellationFees:new.delivery.smsTo')}
              required={sendSms}
              hint={billToKind === 'unregistered'
                ? t('cancellationFees:new.delivery.smsToHint')
                : undefined}
            >
              {/* Kept usable without SMS for an unregistered recipient: the
                  number is how the club will reach them later, so it belongs on
                  the invoice whether or not the notice goes out by SMS. */}
              <Input
                name="clientPhone"
                type="tel"
                required={sendSms}
                disabled={!sendSms && billToKind !== 'unregistered'}
                placeholder="09012345678"
                key={customer?.id ?? 'blank'}
                defaultValue={customer?.phone ?? ''}
              />
            </Field>
          </FormGrid>
          {sendSms ? (
            <>
              <label className="consent-check">
                <input name="smsConsent" type="checkbox" required />
                <span>
                  <strong>{t('cancellationFees:new.delivery.consent')}</strong>
                  <small>{t('cancellationFees:new.delivery.consentDetail')}</small>
                </span>
              </label>
              <Field
                label={t('cancellationFees:new.delivery.smsBody')}
                hint={t('cancellationFees:new.delivery.smsBodyHint')}
              >
                <NativeTextarea
                  name="smsMessage"
                  rows={4}
                  defaultValue={t('cancellationFees:new.delivery.smsBodyDefault')}
                />
              </Field>
            </>
          ) : null}
        </Panel>

        <div className="sticky-submit">
          <div><span>{t('cancellationFees:new.total')}</span><strong>{yen(amount)}</strong></div>
          {/* Once the invoice exists this form is spent: the retry key is tied
              to it, so pressing this again would answer with the invoice that
              was already created and quietly drop any edit made since. What is
              left to do — resend, or open it — is offered in the notice above. */}
          <Button type="submit" variant="primary" size="lg" disabled={submitting || created !== null}>
            <Send />
            {t('cancellationFees:new.review')}
          </Button>
        </div>
      </form>}

      <Sheet
        open={pending !== null}
        onOpenChange={open => { if (!open && !submitting) setPending(null) }}
        title={t('cancellationFees:new.confirm.title')}
        description={t('cancellationFees:new.confirm.description')}
      >
        {pending ? (
          <div className="page-stack">
            <dl className="detail-list">
              <div>
                <dt>{t('cancellationFees:new.confirm.recipient')}</dt>
                <dd>{pending.recipientName}</dd>
              </div>
              <div>
                <dt>{t('cancellationFees:new.confirm.destination')}</dt>
                <dd>{destinationSummary(pending)}</dd>
              </div>
              <div>
                <dt>{t('cancellationFees:new.confirm.amount')}</dt>
                <dd>{yen(pending.amount + pending.taxAmount)}</dd>
              </div>
              <div>
                <dt>{t('cancellationFees:new.confirm.due')}</dt>
                <dd>{pending.dueDate}</dd>
              </div>
              <div>
                <dt>{t('cancellationFees:new.confirm.ledger')}</dt>
                <dd>
                  {pending.registerCustomer
                    ? t('cancellationFees:new.confirm.ledgerRegister')
                    : pending.billTo.kind === 'unregistered'
                      ? t('cancellationFees:new.confirm.ledgerSkip')
                      : t('cancellationFees:new.confirm.ledgerExisting')}
                </dd>
              </div>
            </dl>
            {pending.sendSms && pending.smsMessage ? (
              <SmsPreview
                template={pending.smsMessage}
                amount={pending.amount + pending.taxAmount}
                dueDate={pending.dueDate}
              />
            ) : null}
            <div className="toolbar-row">
              <Button type="button" disabled={submitting} onClick={() => setPending(null)}>
                {t('cancellationFees:new.confirm.back')}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={submitting}
                onClick={() => void send(pending)}
              >
                <Send />
                {submitting
                  ? t('cancellationFees:new.submitting')
                  : t('cancellationFees:new.submit')}
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  )
}

/**
 * How to reach the person this invoice is addressed to.
 *
 * `clientPhone` and `clientEmail` are the delivery destinations, so Field only
 * fills them for a channel that was actually asked for. The recipient's own
 * contact details are on the `billTo` snapshot, which is what a cancellation
 * fee raised without an SMS still has to show — the desk rings the guest about
 * the fee whether or not the notice went out that way.
 */
export function recipientPhone(invoice: Pick<InvoiceData, 'clientPhone' | 'billTo'>) {
  return invoice.clientPhone ?? invoice.billTo?.snapshot?.phone ?? null
}

export function recipientEmail(invoice: Pick<InvoiceData, 'clientEmail' | 'billTo'>) {
  return invoice.clientEmail ?? invoice.billTo?.snapshot?.email ?? null
}

/**
 * The SMS as it will arrive, for the confirmation step.
 *
 * This is the last point where the finished text can still be read: Field
 * substitutes the placeholders after the send is handed over, so up to here
 * the desk has only seen a template. The part count rides along because the
 * text is editable and AWS bills per part — the shipped wording leaves sixteen
 * characters under the two-part ceiling, so one added phrase makes every send
 * half again as expensive without looking any different.
 *
 * `amount` is the invoice total: the message asks for what the guest owes, and
 * a preview that quoted the fee before tax would be a different number from
 * the one on the payment page.
 */
function SmsPreview({
  template,
  amount,
  dueDate,
}: {
  template: string
  amount: number
  dueDate: string
}) {
  const { t } = useTranslation(['cancellationFees'])
  // The payment link does not exist yet, so this renders against a stand-in of
  // the same length rather than leaving `{url}` showing.
  const text = renderSmsPreview({ template, amount, dueDate })
  // Not a `Field`: that renders a `<label>`, and the preview is a block of
  // text rather than a control for the label to name.
  return (
    <div className="field">
      <span className="field-label">{t('cancellationFees:new.confirm.smsPreview')}</span>
      <p className="notes-block sms-preview">{text}</p>
      <span className="field-hint">{t('cancellationFees:new.confirm.smsPreviewHint')}</span>
      <span className="field-hint">
        {t('cancellationFees:new.confirm.smsParts', {
          characters: String(smsCharacterCount(text)),
          parts: String(smsPartCount(text)),
        })}
      </span>
    </div>
  )
}

/** Where the payment link is going, for the confirmation step. */
function destinationSummary(pending: Pick<PendingSubmission, 'clientEmail' | 'clientPhone'>) {
  const destinations = [pending.clientEmail, pending.clientPhone]
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value))
  return destinations.length > 0
    ? destinations.join(' · ')
    : i18next.t('cancellationFees:detail.metrics.unspecified')
}

export function CancellationFeeDetailPage({ invoiceId }: { invoiceId: string }) {
  const { t } = useTranslation(['cancellationFees', 'common'])
  const timezone = useTenantTimezone()
  const businessDate = today(timezone)
  const loader = useCallback(() => fieldApiJson<InvoiceData>(`/v1/invoices/${encodeURIComponent(invoiceId)}`), [invoiceId])
  const resource = useResource(loader, [invoiceId])
  useRegisterPageReload(resource.refresh)
  const [fulfilling, setFulfilling] = useState(false)
  /** Announcements are toasts; the call sites still read `setNotice(...)`. */
  const setNotice = showToast

  async function fulfill() {
    // Payment-link fulfilment is a mutation too. A paid invoice is terminal;
    // keep the guard here in addition to disabling the button below so a
    // stale click cannot resend a paid invoice.
    if (!resource.data || !isInvoiceUpdateAllowed(resource.data)) return
    setFulfilling(true)
    setNotice(null)
    try {
      const fulfilled = await fieldApiJson<InvoiceData>(`/v1/invoices/${encodeURIComponent(invoiceId)}/fulfill`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      const issue = fulfillmentIssue(fulfilled, {
        sendEmail: fulfilled.emailDeliveryStatus !== null && fulfilled.emailDeliveryStatus !== undefined,
        sendSms: fulfilled.smsDeliveryStatus !== null && fulfilled.smsDeliveryStatus !== undefined,
      })
      setNotice(issue
        ? { tone: 'danger', message: issue }
        : { tone: 'success', message: t('cancellationFees:detail.notice.resent') })
      resource.refresh()
    } catch (reason) {
      setNotice({
        tone: 'danger',
        message: reason instanceof Error
          ? reason.message
          : t('cancellationFees:detail.notice.resendFailed'),
      })
    } finally {
      setFulfilling(false)
    }
  }

  async function openPaymentLink(url: string) {
    try {
      await openExternal(url)
    } catch (reason) {
      setNotice({
        tone: 'danger',
        message: reason instanceof Error
          ? reason.message
          : t('cancellationFees:detail.notice.openFailed'),
      })
    }
  }

  async function copyPaymentLink(url: string) {
    try {
      await copyToClipboard(url)
      setNotice({ tone: 'success', message: t('cancellationFees:detail.notice.copied') })
    } catch {
      setNotice({ tone: 'danger', message: t('cancellationFees:detail.notice.copyFailed') })
    }
  }

  async function downloadPdf(invoice: InvoiceData) {
    try {
      const { buildInvoicePdf } = await import('../../lib/invoice-pdf')
      const bytes = await buildInvoicePdf(invoice)
      const blob = new Blob([bytes], { type: 'application/pdf' })
      await downloadBlob(`invoice-${invoice.invoiceNumber}.pdf`, blob)
      setNotice({ tone: 'success', message: t('cancellationFees:detail.notice.pdfReady') })
    } catch (reason) {
      setNotice({
        tone: 'danger',
        message: reason instanceof Error
          ? reason.message
          : t('cancellationFees:detail.notice.pdfFailed'),
      })
    }
  }

  if (resource.loading) return <LoadingState label={t('cancellationFees:detail.loading')} />
  if (resource.error) return <ResourceError error={resource.error} onRetry={resource.refresh} />
  const storedInvoice = resource.data
  if (!storedInvoice) return <EmptyState title={t('cancellationFees:detail.notFound')} />
  const invoice = withDisplayStatus(storedInvoice, timezone, businessDate)

  return (
    <div className="page-stack page-narrow">
      <PageHeader
        eyebrow={invoice.invoiceNumber}
        title={invoice.clientName ?? invoice.clientId}
        description={t('cancellationFees:detail.subtitle', {
          created: invoice.createdAt.slice(0, 10),
          due: invoice.dueDate.slice(0, 10),
        })}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => navigate('cancellation-fees')}>
              <ArrowLeft /> {t('cancellationFees:new.backToList')}
            </Button>
          </div>
        )}
      />
      <MetricGrid>
        <Metric
          label={t('cancellationFees:detail.metrics.amount')}
          value={yen(invoice.totalAmount, invoice.currency)}
        />
        <Metric
          label={t('cancellationFees:detail.metrics.status')}
          value={statusLabel(invoice.status)}
          tone={invoice.status === 'Paid' ? 'success' : 'warning'}
        />
        <Metric
          label={t('cancellationFees:detail.metrics.email')}
          value={invoice.emailDeliveryStatus ?? t('cancellationFees:detail.metrics.unspecified')}
        />
        <Metric
          label={t('cancellationFees:detail.metrics.sms')}
          value={invoice.smsDeliveryStatus ?? t('cancellationFees:detail.metrics.unspecified')}
        />
      </MetricGrid>
      {deliveryFailures(invoice).map(failure => (
        <Notice
          key={failure.channel}
          tone="danger"
          title={t('cancellationFees:delivery.failedTitle', { channel: failure.label })}
        >
          {failure.reason} {t('cancellationFees:delivery.retryHint')}
        </Notice>
      ))}
      <Panel
        title={t('cancellationFees:detail.payment.title')}
        actions={(
          <div className="toolbar-row">
            {invoice.paymentLinkUrl ? (
              <>
                <Button type="button" onClick={() => void openPaymentLink(invoice.paymentLinkUrl!)}>
                  <ExternalLink /> {t('cancellationFees:detail.payment.openPage')}
                </Button>
                <Button type="button" onClick={() => void copyPaymentLink(invoice.paymentLinkUrl!)}>
                  <ClipboardCopy /> {t('cancellationFees:detail.payment.copyUrl')}
                </Button>
              </>
            ) : null}
            <Button type="button" onClick={() => void downloadPdf(invoice)}><Download /> PDF</Button>
            <Button
              type="button"
              variant="primary"
              disabled={fulfilling || invoice.status === 'Paid'}
              onClick={() => void fulfill()}
            >
              <Send />
              {fulfilling
                ? t('cancellationFees:detail.payment.working')
                : t('cancellationFees:detail.payment.resend')}
            </Button>
          </div>
        )}
      >
        <dl className="detail-list">
          <div>
            <dt>{t('cancellationFees:detail.payment.link')}</dt>
            <dd>
              {invoice.paymentLinkStatus
                ?? (invoice.paymentLinkUrl ? 'Ready' : t('cancellationFees:detail.payment.notIssued'))}
            </dd>
          </div>
          <div>
            <dt>{t('cancellationFees:detail.payment.emailTo')}</dt>
            <dd>{recipientEmail(invoice) ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('cancellationFees:detail.payment.phoneTo')}</dt>
            <dd>{recipientPhone(invoice) ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('cancellationFees:detail.payment.paidAt')}</dt>
            <dd>{invoice.paidAt ?? '—'}</dd>
          </div>
        </dl>
      </Panel>
      <InvoiceOperations
        key={`${storedInvoice.status}-${storedInvoice.paymentLinkStatus}-${storedInvoice.updatedAt ?? ''}`}
        invoice={storedInvoice}
        onRefresh={resource.refresh}
        onNotice={setNotice}
      />
      <Panel title={t('cancellationFees:detail.items.title')}>
        <DataTable
          rows={invoice.lineItems}
          rowKey={item => `${item.description}-${item.unitPrice}`}
          columns={[
            {
              key: 'description',
              header: t('cancellationFees:detail.items.description'),
              cell: item => item.description,
            },
            {
              key: 'quantity',
              header: t('cancellationFees:detail.items.quantity'),
              align: 'right',
              cell: item => item.quantity,
            },
            {
              key: 'unit',
              header: t('cancellationFees:detail.items.unitPrice'),
              align: 'right',
              cell: item => yen(item.unitPrice, invoice.currency),
            },
            {
              key: 'amount',
              header: t('cancellationFees:detail.items.amount'),
              align: 'right',
              cell: item => yen(item.amount, invoice.currency),
            },
          ]}
        />
        {invoice.notes ? <pre className="notes-block">{invoice.notes}</pre> : null}
      </Panel>
    </div>
  )
}

function InvoiceOperations({
  invoice,
  onRefresh,
  onNotice,
}: {
  invoice: InvoiceData
  onRefresh(): void
  onNotice(notice: { tone: 'success' | 'danger'; message: string }): void
}) {
  const { t } = useTranslation(['cancellationFees', 'common'])
  const [status, setStatus] = useState<InvoiceStatus>(invoice.status)
  const [createPaymentLink, setCreatePaymentLink] = useState(false)
  const [sendEmail, setSendEmail] = useState(false)
  const [saving, setSaving] = useState(false)
  const isPaid = !isInvoiceUpdateAllowed(invoice)

  async function updateInvoice() {
    if (isPaid) return
    setSaving(true)
    try {
      await fieldApiJson<InvoiceData>(`/v1/invoices/${encodeURIComponent(invoice.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          createPaymentLink,
          paymentLinkProvider: 'stripe',
          sendEmail,
        }),
      })
      onNotice({ tone: 'success', message: t('cancellationFees:detail.notice.statusUpdated') })
      setCreatePaymentLink(false)
      setSendEmail(false)
      onRefresh()
    } catch (reason) {
      onNotice({
        tone: 'danger',
        message: reason instanceof Error
          ? reason.message
          : t('cancellationFees:detail.notice.statusFailed'),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel
      title={t('cancellationFees:detail.update.title')}
      description={t('cancellationFees:detail.update.description')}
    >
      <FormGrid>
        <Field label={t('cancellationFees:detail.update.status')}>
          <NativeSelect
            value={status}
            disabled={isPaid}
            onChange={event => setStatus(event.target.value as InvoiceStatus)}
          >
            {(isPaid ? [invoice.status] : EDITABLE_INVOICE_STATUSES).map(value => (
              <option key={value} value={value}>{statusLabel(value)}</option>
            ))}
          </NativeSelect>
        </Field>
        <div className="operation-checks">
          <label className="consent-check">
            <input
              type="checkbox"
              checked={createPaymentLink}
              disabled={isPaid}
              onChange={event => setCreatePaymentLink(event.target.checked)}
            />
            <span><strong>{t('cancellationFees:detail.update.regenerateLink')}</strong></span>
          </label>
          <label className="consent-check">
            <input
              type="checkbox"
              checked={sendEmail}
              disabled={isPaid}
              onChange={event => setSendEmail(event.target.checked)}
            />
            <span><strong>{t('cancellationFees:detail.update.sendEmail')}</strong></span>
          </label>
        </div>
      </FormGrid>
      <div className="panel-footer-actions">
        <Button
          type="button"
          variant="primary"
          disabled={saving || isPaid}
          onClick={() => void updateInvoice()}
        >
          <Save />
          {saving
            ? t('cancellationFees:detail.update.submitting')
            : t('cancellationFees:detail.update.submit')}
        </Button>
      </div>
    </Panel>
  )
}

export function summarize(
  invoices: Array<Pick<InvoiceData, 'status' | 'dueDate' | 'totalAmount'>>,
  timezone = DEFAULT_TIME_ZONE,
  businessDate = today(timezone),
) {
  return invoices.reduce((summary, invoice) => {
    const status = invoiceDisplayStatus(invoice, timezone, businessDate)
    summary.count += 1
    if (status === 'Paid') summary.paid += invoice.totalAmount
    else summary.unpaid += invoice.totalAmount
    if (status === 'Overdue') summary.overdue += 1
    return summary
  }, { count: 0, unpaid: 0, overdue: 0, paid: 0 })
}

export type DeliveryChannel = 'email' | 'sms'

/**
 * Failure codes Field returns per channel, mapped to the i18n key that names
 * the fix (PLT-3707).
 *
 * Matched case-insensitively: the codes are `paymentLinkFailureCode`-style
 * PascalCase on the wire, and a snake_case spelling has to keep reading as the
 * same cause rather than falling through to `unknown`.
 */
const DELIVERY_FAILURE_REASONS: Record<string, string> = {
  permissiondenied: 'permissionDenied',
  billingnotready: 'billingNotReady',
  missingdestination: 'missingDestination',
  invaliddestination: 'invalidDestination',
  providerrequestfailed: 'providerError',
}

function deliveryFailureReason(code?: string | null) {
  const normalized = code?.trim().toLowerCase().replace(/_/g, '')
  const key = (normalized && DELIVERY_FAILURE_REASONS[normalized]) ?? 'unknown'
  return i18next.t(`cancellationFees:delivery.reason.${key}` as 'cancellationFees:delivery.reason.unknown')
}

export function deliveryChannelLabel(channel: DeliveryChannel) {
  return i18next.t(`cancellationFees:delivery.channel.${channel}` as 'cancellationFees:delivery.channel.sms')
}

/**
 * The channels whose send failed, each with what to do about it.
 *
 * Empty for an invoice that never asked for that channel: a `null` status is
 * "not requested", which is not a failure to report.
 */
export function deliveryFailures(
  invoice: Pick<InvoiceData,
    'emailDeliveryStatus' | 'smsDeliveryStatus'
    | 'emailDeliveryFailureCode' | 'smsDeliveryFailureCode'>,
) {
  const channels: { channel: DeliveryChannel; failed: boolean; code?: string | null }[] = [
    {
      channel: 'email',
      failed: invoice.emailDeliveryStatus === 'Failed',
      code: invoice.emailDeliveryFailureCode,
    },
    {
      channel: 'sms',
      failed: invoice.smsDeliveryStatus === 'Failed',
      code: invoice.smsDeliveryFailureCode,
    },
  ]
  return channels
    .filter(entry => entry.failed)
    .map(entry => ({
      channel: entry.channel,
      label: deliveryChannelLabel(entry.channel),
      reason: deliveryFailureReason(entry.code),
    }))
}

export function fulfillmentIssue(
  invoice: Pick<InvoiceData,
    'status' | 'paymentLinkStatus' | 'paymentLinkUrl' | 'emailDeliveryStatus' | 'smsDeliveryStatus'
    | 'emailDeliveryFailureCode' | 'smsDeliveryFailureCode'>,
  delivery: { sendEmail: boolean; sendSms: boolean },
) {
  if (invoice.paymentLinkStatus !== 'Ready' || !invoice.paymentLinkUrl) {
    return i18next.t('cancellationFees:new.error.noPaymentLink')
  }
  // Name the channel and the fix when the send actually failed. `deliveryPartial`
  // below stays for the states that are not a failure yet — a delivery still
  // Pending, or an invoice Field left short of `Sent`.
  const failures = deliveryFailures(invoice)
    .filter(failure => (failure.channel === 'email' ? delivery.sendEmail : delivery.sendSms))
  if (failures.length > 0) {
    return failures
      .map(failure => i18next.t('cancellationFees:new.error.deliveryFailed', {
        channel: failure.label,
        reason: failure.reason,
      }))
      .join(' ')
  }
  const selectedDeliveriesSent =
    (!delivery.sendEmail || invoice.emailDeliveryStatus === 'Sent')
    && (!delivery.sendSms || invoice.smsDeliveryStatus === 'Sent')
  if (invoice.status !== 'Sent' || !selectedDeliveriesSent) {
    return i18next.t('cancellationFees:new.error.deliveryPartial')
  }
  return undefined
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('clipboard unavailable')
}

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
  notes?: string | null
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
 * Invoices created by Course Board carry the notes marker. The Japanese prefix
 * stays hard-coded because it identifies rows already stored by earlier
 * versions — translating it would hide them.
 */
const LEGACY_FEE_DESCRIPTION_PREFIX = 'キャンセル料'

function isCancellationFee(invoice: InvoiceData) {
  return invoice.notes?.includes('[courseboard:cancellation-fee]')
    || invoice.lineItems.some(item => item.description.startsWith(LEGACY_FEE_DESCRIPTION_PREFIX))
}

export function CancellationFeesPage() {
  const { t } = useTranslation(['cancellationFees', 'common'])
  const [status, setStatus] = useState<'all' | InvoiceStatus>('all')
  const loader = useCallback(async () => {
    const suffix = status === 'all' ? '' : `?status=${encodeURIComponent(status)}`
    const response = await fieldApiJson<{ items: InvoiceData[] }>(`/v1/invoices${suffix}`)
    return response.items.filter(isCancellationFee)
  }, [status])
  const resource = useResource(loader, [status])
  const summary = useMemo(() => summarize(resource.data ?? []), [resource.data])
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
            rows={resource.data}
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
                cell: invoice => <div className="primary-cell"><strong>{invoice.invoiceNumber}</strong><small>{invoice.id}</small></div>,
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

export function NewCancellationFeePage() {
  const { t } = useTranslation(['cancellationFees', 'common'])
  const idempotencyKey = useRef(crypto.randomUUID())
  const orderId = currentRouteSearchParams().get('orderId')?.trim() ?? ''
  const orderLoader = useCallback(async () => {
    if (!orderId) return null
    return fieldApiJson<OrderData>(`/v1/erp/orders/${encodeURIComponent(orderId)}`)
  }, [orderId])
  const orderResource = useResource(orderLoader, [orderId])
  const order = orderResource.data
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const [sendEmail, setSendEmail] = useState(true)
  const [sendSms, setSendSms] = useState(false)
  const [amount, setAmount] = useState(5000)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<InvoiceData | null>(null)
  const [deliveryError, setDeliveryError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
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
    const clientName = String(form.get('clientName') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()
    const notes = String(form.get('notes') ?? '').trim()
    const customerPhone = normalizePhone(String(form.get('clientPhone') ?? ''))
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('cancellationFees:new.validation.amount'))
      return
    }
    if (sendSms && !customerPhone) {
      setError(t('cancellationFees:new.validation.phone'))
      return
    }

    setSubmitting(true)
    try {
      const invoice = await fieldApiJson<InvoiceData>('/v1/invoices', {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey.current },
        body: JSON.stringify({
          clientId: String(form.get('clientId') ?? '').trim() || `courseboard:${reference || crypto.randomUUID()}`,
          clientName,
          clientEmail: sendEmail ? String(form.get('clientEmail') ?? '').trim() : undefined,
          clientPhone: sendSms ? customerPhone : undefined,
          dueDate: String(form.get('dueDate') ?? ''),
          currency: 'JPY',
          taxAmount: Number(form.get('taxAmount') ?? 0),
          notes: [
            '[courseboard:cancellation-fee]',
            t('cancellationFees:new.message.intro'),
            reference ? t('cancellationFees:new.message.reference', { reference }) : null,
            reason ? t('cancellationFees:new.message.reason', { reason }) : null,
            notes || null,
          ].filter(Boolean).join('\n'),
          lineItems: [{
            description: reference
              ? t('cancellationFees:new.message.lineItem', { reference })
              : t('cancellationFees:lineItemLabel'),
            quantity: 1,
            unitPrice: amount,
          }],
          createPaymentLink: true,
          paymentLinkProvider: 'stripe',
          sendEmail,
          sendSms,
          smsMessage: sendSms ? String(form.get('smsMessage') ?? '') : undefined,
        }),
      })
      setCreated(invoice)
      try {
        const fulfilled = await fieldApiJson<InvoiceData>(`/v1/invoices/${encodeURIComponent(invoice.id)}/fulfill`, {
          method: 'POST',
          body: JSON.stringify({}),
        })
        setCreated(fulfilled)
        const incomplete = fulfillmentIssue(fulfilled, { sendEmail, sendSms })
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
      setError(reason instanceof Error ? reason.message : t('cancellationFees:new.error.create'))
    } finally {
      setSubmitting(false)
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

      {orderId && orderResource.loading ? null : <form className="collection-editor" onSubmit={submit}>
        <Panel
          title={t('cancellationFees:new.detail.title')}
          description={t('cancellationFees:new.detail.description')}
        >
          <FormGrid>
            <Field label={t('cancellationFees:new.detail.reference')}>
              <Input
                name="reference"
                placeholder="RSV-1001 / ORD-1001"
                defaultValue={order ? `${order.orderNumber} / ${order.id}` : ''}
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
            <Field label={t('cancellationFees:new.client.due')} required>
              <Input name="dueDate" type="date" required defaultValue={due} />
            </Field>
          </FormGrid>
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
                defaultValue={order?.clientEmail ?? ''}
              />
            </Field>
            <Field label={t('cancellationFees:new.delivery.smsTo')} required={sendSms}>
              <Input name="clientPhone" type="tel" required={sendSms} disabled={!sendSms} placeholder="09012345678" />
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
          <Button type="submit" variant="primary" size="lg" disabled={submitting}>
            <Send />
            {submitting ? t('cancellationFees:new.submitting') : t('cancellationFees:new.submit')}
          </Button>
        </div>
      </form>}
    </div>
  )
}

export function CancellationFeeDetailPage({ invoiceId }: { invoiceId: string }) {
  const { t } = useTranslation(['cancellationFees', 'common'])
  const loader = useCallback(() => fieldApiJson<InvoiceData>(`/v1/invoices/${encodeURIComponent(invoiceId)}`), [invoiceId])
  const resource = useResource(loader, [invoiceId])
  useRegisterPageReload(resource.refresh)
  const [fulfilling, setFulfilling] = useState(false)
  /** Announcements are toasts; the call sites still read `setNotice(...)`. */
  const setNotice = showToast

  async function fulfill() {
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
  const invoice = resource.data
  if (!invoice) return <EmptyState title={t('cancellationFees:detail.notFound')} />

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
            <Button type="button" variant="primary" disabled={fulfilling} onClick={() => void fulfill()}>
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
            <dd>{invoice.clientEmail ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('cancellationFees:detail.payment.phoneTo')}</dt>
            <dd>{invoice.clientPhone ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('cancellationFees:detail.payment.paidAt')}</dt>
            <dd>{invoice.paidAt ?? '—'}</dd>
          </div>
        </dl>
      </Panel>
      <InvoiceOperations
        key={`${invoice.status}-${invoice.paymentLinkStatus}-${invoice.updatedAt ?? ''}`}
        invoice={invoice}
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

  async function updateInvoice() {
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
          <NativeSelect value={status} onChange={event => setStatus(event.target.value as InvoiceStatus)}>
            {INVOICE_STATUSES.map(value => (
              <option key={value} value={value}>{statusLabel(value)}</option>
            ))}
          </NativeSelect>
        </Field>
        <div className="operation-checks">
          <label className="consent-check">
            <input
              type="checkbox"
              checked={createPaymentLink}
              onChange={event => setCreatePaymentLink(event.target.checked)}
            />
            <span><strong>{t('cancellationFees:detail.update.regenerateLink')}</strong></span>
          </label>
          <label className="consent-check">
            <input type="checkbox" checked={sendEmail} onChange={event => setSendEmail(event.target.checked)} />
            <span><strong>{t('cancellationFees:detail.update.sendEmail')}</strong></span>
          </label>
        </div>
      </FormGrid>
      <div className="panel-footer-actions">
        <Button type="button" variant="primary" disabled={saving} onClick={() => void updateInvoice()}>
          <Save />
          {saving
            ? t('cancellationFees:detail.update.submitting')
            : t('cancellationFees:detail.update.submit')}
        </Button>
      </div>
    </Panel>
  )
}

function summarize(invoices: InvoiceData[]) {
  return invoices.reduce((summary, invoice) => {
    summary.count += 1
    if (invoice.status === 'Paid') summary.paid += invoice.totalAmount
    else summary.unpaid += invoice.totalAmount
    if (invoice.status === 'Overdue') summary.overdue += 1
    return summary
  }, { count: 0, unpaid: 0, overdue: 0, paid: 0 })
}

export function fulfillmentIssue(
  invoice: Pick<InvoiceData,
    'status' | 'paymentLinkStatus' | 'paymentLinkUrl' | 'emailDeliveryStatus' | 'smsDeliveryStatus'>,
  delivery: { sendEmail: boolean; sendSms: boolean },
) {
  if (invoice.paymentLinkStatus !== 'Ready' || !invoice.paymentLinkUrl) {
    return i18next.t('cancellationFees:new.error.noPaymentLink')
  }
  const selectedDeliveriesSent =
    (!delivery.sendEmail || invoice.emailDeliveryStatus === 'Sent')
    && (!delivery.sendSms || invoice.smsDeliveryStatus === 'Sent')
  if (invoice.status !== 'Sent' || !selectedDeliveriesSent) {
    return i18next.t('cancellationFees:new.error.deliveryPartial')
  }
  return undefined
}

export function normalizePhone(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('+')) {
    const normalized = `+${trimmed.slice(1).replace(/\D/g, '')}`
    return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : ''
  }
  const digits = trimmed.replace(/\D/g, '')
  if (/^0\d{9,10}$/.test(digits)) return `+81${digits.slice(1)}`
  return ''
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

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
import { courseboardApiBlob, downloadBlob, fieldApiJson, yen } from '../../api'
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
  PageRefreshButton,
  Panel,
  ResourceError,
} from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { useRegisterPageReload } from '../../lib/pageReload'
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

const statusLabels: Record<InvoiceStatus, string> = {
  Draft: '下書き',
  Sent: '送付済',
  SendFailed: '送信失敗',
  Paid: '入金済',
  Overdue: '期限超過',
}

const statusVariants: Record<InvoiceStatus, 'neutral' | 'accent' | 'warning' | 'success' | 'destructive'> = {
  Draft: 'neutral',
  Sent: 'accent',
  SendFailed: 'destructive',
  Paid: 'success',
  Overdue: 'warning',
}

function isCancellationFee(invoice: InvoiceData) {
  return invoice.notes?.includes('[courseboard:cancellation-fee]')
    || invoice.lineItems.some(item => item.description.startsWith('キャンセル料'))
}

export function CancellationFeesPage() {
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
      <PageHeader
        eyebrow="Collections"
        title="キャンセル料"
        description="キャンセル料だけを識別して、作成・送信・入金状態を一つの一覧で追跡します。"
        actions={(
          <Button type="button" variant="primary" onClick={() => navigate('cancellation-fees/new')}>
            <Plus /> 新規請求
          </Button>
        )}
      />

      <MetricGrid>
        <Metric label="表示" value={`${summary.count} 件`} />
        <Metric label="未入金" value={yen(summary.unpaid)} tone={summary.unpaid > 0 ? 'warning' : 'neutral'} />
        <Metric label="期限超過" value={`${summary.overdue} 件`} tone={summary.overdue > 0 ? 'danger' : 'neutral'} />
        <Metric label="入金済" value={yen(summary.paid)} tone="success" />
      </MetricGrid>

      <Panel
        title="請求一覧"
        description="Course Board の識別子、またはキャンセル料明細を持つ請求だけを表示します。"
        actions={(
          <div className="toolbar-row">
            <NativeSelect aria-label="状態" value={status} onChange={event => setStatus(event.target.value as typeof status)}>
              <option value="all">すべて</option>
              {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </NativeSelect>
            <PageRefreshButton size="sm" onClick={resource.refresh} label="更新" />
          </div>
        )}
      >
        {resource.loading ? <LoadingState label="請求を読み込み中" /> : null}
        {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
        {resource.data ? (
          <DataTable
            rows={resource.data}
            rowKey={invoice => invoice.id}
            onRowClick={invoice => navigate(`cancellation-fees/${invoice.id}`)}
            empty={<EmptyState title="キャンセル料請求はありません" description="新規請求を作成するとここに表示されます。" />}
            columns={[
              {
                key: 'number',
                header: '請求番号',
                cell: invoice => <div className="primary-cell"><strong>{invoice.invoiceNumber}</strong><small>{invoice.id}</small></div>,
              },
              { key: 'client', header: '請求先', cell: invoice => invoice.clientName ?? invoice.clientId },
              { key: 'status', header: '状態', cell: invoice => <Badge variant={statusVariants[invoice.status]}>{statusLabels[invoice.status]}</Badge> },
              { key: 'due', header: '支払期限', cell: invoice => invoice.dueDate.slice(0, 10) },
              { key: 'amount', header: '請求額', align: 'right', cell: invoice => yen(invoice.totalAmount, invoice.currency) },
            ]}
          />
        ) : null}
      </Panel>
    </div>
  )
}

export function NewCancellationFeePage() {
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
      setError('メールまたはSMSを少なくとも一つ選択してください。')
      return
    }
    if (sendSms && form.get('smsConsent') !== 'on') {
      setError('SMS送信前に受信者の同意確認が必要です。')
      return
    }
    const reference = String(form.get('reference') ?? '').trim()
    const clientName = String(form.get('clientName') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()
    const notes = String(form.get('notes') ?? '').trim()
    const customerPhone = normalizePhone(String(form.get('clientPhone') ?? ''))
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('キャンセル料は1円以上で入力してください。')
      return
    }
    if (sendSms && !customerPhone) {
      setError('SMS送付先を日本の携帯番号またはE.164形式で入力してください。')
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
            'キャンセル料のご請求です。',
            reference ? `対象: ${reference}` : null,
            reason ? `理由: ${reason}` : null,
            notes || null,
          ].filter(Boolean).join('\n'),
          lineItems: [{
            description: reference ? `キャンセル料 (${reference})` : 'キャンセル料',
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
        setDeliveryError(reason instanceof Error ? reason.message : '通知処理に失敗しました')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '請求書を作成できませんでした')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-stack page-narrow">
      <PageHeader
        eyebrow="New collection"
        title="キャンセル料請求"
        description="Stripe 支払いリンク付きの請求書を作成し、選択した送信方法で案内します。"
        actions={(
          <div className="flex flex-wrap gap-2">
            {orderId ? <PageRefreshButton onClick={orderResource.refresh} label="受注を更新" /> : null}
            <Button type="button" onClick={() => navigate('cancellation-fees')}><ArrowLeft /> 一覧へ</Button>
          </div>
        )}
      />

      {error ? <Notice tone="danger" title="作成できませんでした">{error}</Notice> : null}
      {created && deliveryError ? (
        <Notice tone="warning" title="請求書は作成済みです">
          {deliveryError}。請求詳細から再送できます。
          <div className="notice-inline-action">
            <Button type="button" size="sm" onClick={() => navigate(`cancellation-fees/${created.id}`)}>請求詳細へ</Button>
          </div>
        </Notice>
      ) : null}

      {orderId && orderResource.loading ? <LoadingState label="対象受注を読み込み中" /> : null}
      {orderId && orderResource.error ? (
        <Notice tone="warning" title="対象受注を読み込めませんでした">
          受注情報を自動入力できません。内容を手入力して続行できます。
        </Notice>
      ) : null}

      {order ? (
        <Panel title="対象受注" description="受注から請求先と参照番号を自動入力しました。">
          <dl className="detail-list">
            <div><dt>受注番号</dt><dd>{order.orderNumber}</dd></div>
            <div><dt>受注金額</dt><dd>{yen(order.totalAmount, order.currency)}</dd></div>
            <div><dt>状態</dt><dd>{order.status}</dd></div>
          </dl>
        </Panel>
      ) : null}

      {orderId && orderResource.loading ? null : <form className="collection-editor" onSubmit={submit}>
        <Panel title="キャンセル内容" description="対象、金額、理由を運用記録と一致させます。">
          <FormGrid>
            <Field label="対象予約・注文">
              <Input
                name="reference"
                placeholder="RSV-1001 / ORD-1001"
                defaultValue={order ? `${order.orderNumber} / ${order.id}` : ''}
              />
            </Field>
            <Field label="キャンセル料" required>
              <Input name="amount" type="number" min={1} required value={amount} onChange={event => setAmount(Number(event.target.value))} />
            </Field>
            <Field label="税額"><Input name="taxAmount" type="number" min={0} defaultValue={0} /></Field>
            <Field label="理由"><Input name="reason" placeholder="当日キャンセル" /></Field>
          </FormGrid>
          <Field label="備考"><NativeTextarea name="notes" rows={4} placeholder="お客様に共有する補足" /></Field>
        </Panel>

        <Panel title="請求先" description="取引先IDがない場合は Course Board が重複しない参照IDを発行します。">
          <FormGrid>
            <Field label="請求先名" required><Input name="clientName" required defaultValue={order?.clientName ?? ''} /></Field>
            <Field label="取引先ID"><Input name="clientId" placeholder="既存IDがある場合のみ" defaultValue={order?.clientId ?? ''} /></Field>
            <Field label="支払期限" required><Input name="dueDate" type="date" required defaultValue={due} /></Field>
          </FormGrid>
        </Panel>

        <Panel title="送信" description="支払いURLは発行後に文面の {url} へ差し込まれます。">
          <div className="delivery-choices">
            <label className={sendEmail ? 'delivery-choice selected' : 'delivery-choice'}>
              <input type="checkbox" checked={sendEmail} onChange={event => setSendEmail(event.target.checked)} />
              <Mail /><span><strong>メール</strong><small>請求書と支払いリンク</small></span>
            </label>
            <label className={sendSms ? 'delivery-choice selected' : 'delivery-choice'}>
              <input type="checkbox" checked={sendSms} onChange={event => setSendSms(event.target.checked)} />
              <MessageSquareText /><span><strong>SMS</strong><small>短い支払い案内</small></span>
            </label>
          </div>
          <FormGrid>
            <Field label="送付先メール" required={sendEmail}>
              <Input
                name="clientEmail"
                type="email"
                required={sendEmail}
                disabled={!sendEmail}
                placeholder="guest@example.com"
                defaultValue={order?.clientEmail ?? ''}
              />
            </Field>
            <Field label="SMS送付先" required={sendSms}>
              <Input name="clientPhone" type="tel" required={sendSms} disabled={!sendSms} placeholder="09012345678" />
            </Field>
          </FormGrid>
          {sendSms ? (
            <>
              <label className="consent-check">
                <input name="smsConsent" type="checkbox" required />
                <span><strong>SMS同意確認</strong><small>受信者が取引SMSを受け取ることに同意済みであることを確認しました。</small></span>
              </label>
              <Field label="SMS文面">
                <NativeTextarea
                  name="smsMessage"
                  rows={4}
                  defaultValue={'Course Boardです。\nキャンセル料 {amount}{currency} のお支払いをお願いします。\n支払期限: {dueDate}\n{url}'}
                />
              </Field>
            </>
          ) : null}
        </Panel>

        <div className="sticky-submit">
          <div><span>請求金額</span><strong>{yen(amount)}</strong></div>
          <Button type="submit" variant="primary" size="lg" disabled={submitting}>
            <Send /> {submitting ? '作成・送信中…' : '請求を作成して送信'}
          </Button>
        </div>
      </form>}
    </div>
  )
}

export function CancellationFeeDetailPage({ invoiceId }: { invoiceId: string }) {
  const loader = useCallback(() => fieldApiJson<InvoiceData>(`/v1/invoices/${encodeURIComponent(invoiceId)}`), [invoiceId])
  const resource = useResource(loader, [invoiceId])
  useRegisterPageReload(resource.refresh)
  const [fulfilling, setFulfilling] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null)

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
        : { tone: 'success', message: '支払いリンクと通知状態を更新しました。' })
      resource.refresh()
    } catch (reason) {
      setNotice({
        tone: 'danger',
        message: reason instanceof Error ? reason.message : '再送できませんでした',
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
        message: reason instanceof Error ? reason.message : '支払いページを開けませんでした。',
      })
    }
  }

  async function copyPaymentLink(url: string) {
    try {
      await copyToClipboard(url)
      setNotice({ tone: 'success', message: '支払いURLをコピーしました。' })
    } catch {
      setNotice({ tone: 'danger', message: '支払いURLをコピーできませんでした。' })
    }
  }

  async function downloadPdf(invoice: InvoiceData) {
    try {
      const blob = await courseboardApiBlob(`/api/courseboard/invoices/${encodeURIComponent(invoice.id)}/pdf`)
      await downloadBlob(`invoice-${invoice.invoiceNumber}.pdf`, blob)
      setNotice({ tone: 'success', message: '請求書PDFを準備しました。' })
    } catch (reason) {
      setNotice({
        tone: 'danger',
        message: reason instanceof Error ? reason.message : '請求書PDFを取得できませんでした。',
      })
    }
  }

  if (resource.loading) return <LoadingState label="請求詳細を読み込み中" />
  if (resource.error) return <ResourceError error={resource.error} onRetry={resource.refresh} />
  const invoice = resource.data
  if (!invoice) return <EmptyState title="請求が見つかりません" />

  return (
    <div className="page-stack page-narrow">
      <PageHeader
        eyebrow={invoice.invoiceNumber}
        title={invoice.clientName ?? invoice.clientId}
        description={`作成日 ${invoice.createdAt.slice(0, 10)} · 支払期限 ${invoice.dueDate.slice(0, 10)}`}
        actions={(
          <div className="flex flex-wrap gap-2">
            <PageRefreshButton onClick={resource.refresh} label="更新" />
            <Button type="button" onClick={() => navigate('cancellation-fees')}><ArrowLeft /> 一覧へ</Button>
          </div>
        )}
      />
      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}
      <MetricGrid>
        <Metric label="請求額" value={yen(invoice.totalAmount, invoice.currency)} />
        <Metric label="状態" value={statusLabels[invoice.status]} tone={invoice.status === 'Paid' ? 'success' : 'warning'} />
        <Metric label="メール" value={invoice.emailDeliveryStatus ?? '未指定'} />
        <Metric label="SMS" value={invoice.smsDeliveryStatus ?? '未指定'} />
      </MetricGrid>
      <Panel
        title="支払いと通知"
        actions={(
          <div className="toolbar-row">
            {invoice.paymentLinkUrl ? (
              <>
                <Button type="button" onClick={() => void openPaymentLink(invoice.paymentLinkUrl!)}><ExternalLink /> 支払いページ</Button>
                <Button type="button" onClick={() => void copyPaymentLink(invoice.paymentLinkUrl!)}><ClipboardCopy /> URLコピー</Button>
              </>
            ) : null}
            <Button type="button" onClick={() => void downloadPdf(invoice)}><Download /> PDF</Button>
            <Button type="button" variant="primary" disabled={fulfilling} onClick={() => void fulfill()}>
              <Send /> {fulfilling ? '処理中…' : 'リンク発行・再送'}
            </Button>
          </div>
        )}
      >
        <dl className="detail-list">
          <div><dt>支払いリンク</dt><dd>{invoice.paymentLinkStatus ?? (invoice.paymentLinkUrl ? 'Ready' : '未発行')}</dd></div>
          <div><dt>送付先メール</dt><dd>{invoice.clientEmail ?? '—'}</dd></div>
          <div><dt>送付先電話</dt><dd>{invoice.clientPhone ?? '—'}</dd></div>
          <div><dt>入金日時</dt><dd>{invoice.paidAt ?? '—'}</dd></div>
        </dl>
      </Panel>
      <InvoiceOperations
        key={`${invoice.status}-${invoice.paymentLinkStatus}-${invoice.updatedAt ?? ''}`}
        invoice={invoice}
        onRefresh={resource.refresh}
        onNotice={setNotice}
      />
      <Panel title="請求明細">
        <DataTable
          rows={invoice.lineItems}
          rowKey={item => `${item.description}-${item.unitPrice}`}
          columns={[
            { key: 'description', header: '内容', cell: item => item.description },
            { key: 'quantity', header: '数量', align: 'right', cell: item => item.quantity },
            { key: 'unit', header: '単価', align: 'right', cell: item => yen(item.unitPrice, invoice.currency) },
            { key: 'amount', header: '金額', align: 'right', cell: item => yen(item.amount, invoice.currency) },
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
      onNotice({ tone: 'success', message: '請求状態を更新しました。' })
      setCreatePaymentLink(false)
      setSendEmail(false)
      onRefresh()
    } catch (reason) {
      onNotice({
        tone: 'danger',
        message: reason instanceof Error ? reason.message : '請求状態を更新できませんでした。',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel title="請求状態の更新" description="状態変更、Payment Link再生成、メール再送を個別に指定します。">
      <FormGrid>
        <Field label="ステータス">
          <NativeSelect value={status} onChange={event => setStatus(event.target.value as InvoiceStatus)}>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
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
            <span><strong>Payment Linkを再生成</strong></span>
          </label>
          <label className="consent-check">
            <input type="checkbox" checked={sendEmail} onChange={event => setSendEmail(event.target.checked)} />
            <span><strong>メール送信</strong></span>
          </label>
        </div>
      </FormGrid>
      <div className="panel-footer-actions">
        <Button type="button" variant="primary" disabled={saving} onClick={() => void updateInvoice()}>
          <Save /> {saving ? '更新中…' : '更新'}
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
    return '支払いリンクが発行されていません。請求詳細から再試行してください。'
  }
  const selectedDeliveriesSent =
    (!delivery.sendEmail || invoice.emailDeliveryStatus === 'Sent')
    && (!delivery.sendSms || invoice.smsDeliveryStatus === 'Sent')
  if (invoice.status !== 'Sent' || !selectedDeliveriesSent) {
    return '支払いリンクは作成済みですが、選択したメールまたはSMSの送信が完了していません。請求詳細から再送できます。'
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

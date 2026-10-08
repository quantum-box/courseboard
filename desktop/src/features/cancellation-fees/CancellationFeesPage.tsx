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
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, downloadBlob, fieldTenant, fieldUserId, yen } from '../../api'
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
import { navigate } from '../../lib/router'
import { DEFAULT_TIME_ZONE, normalizeIsoDate, today } from '../../lib/clock'
import { Sheet } from '../../components/Sheet'
import { CustomerPicker } from '../golf/customers/CustomerPicker'
import type { Customer } from '../golf/customers/models'
import {
  createCancellationFee,
  fulfillCancellationFee,
  getCancellationFee,
  listCancellationFees,
  newCancellationFeeIdempotencyKey,
  sendCancellationFee,
  updateCancellationFee,
} from './cancellation-fee-api'
import {
  cancellationFeeInvoiceRequestBody,
  customerRegistrationRequestBody,
  invoiceBillTo,
  normalizePhone,
  CANCELLATION_FEE_MARKER,
  type InvoiceBillTo,
  type InvoiceSource,
} from './models'
// Kept exported for the existing model consumers while the page itself uses
// only the dedicated adapter below.
export {
  cancellationFeeInvoiceRequestBody,
  customerRegistrationRequestBody,
  invoiceBillTo,
  normalizePhone,
  type InvoiceBillTo,
}

type InvoiceStatus = 'Draft' | 'Sent' | 'SendFailed' | 'Paid' | 'Overdue'

const DELIVERY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CREATE_KEY_STORAGE_PREFIX = 'courseboard:cancellation-fee:create-keys'
const CREATE_RECOVERY_STORAGE_PREFIX = 'courseboard:cancellation-fee:create-recovery'

function createStorageScope() {
  const tenant = fieldTenant()
  const user = fieldUserId()
  return tenant && user ? `${tenant}:${user}` : null
}

function createIdentityHash(identity: string) {
  // The form payload can contain recipient PII. Store a compact identity
  // fingerprint instead of the payload itself while retaining deterministic
  // lookup after a reload.
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < identity.length; index += 1) {
    const code = identity.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ (code + index), 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

function createKeyStorageKey() {
  const scope = createStorageScope()
  return scope ? `${CREATE_KEY_STORAGE_PREFIX}:${scope}` : null
}

function loadPersistedCreateKeys() {
  try {
    const storageKey = createKeyStorageKey()
    if (!storageKey) return {}
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(([identityHash, key]) => (
        /^[0-9a-f]{16}$/.test(identityHash)
        && typeof key === 'string'
        && DELIVERY_KEY_PATTERN.test(key)
      )),
    )
  } catch {
    return {}
  }
}

function persistedCreateKey(identity: string) {
  return loadPersistedCreateKeys()[createIdentityHash(identity)]
}

function savePersistedCreateKey(identity: string, key: string) {
  try {
    const storageKey = createKeyStorageKey()
    if (!storageKey) return
    const keys = loadPersistedCreateKeys()
    keys[createIdentityHash(identity)] = key
    sessionStorage.setItem(storageKey, JSON.stringify(keys))
  } catch {
    // Session storage is a retry aid; the request itself remains valid without it.
  }
}

function clearPersistedCreateKey(identity: string, expectedKey?: string) {
  try {
    const storageKey = createKeyStorageKey()
    if (!storageKey) return
    const keys = loadPersistedCreateKeys()
    if (expectedKey && keys[createIdentityHash(identity)] !== expectedKey) return
    delete keys[createIdentityHash(identity)]
    sessionStorage.setItem(storageKey, JSON.stringify(keys))
  } catch {
    // Ignore storage failures after the server has reconciled the invoice.
  }
}

type CreateRecovery = {
  identity: string
  key: string
  scope: string
  submission: PendingSubmission
  /** Set after Field has accepted create; retained through initial fulfilment. */
  invoiceId?: string
}

class CreateScopeChangedError extends Error {
  constructor() {
    super('cancellation-fee create scope changed while the request was in flight')
    this.name = 'CreateScopeChangedError'
  }
}

function createRecoveryStorageKey(scope = createStorageScope()) {
  return scope ? `${CREATE_RECOVERY_STORAGE_PREFIX}:${scope}` : null
}

function isPendingSubmission(value: unknown): value is PendingSubmission {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const billTo = candidate.billTo
  if (!billTo || typeof billTo !== 'object' || Array.isArray(billTo)) return false
  const recipient = billTo as Record<string, unknown>
  return typeof recipient.name === 'string'
    && (recipient.phone === undefined || typeof recipient.phone === 'string')
    && (recipient.email === undefined || typeof recipient.email === 'string')
    && typeof candidate.recipientName === 'string'
    && (candidate.clientEmail === undefined || typeof candidate.clientEmail === 'string')
    && (candidate.clientPhone === undefined || typeof candidate.clientPhone === 'string')
    && typeof candidate.dueDate === 'string'
    && typeof candidate.taxAmount === 'number'
    && Number.isFinite(candidate.taxAmount)
    && typeof candidate.notes === 'string'
    && typeof candidate.description === 'string'
    && typeof candidate.amount === 'number'
    && Number.isFinite(candidate.amount)
    && typeof candidate.sendEmail === 'boolean'
    && typeof candidate.sendSms === 'boolean'
}

function loadPersistedCreateRecovery(): CreateRecovery | null {
  try {
    const storageKey = createRecoveryStorageKey()
    if (!storageKey) return null
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const candidate = parsed as Record<string, unknown>
    if (typeof candidate.identity !== 'string'
      || typeof candidate.key !== 'string'
      || !DELIVERY_KEY_PATTERN.test(candidate.key)
      || typeof candidate.scope !== 'string'
      || candidate.scope !== createStorageScope()
      || !isPendingSubmission(candidate.submission)) {
      return null
    }
    return {
      identity: candidate.identity,
      key: candidate.key,
      scope: candidate.scope,
      submission: candidate.submission,
      ...(typeof candidate.invoiceId === 'string' && candidate.invoiceId
        ? { invoiceId: candidate.invoiceId }
        : {}),
    }
  } catch {
    return null
  }
}

/**
 * Keep the complete frozen request until create and its initial delivery are
 * reconciled. It is scoped to the authenticated tenant and user so a later
 * sign-in cannot see or replay another user's recipient snapshot.
 */
function savePersistedCreateRecovery(recovery: CreateRecovery) {
  const storageKey = createRecoveryStorageKey(recovery.scope)
  if (!storageKey) return false
  try {
    const serialized = JSON.stringify(recovery)
    sessionStorage.setItem(storageKey, serialized)
    return sessionStorage.getItem(storageKey) === serialized
  } catch {
    return false
  }
}

/** Update an in-flight record only while it still belongs to this operation. */
function updatePersistedCreateRecovery(recovery: CreateRecovery) {
  const storageKey = createRecoveryStorageKey(recovery.scope)
  if (!storageKey) return false
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return false
    const current = JSON.parse(raw) as Partial<CreateRecovery>
    if (current.scope !== recovery.scope
      || current.identity !== recovery.identity
      || current.key !== recovery.key) return false
    return savePersistedCreateRecovery(recovery)
  } catch {
    return false
  }
}

function clearPersistedCreateRecovery(recovery: CreateRecovery) {
  try {
    const storageKey = createRecoveryStorageKey(recovery.scope)
    if (!storageKey) return
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return
    const current = JSON.parse(raw) as Partial<CreateRecovery>
    if (current.identity === recovery.identity && current.key === recovery.key) {
      sessionStorage.removeItem(storageKey)
    }
  } catch {
    // Ignore storage failures after Field has resolved the create operation.
  }
}

/** Detail-page recovery must retire the create key once the invoice is complete. */
function clearPersistedCreateRecoveryForInvoice(invoiceId: string) {
  try {
    const storageKey = createRecoveryStorageKey()
    if (!storageKey) return
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return
    const current = JSON.parse(raw) as Partial<CreateRecovery>
    if (current.invoiceId !== invoiceId
      || typeof current.identity !== 'string'
      || typeof current.key !== 'string') return
    sessionStorage.removeItem(storageKey)
    clearPersistedCreateKey(current.identity, current.key)
  } catch {
    // Leave the recovery in place when storage is unavailable; it is safer to
    // replay the known operation than to mint a second invoice.
  }
}

/** Keep a resend tied to this invoice when the detail page is remounted. */
function persistedDeliveryKey(invoiceId: string) {
  const storageKey = `courseboard:cancellation-fee:delivery:${fieldTenant()}:${invoiceId}`
  try {
    const existing = sessionStorage.getItem(storageKey)
    if (existing && DELIVERY_KEY_PATTERN.test(existing)) return existing
    const generated = newCancellationFeeIdempotencyKey()
    sessionStorage.setItem(storageKey, generated)
    return generated
  } catch {
    // Storage can be unavailable in a private or embedded browser context.
    // The in-memory key still protects repeated clicks for this page visit.
    return newCancellationFeeIdempotencyKey()
  }
}

/** A completed send response gets a fresh key for the next intentional retry. */
function rotatePersistedDeliveryKey(invoiceId: string) {
  const storageKey = `courseboard:cancellation-fee:delivery:${fieldTenant()}:${invoiceId}`
  const generated = newCancellationFeeIdempotencyKey()
  try {
    sessionStorage.setItem(storageKey, generated)
  } catch {
    // The in-memory ref still carries the rotated key when storage is blocked.
  }
  return generated
}

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

const statusVariants: Record<InvoiceStatus, 'neutral' | 'accent' | 'warning' | 'success' | 'destructive'> = {
  Draft: 'neutral',
  Sent: 'accent',
  SendFailed: 'destructive',
  Paid: 'success',
  Overdue: 'warning',
}

/** The dedicated Field list is already scoped to cancellation-fee invoices. */

export function CancellationFeesPage() {
  const { t } = useTranslation(['cancellationFees', 'common'])
  const timezone = useTenantTimezone()
  const businessDate = today(timezone)
  const [status, setStatus] = useState<'all' | InvoiceStatus>('all')
  const loader = useCallback(async () => {
    // Do not pass the saved status filter to Field. A Sent invoice can be
    // overdue according to the tenant's business date even while Field still
    // stores it as Sent, so filtering happens after deriving the display state.
    const pageSize = 100
    const invoices: InvoiceData[] = []
    for (let offset = 0; ; offset += pageSize) {
      const response = await listCancellationFees<{ items: InvoiceData[] }>({
        limit: pageSize,
        offset,
      })
      invoices.push(...response.items)
      if (response.items.length < pageSize) break
    }
    return invoices
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
 * What the confirmation step is holding: everything the send will use, read
 * off the form once so the operator confirms the same values that go upstream.
 */
type PendingSubmission = {
  billTo: { name: string; phone?: string; email?: string }
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
}

export function NewCancellationFeePage() {
  const { t } = useTranslation(['cancellationFees', 'common'])
  const timezone = useTenantTimezone()
  const storageScope = createStorageScope()
  const initialStorageScopeRef = useRef<string | null | undefined>(undefined)
  const renderedScopeRef = useRef<string | null | undefined>(undefined)
  const scopeGenerationRef = useRef(0)
  const recoveredCreateRef = useRef<CreateRecovery | null | undefined>(undefined)
  if (renderedScopeRef.current === undefined) {
    renderedScopeRef.current = storageScope
  } else if (renderedScopeRef.current !== storageScope) {
    renderedScopeRef.current = storageScope
    scopeGenerationRef.current += 1
  }
  if (initialStorageScopeRef.current === undefined) {
    initialStorageScopeRef.current = storageScope
    recoveredCreateRef.current = loadPersistedCreateRecovery()
  }
  const recoveredCreate = recoveredCreateRef.current ?? null
  // One stable UUID per form visit makes a timeout retry safe. Field rejects
  // arbitrary identifiers, and this value is the only create idempotency key
  // sent to the dedicated endpoint.
  const requestKey = useRef(recoveredCreate?.key ?? newCancellationFeeIdempotencyKey())
  const requestIdentity = useRef<string | null>(recoveredCreate?.identity ?? null)
  const resendKey = useRef<string | null>(null)
  const [year, month, day] = today(timezone).split('-').map(Number)
  const due = new Date(Date.UTC(year!, month! - 1, day! + 7)).toISOString().slice(0, 10)
  const [sendEmail, setSendEmail] = useState(true)
  const [sendSms, setSendSms] = useState(false)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [amount, setAmount] = useState(5000)
  const [taxAmount, setTaxAmount] = useState(0)
  const [dueDate, setDueDate] = useState(due)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createRecovery, setCreateRecovery] = useState<CreateRecovery | null>(recoveredCreate)
  const [pending, setPending] = useState<PendingSubmission | null>(recoveredCreate?.submission ?? null)
  const [created, setCreated] = useState<InvoiceData | null>(null)
  const [sent, setSent] = useState<PendingSubmission | null>(null)
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  const [resending, setResending] = useState(false)
  const [initialDeliveryUncertain, setInitialDeliveryUncertain] = useState(false)
  const activeCreateRecovery = createRecovery?.scope === storageScope ? createRecovery : null
  const recoveryScopeMismatch = createRecovery !== null && createRecovery.scope !== storageScope

  function isCurrentCreateScope(scope: string, generation: number) {
    return createStorageScope() === scope && scopeGenerationRef.current === generation
  }

  useEffect(() => {
    if (initialStorageScopeRef.current === storageScope) return
    initialStorageScopeRef.current = storageScope
    const recovered = loadPersistedCreateRecovery()
    requestIdentity.current = recovered?.identity ?? null
    requestKey.current = recovered?.key ?? newCancellationFeeIdempotencyKey()
    setCreateRecovery(recovered)
    setPending(recovered?.submission ?? null)
    setCreated(null)
    setSent(null)
    setDeliveryError(null)
    setInitialDeliveryUncertain(false)
    setSubmitting(false)
    setResending(false)
    setError(null)
  }, [storageScope])

  /**
   * Read the form, check it, and hand it to the confirmation step.
   *
   * Nothing is sent here. The dedicated API accepts an unregistered recipient
   * snapshot only; ledger and reservation linking require a separate audited
   * action and never belong in this request.
   */
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (createRecovery) {
      setPending(createRecovery.submission)
      return
    }
    const form = new FormData(event.currentTarget)
    setError(null)
    setDeliveryError(null)
    setInitialDeliveryUncertain(false)
    if (sendSms && form.get('smsConsent') !== 'on') {
      setError(t('cancellationFees:new.validation.consent'))
      return
    }
    const reference = String(form.get('reference') ?? '').trim()
    const clientName = (customer?.name ?? customerName).trim()
    const clientEmail = String(form.get('clientEmail') ?? '').trim()
    const reason = String(form.get('reason') ?? '').trim()
    const notes = String(form.get('notes') ?? '').trim()
    const typedPhone = String(form.get('clientPhone') ?? '').trim()
    const customerPhone = normalizePhone(typedPhone)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('cancellationFees:new.validation.amount'))
      return
    }
    if (typedPhone && !customerPhone) {
      setError(t('cancellationFees:new.validation.phone'))
      return
    }
    if (sendSms && !customerPhone) {
      setError(t('cancellationFees:new.validation.phone'))
      return
    }
    if (!clientName) {
      setError(t('cancellationFees:new.validation.billTo'))
      return
    }

    setPending({
      billTo: {
        name: clientName,
        ...(customerPhone ? { phone: customerPhone } : {}),
        ...(clientEmail ? { email: clientEmail } : {}),
      },
      recipientName: clientName,
      clientEmail: clientEmail || undefined,
      clientPhone: customerPhone || undefined,
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
    })
  }

  async function send(submission: PendingSubmission) {
    setSubmitting(true)
    setError(null)
    setDeliveryError(null)
    setInitialDeliveryUncertain(false)
    const currentScope = createStorageScope()
    const currentScopeGeneration = scopeGenerationRef.current
    if (createRecovery && createRecovery.scope !== currentScope) {
      setError(t('cancellationFees:new.error.scopeChanged'))
      setSubmitting(false)
      return
    }
    const frozenSubmission = createRecovery?.submission ?? submission
    const identity = createRecovery?.identity ?? JSON.stringify(frozenSubmission)
    let recovery: CreateRecovery = {
      identity,
      key: requestKey.current,
      scope: currentScope ?? '',
      submission: frozenSubmission,
      ...(createRecovery?.invoiceId ? { invoiceId: createRecovery.invoiceId } : {}),
    }
    try {
      if (createRecovery) {
        requestIdentity.current = createRecovery.identity
        requestKey.current = createRecovery.key
      } else if (requestIdentity.current !== identity) {
        requestKey.current = persistedCreateKey(identity)
          ?? (requestIdentity.current === null
            ? requestKey.current
            : newCancellationFeeIdempotencyKey())
        requestIdentity.current = identity
      }
      recovery = {
        ...recovery,
        key: requestKey.current,
      }
      // A lost response is recoverable only if the complete request was
      // durably saved before dispatch. Refuse the mutation when storage is
      // unavailable instead of promising a retry that would change the key.
      if (!savePersistedCreateRecovery(recovery)) {
        setPending(frozenSubmission)
        setError(t('cancellationFees:new.error.persistence'))
        return
      }
      setCreateRecovery(recovery)
      // Save before the network call. If the response is lost after Field
      // accepts the invoice, a remounted form can replay the same operation.
      savePersistedCreateKey(identity, recovery.key)

      // A recovered create is replayed with the same frozen body and key. Field
      // returns the current invoice (including Paid) so we can decide whether
      // the initial operation still needs reconciliation without a List call.
      const invoice = await createCancellationFee<InvoiceData>({
        idempotencyKey: recovery.key,
        billTo: frozenSubmission.billTo,
        lineItems: [{
          description: frozenSubmission.description,
          quantity: 1,
          unitPrice: frozenSubmission.amount,
        }],
        dueDate: frozenSubmission.dueDate,
        currency: 'JPY',
        taxCategory: 'out_of_scope',
        taxAmount: frozenSubmission.taxAmount,
        notes: frozenSubmission.notes,
        createPaymentLink: true,
        sendEmail: frozenSubmission.sendEmail,
        sendSms: frozenSubmission.sendSms,
      })
      if (!isCurrentCreateScope(recovery.scope, currentScopeGeneration)) {
        throw new CreateScopeChangedError()
      }
      const invoiceRecovery: CreateRecovery = { ...recovery, invoiceId: invoice.id }
      // The create has succeeded, so keep the frozen body and invoice ID until
      // the initial fulfilment is definitely complete. A remount during an
      // uncertain fulfilment must replay fulfil, never mint a new invoice.
      if (!updatePersistedCreateRecovery(invoiceRecovery)) return
      recovery = invoiceRecovery
      setCreateRecovery(recovery)
      setPending(null)
      setCreated(invoice)
      setSent(frozenSubmission)
      try {
        // A replay can return an invoice that was already delivered. Reuse the
        // initial operation for a draft or an unpaid partial/failed result, but
        // do not call it again for a completed Sent/Overdue replay (and never
        // attempt to mutate a paid invoice).
        const shouldFulfill = needsInitialFulfillment(invoice, {
          sendEmail: frozenSubmission.sendEmail,
          sendSms: frozenSubmission.sendSms,
        })
        const fulfilled = shouldFulfill
          ? await runInitialFulfillment(invoice.id, recovery.scope, currentScopeGeneration)
          : invoice
        if (!isCurrentCreateScope(recovery.scope, currentScopeGeneration)) {
          throw new CreateScopeChangedError()
        }
        setCreated(fulfilled)
        const incomplete = fulfillmentIssue(fulfilled, {
          sendEmail: frozenSubmission.sendEmail,
          sendSms: frozenSubmission.sendSms,
        })
        if (incomplete) {
          setDeliveryError(incomplete)
        } else {
          clearPersistedCreateRecovery(recovery)
          clearPersistedCreateKey(identity, recovery.key)
          setCreateRecovery(null)
          navigate(`cancellation-fees/${fulfilled.id}`)
        }
      } catch (reason) {
        if (reason instanceof CreateScopeChangedError
          || !isCurrentCreateScope(recovery.scope, currentScopeGeneration)) {
          updatePersistedCreateRecovery(recovery)
          return
        }
        setDeliveryError(reason instanceof Error
          ? reason.message
          : t('cancellationFees:new.error.delivery'))
      }
    } catch (reason) {
      if (reason instanceof CreateScopeChangedError
        || !isCurrentCreateScope(recovery.scope, currentScopeGeneration)) {
        const scopeRecovery = recovery
        updatePersistedCreateRecovery(scopeRecovery)
        return
      }
      // A recovered invoice already exists. A fulfilment error must retain its
      // invoice ID and frozen body; clearing it here would make a remount POST
      // a second invoice.
      if (recovery.invoiceId) {
        if (!updatePersistedCreateRecovery(recovery)) return
        if (isCurrentCreateScope(recovery.scope, currentScopeGeneration)) {
          setCreateRecovery(recovery)
          setPending(frozenSubmission)
          setError(reason instanceof Error ? reason.message : t('cancellationFees:new.error.delivery'))
        }
        return
      }
      const definitiveFailure = reason instanceof ApiError
        && reason.status >= 400
        && reason.status < 500
        && reason.status !== 408
        && reason.status !== 409
        && reason.status !== 429
      if (definitiveFailure) {
        // A previous uncertain dispatch may already have created the invoice
        // even when its replay now fails with an auth or validation response.
        // Keep that operation recoverable until it is positively reconciled;
        // only the first dispatch may clear a definitive client failure.
        if (createRecovery) {
          updatePersistedCreateRecovery(recovery)
          setCreateRecovery(recovery)
          setPending(frozenSubmission)
          setError(reason instanceof Error ? reason.message : t('cancellationFees:new.error.create'))
          return
        }
        clearPersistedCreateRecovery({
          identity,
          key: recovery.key,
          scope: currentScope ?? '',
          submission: frozenSubmission,
        })
        clearPersistedCreateKey(identity, recovery.key)
        setCreateRecovery(null)
        setPending(null)
      } else {
        // The server may have accepted the invoice before the connection
        // failed. Keep the exact operation and body for the next retry,
        // including after a page reload; never mint a second payable invoice.
        const retryRecovery: CreateRecovery = {
          identity,
          key: recovery.key,
          scope: currentScope ?? '',
          submission: frozenSubmission,
        }
        if (!updatePersistedCreateRecovery(retryRecovery)) return
        setCreateRecovery(retryRecovery)
        setPending(frozenSubmission)
      }
      setError(reason instanceof Error ? reason.message : t('cancellationFees:new.error.create'))
    } finally {
      if (isCurrentCreateScope(recovery.scope, currentScopeGeneration)) setSubmitting(false)
    }
  }

  async function runInitialFulfillment(
    invoiceId: string,
    expectedScope?: string,
    expectedGeneration = scopeGenerationRef.current,
  ) {
    if (expectedScope && !isCurrentCreateScope(expectedScope, expectedGeneration)) {
      throw new CreateScopeChangedError()
    }
    try {
      const fulfilled = await fulfillCancellationFee<InvoiceData>(invoiceId)
      if (expectedScope && !isCurrentCreateScope(expectedScope, expectedGeneration)) {
        throw new CreateScopeChangedError()
      }
      setInitialDeliveryUncertain(false)
      return fulfilled
    } catch (reason) {
      if (reason instanceof CreateScopeChangedError) throw reason
      if (expectedScope && !isCurrentCreateScope(expectedScope, expectedGeneration)) {
        throw new CreateScopeChangedError()
      }
      // Any non-response can leave the durable initial claim active. Keep the
      // retry on the same initial operation until Field gives a definitive
      // response; /send would use a new key and can race it.
      setInitialDeliveryUncertain(true)
      throw reason
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
    if (!created || !sent || initialDeliveryUncertain) return
    setResending(true)
    const requestScope = createStorageScope()
    const requestGeneration = scopeGenerationRef.current
    try {
      const fulfilled = await sendCancellationFee<InvoiceData>(created.id, {
        idempotencyKey: resendKey.current ?? (resendKey.current = persistedDeliveryKey(created.id)),
        sendEmail: sent.sendEmail,
        sendSms: sent.sendSms,
      })
      if (requestScope && !isCurrentCreateScope(requestScope, requestGeneration)) return
      setCreated(fulfilled)
      const incomplete = fulfillmentIssue(fulfilled, {
        sendEmail: sent.sendEmail,
        sendSms: sent.sendSms,
      })
      setDeliveryError(incomplete ?? null)
      if (!incomplete) {
        if (activeCreateRecovery) {
          clearPersistedCreateRecovery(activeCreateRecovery)
          setCreateRecovery(null)
        }
        clearPersistedCreateKey(JSON.stringify(sent), activeCreateRecovery?.key)
        resendKey.current = rotatePersistedDeliveryKey(created.id)
        navigate(`cancellation-fees/${fulfilled.id}`)
      }
    } catch (reason) {
      if (requestScope && !isCurrentCreateScope(requestScope, requestGeneration)) return
      setDeliveryError(reason instanceof Error
        ? reason.message
        : t('cancellationFees:new.error.delivery'))
    } finally {
      if (!requestScope || isCurrentCreateScope(requestScope, requestGeneration)) setResending(false)
    }
  }

  async function retryInitialDelivery() {
    if (!created || !sent || !initialDeliveryUncertain) return
    setResending(true)
    const requestScope = createStorageScope()
    const requestGeneration = scopeGenerationRef.current
    try {
      const fulfilled = await runInitialFulfillment(created.id, requestScope ?? undefined, requestGeneration)
      if (requestScope && !isCurrentCreateScope(requestScope, requestGeneration)) return
      setCreated(fulfilled)
      const incomplete = fulfillmentIssue(fulfilled, {
        sendEmail: sent.sendEmail,
        sendSms: sent.sendSms,
      })
      setDeliveryError(incomplete ?? null)
      if (!incomplete) {
        if (activeCreateRecovery) {
          clearPersistedCreateRecovery(activeCreateRecovery)
          setCreateRecovery(null)
        }
        clearPersistedCreateKey(JSON.stringify(sent), activeCreateRecovery?.key)
        navigate(`cancellation-fees/${fulfilled.id}`)
      }
    } catch (reason) {
      if (requestScope && !isCurrentCreateScope(requestScope, requestGeneration)) return
      setDeliveryError(reason instanceof Error
        ? reason.message
        : t('cancellationFees:new.error.delivery'))
    } finally {
      if (!requestScope || isCurrentCreateScope(requestScope, requestGeneration)) setResending(false)
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
      {activeCreateRecovery && !created ? (
        <Notice tone="warning" title={t('cancellationFees:new.recovery.title')}>
          {activeCreateRecovery.invoiceId
            ? t('cancellationFees:new.recovery.deliveryDescription')
            : t('cancellationFees:new.recovery.description')}
          <div className="notice-inline-action">
            <Button type="button" size="sm" onClick={() => setPending(activeCreateRecovery.submission)}>
              {t('cancellationFees:new.recovery.retry')}
            </Button>
          </div>
        </Notice>
      ) : null}
      {created && deliveryError ? (
        <Notice tone="warning" title={t('cancellationFees:new.partial.title')}>
          {initialDeliveryUncertain
            ? t('cancellationFees:new.partial.initialDescription', { message: deliveryError })
            : t('cancellationFees:new.partial.description', { message: deliveryError })}
          <div className="notice-inline-action">
            <Button
              type="button"
              size="sm"
              disabled={resending}
              onClick={() => void (initialDeliveryUncertain
                ? retryInitialDelivery()
                : resendDelivery())}
            >
              {resending
                ? t('cancellationFees:new.partial.resending')
                : initialDeliveryUncertain
                  ? t('cancellationFees:new.partial.initialRetry')
                  : t('cancellationFees:new.partial.resend')}
            </Button>
            <Button type="button" size="sm" onClick={() => navigate(`cancellation-fees/${created.id}`)}>
              {t('cancellationFees:new.partial.openDetail')}
            </Button>
          </div>
        </Notice>
      ) : null}

      <form className="collection-editor" hidden={recoveryScopeMismatch} onSubmit={review}>
        <fieldset className="collection-editor-fields" disabled={createRecovery !== null}>
        <Panel
          title={t('cancellationFees:new.detail.title')}
          description={t('cancellationFees:new.detail.description')}
        >
          <FormGrid>
            <Field label={t('cancellationFees:new.detail.reference')}>
              <Input
                name="reference"
                placeholder="RSV-1001 / ORD-1001"
              />
            </Field>
            <Field label={t('cancellationFees:new.detail.amount')} required>
              <Input name="amount" type="number" min={1} required value={amount} onChange={event => setAmount(Number(event.target.value))} />
            </Field>
            <Field label={t('cancellationFees:new.detail.tax')}>
              <Input
                name="taxAmount"
                type="number"
                min={0}
                value={taxAmount}
                onChange={event => setTaxAmount(Number(event.target.value))}
              />
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
            <Field
              label={t('cancellationFees:new.client.name')}
              hint={t('cancellationFees:new.client.nameHint')}
              required
            >
              <CustomerPicker
                name={customerName}
                customerId={customer?.id ?? null}
                required
                disabled={createRecovery !== null}
                allowRegister={false}
                onNameChange={name => {
                  setCustomerName(name)
                  if (customer && name !== customer.name) setCustomer(null)
                }}
                onSelect={picked => {
                  setCustomer(picked)
                  if (picked) setCustomerName(picked.name)
                }}
              />
            </Field>
            <Field label={t('cancellationFees:new.client.due')} required>
              <Input
                name="dueDate"
                type="date"
                required
                value={dueDate}
                onChange={event => setDueDate(event.target.value)}
              />
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
                placeholder="guest@example.com"
                key={customer?.id ?? 'blank'}
                defaultValue={customer?.email ?? ''}
              />
            </Field>
            <Field
              label={t('cancellationFees:new.delivery.smsTo')}
              required={sendSms}
              hint={t('cancellationFees:new.delivery.smsToHint')}
            >
              {/* Kept usable without SMS for an unregistered recipient: the
                  number is how the club will reach them later, so it belongs on
                  the invoice whether or not the notice goes out by SMS. */}
              <Input
                name="clientPhone"
                type="tel"
                required={sendSms}
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
              <p className="field-hint">{t('cancellationFees:new.delivery.smsBodyHint')}</p>
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
        </fieldset>
      </form>

      <Sheet
        open={pending !== null && !recoveryScopeMismatch}
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
            </dl>
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
 * An email added after creation is an explicit resend destination even when
 * the original invoice never requested email delivery and therefore still
 * has a null delivery status. The bill-to snapshot is intentionally excluded:
 * it may contain an email the operator chose not to send to at creation time.
 */
export function shouldResendEmail(
  invoice: Pick<InvoiceData, 'emailDeliveryStatus' | 'clientEmail'>,
) {
  return (
    (invoice.emailDeliveryStatus !== null && invoice.emailDeliveryStatus !== undefined)
    || Boolean(invoice.clientEmail?.trim())
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
  const loader = useCallback(() => getCancellationFee<InvoiceData>(invoiceId), [invoiceId])
  const resource = useResource(loader, [invoiceId])
  useRegisterPageReload(resource.refresh)
  const [fulfilling, setFulfilling] = useState(false)
  const resendKey = useRef<string | null>(null)
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
      const sendEmail = shouldResendEmail(resource.data)
      const sendSms = resource.data.smsDeliveryStatus !== null
        && resource.data.smsDeliveryStatus !== undefined
      const initialFulfillment = needsInitialFulfillment(resource.data, {
        sendEmail,
        sendSms,
      })
      const explicitResend = !initialFulfillment && (sendEmail || sendSms)
      const fulfilled = initialFulfillment
        ? await fulfillCancellationFee<InvoiceData>(invoiceId)
        : sendEmail || sendSms
          ? await sendCancellationFee<InvoiceData>(invoiceId, {
            idempotencyKey: resendKey.current ?? (resendKey.current = persistedDeliveryKey(invoiceId)),
            sendEmail,
            sendSms,
          })
          : resource.data
      // Apply the authoritative mutation response before the action is enabled
      // again. A revalidation may be in flight, so a second click must use the
      // completed invoice and select /send rather than repeating /fulfill.
      resource.setData(fulfilled)
      const issue = fulfillmentIssue(fulfilled, {
        sendEmail,
        sendSms,
      })
      if (!issue) clearPersistedCreateRecoveryForInvoice(invoiceId)
      // Keep the same resend claim while Field has returned a partial or
      // failed result. Rotate only after a complete response so a retry of an
      // incomplete delivery cannot race a still-active provider operation.
      if (explicitResend && !issue) {
        resendKey.current = rotatePersistedDeliveryKey(invoiceId)
      }
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
        onUpdated={updated => resource.setData(updated)}
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
  onUpdated,
  onRefresh,
  onNotice,
}: {
  invoice: InvoiceData
  onUpdated(invoice: InvoiceData): void
  onRefresh(): void
  onNotice(notice: { tone: 'success' | 'danger'; message: string }): void
}) {
  const { t } = useTranslation(['cancellationFees', 'common'])
  const [notes, setNotes] = useState(invoice.notes ?? '')
  const [clientEmail, setClientEmail] = useState(invoice.clientEmail ?? '')
  const [saving, setSaving] = useState(false)
  const isPaid = !isInvoiceUpdateAllowed(invoice)

  async function updateInvoice() {
    if (isPaid) return
    setSaving(true)
    try {
      const email = clientEmail.trim()
      if (!email && invoice.clientEmail?.trim()) {
        onNotice({ tone: 'danger', message: t('cancellationFees:detail.update.emailRequired') })
        return
      }
      const updated = await updateCancellationFee<InvoiceData>(invoice.id, {
        notes,
        ...(email ? { clientEmail: email } : {}),
      })
      // Apply the authoritative PATCH response before starting the background
      // refresh. This makes a newly added email available to the resend action
      // immediately, even while the follow-up GET is in flight.
      onUpdated(updated)
      onNotice({ tone: 'success', message: t('cancellationFees:detail.notice.statusUpdated') })
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
        <Field label={t('cancellationFees:detail.update.email')}>
          <Input
            type="email"
            value={clientEmail}
            disabled={isPaid}
            onChange={event => setClientEmail(event.target.value)}
          />
        </Field>
      </FormGrid>
      <Field label={t('cancellationFees:detail.update.notes')}>
        <NativeTextarea
          rows={4}
          value={notes}
          disabled={isPaid}
          onChange={event => setNotes(event.target.value)}
        />
      </Field>
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
  // Payment is already an accounting fact. A paid invoice is terminal even if
  // an older response has stale delivery/link fields; never block recovery or
  // attempt another notification from those fields.
  if (invoice.status === 'Paid') return undefined
  if (invoice.paymentLinkStatus !== 'Ready' || !invoice.paymentLinkUrl) {
    return i18next.t('cancellationFees:new.error.noPaymentLink')
  }
  if (!delivery.sendEmail && !delivery.sendSms) return undefined
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
  const deliveredStatus = invoice.status === 'Sent'
    || invoice.status === 'Overdue'
  if (!deliveredStatus || !selectedDeliveriesSent) {
    return i18next.t('cancellationFees:new.error.deliveryPartial')
  }
  return undefined
}

/**
 * Decide whether the create response still needs the initial delivery action.
 * Field keeps unpaid Sent/SendFailed invoices retryable, so a partial or
 * uncertain response must go through the same initial claim again. A completed
 * Sent/Overdue response can be shown directly, while Paid is terminal.
 */
function needsInitialFulfillment(
  invoice: Pick<InvoiceData,
    'status' | 'paymentLinkStatus' | 'paymentLinkUrl' | 'emailDeliveryStatus' | 'smsDeliveryStatus'>,
  delivery: { sendEmail: boolean; sendSms: boolean },
) {
  if (invoice.status === 'Paid') return false
  const paymentLinkReady = invoice.paymentLinkStatus === 'Ready' && Boolean(invoice.paymentLinkUrl)
  if (paymentLinkReady && !delivery.sendEmail && !delivery.sendSms) return false
  const selectedDeliveriesSent =
    (!delivery.sendEmail || invoice.emailDeliveryStatus === 'Sent')
    && (!delivery.sendSms || invoice.smsDeliveryStatus === 'Sent')
  if (paymentLinkReady && selectedDeliveriesSent
    && (invoice.status === 'Sent' || invoice.status === 'Overdue')) {
    return false
  }
  return true
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

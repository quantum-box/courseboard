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
import { CapabilityGate } from '../../auth/CapabilityGate'
import { useEffectiveCapabilities } from '../../auth/EffectiveCapabilitiesProvider'
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

type InvoiceStatus = 'Draft' | 'Sent' | 'SendFailed' | 'Paid' | 'Overdue' | 'Void'

const DELIVERY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CREATE_KEY_STORAGE_PREFIX = 'courseboard:cancellation-fee:create-keys'
const CREATE_RECOVERY_STORAGE_PREFIX = 'courseboard:cancellation-fee:create-recovery'
const DELIVERY_OPERATION_STORAGE_PREFIX = 'courseboard:cancellation-fee:delivery-operations'

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
  /** Initial fulfilment returned a definite result; later retries use /send. */
  initialDeliverySettled?: boolean
  /** A recipient PATCH whose response was not yet confirmed. */
  recipientPatch?: { email: string }
  /** An explicit /send operation; keep its key and channels across reloads. */
  deliveryRetry?: { key: string; sendEmail: boolean; sendSms: boolean }
}

type DeliveryOperationType = 'fulfill' | 'send'

type DeliveryOperation = {
  scope: string
  invoiceId: string
  type: DeliveryOperationType
  key: string
  sendEmail: boolean
  sendSms: boolean
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

function isPersistedRecipientPatch(value: unknown): value is { email: string } {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { email?: unknown }).email === 'string'
    && Boolean((value as { email: string }).email.trim())
}

function isPersistedDeliveryRetry(
  value: unknown,
): value is { key: string; sendEmail: boolean; sendSms: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.key === 'string'
    && DELIVERY_KEY_PATTERN.test(candidate.key)
    && typeof candidate.sendEmail === 'boolean'
    && typeof candidate.sendSms === 'boolean'
    && (candidate.sendEmail || candidate.sendSms)
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
      ...(candidate.initialDeliverySettled === true
        ? { initialDeliverySettled: true }
        : {}),
      ...(isPersistedRecipientPatch(candidate.recipientPatch)
        ? { recipientPatch: { email: candidate.recipientPatch.email.trim() } }
        : {}),
      ...(isPersistedDeliveryRetry(candidate.deliveryRetry)
        ? { deliveryRetry: candidate.deliveryRetry }
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
function clearPersistedCreateRecoveryForInvoice(invoiceId: string, operation?: DeliveryOperation) {
  try {
    const storageKey = createRecoveryStorageKey()
    if (!storageKey) return
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return
    const current = JSON.parse(raw) as Partial<CreateRecovery>
    if (current.invoiceId !== invoiceId
      || typeof current.identity !== 'string'
      || typeof current.key !== 'string') return
    if (operation?.type === 'fulfill' && current.key !== operation.key) return
    if (operation?.type === 'send'
      && current.deliveryRetry
      && current.deliveryRetry.key !== operation.key) return
    sessionStorage.removeItem(storageKey)
    clearPersistedCreateKey(current.identity, current.key)
  } catch {
    // Leave the recovery in place when storage is unavailable; it is safer to
    // replay the known operation than to mint a second invoice.
  }
}

/** Retire one completed explicit delivery while keeping the invoice recovery. */
function clearPersistedDeliveryRetryForInvoice(invoiceId: string, operation?: DeliveryOperation) {
  try {
    const storageKey = createRecoveryStorageKey()
    if (!storageKey) return
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return
    const current = JSON.parse(raw) as Partial<CreateRecovery>
    if (current.invoiceId !== invoiceId || !current.deliveryRetry) return
    if (operation?.type === 'send' && current.deliveryRetry.key !== operation.key) return
    const recovery = { ...current }
    delete recovery.deliveryRetry
    recovery.initialDeliverySettled = true
    sessionStorage.setItem(storageKey, JSON.stringify(recovery))
  } catch {
    // Keep the durable claim when storage cannot be updated; the server-side
    // idempotency record still prevents a second delivery for this key.
  }
}

function deliveryOperationStorageKey(invoiceId: string, scope = createStorageScope()) {
  return scope
    ? `${DELIVERY_OPERATION_STORAGE_PREFIX}:${scope}:${encodeURIComponent(invoiceId)}`
    : null
}

function isDeliveryOperation(
  value: unknown,
  invoiceId: string,
  scope: string,
): value is DeliveryOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const type = candidate.type
  const channels = candidate.sendEmail === true || candidate.sendSms === true
  return candidate.scope === scope
    && candidate.invoiceId === invoiceId
    && (type === 'fulfill' || type === 'send')
    && typeof candidate.key === 'string'
    && DELIVERY_KEY_PATTERN.test(candidate.key)
    && typeof candidate.sendEmail === 'boolean'
    && typeof candidate.sendSms === 'boolean'
    && (type === 'fulfill' || channels)
}

function loadPersistedDeliveryOperation(invoiceId: string, scope = createStorageScope()) {
  if (!scope) return null
  try {
    const storageKey = deliveryOperationStorageKey(invoiceId, scope)
    if (!storageKey) return null
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isDeliveryOperation(parsed, invoiceId, scope) ? parsed : null
  } catch {
    return null
  }
}

/**
 * New-page recovery is the source of truth when an invoice is opened in the
 * detail route before its create/initial delivery operation is settled. The
 * explicit send key is reused verbatim; an unknown initial fulfilment keeps
 * the frozen create key as the operation identity even though `/fulfill` has
 * no request body idempotency field.
 */
function loadCreateRecoveryDeliveryOperation(invoiceId: string, scope = createStorageScope()) {
  if (!scope) return null
  const recovery = loadPersistedCreateRecovery()
  if (!recovery || recovery.scope !== scope || recovery.invoiceId !== invoiceId) return null
  if (recovery.deliveryRetry) {
    return {
      scope,
      invoiceId,
      type: 'send' as const,
      key: recovery.deliveryRetry.key,
      sendEmail: recovery.deliveryRetry.sendEmail,
      sendSms: recovery.deliveryRetry.sendSms,
    }
  }
  if (!recovery.initialDeliverySettled) {
    return {
      scope,
      invoiceId,
      type: 'fulfill' as const,
      key: recovery.key,
      sendEmail: recovery.submission.sendEmail,
      sendSms: recovery.submission.sendSms,
    }
  }
  return null
}

function loadDeliveryOperation(invoiceId: string, scope = createStorageScope()) {
  return loadPersistedDeliveryOperation(invoiceId, scope)
    ?? loadCreateRecoveryDeliveryOperation(invoiceId, scope)
}

function saveDeliveryOperation(operation: DeliveryOperation) {
  if (createStorageScope() !== operation.scope) return false
  try {
    const storageKey = deliveryOperationStorageKey(operation.invoiceId, operation.scope)
    if (!storageKey) return false
    const serialized = JSON.stringify(operation)
    sessionStorage.setItem(storageKey, serialized)
    return sessionStorage.getItem(storageKey) === serialized
  } catch {
    return false
  }
}

function clearDeliveryOperation(operation: DeliveryOperation) {
  if (createStorageScope() !== operation.scope) return
  try {
    const storageKey = deliveryOperationStorageKey(operation.invoiceId, operation.scope)
    if (!storageKey) return
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return
    const current: unknown = JSON.parse(raw)
    if (isDeliveryOperation(current, operation.invoiceId, operation.scope)
      && current.type === operation.type
      && current.key === operation.key) {
      sessionStorage.removeItem(storageKey)
    }
  } catch {
    // Retain the operation when storage is unavailable; a reload must retry
    // the same operation rather than minting a new delivery claim.
  }
}

function markCreateRecoveryDeliverySettled(invoiceId: string, operation?: DeliveryOperation) {
  const recovery = loadPersistedCreateRecovery()
  if (!recovery || recovery.invoiceId !== invoiceId) return
  if (operation?.type === 'fulfill' && recovery.key !== operation.key) return
  if (operation?.type === 'send'
    && recovery.deliveryRetry
    && recovery.deliveryRetry.key !== operation.key) return
  const settled = { ...recovery, initialDeliverySettled: true }
  delete settled.deliveryRetry
  updatePersistedCreateRecovery(settled)
}

/** Keep a resend tied to this invoice when the detail page is remounted. */
function persistedDeliveryKey(invoiceId: string) {
  const scope = createStorageScope()
  const storageKey = scope
    ? `courseboard:cancellation-fee:delivery:${scope}:${encodeURIComponent(invoiceId)}`
    : null
  try {
    const existing = storageKey ? sessionStorage.getItem(storageKey) : null
    if (existing && DELIVERY_KEY_PATTERN.test(existing)) return existing
    const generated = newCancellationFeeIdempotencyKey()
    if (storageKey) sessionStorage.setItem(storageKey, generated)
    return generated
  } catch {
    // Storage can be unavailable in a private or embedded browser context.
    // The in-memory key still protects repeated clicks for this page visit.
    return newCancellationFeeIdempotencyKey()
  }
}

/** A completed send response gets a fresh key for the next intentional retry. */
function rotatePersistedDeliveryKey(invoiceId: string) {
  const scope = createStorageScope()
  const storageKey = scope
    ? `courseboard:cancellation-fee:delivery:${scope}:${encodeURIComponent(invoiceId)}`
    : null
  const generated = newCancellationFeeIdempotencyKey()
  try {
    if (storageKey) sessionStorage.setItem(storageKey, generated)
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

const INVOICE_STATUSES: InvoiceStatus[] = ['Draft', 'Sent', 'SendFailed', 'Paid', 'Overdue', 'Void']

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
  if (invoice.status === 'Paid' || invoice.status === 'Overdue' || invoice.status === 'Void') return invoice.status

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
  return invoice.status !== 'Paid' && invoice.status !== 'Void'
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
  Void: 'neutral',
}

/** The dedicated Field list is already scoped to cancellation-fee invoices. */

export function CancellationFeesPage() {
  return (
    <CapabilityGate route="cancellation-fees">
      <CancellationFeesContent />
    </CapabilityGate>
  )
}

function CancellationFeesContent() {
  const { capabilities } = useEffectiveCapabilities()
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
        {capabilities.cancellationFees.manage ? <Button type="button" variant="primary" onClick={() => navigate('cancellation-fees/new')}>
          <Plus /> {t('cancellationFees:create')}
        </Button> : null}
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
  return (
    <CapabilityGate route="cancellation-fees/new">
      <NewCancellationFeeContent />
    </CapabilityGate>
  )
}

function NewCancellationFeeContent() {
  const { capabilities } = useEffectiveCapabilities()
  const canManage = capabilities.cancellationFees.manage
  const canList = capabilities.cancellationFees.list
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
  const resendKey = useRef<string | null>(recoveredCreate?.deliveryRetry?.key ?? null)
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
  const [recipientEmailDraft, setRecipientEmailDraft] = useState('')
  const [recipientPatchError, setRecipientPatchError] = useState<string | null>(null)
  const [patchingRecipient, setPatchingRecipient] = useState(false)
  const [recipientPatchConfirmed, setRecipientPatchConfirmed] = useState(false)
  const [recipientPatchUncertain, setRecipientPatchUncertain] = useState(false)
  const [recipientPatchRetryEmail, setRecipientPatchRetryEmail] = useState<string | null>(null)
  const [resendDeliveryUncertain, setResendDeliveryUncertain] = useState(false)
  const recipientInvoiceIdRef = useRef<string | null>(null)
  const activeCreateRecovery = createRecovery?.scope === storageScope ? createRecovery : null
  const recoveryScopeMismatch = createRecovery !== null && createRecovery.scope !== storageScope
  const sharedDeliveryInvoiceId = created?.id ?? activeCreateRecovery?.invoiceId
  const activeDeliveryOperation = sharedDeliveryInvoiceId
    ? loadDeliveryOperation(sharedDeliveryInvoiceId, storageScope)
    : null

  useEffect(() => {
    const nextInvoiceId = created?.id ?? null
    const previousInvoiceId = recipientInvoiceIdRef.current
    if (previousInvoiceId !== nextInvoiceId) {
      recipientInvoiceIdRef.current = nextInvoiceId
      // A first created invoice starts unconfirmed by default. Do not clear a
      // confirmation established by a recovered PATCH in the same commit;
      // clear only when an already displayed invoice is replaced.
      if (previousInvoiceId !== null && nextInvoiceId !== null) {
        setRecipientPatchConfirmed(false)
      }
    }
    if (created && isInvalidEmailDestinationFailure(created)) {
      setRecipientEmailDraft(recipientEmail(created) ?? '')
      setRecipientPatchError(null)
    }
  }, [created])

  function isCurrentCreateScope(scope: string, generation: number) {
    return createStorageScope() === scope && scopeGenerationRef.current === generation
  }

  useEffect(() => {
    if (initialStorageScopeRef.current === storageScope) return
    initialStorageScopeRef.current = storageScope
    const recovered = loadPersistedCreateRecovery()
    requestIdentity.current = recovered?.identity ?? null
    requestKey.current = recovered?.key ?? newCancellationFeeIdempotencyKey()
    resendKey.current = recovered?.deliveryRetry?.key ?? null
    setCreateRecovery(recovered)
    setPending(recovered?.submission ?? null)
    setCreated(null)
    setSent(null)
    setDeliveryError(null)
    setInitialDeliveryUncertain(false)
    setRecipientEmailDraft('')
    setRecipientPatchError(null)
    setRecipientPatchConfirmed(false)
    setRecipientPatchUncertain(false)
    setRecipientPatchRetryEmail(null)
    setResendDeliveryUncertain(false)
    setPatchingRecipient(false)
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
    setResendDeliveryUncertain(false)
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
      ...(createRecovery?.initialDeliverySettled
        ? { initialDeliverySettled: true }
        : {}),
      ...(createRecovery?.recipientPatch ? { recipientPatch: createRecovery.recipientPatch } : {}),
      ...(createRecovery?.deliveryRetry ? { deliveryRetry: createRecovery.deliveryRetry } : {}),
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
        let fulfilled: InvoiceData
        // A create recovery with initialDeliverySettled=false is only a
        // replay claim; it does not prove that /fulfill was dispatched. A
        // standalone operation written by Detail (or an explicit recovery
        // send) is the evidence that must take precedence here.
        const existingDeliveryOperation = loadPersistedDeliveryOperation(invoice.id, recovery.scope)
          ?? (recovery.deliveryRetry
            ? loadCreateRecoveryDeliveryOperation(invoice.id, recovery.scope)
            : null)
        if (!isInvoiceUpdateAllowed(invoice)) {
          // A replay can observe a terminal invoice after the original send
          // or patch was accepted. Never issue another mutation against Paid
          // or Void; the final reconciliation below retires the recovery.
          if (existingDeliveryOperation) {
            clearDeliveryOperation(existingDeliveryOperation)
            markCreateRecoveryDeliverySettled(invoice.id, existingDeliveryOperation)
          }
          fulfilled = invoice
        } else if (existingDeliveryOperation?.type === 'fulfill') {
          // A Detail page may have started the initial operation. Keep its
          // operation identity and retry /fulfill rather than switching to a
          // fresh /send or changing the frozen create request.
          fulfilled = await runInitialFulfillment(
            invoice.id,
            recovery.scope,
            currentScopeGeneration,
            frozenSubmission,
          )
        } else if (existingDeliveryOperation?.type === 'send' || recovery.deliveryRetry) {
          // A /send response may have been lost after Field accepted it. The
          // persisted key and channel flags are the only safe replay; do not
          // fall back to fulfilment or mint a new delivery operation. A
          // standalone Detail operation wins over stale create recovery.
          const deliveryOperation: DeliveryOperation = existingDeliveryOperation?.type === 'send'
            ? existingDeliveryOperation
            : {
                scope: recovery.scope,
                invoiceId: invoice.id,
                type: 'send',
                key: recovery.deliveryRetry!.key,
                sendEmail: recovery.deliveryRetry!.sendEmail,
                sendSms: recovery.deliveryRetry!.sendSms,
              }
          if (!saveDeliveryOperation(deliveryOperation)) {
            throw new Error(t('cancellationFees:new.error.persistence'))
          }
          const recoveryWithDeliveryRetry: CreateRecovery = {
            ...recovery,
            deliveryRetry: {
              key: deliveryOperation.key,
              sendEmail: deliveryOperation.sendEmail,
              sendSms: deliveryOperation.sendSms,
            },
          }
          if (!updatePersistedCreateRecovery(recoveryWithDeliveryRetry)) {
            throw new Error(t('cancellationFees:new.error.persistence'))
          }
          recovery = recoveryWithDeliveryRetry
          setCreateRecovery(recovery)
          resendKey.current = deliveryOperation.key
          try {
            fulfilled = await sendCancellationFee<InvoiceData>(invoice.id, {
              idempotencyKey: deliveryOperation.key,
              sendEmail: deliveryOperation.sendEmail,
              sendSms: deliveryOperation.sendSms,
            })
            if (!isCurrentCreateScope(recovery.scope, currentScopeGeneration)) {
              throw new CreateScopeChangedError()
            }
            clearDeliveryOperation(deliveryOperation)
            markCreateRecoveryDeliverySettled(invoice.id, deliveryOperation)
            setResendDeliveryUncertain(false)
            // A response, including a partial/failed delivery result, is a
            // definitive completion of this particular /send operation. Do
            // not replay its key forever after a reload; a later explicit
            // retry receives a fresh key.
            const recoveryWithoutDeliveryRetry = { ...recovery }
            delete recoveryWithoutDeliveryRetry.deliveryRetry
            recovery = recoveryWithoutDeliveryRetry
            recovery.initialDeliverySettled = true
            updatePersistedCreateRecovery(recovery)
            setCreateRecovery(recovery)
            resendKey.current = rotatePersistedDeliveryKey(invoice.id)
          } catch (reason) {
            if (reason instanceof CreateScopeChangedError
              || !isCurrentCreateScope(recovery.scope, currentScopeGeneration)) {
              throw reason
            }
            setResendDeliveryUncertain(isUncertainMutationResponse(reason))
            throw reason
          }
        } else if (recovery.recipientPatch) {
          // A PATCH response can be lost too. Retry the exact saved email
          // against the known invoice, then wait for the operator to start a
          // separate /send operation.
          const email = recovery.recipientPatch.email
          setRecipientPatchRetryEmail(email)
          try {
            fulfilled = await updateCancellationFee<InvoiceData>(invoice.id, {
              clientEmail: email,
            })
            if (!isCurrentCreateScope(recovery.scope, currentScopeGeneration)) {
              throw new CreateScopeChangedError()
            }
            // The PATCH received a response, so its exact retry payload is
            // no longer an in-flight mutation. Unknown responses are the only
            // case that keeps recipientPatch in durable recovery.
            const recoveryWithoutPatch = { ...recovery }
            delete recoveryWithoutPatch.recipientPatch
            recoveryWithoutPatch.initialDeliverySettled = true
            recovery = recoveryWithoutPatch
            updatePersistedCreateRecovery(recovery)
            setCreateRecovery(recovery)
            if (!isInvoiceUpdateAllowed(fulfilled)) {
              setRecipientPatchConfirmed(false)
              setRecipientPatchUncertain(false)
              setRecipientPatchRetryEmail(null)
            } else if (recipientEmail(fulfilled)?.trim() !== email) {
              setRecipientPatchError(t('cancellationFees:new.partial.destination.mismatch'))
              setRecipientPatchConfirmed(false)
            } else {
              setRecipientEmailDraft(recipientEmail(fulfilled) ?? email)
              setRecipientPatchConfirmed(true)
              setRecipientPatchUncertain(false)
              setRecipientPatchRetryEmail(null)
              if (fulfilled.status !== 'Paid') {
                resendKey.current = rotatePersistedDeliveryKey(fulfilled.id)
              }
            }
          } catch (reason) {
            if (reason instanceof CreateScopeChangedError
              || !isCurrentCreateScope(recovery.scope, currentScopeGeneration)) {
              throw reason
            }
            setRecipientPatchUncertain(isUncertainMutationResponse(reason))
            setRecipientPatchError(isUncertainMutationResponse(reason)
              ? t('cancellationFees:new.partial.destination.uncertain')
              : reason instanceof Error
                ? reason.message
                : t('cancellationFees:detail.notice.statusFailed'))
            throw reason
          }
        } else if (recovery.initialDeliverySettled) {
          // The original fulfilment already returned a definite result. A
          // later remount must not call /fulfill again; only an explicit
          // delivery action may start a new operation.
          fulfilled = invoice
        } else {
          // A replay can return an invoice that was already delivered. Reuse
          // the initial operation for a draft or an unpaid partial/failed
          // result, but never mutate a paid invoice.
          const shouldFulfill = needsInitialFulfillment(invoice, {
            sendEmail: frozenSubmission.sendEmail,
            sendSms: frozenSubmission.sendSms,
          })
          fulfilled = shouldFulfill
            ? await runInitialFulfillment(
                invoice.id,
                recovery.scope,
                currentScopeGeneration,
                frozenSubmission,
              )
            : invoice
        }
        if (!isCurrentCreateScope(recovery.scope, currentScopeGeneration)) {
          throw new CreateScopeChangedError()
        }
        setCreated(fulfilled)
        const incomplete = fulfillmentIssue(fulfilled, {
          sendEmail: frozenSubmission.sendEmail,
          sendSms: frozenSubmission.sendSms,
        })
        if (incomplete) {
          const settledRecovery = { ...recovery, initialDeliverySettled: true }
          recovery = settledRecovery
          updatePersistedCreateRecovery(recovery)
          setCreateRecovery(recovery)
          setDeliveryError(incomplete)
        } else {
          clearPersistedCreateRecovery(recovery)
          clearPersistedCreateKey(identity, recovery.key)
          setCreateRecovery(null)
          if (canList) navigate(`cancellation-fees/${fulfilled.id}`)
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
    delivery?: { sendEmail: boolean; sendSms: boolean },
  ) {
    if (expectedScope && !isCurrentCreateScope(expectedScope, expectedGeneration)) {
      throw new CreateScopeChangedError()
    }
    const operationScope = expectedScope ?? createStorageScope()
    const existingOperation = loadDeliveryOperation(invoiceId, operationScope)
    if (existingOperation?.type === 'send') {
      throw new Error('an explicit delivery operation is already pending')
    }
    const operation: DeliveryOperation = existingOperation ?? {
      scope: operationScope ?? '',
      invoiceId,
      type: 'fulfill',
      key: newCancellationFeeIdempotencyKey(),
      sendEmail: delivery?.sendEmail ?? false,
      sendSms: delivery?.sendSms ?? false,
    }
    if (!saveDeliveryOperation(operation)) {
      throw new Error(t('cancellationFees:new.error.persistence'))
    }
    try {
      const fulfilled = await fulfillCancellationFee<InvoiceData>(invoiceId)
      if (expectedScope && !isCurrentCreateScope(expectedScope, expectedGeneration)) {
        throw new CreateScopeChangedError()
      }
      clearDeliveryOperation(operation)
      markCreateRecoveryDeliverySettled(invoiceId, operation)
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
    const existingDeliveryOperation = created
      ? loadDeliveryOperation(created.id, storageScope)
      : null
    const sharedSendOperation = existingDeliveryOperation?.type === 'send'
      ? existingDeliveryOperation
      : null
    if (!created || !sent || (initialDeliveryUncertain && !sharedSendOperation)
      || patchingRecipient || (recipientPatchUncertain && !sharedSendOperation)
      || !isInvoiceUpdateAllowed(created)
      || existingDeliveryOperation?.type === 'fulfill'
      || (isInvalidEmailDestinationFailure(created)
        && !recipientPatchConfirmed
        && !sharedSendOperation)) return
    setResending(true)
    const requestScope = createStorageScope()
    const requestGeneration = scopeGenerationRef.current
    const resendOperation: DeliveryOperation = sharedSendOperation ?? {
      scope: requestScope ?? '',
      invoiceId: created.id,
      type: 'send',
      key: resendKey.current ?? persistedDeliveryKey(created.id),
      sendEmail: sent.sendEmail,
      sendSms: sent.sendSms,
    }
    if (!saveDeliveryOperation(resendOperation)) {
      setResending(false)
      setDeliveryError(t('cancellationFees:new.error.persistence'))
      return
    }
    const resendIdempotencyKey = resendOperation.key
    resendKey.current = resendIdempotencyKey
    const deliveryRecovery = activeCreateRecovery
      ? {
          ...activeCreateRecovery,
          deliveryRetry: {
            key: resendIdempotencyKey,
            sendEmail: resendOperation.sendEmail,
            sendSms: resendOperation.sendSms,
          },
        }
      : null
    if (!deliveryRecovery || !updatePersistedCreateRecovery(deliveryRecovery)) {
      setResending(false)
      setDeliveryError(t('cancellationFees:new.error.persistence'))
      return
    }
    setCreateRecovery(deliveryRecovery)
    if (requestScope && !isCurrentCreateScope(requestScope, requestGeneration)) {
      setResending(false)
      return
    }
    try {
      const fulfilled = await sendCancellationFee<InvoiceData>(created.id, {
        idempotencyKey: resendIdempotencyKey,
        sendEmail: resendOperation.sendEmail,
        sendSms: resendOperation.sendSms,
      })
      if (requestScope && !isCurrentCreateScope(requestScope, requestGeneration)) return
      clearDeliveryOperation(resendOperation)
      markCreateRecoveryDeliverySettled(fulfilled.id, resendOperation)
      setResendDeliveryUncertain(false)
      setCreated(fulfilled)
      const incomplete = fulfillmentIssue(fulfilled, {
        sendEmail: resendOperation.sendEmail,
        sendSms: resendOperation.sendSms,
      })
      setDeliveryError(incomplete ?? null)
      if (isInvalidEmailDestinationFailure(fulfilled)) setRecipientPatchConfirmed(false)
      // Any HTTP response closes this explicit /send operation, even when
      // delivery is partial or failed. Keep only the base create recovery so
      // a later operator click starts a new /send with a fresh key.
      const recoveryWithoutDeliveryRetry: CreateRecovery = { ...deliveryRecovery }
      delete recoveryWithoutDeliveryRetry.deliveryRetry
      recoveryWithoutDeliveryRetry.initialDeliverySettled = true
      resendKey.current = rotatePersistedDeliveryKey(fulfilled.id)
      if (!incomplete) {
        if (activeCreateRecovery) {
          clearPersistedCreateRecovery(recoveryWithoutDeliveryRetry)
          setCreateRecovery(null)
        }
        clearPersistedCreateKey(JSON.stringify(sent), activeCreateRecovery?.key)
        if (canList) navigate(`cancellation-fees/${fulfilled.id}`)
      } else {
        updatePersistedCreateRecovery(recoveryWithoutDeliveryRetry)
        setCreateRecovery(recoveryWithoutDeliveryRetry)
      }
    } catch (reason) {
      if (requestScope && !isCurrentCreateScope(requestScope, requestGeneration)) return
      setResendDeliveryUncertain(isUncertainMutationResponse(reason))
      setDeliveryError(reason instanceof Error
        ? reason.message
        : t('cancellationFees:new.error.delivery'))
    } finally {
      if (!requestScope || isCurrentCreateScope(requestScope, requestGeneration)) setResending(false)
    }
  }

  async function patchRecipientEmail() {
    const existingDeliveryOperation = created
      ? loadDeliveryOperation(created.id, storageScope)
      : null
    if (!created || !canManage || initialDeliveryUncertain || resendDeliveryUncertain
      || patchingRecipient || resending || submitting
      || existingDeliveryOperation
      || !isInvoiceUpdateAllowed(created)
      || !isInvalidEmailDestinationFailure(created)) return
    const email = (recipientPatchRetryEmail ?? recipientEmailDraft).trim()
    if (!email) {
      setRecipientPatchError(t('cancellationFees:detail.update.emailRequired'))
      return
    }
    const requestScope = createStorageScope()
    const requestGeneration = scopeGenerationRef.current
    const requestInvoiceId = created.id
    const currentRecovery = activeCreateRecovery
    if (!currentRecovery || currentRecovery.invoiceId !== requestInvoiceId) {
      setRecipientPatchError(t('cancellationFees:new.error.persistence'))
      return
    }
    const patchRecovery: CreateRecovery = {
      ...currentRecovery,
      recipientPatch: { email },
      initialDeliverySettled: true,
    }
    delete patchRecovery.deliveryRetry
    if (!updatePersistedCreateRecovery(patchRecovery)) {
      setRecipientPatchError(t('cancellationFees:new.error.persistence'))
      return
    }
    setCreateRecovery(patchRecovery)
    setPatchingRecipient(true)
    setRecipientPatchError(null)
    setRecipientPatchRetryEmail(email)
    setRecipientPatchConfirmed(false)
    try {
      // This is the dedicated invoice PATCH. The server validates the
      // recipient snapshot and authenticated tenant context, then returns the
      // authoritative invoice; the frozen create body/key stay untouched.
      const updated = await updateCancellationFee<InvoiceData>(created.id, {
        clientEmail: email,
      })
      if (requestScope && !isCurrentCreateScope(requestScope, requestGeneration)) return
      // A Detail page may have claimed delivery while this PATCH was in
      // flight. Do not apply the PATCH response or mint a new resend key
      // across that operation boundary; the frozen PATCH recovery remains
      // available for the next same-payload reconciliation.
      if (loadDeliveryOperation(requestInvoiceId, requestScope)) return
      if (recipientInvoiceIdRef.current !== requestInvoiceId) return
      if (!isInvoiceUpdateAllowed(updated)) {
        setCreated(updated)
        setDeliveryError(null)
        setRecipientPatchConfirmed(false)
        setRecipientPatchUncertain(false)
        setRecipientPatchRetryEmail(null)
        clearPersistedCreateRecovery(patchRecovery)
        clearPersistedCreateKey(patchRecovery.identity, patchRecovery.key)
        setCreateRecovery(null)
        return
      }
      if (recipientEmail(updated)?.trim() !== email) {
        const recoveryWithoutPatch = { ...patchRecovery }
        delete recoveryWithoutPatch.recipientPatch
        updatePersistedCreateRecovery(recoveryWithoutPatch)
        setCreateRecovery(recoveryWithoutPatch)
        setRecipientPatchError(t('cancellationFees:new.partial.destination.mismatch'))
        setRecipientPatchConfirmed(false)
        setRecipientPatchUncertain(false)
        setRecipientPatchRetryEmail(null)
        return
      }
      setCreated(updated)
      setRecipientEmailDraft(recipientEmail(updated) ?? email)
      setRecipientPatchConfirmed(true)
      setRecipientPatchUncertain(false)
      setRecipientPatchRetryEmail(null)
      const recoveryWithoutPatch = { ...patchRecovery }
      delete recoveryWithoutPatch.recipientPatch
      recoveryWithoutPatch.initialDeliverySettled = true
      updatePersistedCreateRecovery(recoveryWithoutPatch)
      setCreateRecovery(recoveryWithoutPatch)
      // A corrected destination starts a new explicit send operation. Keep
      // its key only while the send result is uncertain.
      resendKey.current = rotatePersistedDeliveryKey(updated.id)
    } catch (reason) {
      if (requestScope && !isCurrentCreateScope(requestScope, requestGeneration)) return
      const uncertain = isUncertainMutationResponse(reason)
      setRecipientPatchUncertain(uncertain)
      if (!uncertain) {
        setRecipientPatchRetryEmail(null)
        const recoveryWithoutPatch: CreateRecovery = { ...patchRecovery }
        delete recoveryWithoutPatch.recipientPatch
        if (updatePersistedCreateRecovery(recoveryWithoutPatch)) {
          setCreateRecovery(recoveryWithoutPatch)
        }
      }
      setRecipientPatchError(reason instanceof Error
        ? uncertain
          ? t('cancellationFees:new.partial.destination.uncertain')
          : reason.message
        : t('cancellationFees:detail.notice.statusFailed'))
    } finally {
      if (!requestScope || isCurrentCreateScope(requestScope, requestGeneration)) {
        setPatchingRecipient(false)
      }
    }
  }

  async function retryInitialDelivery() {
    const existingDeliveryOperation = created
      ? loadDeliveryOperation(created.id, storageScope)
      : null
    if (!created || !sent || !initialDeliveryUncertain
      || existingDeliveryOperation?.type === 'send') return
    setResending(true)
    const requestScope = createStorageScope()
    const requestGeneration = scopeGenerationRef.current
    try {
      const fulfilled = await runInitialFulfillment(
        created.id,
        requestScope ?? undefined,
        requestGeneration,
        sent,
      )
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
        if (canList) navigate(`cancellation-fees/${fulfilled.id}`)
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

  const canRetrySharedSend = Boolean(
    created
    && activeDeliveryOperation?.invoiceId === created.id
    && activeDeliveryOperation.type === 'send',
  )

  return (
    <div className="page-stack page-narrow">
      <PageHeader
        title={t('cancellationFees:new.title')}
        description={t('cancellationFees:new.description')}
        actions={(
          <div className="flex flex-wrap gap-2">
            {canList ? <Button type="button" onClick={() => navigate('cancellation-fees')}>
              <ArrowLeft /> {t('cancellationFees:new.backToList')}
            </Button> : null}
          </div>
        )}
      />

      {error ? (
        <Notice tone="danger" title={t('cancellationFees:new.createFailed')}>{error}</Notice>
      ) : null}
      {!canList && created && !submitting && !resending && !deliveryError && !activeCreateRecovery ? (
        <Notice tone="success" title={t('cancellationFees:new.completed.title')}>
          {t('cancellationFees:new.completed.description', { number: created.invoiceNumber })}
          {created.paymentLinkUrl ? <div className="notice-inline-action">
            <Button type="button" onClick={() => void openExternal(created.paymentLinkUrl!).catch(reason => {
              setError(reason instanceof Error ? reason.message : t('cancellationFees:detail.notice.openFailed'))
            })}>
              <ExternalLink /> {t('cancellationFees:detail.payment.openPage')}
            </Button>
          </div> : null}
        </Notice>
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
              disabled={resending || patchingRecipient
                || (!initialDeliveryUncertain && !canRetrySharedSend && recipientPatchUncertain)
                || (!initialDeliveryUncertain
                  && !canRetrySharedSend
                  && isInvalidEmailDestinationFailure(created)
                  && !recipientPatchConfirmed)}
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
            {canList ? <Button type="button" size="sm" onClick={() => navigate(`cancellation-fees/${created.id}`)}>
              {t('cancellationFees:new.partial.openDetail')}
            </Button> : null}
          </div>
        </Notice>
      ) : null}
      {created && deliveryError && canManage && !initialDeliveryUncertain
        && isInvalidEmailDestinationFailure(created) ? (
        <Panel
          title={t('cancellationFees:new.partial.destination.title')}
          description={t('cancellationFees:new.partial.destination.description')}
        >
          <form onSubmit={event => { event.preventDefault(); void patchRecipientEmail() }}>
            <Field label={t('cancellationFees:detail.update.email')} required>
              <Input
                type="email"
                required
                value={recipientEmailDraft}
                disabled={patchingRecipient || resending || submitting
                  || recipientPatchUncertain || resendDeliveryUncertain
                  || Boolean(activeDeliveryOperation)
                  || !isInvoiceUpdateAllowed(created)}
                onChange={event => {
                  setRecipientEmailDraft(event.target.value)
                  setRecipientPatchConfirmed(false)
                  setRecipientPatchUncertain(false)
                  setRecipientPatchRetryEmail(null)
                  setRecipientPatchError(null)
                }}
              />
            </Field>
            {recipientPatchError ? <p className="field-hint">{recipientPatchError}</p> : null}
            <div className="panel-footer-actions">
              <Button
                type="submit"
                variant="primary"
                disabled={patchingRecipient || resending || submitting || resendDeliveryUncertain
                  || Boolean(activeDeliveryOperation)
                  || !isInvoiceUpdateAllowed(created)}
              >
                {patchingRecipient
                  ? t('cancellationFees:detail.update.submitting')
                  : t('cancellationFees:detail.update.submit')}
              </Button>
            </div>
          </form>
        </Panel>
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
  return (
    <CapabilityGate route={`cancellation-fees/${invoiceId}`}>
      <CancellationFeeDetailContent invoiceId={invoiceId} />
    </CapabilityGate>
  )
}

function CancellationFeeDetailContent({ invoiceId }: { invoiceId: string }) {
  const { capabilities } = useEffectiveCapabilities()
  const canManage = capabilities.cancellationFees.manage
  const { t } = useTranslation(['cancellationFees', 'common'])
  const timezone = useTenantTimezone()
  const businessDate = today(timezone)
  const loader = useCallback(() => getCancellationFee<InvoiceData>(invoiceId), [invoiceId])
  const resource = useResource(loader, [invoiceId])
  useRegisterPageReload(resource.refresh)
  const detailScope = createStorageScope()
  const renderedScopeRef = useRef(detailScope)
  const renderedInvoiceIdRef = useRef(invoiceId)
  const scopeGenerationRef = useRef(0)
  const patchInFlightRef = useRef(false)
  if (renderedScopeRef.current !== detailScope || renderedInvoiceIdRef.current !== invoiceId) {
    renderedScopeRef.current = detailScope
    renderedInvoiceIdRef.current = invoiceId
    scopeGenerationRef.current += 1
    patchInFlightRef.current = false
  }
  useEffect(() => () => {
    // A response from an unmounted page must not mutate recovery or rotate a
    // delivery key after another route has taken over this component instance.
    scopeGenerationRef.current += 1
  }, [])
  const [fulfilling, setFulfilling] = useState(false)
  const initialDeliveryOperation = loadDeliveryOperation(invoiceId, detailScope)
  const [deliveryOperation, setDeliveryOperation] = useState<DeliveryOperation | null>(
    initialDeliveryOperation,
  )
  const deliveryOperationRef = useRef<DeliveryOperation | null>(initialDeliveryOperation)
  const resendKey = useRef<string | null>(
    initialDeliveryOperation?.type === 'send' ? initialDeliveryOperation.key : null,
  )
  const activeDeliveryOperation = deliveryOperation?.scope === detailScope
    && deliveryOperation.invoiceId === invoiceId
    ? deliveryOperation
    : null
  deliveryOperationRef.current = activeDeliveryOperation
  /** Announcements are toasts; the call sites still read `setNotice(...)`. */
  const setNotice = showToast

  function isCurrentDetailScope(scope: string, generation: number) {
    return createStorageScope() === scope
      && renderedInvoiceIdRef.current === invoiceId
      && scopeGenerationRef.current === generation
  }

  useEffect(() => {
    const operation = loadDeliveryOperation(invoiceId, detailScope)
    setDeliveryOperation(operation)
    deliveryOperationRef.current = operation
    resendKey.current = operation?.type === 'send' ? operation.key : null
    setFulfilling(false)
  }, [detailScope, invoiceId])

  useEffect(() => {
    if (!resource.data || !activeDeliveryOperation || isInvoiceUpdateAllowed(resource.data)) return
    clearDeliveryOperation(activeDeliveryOperation)
    markCreateRecoveryDeliverySettled(invoiceId, activeDeliveryOperation)
    setDeliveryOperation(null)
    deliveryOperationRef.current = null
  }, [activeDeliveryOperation, invoiceId, resource.data])

  async function fulfill() {
    // Payment-link fulfilment is a mutation too. A paid invoice is terminal;
    // keep the guard here in addition to disabling the button below so a
    // stale click cannot resend a paid invoice.
    if (!canManage || !resource.data || !isInvoiceUpdateAllowed(resource.data)
      || patchInFlightRef.current) return
    const requestScope = detailScope
    const requestGeneration = scopeGenerationRef.current
    if (!requestScope || !isCurrentDetailScope(requestScope, requestGeneration)) return
    const currentInvoice = resource.data
    const existingOperation = deliveryOperationRef.current
      ?? loadDeliveryOperation(invoiceId, requestScope)
    const sendEmail = existingOperation?.sendEmail ?? shouldResendEmail(currentInvoice)
    const sendSms = existingOperation?.sendSms
      ?? (currentInvoice.smsDeliveryStatus !== null && currentInvoice.smsDeliveryStatus !== undefined)
    const paymentLinkReady = currentInvoice.paymentLinkStatus === 'Ready'
      && Boolean(currentInvoice.paymentLinkUrl)
    // A link-only Draft has no initial delivery to fulfil. If an operator
    // adds an email through PATCH, send that new destination explicitly
    // while the background detail refresh is still allowed to be stale.
    const addedEmailForLinkOnlyDraft = !existingOperation
      && paymentLinkReady
      && currentInvoice.status === 'Draft'
      && sendEmail
      && !sendSms
      && (currentInvoice.emailDeliveryStatus === null
        || currentInvoice.emailDeliveryStatus === undefined)
    const needsInitialDelivery = !existingOperation
      && !addedEmailForLinkOnlyDraft
      && needsInitialFulfillment(currentInvoice, { sendEmail, sendSms })
    // A ready link-only draft has no delivery mutation to perform. Keep the
    // existing no-op behavior instead of sending a false/false /send body.
    if (!existingOperation && !addedEmailForLinkOnlyDraft && !sendEmail && !sendSms
      && !needsInitialDelivery) return
    const initialFulfillment = existingOperation
      ? existingOperation.type === 'fulfill'
      : addedEmailForLinkOnlyDraft
        ? false
        : needsInitialDelivery
    const operation: DeliveryOperation = existingOperation ?? {
      scope: requestScope,
      invoiceId,
      type: initialFulfillment ? 'fulfill' : 'send',
      key: initialFulfillment
        ? newCancellationFeeIdempotencyKey()
        : resendKey.current ?? persistedDeliveryKey(invoiceId),
      sendEmail,
      sendSms,
    }
    if (!saveDeliveryOperation(operation)) {
      setNotice({ tone: 'danger', message: t('cancellationFees:new.error.persistence') })
      return
    }
    deliveryOperationRef.current = operation
    setDeliveryOperation(operation)
    setFulfilling(true)
    setNotice(null)
    try {
      const fulfilled = operation.type === 'fulfill'
        ? await fulfillCancellationFee<InvoiceData>(invoiceId)
        : await sendCancellationFee<InvoiceData>(invoiceId, {
          idempotencyKey: operation.key,
          sendEmail: operation.sendEmail,
          sendSms: operation.sendSms,
        })
      if (!isCurrentDetailScope(requestScope, requestGeneration)) return
      // Apply the authoritative mutation response before the action is enabled
      // again. A revalidation may be in flight, so a second click must use the
      // completed invoice and select /send rather than repeating /fulfill.
      resource.setData(fulfilled)
      const issue = fulfillmentIssue(fulfilled, {
        sendEmail: operation.sendEmail,
        sendSms: operation.sendSms,
      })
      // A returned invoice closes this operation, including a definitive
      // partial/failed result. Unknown responses keep the durable record in
      // the catch path and therefore retry the exact same operation.
      clearDeliveryOperation(operation)
      deliveryOperationRef.current = null
      setDeliveryOperation(null)
      markCreateRecoveryDeliverySettled(invoiceId, operation)
      if (operation.type === 'send') {
        clearPersistedDeliveryRetryForInvoice(invoiceId, operation)
        resendKey.current = rotatePersistedDeliveryKey(invoiceId)
      }
      if (!issue) clearPersistedCreateRecoveryForInvoice(invoiceId, operation)
      setNotice(issue
        ? { tone: 'danger', message: issue }
        : { tone: 'success', message: t('cancellationFees:detail.notice.resent') })
      resource.refresh()
    } catch (reason) {
      if (!isCurrentDetailScope(requestScope, requestGeneration)) return
      setNotice({
        tone: 'danger',
        message: reason instanceof Error
          ? reason.message
          : t('cancellationFees:detail.notice.resendFailed'),
      })
    } finally {
      if (isCurrentDetailScope(requestScope, requestGeneration)) setFulfilling(false)
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
            {canManage ? <Button
              type="button"
              variant="primary"
              disabled={fulfilling || !isInvoiceUpdateAllowed(invoice)}
              onClick={() => void fulfill()}
            >
              <Send />
              {fulfilling
                ? t('cancellationFees:detail.payment.working')
                : t('cancellationFees:detail.payment.resend')}
            </Button> : null}
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
      {canManage ? <InvoiceOperations
        key={`${storedInvoice.status}-${storedInvoice.paymentLinkStatus}-${storedInvoice.updatedAt ?? ''}`}
        invoice={storedInvoice}
        onUpdated={updated => resource.setData(updated)}
        onRefresh={resource.refresh}
        onNotice={setNotice}
        getDeliveryOperation={() => deliveryOperationRef.current ?? loadDeliveryOperation(invoiceId)}
        getRequestScope={() => ({ scope: detailScope, generation: scopeGenerationRef.current })}
        isCurrentRequest={isCurrentDetailScope}
        onPatchStateChange={(patching, request) => {
          if (isCurrentDetailScope(request.scope, request.generation)) {
            patchInFlightRef.current = patching
          }
        }}
        onPatched={() => {
          if (deliveryOperationRef.current || loadDeliveryOperation(invoiceId)) return
          resendKey.current = rotatePersistedDeliveryKey(invoiceId)
        }}
      /> : null}
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
  getDeliveryOperation,
  getRequestScope,
  isCurrentRequest,
  onPatchStateChange,
  onPatched,
}: {
  invoice: InvoiceData
  onUpdated(invoice: InvoiceData): void
  onRefresh(): void
  onNotice(notice: { tone: 'success' | 'danger'; message: string }): void
  getDeliveryOperation(): DeliveryOperation | null
  getRequestScope(): { scope: string | null; generation: number }
  isCurrentRequest(scope: string, generation: number): boolean
  onPatchStateChange(patching: boolean, request: { scope: string; generation: number }): void
  onPatched(): void
}) {
  const { t } = useTranslation(['cancellationFees', 'common'])
  const [notes, setNotes] = useState(invoice.notes ?? '')
  const [clientEmail, setClientEmail] = useState(invoice.clientEmail ?? '')
  const [saving, setSaving] = useState(false)
  const isTerminal = !isInvoiceUpdateAllowed(invoice)

  async function updateInvoice() {
    if (isTerminal || getDeliveryOperation()) return
    const request = getRequestScope()
    const scope = request.scope
    if (!scope || !isCurrentRequest(scope, request.generation)) return
    setSaving(true)
    onPatchStateChange(true, { scope, generation: request.generation })
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
      if (!isCurrentRequest(scope, request.generation) || getDeliveryOperation()) return
      // Apply the authoritative PATCH response before starting the background
      // refresh. This makes a newly added email available to the resend action
      // immediately, even while the follow-up GET is in flight.
      onUpdated(updated)
      onPatched()
      onNotice({ tone: 'success', message: t('cancellationFees:detail.notice.statusUpdated') })
      onRefresh()
    } catch (reason) {
      if (!isCurrentRequest(scope, request.generation)) return
      onNotice({
        tone: 'danger',
        message: reason instanceof Error
          ? reason.message
          : t('cancellationFees:detail.notice.statusFailed'),
      })
    } finally {
      if (isCurrentRequest(scope, request.generation)) {
        setSaving(false)
        onPatchStateChange(false, { scope, generation: request.generation })
      }
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
            disabled={isTerminal || Boolean(getDeliveryOperation())}
            onChange={event => setClientEmail(event.target.value)}
          />
        </Field>
      </FormGrid>
      <Field label={t('cancellationFees:detail.update.notes')}>
        <NativeTextarea
          rows={4}
          value={notes}
          disabled={isTerminal || Boolean(getDeliveryOperation())}
          onChange={event => setNotes(event.target.value)}
        />
      </Field>
      <div className="panel-footer-actions">
        <Button
          type="button"
          variant="primary"
          disabled={saving || isTerminal || Boolean(getDeliveryOperation())}
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
    else if (status !== 'Void') summary.unpaid += invoice.totalAmount
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

function normalizedDeliveryFailureCode(code?: string | null) {
  return code?.trim().toLowerCase().replace(/_/g, '')
}

function deliveryFailureReason(code?: string | null) {
  const normalized = normalizedDeliveryFailureCode(code)
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

function isInvalidEmailDestinationFailure(
  invoice: Pick<InvoiceData, 'status' | 'emailDeliveryStatus' | 'emailDeliveryFailureCode'>,
) {
  return isInvoiceUpdateAllowed(invoice)
    && invoice.emailDeliveryStatus === 'Failed'
    && normalizedDeliveryFailureCode(invoice.emailDeliveryFailureCode) === 'invaliddestination'
}

function isUncertainMutationResponse(reason: unknown) {
  if (!(reason instanceof ApiError)) return true
  return reason.status < 400 || reason.status === 408 || reason.status === 409
    || reason.status === 429 || reason.status >= 500
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
  if (!isInvoiceUpdateAllowed(invoice)) return undefined
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
  if (!isInvoiceUpdateAllowed(invoice)) return false
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

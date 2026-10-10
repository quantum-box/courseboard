import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { ChevronLeft, ReceiptText, Ban } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ApiError,
  courseboardApiJson,
  fieldApiJson,
  fieldTenant,
  fieldUserId,
  yen,
} from '../../../api'
import {
  DataTable,
  type DataTableColumn,
  EmptyState,
  Field,
  FormGrid,
  LoadingState,
  NativeSelect,
  NativeTextarea,
  Notice,
  Panel,
  ResourceError,
} from '../../../components/Page'
import { Sheet } from '../../../components/Sheet'
import { useTenantTimezone } from '../../../context/TenantTimezoneProvider'
import { useKeptData } from '../../../hooks/useKeptData'
import { useResource } from '../../../hooks/useResource'
import { today } from '../../../lib/clock'
import { navigateFromClick } from '../../../lib/router'
import { showToast } from '../../../lib/toast'
import {
  CANCELLATION_FEE_MARKER,
  cancellationFeeIdempotencyKey,
  cancellationFeeInvoiceRequestBody,
  cancellationFeeInvoicesPath,
  cancellationFeeSources,
  invoicedReservationIds,
  normalizePhone,
  type InvoiceSource,
} from '../../cancellation-fees/models'
import {
  addDays,
  CANCELLATION_FEE_STATES,
  CANCELLATION_REASONS,
  CANCELLATION_PAGE_SIZE,
  CANCELLATION_SORT_COLUMNS,
  DEFAULT_CANCELLATION_ORDER,
  cancellationSortForColumn,
  cancellationsQuery,
  defaultCancellationFilters,
  planCancellationFees,
  splitFeeAcrossRows,
  type CancellationFeeAssignment,
  type CancellationFeeState,
  type CancellationFilters,
  type CancellationOrder,
  type CancellationReason,
  type CustomerFeeGroup,
  type ReservationCancellation,
  type ReservationCancellationPage,
} from './cancellations'
import { CustomerPicker } from './CustomerPicker'
import type { Customer } from './models'
import { visitDate } from './visits'

/** What a club most often charges per round given up. Editable on the sheet. */
const DEFAULT_PER_PLAYER_FEE = 3_000

type InvoiceStatus = 'Draft' | 'Sent' | 'SendFailed' | 'Paid' | 'Overdue'

type InvoiceResponse = {
  id: string
  invoiceNumber?: string
  status?: InvoiceStatus | string
  sources?: InvoiceSource[] | null
  paymentLinkUrl?: string | null
  paymentLinkStatus?: 'Pending' | 'Ready' | 'Failed' | null
  emailDeliveryStatus?: 'Pending' | 'Sent' | 'Failed' | null
  smsDeliveryStatus?: 'Pending' | 'Sent' | 'Failed' | null
}

type InvoiceListResponse = {
  items: { id: string; sources?: InvoiceSource[] | null }[]
}

type CancellationFeeInvoiceSnapshot = {
  generation: number
  response: InvoiceListResponse
}

/**
 * Who gave up a tee time, why, and who still owes for it.
 *
 * Cancelling removes a booking from the board, which is the point of it and
 * also the problem: afterwards nothing said a group had ever held that slot,
 * and nothing at all said why they let it go. The reason is now CourseBoard's
 * own record, and this is the screen it exists for — a month of cancellations
 * the desk can read, sort by reason, and turn into invoices in one action.
 *
 * The collection list is this screen with its default filters: the last month,
 * the reasons the club charges for, and only the rows nobody has settled. A
 * row that has been invoiced or waived drops out of it and stops coming back,
 * which is what makes working down the list finish.
 *
 * Its own route rather than a panel under the ledger, because it is a
 * morning's work and has to survive a reload with its filters intact.
 */
export function CancellationsPage() {
  const { t } = useTranslation(['customers', 'cancellationFees', 'common'])
  const timezone = useTenantTimezone()
  const businessDate = today(timezone)
  const [filters, setFilters] = useState<CancellationFilters>(() =>
    defaultCancellationFilters(businessDate))
  const [order, setOrder] = useState<CancellationOrder>(DEFAULT_CANCELLATION_ORDER)
  const [pageIndex, setPageIndex] = useState(0)
  // Kept with the row, not just its id: the selection outlives the page it was
  // made on, and billing needs the whole row for bookings no longer on screen.
  const [selected, setSelected] = useState<Map<string, ReservationCancellation>>(new Map())
  const [billing, setBilling] = useState(false)
  const [billingRun, setBillingRun] = useState(0)
  const [waiving, setWaiving] = useState(false)

  const query = cancellationsQuery(filters, order, pageIndex)
  // Keyed by the query so changing a filter re-reads rather than showing the
  // previous period under the new description of it.
  const resource = useResource(
    () => courseboardApiJson<ReservationCancellationPage>(query),
    [query],
    { cacheKey: `course:cancellations:${query}` },
  )

  // A period can hold more cancellations than anybody pages through by hand,
  // so the server orders and pages it. The previous page stays up, dimmed,
  // while the next one loads.
  const page = useKeptData(resource.data)
  const rows = useMemo(() => page?.items ?? [], [page])
  const selectedRows = useMemo(() => [...selected.values()], [selected])

  const patch = (change: Partial<CancellationFilters>) => {
    setFilters(current => ({ ...current, ...change }))
    setPageIndex(0)
    // The selection is rows of the list that is going away. Carrying it
    // across a filter change would bill rows nobody can still see. Turning a
    // page or re-ordering keeps it: those rows are still in the list.
    setSelected(new Map())
  }

  const toggle = (row: ReservationCancellation) => {
    setSelected(current => {
      const next = new Map(current)
      if (!next.delete(row.reservationId)) next.set(row.reservationId, row)
      return next
    })
  }

  /** The header box ticks or clears the page on screen, not the whole period. */
  const togglePage = (select: boolean) => {
    setSelected(current => {
      const next = new Map(current)
      for (const row of rows) {
        if (select) next.set(row.reservationId, row)
        else next.delete(row.reservationId)
      }
      return next
    })
  }

  const allSelected = rows.length > 0 && rows.every(row => selected.has(row.reservationId))

  const columns = useMemo<DataTableColumn<ReservationCancellation>[]>(() => [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          checked={allSelected}
          aria-label={t('customers:cancellations.selectAll')}
          onChange={() => togglePage(!allSelected)}
        />
      ),
      cell: row => (
        <input
          type="checkbox"
          checked={selected.has(row.reservationId)}
          aria-label={t('customers:cancellations.selectRow', {
            name: row.customerName ?? row.reservationId,
          })}
          onClick={event => event.stopPropagation()}
          onChange={() => toggle(row)}
        />
      ),
    },
    {
      key: 'playedOn',
      header: t('customers:cancellations.column.playedOn'),
      cell: row => (row.playedOn ? visitDate(row.playedOn, timezone) : ''),
      serverSortable: true,
    },
    {
      key: 'name',
      header: t('customers:field.name'),
      cell: row => (
        row.customerId
          ? (
            <a
              href={`#/golf/customers/${encodeURIComponent(row.customerId)}`}
              onClick={event => navigateFromClick(event, `golf/customers/${row.customerId}`)}
            >
              <strong>{row.customerName ?? row.customerId}</strong>
            </a>
          )
          : (
            <>
              <strong>{row.customerName ?? t('customers:callList.unnamed')}</strong>{' '}
              <span className="muted">{t('customers:cancellations.unlinked')}</span>
            </>
          )
      ),
    },
    {
      key: 'reason',
      header: t('customers:cancellations.column.reason'),
      // The reason and the sentence together: the code is what the month is
      // counted by, the note is what makes one row make sense.
      cell: row => (
        <>
          <Badge variant={row.feeExpected ? 'warning' : 'neutral'}>
            {t(`customers:cancellations.reason.${row.reason}`, {
              defaultValue: t('customers:cancellations.reason.other'),
            })}
          </Badge>
          {row.reasonNote ? <div className="muted">{row.reasonNote}</div> : null}
        </>
      ),
      serverSortable: true,
    },
    {
      key: 'notice',
      header: t('customers:cancellations.column.notice'),
      align: 'right',
      // Negative notice is the call that came after the round should have
      // started, which is a different thing from a late cancellation and reads
      // as such.
      cell: row => {
        if (row.noticeDays === null || row.noticeDays === undefined) return null
        return row.noticeDays < 0
          ? <span className="muted">{t('customers:cancellations.afterTeeTime')}</span>
          : t('customers:cancellations.daysBefore', { count: row.noticeDays })
      },
      serverSortable: true,
    },
    {
      key: 'players',
      header: t('customers:cancellations.column.players'),
      align: 'right',
      cell: row => row.players || '',
      serverSortable: true,
    },
    {
      key: 'bookingAmount',
      header: t('customers:cancellations.column.bookingAmount'),
      align: 'right',
      // Zero means "nothing recorded" far more often than a free round.
      cell: row => (row.bookingAmount ? row.bookingAmount.toLocaleString() : ''),
      serverSortable: true,
    },
    {
      key: 'feeState',
      header: t('customers:cancellations.column.feeState'),
      cell: row => (
        <>
          <Badge
            variant={
              row.feeState === 'invoiced'
                ? 'success'
                : row.feeState === 'waived'
                  ? 'neutral'
                  : 'warning'
            }
          >
            {t(`customers:cancellations.feeState.${row.feeState}`, {
              defaultValue: String(row.feeState),
            })}
          </Badge>
          {row.feeAmount ? <div className="muted">{yen(row.feeAmount)}</div> : null}
          {row.feeNote ? <div className="muted">{row.feeNote}</div> : null}
        </>
      ),
      serverSortable: true,
    },
  ], [allSelected, rows, selected, t, timezone])

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

      <Panel
        title={t('customers:cancellations.filters.title')}
        description={t('customers:cancellations.filters.description')}
      >
        <FormGrid columns={2}>
          <Field label={t('customers:cancellations.filters.from')}>
            <Input
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={event => patch({ from: event.target.value })}
            />
          </Field>
          <Field label={t('customers:cancellations.filters.to')}>
            <Input
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={event => patch({ to: event.target.value })}
            />
          </Field>
          <Field
            label={t('customers:cancellations.filters.reason')}
            hint={t('customers:cancellations.filters.reasonHint')}
          >
            <NativeSelect
              value={filters.reason}
              onChange={event => patch({
                reason: event.target.value as CancellationReason | '',
              })}
            >
              <option value="">{t('customers:cancellations.filters.everyReason')}</option>
              {CANCELLATION_REASONS.map(reason => (
                <option key={reason} value={reason}>
                  {t(`customers:cancellations.reason.${reason}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('customers:cancellations.filters.feeState')}>
            <NativeSelect
              value={filters.feeState}
              onChange={event => patch({
                feeState: event.target.value as CancellationFeeState | '',
              })}
            >
              <option value="">{t('customers:cancellations.filters.everyFeeState')}</option>
              {CANCELLATION_FEE_STATES.map(state => (
                <option key={state} value={state}>
                  {t(`customers:cancellations.feeState.${state}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </FormGrid>
        {/* Only offered while no single reason is named: the two narrowings
            would contradict each other, and the query drops this one anyway. */}
        {filters.reason ? null : (
          <label className="consent-check">
            <input
              type="checkbox"
              checked={filters.chargeableOnly}
              onChange={event => patch({ chargeableOnly: event.target.checked })}
            />
            <span>
              <strong>{t('customers:cancellations.filters.chargeableOnly')}</strong>
              <small>{t('customers:cancellations.filters.chargeableOnlyHint')}</small>
            </span>
          </label>
        )}
      </Panel>

      <Panel
        title={t('customers:cancellations.results.title')}
        description={page
          ? t('customers:cancellations.results.description', { count: page.total })
          : undefined}
        actions={selectedRows.length > 0 ? (
          <>
            <Button type="button" variant="ghost" onClick={() => setWaiving(true)}>
              <Ban /> {t('customers:cancellations.waive.open', { count: selectedRows.length })}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setBillingRun(current => current + 1)
                setBilling(true)
              }}
            >
              <ReceiptText /> {t('customers:cancellations.bill.open', { count: selectedRows.length })}
            </Button>
          </>
        ) : undefined}
      >
        {resource.loading && !page ? <LoadingState /> : null}
        {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}


        <DataTable
          rows={rows}
          columns={columns}
          rowKey={row => row.reservationId}
          pageSize={CANCELLATION_PAGE_SIZE}
          server={{
            page: pageIndex,
            onPageChange: setPageIndex,
            total: page?.total ?? 0,
            loading: resource.loading || resource.data !== page,
            sort: {
              key: CANCELLATION_SORT_COLUMNS[order.sort],
              direction: order.ascending ? 'asc' : 'desc',
            },
            onSortChange: next => {
              const sort = cancellationSortForColumn(next.key)
              if (!sort) return
              setOrder({ sort, ascending: next.direction === 'asc' })
              setPageIndex(0)
            },
          }}
          empty={(
            <EmptyState
              title={t('customers:cancellations.empty.title')}
              description={t('customers:cancellations.empty.description')}
            />
          )}
        />
      </Panel>

      <BillCancellationFeesSheet
        key={billingRun}
        open={billing}
        rows={selectedRows}
        businessDate={businessDate}
        onClose={() => setBilling(false)}
        onSettled={() => {
          setSelected(new Map())
          resource.refresh()
        }}
      />
      <WaiveCancellationFeesSheet
        open={waiving}
        rows={selectedRows}
        onClose={() => setWaiving(false)}
        onSettled={() => {
          setSelected(new Map())
          resource.refresh()
        }}
      />
    </div>
  )
}

/**
 * How the invoice line reads, so the payer knows what they are paying for.
 *
 * One booking names its day; several name how many, because a line listing
 * four dates is longer than the invoice it sits on.
 */
function describeFeeLine(
  group: CustomerFeeGroup,
  t: ReturnType<typeof useTranslation<['customers', 'cancellationFees', 'common']>>['t'],
) {
  const first = group.rows[0]
  if (group.rows.length === 1 && first) {
    return t('customers:cancellations.bill.lineItem.one', {
      date: first.playedOn ?? '',
      players: String(Math.max(1, first.players)),
    })
  }
  return t('customers:cancellations.bill.lineItem.many', {
    count: group.rows.length,
    players: String(group.players),
  })
}

/** What one customer's invoice attempt came to. */
type BatchInvoiceBody = ReturnType<typeof cancellationFeeInvoiceRequestBody>

type BatchDecision = { reservationId: string; amount: number }

/**
 * The exact batch request is frozen as soon as a Field create is attempted.
 * The source set is the logical operation identity; amount, date, recipient,
 * and delivery are payload, so a retry cannot accidentally pair a new body
 * with an old idempotency key after the CourseBoard write-back is uncertain.
 */
type BatchRecovery = {
  sourceKey: string
  reservationIds: string[]
  key: string
  body: BatchInvoiceBody
  decisions: BatchDecision[]
  invoiceId?: string
}

type BillingResult = {
  group: CustomerFeeGroup
  recovery: BatchRecovery
  invoiceId?: string
  error?: string
}

type BatchRecoveryMap = Map<string, BatchRecovery>
type BatchRecoveryScope = { tenantId: string; userId: string }

const BATCH_RECOVERY_STORAGE_PREFIX = 'courseboard:cancellation-fee:batch-recovery'

function currentBatchRecoveryScope(): BatchRecoveryScope {
  return { tenantId: fieldTenant(), userId: fieldUserId() }
}

function batchRecoveryStorageKey(scope: BatchRecoveryScope) {
  return `${BATCH_RECOVERY_STORAGE_PREFIX}:${JSON.stringify([
    scope.tenantId,
    scope.userId,
  ])}`
}

function batchRecoveryScopeMatches(expected: BatchRecoveryScope) {
  const current = currentBatchRecoveryScope()
  return current.tenantId === expected.tenantId && current.userId === expected.userId
}

function batchSourceIds(group: Pick<CustomerFeeGroup, 'rows'>) {
  return [...new Set(group.rows.map(row => row.reservationId))].sort()
}

function batchSourceKey(group: Pick<CustomerFeeGroup, 'rows'>) {
  return JSON.stringify(batchSourceIds(group))
}

function isBatchRecovery(value: unknown): value is BatchRecovery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<BatchRecovery>
  return typeof candidate.sourceKey === 'string'
    && Array.isArray(candidate.reservationIds)
    && candidate.reservationIds.every(id => typeof id === 'string' && id.length > 0)
    && typeof candidate.key === 'string'
    && Boolean(candidate.body && typeof candidate.body === 'object')
    && Array.isArray(candidate.decisions)
    && candidate.decisions.every(decision => (
      Boolean(decision)
      && typeof decision === 'object'
      && typeof decision.reservationId === 'string'
      && typeof decision.amount === 'number'
    ))
}

function loadBatchRecoveries(storageKey: string): BatchRecoveryMap {
  try {
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return new Map()
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map()
    return new Map(
      Object.entries(parsed).flatMap(([sourceKey, value]) => {
        if (!isBatchRecovery(value) || value.sourceKey !== sourceKey) return []
        return [[sourceKey, value] as const]
      }),
    )
  } catch {
    return new Map()
  }
}

function persistBatchRecoveries(recoveries: BatchRecoveryMap, storageKey: string) {
  try {
    if (recoveries.size === 0) {
      sessionStorage.removeItem(storageKey)
      return
    }
    sessionStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(recoveries)))
  } catch {
    // The in-memory map still protects retries during this page visit. A later
    // remount must also pass the source-backed duplicate check before billing.
  }
}

function makeBatchRecovery(
  group: CustomerFeeGroup,
  dueDate: string,
  sendEmail: boolean,
  t: ReturnType<typeof useTranslation<['customers', 'cancellationFees', 'common']>>['t'],
): BatchRecovery {
  const reservationIds = batchSourceIds(group)
  const key = cancellationFeeIdempotencyKey([
    group.recipient.kind === 'customer'
      ? group.recipient.customerId
      : `name:${group.recipient.name}`,
    dueDate,
    String(group.amount),
    ...reservationIds,
  ])
  const body = cancellationFeeInvoiceRequestBody({
    billTo: group.recipient,
    sources: cancellationFeeSources(reservationIds),
    clientName: group.customerName,
    clientEmail: sendEmail ? group.customerEmail : undefined,
    dueDate,
    taxAmount: 0,
    notes: [
      CANCELLATION_FEE_MARKER,
      t('customers:cancellations.bill.invoiceNote', { count: group.rows.length }),
      ...group.rows.map(row => t('customers:cancellations.bill.invoiceLine', {
        date: row.playedOn ?? '',
        reason: t(`customers:cancellations.reason.${row.reason}`, {
          defaultValue: t('customers:cancellations.reason.other'),
        }),
        note: row.reasonNote ?? '',
      })),
    ].join('\n'),
    description: describeFeeLine(group, t),
    amount: group.amount,
    sendEmail: sendEmail && Boolean(group.customerEmail),
    sendSms: false,
    idempotencyKey: key,
  })
  return {
    sourceKey: JSON.stringify(reservationIds),
    reservationIds,
    key,
    body,
    decisions: splitFeeAcrossRows(group),
  }
}

function batchRecoveryAmount(recovery: BatchRecovery) {
  const unitPrice = recovery.body.lineItems?.[0]?.unitPrice
  if (typeof unitPrice === 'number' && Number.isFinite(unitPrice)) return unitPrice
  return recovery.decisions.reduce((total, decision) => total + decision.amount, 0)
}

function batchRecoveryClientName(recovery: BatchRecovery, fallback: string) {
  const clientName = recovery.body.clientName?.trim()
  return clientName || fallback
}

function isDefinitiveBatchCreateFailure(error: unknown) {
  return error instanceof ApiError
    && error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 409
    && error.status !== 429
}

/**
 * Generic invoice creation owns initial delivery for the batch path. A
 * response that says delivery was only partly completed must remain visible
 * as an error even though its invoice id is safe to reconcile.
 */
function fulfillmentIssueKind(
  invoice: InvoiceResponse,
  delivery: { sendEmail: boolean; sendSms: boolean },
): 'noPaymentLink' | 'deliveryPartial' | undefined {
  // Payment is already an accounting fact. A paid replay is terminal even if
  // its older link or delivery fields report a failure.
  if (invoice.status === 'Paid') return undefined
  if (
    invoice.paymentLinkStatus !== undefined
    || invoice.paymentLinkUrl !== undefined
  ) {
    if (invoice.paymentLinkStatus !== 'Ready' || !invoice.paymentLinkUrl) {
      return 'noPaymentLink'
    }
  }
  if (invoice.status === 'SendFailed' || invoice.status === 'Draft') {
    return 'deliveryPartial'
  }
  const selectedDeliveriesSent =
    (!delivery.sendEmail
      || invoice.emailDeliveryStatus === undefined
      || invoice.emailDeliveryStatus === 'Sent')
    && (!delivery.sendSms
      || invoice.smsDeliveryStatus === undefined
      || invoice.smsDeliveryStatus === 'Sent')
  if (!selectedDeliveriesSent) return 'deliveryPartial'
  return undefined
}

const CANCELLATION_FEE_LIST_PAGE_SIZE = 100

/** Read every source-backed cancellation invoice before enabling billing. */
async function loadCancellationFeeInvoices(): Promise<InvoiceListResponse> {
  const items: InvoiceResponse[] = []
  for (let offset = 0; ; offset += CANCELLATION_FEE_LIST_PAGE_SIZE) {
    const separator = cancellationFeeInvoicesPath.includes('?') ? '&' : '?'
    const response = await fieldApiJson<InvoiceListResponse>(
      `${cancellationFeeInvoicesPath}${separator}limit=${CANCELLATION_FEE_LIST_PAGE_SIZE}&offset=${offset}`,
    )
    if (!response || !Array.isArray(response.items)) {
      throw new Error('Field returned an invalid cancellation-fee invoice list')
    }
    items.push(...response.items)
    if (response.items.length < CANCELLATION_FEE_LIST_PAGE_SIZE) {
      return { items }
    }
  }
}

/**
 * What the desk typed into the sheet for a booking the ledger has no link for.
 *
 * Held as the raw text of the boxes rather than as a finished recipient: the
 * number is normalised when the plan is built, and the desk has to be able to
 * see what it typed while the normalisation refuses it.
 */
type RecipientEdit = { customer: Customer | null; name: string; phone: string }

/** What the boxes for a booking start out holding: whatever the booking says. */
function recipientEditFor(row: ReservationCancellation): RecipientEdit {
  return {
    customer: null,
    name: row.customerName?.trim() ?? '',
    phone: row.customerPhone?.trim() ?? '',
  }
}

/**
 * Raise one invoice per person for everything they cancelled, then record it.
 *
 * The order matters and is not negotiable: the invoice is created upstream
 * first, and only the ones that actually exist are written back as invoiced.
 * A row marked invoiced that points at nothing never comes back on the next
 * extraction; a row left unsettled does, which is the failure worth having.
 */
function BillCancellationFeesSheet({
  open,
  rows,
  businessDate,
  onClose,
  onSettled,
}: {
  open: boolean
  rows: ReservationCancellation[]
  businessDate: string
  onClose: () => void
  onSettled: () => void
}) {
  const { t } = useTranslation(['customers', 'cancellationFees', 'common'])
  const timezone = useTenantTimezone()
  const [perPlayer, setPerPlayer] = useState(DEFAULT_PER_PLAYER_FEE)
  const [dueDate, setDueDate] = useState(() => addDays(businessDate, 7))
  const [sendEmail, setSendEmail] = useState(true)
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<BillingResult[] | null>(null)
  // A billing sheet may outlive an auth refresh while a request is in flight.
  // Keep its storage scope fixed to the verified identity that opened it; an
  // old response must never populate the next operator's recovery map.
  const [batchRecoveryScope] = useState(currentBatchRecoveryScope)
  const [batchRecoveryStorageKeyForScope] = useState(() =>
    batchRecoveryStorageKey(batchRecoveryScope))
  const [batchRecoveries, setBatchRecoveries] = useState<BatchRecoveryMap>(() =>
    loadBatchRecoveries(batchRecoveryStorageKeyForScope))
  const batchRecoveriesRef = useRef(batchRecoveries)
  // Keyed by booking, so an entry survives the sheet being closed and reopened
  // and means nothing to the bookings it is not about.
  const [edits, setEdits] = useState<Map<string, RecipientEdit>>(new Map())

  const updateBatchRecoveries = (
    update: (next: BatchRecoveryMap) => void,
  ) => {
    const next = new Map(batchRecoveriesRef.current)
    update(next)
    batchRecoveriesRef.current = next
    setBatchRecoveries(next)
    persistBatchRecoveries(next, batchRecoveryStorageKeyForScope)
  }

  // What Field already holds a cancellation fee for (PLT-4158).
  //
  // CourseBoard's own rows answer this for every batch it managed to record.
  // The case worth catching is the one it could not: the invoice went out and
  // the write back failed, leaving the row `unsettled` so the next extraction
  // offers it again. A read that fails keeps the billing action disabled until
  // the source-backed duplicate check has completed.
  const reconciliationGenerationRef = useRef(0)
  const wasOpenRef = useRef(false)
  if (open && !wasOpenRef.current) reconciliationGenerationRef.current += 1
  wasOpenRef.current = open
  const reconciliationGeneration = reconciliationGenerationRef.current
  const invoiced = useResource<CancellationFeeInvoiceSnapshot>(
    async () => ({
      generation: reconciliationGeneration,
      response: await loadCancellationFeeInvoices(),
    }),
    [open, reconciliationGeneration],
    { enabled: open },
  )
  const alreadyInvoiced = useMemo(
    () => invoicedReservationIds(invoiced.data?.response.items ?? []),
    [invoiced.data],
  )
  /** The bookings the sheet has to ask about: no ledger link on the row. */
  const unlinkedRows = useMemo(
    () => rows.filter(row => !row.customerId?.trim() && !alreadyInvoiced.has(row.reservationId)),
    [rows, alreadyInvoiced],
  )
  const editFor = (row: ReservationCancellation) =>
    edits.get(row.reservationId) ?? recipientEditFor(row)
  const patchEdit = (row: ReservationCancellation, change: Partial<RecipientEdit>) => {
    setEdits(current => {
      const next = new Map(current)
      next.set(row.reservationId, { ...editFor(row), ...change })
      return next
    })
  }

  /**
   * What the desk decided, in the shape the plan reads.
   *
   * The number is normalised here rather than in the box: Field rejects the
   * whole invoice for one it cannot read, and losing the number is a far
   * smaller harm than losing the invoice — the sheet says so beside the box.
   */
  const assignments = useMemo(() => {
    const decided = new Map<string, CancellationFeeAssignment>()
    for (const row of unlinkedRows) {
      const edit = edits.get(row.reservationId) ?? recipientEditFor(row)
      decided.set(row.reservationId, {
        customer: edit.customer,
        name: edit.name,
        phone: normalizePhone(edit.phone),
      })
    }
    return decided
  }, [unlinkedRows, edits])

  const plan = useMemo(
    () => planCancellationFees(rows, perPlayer, alreadyInvoiced, assignments),
    [rows, perPlayer, alreadyInvoiced, assignments],
  )

  const recoveryBySourceKey = useMemo(
    () => new Map(batchRecoveries),
    [batchRecoveries],
  )
  const frozenGroupKeys = useMemo(
    () => new Set(
      plan.groups
        .map(group => batchSourceKey(group))
        .filter(sourceKey => recoveryBySourceKey.has(sourceKey)),
    ),
    [plan.groups, recoveryBySourceKey],
  )
  const hasFrozenRecovery = frozenGroupKeys.size > 0
  const frozenReservationIds = useMemo(
    () => new Set(
      [...batchRecoveries.values()].flatMap(recovery => recovery.reservationIds),
    ),
    [batchRecoveries],
  )
  const recoveryConflicts = useMemo(
    () => plan.groups.flatMap(group => {
      const sourceKey = batchSourceKey(group)
      const sourceIds = new Set(batchSourceIds(group))
      return [...batchRecoveries.entries()]
        .filter(([pendingSourceKey, recovery]) => pendingSourceKey !== sourceKey
          && recovery.reservationIds.some(reservationId => sourceIds.has(reservationId)))
        .map(([pendingSourceKey]) => `${sourceKey}:${pendingSourceKey}`)
    }),
    [plan.groups, batchRecoveries],
  )
  const hasRecoveryConflict = recoveryConflicts.length > 0
  const displayGroups = useMemo(
    () => plan.groups.map(group => {
      const recovery = batchRecoveries.get(batchSourceKey(group))
      return {
        group,
        recovery,
        amount: recovery ? batchRecoveryAmount(recovery) : group.amount,
      }
    }),
    [plan.groups, batchRecoveries],
  )
  const displayedTotal = displayGroups.reduce((total, entry) => total + entry.amount, 0)
  const frozenPreviews = displayGroups.filter(
    (entry): entry is typeof entry & { recovery: BatchRecovery } => Boolean(entry.recovery),
  )

  if (!open) return null

  const unnamed = plan.unbillable.filter(entry => entry.reason === 'unnamed')
  const alreadyBilled = plan.unbillable.filter(entry => entry.reason === 'already_invoiced')
  const reconciliationReady = Boolean(invoiced.data)
    && invoiced.data?.generation === reconciliationGeneration
    && !invoiced.loading
    && !invoiced.error

  const submit = async () => {
    if (!reconciliationReady || hasRecoveryConflict) return
    setSaving(true)
    setResults(null)
    const attempts: BillingResult[] = []
    let scopeChanged = false
    for (const group of plan.groups) {
      if (!batchRecoveryScopeMatches(batchRecoveryScope)) {
        scopeChanged = true
        break
      }
      const sourceKey = batchSourceKey(group)
      const existingRecovery = batchRecoveriesRef.current.get(sourceKey)
      const recovery = existingRecovery ?? makeBatchRecovery(group, dueDate, sendEmail, t)
      if (!existingRecovery) {
        // Save before dispatch. If Field accepts the invoice and the response
        // or CourseBoard write-back is lost, the next click must replay this
        // exact body instead of accepting a changed amount/date as new work.
        updateBatchRecoveries(next => next.set(sourceKey, recovery))
      }
      if (!batchRecoveryScopeMatches(batchRecoveryScope)) {
        scopeChanged = true
        break
      }
      try {
        const invoice = await fieldApiJson<InvoiceResponse>('/v1/invoices', {
          method: 'POST',
          body: JSON.stringify(recovery.body),
        })
        if (!invoice?.id) throw new Error('Field returned an invoice without an id')
        const completedRecovery = { ...recovery, invoiceId: invoice.id }
        updateBatchRecoveries(next => next.set(sourceKey, completedRecovery))
        if (!batchRecoveryScopeMatches(batchRecoveryScope)) {
          scopeChanged = true
          attempts.push({
            group,
            recovery: completedRecovery,
            invoiceId: invoice.id,
            error: t('cancellationFees:new.error.scopeChanged'),
          })
          break
        }
        const issue = fulfillmentIssueKind(invoice, {
          sendEmail: Boolean(recovery.body.sendEmail),
          sendSms: false,
        })
        attempts.push({
          group,
          recovery: completedRecovery,
          invoiceId: invoice.id,
          ...(issue ? { error: t(`cancellationFees:new.error.${issue}`) } : {}),
        })
      } catch (error) {
        // A definitive error is safe to discard only for the first attempt.
        // A replay can fail auth after the original request was accepted; the
        // old recovery must remain frozen so that retrying cannot mint a new
        // key for the same source set.
        if (!existingRecovery && isDefinitiveBatchCreateFailure(error)) {
          updateBatchRecoveries(next => next.delete(sourceKey))
        }
        attempts.push({
          group,
          recovery,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const invoiced = attempts.filter(attempt => attempt.invoiceId)
    const newDecisions = invoiced.flatMap(attempt =>
      attempt.recovery.decisions.map(share => ({
        reservationId: share.reservationId,
        state: 'invoiced',
        invoiceId: attempt.invoiceId,
        amount: share.amount,
      })))
    const decisions = newDecisions
    let settlementError: string | undefined
    if (scopeChanged) {
      settlementError = t('cancellationFees:new.error.scopeChanged')
      showToast({
        tone: 'danger',
        title: t('customers:cancellations.bill.recordFailed'),
        message: settlementError,
      })
    } else if (decisions.length > 0) {
      if (!batchRecoveryScopeMatches(batchRecoveryScope)) {
        settlementError = t('cancellationFees:new.error.scopeChanged')
        showToast({
          tone: 'danger',
          title: t('customers:cancellations.bill.recordFailed'),
          message: settlementError,
        })
      } else {
        try {
          await courseboardApiJson('/v1/course/reservation-cancellations/fees', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              // Attributed back to the bookings by rounds given up, so the rows
              // add up to the invoice exactly.
              decisions,
            }),
          })
          if (!batchRecoveryScopeMatches(batchRecoveryScope)) {
            settlementError = t('cancellationFees:new.error.scopeChanged')
            showToast({
              tone: 'danger',
              title: t('customers:cancellations.bill.recordFailed'),
              message: settlementError,
            })
          } else {
            const settledSourceKeys = attempts
              .filter(attempt => attempt.invoiceId)
              .map(attempt => attempt.recovery.sourceKey)
            updateBatchRecoveries(next => {
              for (const sourceKey of settledSourceKeys) next.delete(sourceKey)
            })
            onSettled()
          }
        } catch (error) {
          settlementError = error instanceof Error ? error.message : String(error)
          // The invoices exist and CourseBoard's rows do not say so, so the
          // bookings come round again on the next extraction. Billing them a
          // second time is what the retry key now prevents; what is left is to
          // say the recording failed, because until somebody looks, the club's
          // own record of who was billed is short by this batch.
          showToast({
            tone: 'danger',
            title: t('customers:cancellations.bill.recordFailed'),
            message: settlementError,
          })
        }
      }
    }

    setResults(attempts)
    setSaving(false)
    const failed = attempts.filter(attempt => attempt.error)
    const completed = attempts.filter(attempt => attempt.invoiceId && !attempt.error)
    const settledCount = completed.length
    if (failed.length === 0 && !settlementError && settledCount > 0) {
      showToast({
        tone: 'success',
        message: t('customers:cancellations.bill.done', { count: settledCount }),
      })
      onClose()
    }
  }

  return (
    <Sheet
      open
      onOpenChange={next => {
        if (!next && !saving) onClose()
      }}
      title={t('customers:cancellations.bill.title')}
      description={t('customers:cancellations.bill.description', { count: plan.groups.length })}
    >
      <div className="ledger-party-editor">
        <FormGrid columns={2}>
          <Field
            label={t('customers:cancellations.bill.perPlayer')}
            hint={t('customers:cancellations.bill.perPlayerHint')}
          >
            <Input
              type="number"
              min={1}
              value={perPlayer}
              disabled={saving || hasFrozenRecovery || hasRecoveryConflict}
              onChange={event => setPerPlayer(Number(event.target.value))}
            />
          </Field>
          <Field label={t('customers:cancellations.bill.due')}>
            <Input
              type="date"
              value={dueDate}
              disabled={saving || hasFrozenRecovery || hasRecoveryConflict}
              onChange={event => setDueDate(event.target.value)}
            />
          </Field>
        </FormGrid>

        <label className="consent-check">
          <input
            type="checkbox"
            checked={sendEmail}
            disabled={saving || hasFrozenRecovery || hasRecoveryConflict}
            onChange={event => setSendEmail(event.target.checked)}
          />
          <span>
            <strong>{t('customers:cancellations.bill.sendEmail')}</strong>
            <small>{t('customers:cancellations.bill.sendEmailHint')}</small>
          </span>
        </label>

        {invoiced.loading ? (
          <LoadingState label={t('cancellationFees:list.loading')} />
        ) : null}
        {invoiced.error ? (
          <ResourceError error={invoiced.error} onRetry={invoiced.refresh} />
        ) : null}

        {hasRecoveryConflict ? (
          <Notice
            tone="warning"
            title={t('cancellationFees:new.recovery.title')}
          >
            {t('cancellationFees:new.recovery.description')}
          </Notice>
        ) : null}

        {frozenPreviews.length > 0 ? (
          <Notice
            tone="warning"
            title={t('cancellationFees:new.recovery.title')}
          >
            <div>{t('cancellationFees:new.recovery.description')}</div>
            <ul className="fee-plan-list">
              {frozenPreviews.map(({ group, recovery, amount }) => (
                <li key={recovery.sourceKey}>
                  <strong>{batchRecoveryClientName(recovery, group.customerName)}</strong>{' '}
                  {yen(amount)}・{recovery.body.dueDate}・{recovery.decisions.length}件
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {/* Who the club has no ledger link for, and the two ways out of it:
            recognise them in the ledger, or bill the name as it stands. These
            bookings used to be reported as unbillable and dropped, which left
            every cancellation taken over the phone uncollectable. */}
        {unlinkedRows.length > 0 ? (
          <div className="fee-recipient-editor">
            <h4>{t('customers:cancellations.bill.unlinkedTitle')}</h4>
            <p className="muted">{t('customers:cancellations.bill.unlinkedHint')}</p>
            <ul className="fee-recipient-list">
              {unlinkedRows.map(row => {
                const edit = editFor(row)
                const unreadablePhone = Boolean(edit.phone.trim()) && !normalizePhone(edit.phone)
                return (
                  <li key={row.reservationId}>
                    <span className="muted">
                      {t('customers:cancellations.bill.unlinkedBooking', {
                        date: row.playedOn ? visitDate(row.playedOn, timezone) : '',
                        players: String(Math.max(1, row.players)),
                      })}
                    </span>
                    <FormGrid columns={2}>
                      <Field label={t('customers:cancellations.bill.unlinkedName')}>
                        <CustomerPicker
                          name={edit.name}
                          customerId={edit.customer?.id ?? null}
                          disabled={saving || hasFrozenRecovery || hasRecoveryConflict
                            || frozenReservationIds.has(row.reservationId)}
                          // The box opens holding the name the booking was
                          // taken under, so landing in it is a question about
                          // who that is.
                          candidatesOnFocus
                          // The ledger is written from the customer's own page,
                          // not in the middle of a morning's collection.
                          allowRegister={false}
                          onNameChange={name => patchEdit(row, {
                            name,
                            // Editing the name after a pick means this is
                            // somebody else; the old link would bill the person
                            // whose name is no longer in the box.
                            ...(edit.customer && name !== edit.customer.name
                              ? { customer: null }
                              : {}),
                          })}
                          onSelect={customer => patchEdit(row, {
                            customer,
                            ...(customer ? { name: customer.name } : {}),
                          })}
                        />
                      </Field>
                      <Field
                        label={t('customers:cancellations.bill.unlinkedPhone')}
                        requirement="optional"
                        hint={unreadablePhone
                          ? t('customers:cancellations.bill.unlinkedPhoneUnreadable')
                          : undefined}
                      >
                        <Input
                          type="tel"
                          value={edit.phone}
                          placeholder="09012345678"
                          disabled={saving || Boolean(edit.customer)
                            || hasRecoveryConflict
                            || frozenReservationIds.has(row.reservationId)}
                          onChange={event => patchEdit(row, { phone: event.target.value })}
                        />
                      </Field>
                    </FormGrid>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        {/* The bill before it is raised: who, how much, and what is being left
            out. A collection that quietly skips rows is money nobody chases. */}
        <ul className="fee-plan-list">
          {displayGroups.map(({ group, recovery, amount }) => (
            <li key={group.key}>
              <strong>{recovery
                ? batchRecoveryClientName(recovery, group.customerName)
                : group.customerName}</strong>{' '}
              <span className="muted">
                {t('customers:cancellations.bill.groupDetail', {
                  count: group.rows.length,
                  players: String(group.players),
                })}
              </span>{' '}
              {yen(amount)}
              {group.recipient.kind === 'unregistered' ? (
                <div className="muted">{t('customers:cancellations.bill.unregistered')}</div>
              ) : null}
              {group.customerEmail ? null : (
                <div className="muted">{t('customers:cancellations.bill.noEmail')}</div>
              )}
            </li>
          ))}
        </ul>

        {/* Two different surprises, so two different sentences. One is a row
            with nothing to address an invoice to; the other is a row somebody
            already was billed for. */}
        {unnamed.length > 0 ? (
          <Notice tone="warning" title={t('customers:cancellations.bill.unbillableTitle')}>
            {t('customers:cancellations.bill.unbillable', { count: unnamed.length })}
          </Notice>
        ) : null}

        {alreadyBilled.length > 0 ? (
          <Notice tone="warning" title={t('customers:cancellations.bill.alreadyInvoicedTitle')}>
            {t('customers:cancellations.bill.alreadyInvoiced', { count: alreadyBilled.length })}
          </Notice>
        ) : null}

        {results ? (
          <Notice
            tone={results.some(result => result.error) ? 'danger' : 'success'}
            title={t('customers:cancellations.bill.resultTitle')}
          >
            <ul className="fee-plan-list">
              {results.map(result => (
                <li key={result.group.key}>
                  {result.group.customerName}:{' '}
                  {result.error ?? t('customers:cancellations.bill.resultOk')}
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}

        <div className="ledger-party-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t('common:action.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={submit}
            disabled={saving || !reconciliationReady || hasRecoveryConflict || plan.groups.length === 0}
          >
            {saving
              ? t('customers:cancellations.bill.saving')
              : t('customers:cancellations.bill.submit', { total: yen(displayedTotal) })}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/**
 * Decide not to charge, with a note saying why.
 *
 * The note is not decoration. A waiver nobody can explain reads as an oversight
 * the next time the same caller cancels, and the row would otherwise sit in the
 * list forever waiting for somebody to be brave enough to clear it.
 */
function WaiveCancellationFeesSheet({
  open,
  rows,
  onClose,
  onSettled,
}: {
  open: boolean
  rows: ReservationCancellation[]
  onClose: () => void
  onSettled: () => void
}) {
  const { t } = useTranslation(['customers', 'common'])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  if (!open) return null

  const submit = async () => {
    setSaving(true)
    try {
      await courseboardApiJson('/v1/course/reservation-cancellations/fees', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decisions: rows.map(row => ({
            reservationId: row.reservationId,
            state: 'waived',
            note: note.trim() || null,
          })),
        }),
      })
      showToast({
        tone: 'success',
        message: t('customers:cancellations.waive.done', { count: rows.length }),
      })
      onSettled()
      onClose()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('customers:cancellations.waive.failed'),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open
      onOpenChange={next => {
        if (!next && !saving) onClose()
      }}
      title={t('customers:cancellations.waive.title')}
      description={t('customers:cancellations.waive.description', { count: rows.length })}
    >
      <div className="ledger-party-editor">
        <Field label={t('customers:cancellations.waive.note')} requirement="none">
          <NativeTextarea
            rows={3}
            maxLength={500}
            value={note}
            placeholder={t('customers:cancellations.waive.notePlaceholder')}
            onChange={event => setNote(event.target.value)}
          />
        </Field>
        <div className="ledger-party-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t('common:action.cancel')}
          </Button>
          <Button type="button" variant="primary" onClick={submit} disabled={saving}>
            {saving ? t('common:action.saving') : t('customers:cancellations.waive.submit')}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

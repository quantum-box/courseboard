import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import {
  CalendarCheck,
  Download,
  ExternalLink,
  FileWarning,
  Link2,
  ReceiptText,
  RotateCcw,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  currentYearMonth,
  downloadText,
  courseboardApiJson,
  courseboardApiText,
  fieldApiJson,
  yen,
} from '../../api'
import { i18next } from '../../i18n'
import {
  DataTable,
  EmptyState,
  Field,
  LoadingState,
  Metric,
  MetricGrid,
  Notice,
  PageRefreshButton,
  Panel,
  ResourceError,
} from '../../components/Page'
import { useRegisterPageReload } from '../../lib/pageReload'
import { openExternal } from '../../lib/platform'

type GolfMonthlySettlementPeriod = {
  yearMonth: string
  startDate: string
  endDate: string
}

type GolfUnpaidCancellationItem = {
  reservationId: string
  reservationNumber: string
  cancellationFeeAmount: number
  checkoutUrl?: string | null
  linkIssued: boolean
  paymentStatus: string
  invoiceId?: string | null
}

type GolfMonthlySettlementReport = {
  period: GolfMonthlySettlementPeriod
  reservations: {
    grossAmount: number
    collectedAmount: number
    refundedAmount: number
    paymentPendingAmount: number
    reservationCount: number
  }
  caddieFees: {
    total: number
    assignmentCount: number
    currency: string
  }
  cancellations: {
    feeOutstandingAmount: number
    count: number
  }
  square: {
    paymentsTotal: number
    refundsTotal: number
    unreconciledLines: number
    warning?: string | null
  }
  drilldown: {
    reservationIds: string[]
    unpaidCancellationReservationIds: string[]
    unpaidCancellationItems: GolfUnpaidCancellationItem[]
  }
}

type IssueSquareInvoiceResponse = {
  checkoutUrl: string
  reusedExistingInvoice: boolean
}

type IssuedInvoice = {
  reservationId: string
  checkoutUrl: string
  reusedExistingInvoice: boolean
}

function normalizeSquareWarning(value?: string | null) {
  if (!value) return null
  if (value.includes('square_payment_reconciliations')) {
    return i18next.t('settlement:squareUnmatchedNote')
  }
  return value
}

function paymentStatusVariant(status: string) {
  if (status === 'fee_paid' || status.toLowerCase() === 'paid') {
    return 'success' as const
  }
  if (status.toLowerCase().includes('pending')) return 'warning' as const
  return 'destructive' as const
}

/**
 * The payment status is a pass-through string from the commercial gateway, so
 * anything outside this set falls back to a label that still shows the raw
 * value instead of leaking bare English into the UI.
 */
const PAYMENT_STATUS_KEYS = new Set([
  'paid',
  'pending',
  'unpaid',
  'fee_paid',
  'fee_pending',
  'fee_unpaid',
  'refunded',
  'failed',
  'canceled',
  'cancelled',
])

function paymentStatusLabel(status: string) {
  const key = status.trim().toLowerCase()
  if (PAYMENT_STATUS_KEYS.has(key)) {
    return i18next.t(
      `settlement:billing.paymentStatusValue.${key}` as 'settlement:billing.paymentStatusValue.paid',
    )
  }
  return i18next.t('settlement:billing.paymentStatusValue.unknown', {
    value: status.trim() || '—',
  })
}

export function SettlementPage() {
  const { t } = useTranslation(['settlement', 'common'])
  const [yearMonth, setYearMonth] = useState(currentYearMonth)
  const [report, setReport] = useState<GolfMonthlySettlementReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [pendingReservationId, setPendingReservationId] = useState<string | null>(null)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  const [issuedInvoice, setIssuedInvoice] = useState<IssuedInvoice | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const payload = await courseboardApiJson<GolfMonthlySettlementReport>(
        `/v1/course/monthly-settlement?yearMonth=${encodeURIComponent(yearMonth)}`,
      )
      setReport(payload)
    } catch (error) {
      setLoadError(error)
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [yearMonth])

  useEffect(() => {
    void load()
  }, [load])

  useRegisterPageReload(load)

  async function exportCsv() {
    setExporting(true)
    setExportError(null)
    try {
      const csv = await courseboardApiText(
        `/v1/course/monthly-settlement/export.csv?yearMonth=${encodeURIComponent(yearMonth)}`,
      )
      downloadText(`golf-monthly-settlement-${yearMonth}.csv`, csv)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : t('settlement:exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  async function issueInvoice(item: GolfUnpaidCancellationItem) {
    setPendingReservationId(item.reservationId)
    setInvoiceError(null)
    setIssuedInvoice(null)
    try {
      const result = await fieldApiJson<IssueSquareInvoiceResponse>(
        `/v1/erp/reservations/${encodeURIComponent(item.reservationId)}/billing-invoice`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      )
      setIssuedInvoice({
        reservationId: item.reservationId,
        checkoutUrl: result.checkoutUrl,
        reusedExistingInvoice: result.reusedExistingInvoice,
      })
      await load()
    } catch (error) {
      setInvoiceError(
        error instanceof Error ? error.message : t('settlement:billing.issueFailed'),
      )
    } finally {
      setPendingReservationId(null)
    }
  }

  async function openCheckout(url: string) {
    try {
      const parsed = new URL(url)
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        throw new Error(t('settlement:billing.invalidUrl'))
      }
      await openExternal(parsed.toString())
    } catch (error) {
      setInvoiceError(
        error instanceof Error ? error.message : t('settlement:billing.openFailed'),
      )
    }
  }

  const squareWarning = normalizeSquareWarning(report?.square.warning)
  const netSquare = report
    ? report.square.paymentsTotal - report.square.refundsTotal
    : 0
  // The drilldown only carries IDs; the reservation number, fee and payment
  // status live on the unpaid cancellation items, so join them by ID to show
  // the same identifiers the billing table below uses.
  const unpaidCancellationById = useMemo(
    () => new Map(
      (report?.drilldown.unpaidCancellationItems ?? []).map(item => [item.reservationId, item] as const),
    ),
    [report],
  )

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <PageRefreshButton
          onClick={() => void load()}
          loading={loading}
          label={t('common:action.refresh')}
        />
        <Button type="button" onClick={() => void exportCsv()} disabled={exporting}>
          <Download /> {exporting ? t('settlement:exporting') : t('settlement:exportCsv')}
        </Button>
      </div>

      <Panel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <Field requirement="none" label={t('settlement:month')} className="sm:w-48">
            <Input
              type="month"
              value={yearMonth}
              onChange={event => setYearMonth(event.target.value || currentYearMonth())}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2 pb-1 text-xs text-muted-foreground">
            <Badge variant="outline"><CalendarCheck /> {t('settlement:badge')}</Badge>
            {report ? <span>{report.period.startDate} — {report.period.endDate}</span> : null}
          </div>
        </div>
        {exportError ? <Notice tone="danger">{exportError}</Notice> : null}
      </Panel>

      {loading ? <LoadingState label={t('settlement:loading')} /> : null}
      {!loading && loadError ? <ResourceError error={loadError} onRetry={() => void load()} /> : null}

      {!loading && !loadError && report ? (
        <>
          <Panel
            title={t('settlement:summary.title')}
            description={t('settlement:summary.description', {
              month: report.period.yearMonth,
              n: String(report.reservations.reservationCount),
            })}
            actions={<Badge variant="accent"><ReceiptText /> {t('settlement:summary.badge')}</Badge>}
          >
            <MetricGrid>
              <Metric
                label={t('settlement:summary.metrics.revenue')}
                value={yen(report.reservations.grossAmount)}
                detail={t('settlement:summary.metrics.revenueDetail', {
                  n: String(report.reservations.reservationCount),
                })}
              />
              <Metric
                label={t('settlement:summary.metrics.paid')}
                value={yen(report.reservations.collectedAmount)}
                tone="success"
                detail={t('settlement:summary.metrics.paidDetail')}
              />
              <Metric
                label={t('settlement:summary.metrics.unpaid')}
                value={yen(report.reservations.paymentPendingAmount)}
                tone={report.reservations.paymentPendingAmount > 0 ? 'warning' : 'success'}
                detail={t('settlement:summary.metrics.unpaidDetail')}
              />
              <Metric
                label={t('settlement:summary.metrics.refunded')}
                value={yen(report.reservations.refundedAmount)}
                detail={t('settlement:summary.metrics.refundedDetail')}
              />
              <Metric
                label={t('settlement:summary.metrics.caddieCost')}
                value={yen(report.caddieFees.total, report.caddieFees.currency)}
                detail={t('settlement:summary.metrics.caddieCostDetail', {
                  n: String(report.caddieFees.assignmentCount),
                })}
              />
              <Metric
                label={t('settlement:summary.metrics.unpaidCancellation')}
                value={yen(report.cancellations.feeOutstandingAmount)}
                tone={report.cancellations.count > 0 ? 'danger' : 'success'}
                detail={t('settlement:summary.metrics.unpaidCancellationDetail', {
                  n: String(report.cancellations.count),
                })}
              />
              <Metric
                label={t('settlement:summary.metrics.squareIn')}
                value={yen(report.square.paymentsTotal)}
                detail={t('settlement:summary.metrics.squareInDetail')}
              />
              <Metric
                label={t('settlement:summary.metrics.squareRefund')}
                value={yen(report.square.refundsTotal)}
                detail={t('settlement:summary.metrics.squareRefundDetail', { amount: yen(netSquare) })}
              />
              <Metric
                label={t('settlement:summary.metrics.squareUnmatched')}
                value={report.square.unreconciledLines.toLocaleString()}
                tone={report.square.unreconciledLines > 0 ? 'warning' : 'success'}
                detail={t('settlement:summary.metrics.squareUnmatchedDetail')}
              />
            </MetricGrid>
            {squareWarning ? (
              <Notice tone="warning" title={t('settlement:summary.warning')}>
                {squareWarning}
              </Notice>
            ) : null}
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              title={t('settlement:reservations.title')}
              description={t('settlement:reservations.description')}
              actions={(
                <Badge variant="neutral">
                  {t('settlement:reservations.badge', {
                    n: String(report.drilldown.reservationIds.length),
                  })}
                </Badge>
              )}
            >
              {report.drilldown.reservationIds.length === 0 ? (
                <EmptyState title={t('settlement:reservations.empty')} />
              ) : (
                <div className="flex max-h-56 flex-wrap gap-1 overflow-auto rounded-md border border-border bg-muted/20 p-3">
                  {report.drilldown.reservationIds.map(id => (
                    <code
                      key={id}
                      className="rounded-sm border border-border bg-background px-1.5 py-1 text-2xs text-subtle-foreground"
                    >
                      {id}
                    </code>
                  ))}
                </div>
              )}
            </Panel>
            <Panel
              title={t('settlement:unpaidCancellations.title')}
              description={t('settlement:unpaidCancellations.description')}
              actions={(
                <Badge variant={report.drilldown.unpaidCancellationReservationIds.length > 0 ? 'warning' : 'success'}>
                  {t('settlement:unpaidCancellations.badge', {
                    n: String(report.drilldown.unpaidCancellationReservationIds.length),
                  })}
                </Badge>
              )}
            >
              {report.drilldown.unpaidCancellationReservationIds.length === 0 ? (
                <EmptyState
                  title={t('settlement:unpaidCancellations.empty.title')}
                  description={t('settlement:unpaidCancellations.empty.description')}
                />
              ) : (
                <div className="grid max-h-56 gap-1 overflow-auto rounded-md border border-border bg-muted/20 p-3">
                  {report.drilldown.unpaidCancellationReservationIds.map(id => {
                    const item = unpaidCancellationById.get(id)
                    return (
                      <div
                        key={id}
                        className="rounded-sm border border-border bg-background px-2 py-1.5 text-sm"
                      >
                        <strong>
                          {item?.reservationNumber
                            || t('settlement:unpaidCancellations.numberUnknown')}
                        </strong>
                        <div className="text-2xs text-subtle-foreground">{id}</div>
                        {item ? (
                          <div className="text-2xs text-subtle-foreground">
                            {yen(item.cancellationFeeAmount)}
                            {' · '}
                            {paymentStatusLabel(item.paymentStatus)}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>
          </div>

          <Panel
            title={t('settlement:billing.title')}
            description={t('settlement:billing.description')}
            actions={(
              <Badge variant={report.drilldown.unpaidCancellationItems.length > 0 ? 'destructive' : 'success'}>
                <FileWarning />
                {t('settlement:billing.badge', {
                  n: String(report.drilldown.unpaidCancellationItems.length),
                })}
              </Badge>
            )}
          >
            {invoiceError ? (
              <Notice tone="danger" title={t('settlement:billing.failed')}>
                {invoiceError}
              </Notice>
            ) : null}
            {issuedInvoice ? (
              <Notice
                tone="success"
                title={issuedInvoice.reusedExistingInvoice
                  ? t('settlement:billing.reused')
                  : t('settlement:billing.issued')}
                actions={(
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void openCheckout(issuedInvoice.checkoutUrl)}
                  >
                    <ExternalLink /> {t('settlement:billing.openPayment')}
                  </Button>
                )}
              >
                {t('settlement:billing.paymentUrlNote', { id: issuedInvoice.reservationId })}
              </Notice>
            ) : null}
            <DataTable
              rows={report.drilldown.unpaidCancellationItems}
              rowKey={row => row.reservationId}
              empty={(
                <EmptyState
                  title={t('settlement:billing.empty.title')}
                  description={t('settlement:billing.empty.description')}
                />
              )}
              columns={[
                {
                  key: 'reservation',
                  header: t('settlement:billing.table.reservation'),
                  cell: row => (
                    <div>
                      <strong>{row.reservationNumber}</strong>
                      <div className="text-2xs text-subtle-foreground">{row.reservationId}</div>
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: t('settlement:billing.table.paymentStatus'),
                  cell: row => (
                    <Badge variant={paymentStatusVariant(row.paymentStatus)}>
                      {paymentStatusLabel(row.paymentStatus)}
                    </Badge>
                  ),
                },
                {
                  key: 'amount',
                  header: t('settlement:billing.table.fee'),
                  align: 'right',
                  cell: row => yen(row.cancellationFeeAmount),
                },
                {
                  key: 'invoice',
                  header: t('settlement:billing.table.invoice'),
                  cell: row => (
                    <div className="grid gap-1">
                      <Badge variant={row.linkIssued ? 'accent' : 'outline'}>
                        {row.linkIssued
                          ? t('settlement:billing.table.issued')
                          : t('settlement:billing.table.notIssued')}
                      </Badge>
                      {row.invoiceId ? (
                        <span className="text-2xs text-subtle-foreground">{row.invoiceId}</span>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: 'actions',
                  header: t('settlement:billing.table.actions'),
                  align: 'right',
                  cell: row => (
                    <div className="flex flex-wrap justify-end gap-1">
                      {row.checkoutUrl ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void openCheckout(row.checkoutUrl as string)}
                        >
                          <ExternalLink /> {t('settlement:billing.table.open')}
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant={row.linkIssued ? 'secondary' : 'primary'}
                        disabled={pendingReservationId !== null}
                        onClick={() => void issueInvoice(row)}
                      >
                        {row.linkIssued ? <RotateCcw /> : <Link2 />}
                        {pendingReservationId === row.reservationId
                          ? t('settlement:billing.table.checking')
                          : row.linkIssued
                            ? t('settlement:billing.table.checkExisting')
                            : t('settlement:billing.table.issue')}
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </Panel>

          <Panel
            title={t('settlement:checklist.title')}
            description={t('settlement:checklist.description')}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                <CalendarCheck className="mt-0.5 size-4 text-primary" />
                <div>
                  <strong>{t('settlement:checklist.reservation.title')}</strong>
                  <p className="text-xs text-muted-foreground">
                    {t('settlement:checklist.reservation.detail')}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                <Users className="mt-0.5 size-4 text-primary" />
                <div>
                  <strong>{t('settlement:checklist.caddie.title')}</strong>
                  <p className="text-xs text-muted-foreground">
                    {t('settlement:checklist.caddie.detail')}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                <ReceiptText className="mt-0.5 size-4 text-primary" />
                <div>
                  <strong>{t('settlement:checklist.payment.title')}</strong>
                  <p className="text-xs text-muted-foreground">
                    {t('settlement:checklist.payment.detail')}
                  </p>
                </div>
              </div>
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  )
}

export default SettlementPage

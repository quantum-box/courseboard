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
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  currentYearMonth,
  downloadText,
  courseboardApiJson,
  courseboardApiText,
  fieldApiJson,
  fieldTenant,
  yen,
} from '../../api'
import {
  DataTable,
  EmptyState,
  Field,
  LoadingState,
  Metric,
  MetricGrid,
  Notice,
  PageHeader,
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
    return 'Square照合テーブルが未設定です。入金・返金・未照合件数は参考値として確認してください。'
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

export function SettlementPage() {
  const tenant = useMemo(() => fieldTenant(), [])
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
      setExportError(error instanceof Error ? error.message : 'CSVを出力できませんでした。')
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
        error instanceof Error ? error.message : 'Square請求書を発行できませんでした。',
      )
    } finally {
      setPendingReservationId(null)
    }
  }

  async function openCheckout(url: string) {
    try {
      const parsed = new URL(url)
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        throw new Error('決済URLの形式が正しくありません。')
      }
      await openExternal(parsed.toString())
    } catch (error) {
      setInvoiceError(
        error instanceof Error ? error.message : '決済ページを開けませんでした。',
      )
    }
  }

  const squareWarning = normalizeSquareWarning(report?.square.warning)
  const netSquare = report
    ? report.square.paymentsTotal - report.square.refundsTotal
    : 0

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`Golf operations · ${tenant}`}
        title="月次精算"
        description="予約、キャディ費用、キャンセル料、Square照合を月単位で締め前に確認します。"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <PageRefreshButton onClick={() => void load()} loading={loading} label="更新" />
            <Button type="button" onClick={() => void exportCsv()} disabled={exporting}>
              <Download /> {exporting ? '出力中…' : 'CSVを出力'}
            </Button>
          </div>
        )}
      />

      <Panel>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <Field label="対象月" required className="sm:w-48">
            <Input
              type="month"
              value={yearMonth}
              onChange={event => setYearMonth(event.target.value || currentYearMonth())}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2 pb-1 text-xs text-muted-foreground">
            <Badge variant="outline"><CalendarCheck /> 月次運用精算</Badge>
            {report ? <span>{report.period.startDate} — {report.period.endDate}</span> : null}
          </div>
        </div>
        {exportError ? <Notice tone="danger">{exportError}</Notice> : null}
      </Panel>

      {loading ? <LoadingState label="月次精算を集計しています" /> : null}
      {!loading && loadError ? <ResourceError error={loadError} onRetry={() => void load()} /> : null}

      {!loading && !loadError && report ? (
        <>
          <Panel
            title="精算サマリー"
            description={`${report.period.yearMonth} · 予約 ${report.reservations.reservationCount} 件`}
            actions={<Badge variant="accent"><ReceiptText /> 締め前確認</Badge>}
          >
            <MetricGrid>
              <Metric
                label="予約売上"
                value={yen(report.reservations.grossAmount)}
                detail={`${report.reservations.reservationCount} 件`}
              />
              <Metric
                label="入金済み"
                value={yen(report.reservations.collectedAmount)}
                tone="success"
                detail="予約に対する入金額"
              />
              <Metric
                label="未収"
                value={yen(report.reservations.paymentPendingAmount)}
                tone={report.reservations.paymentPendingAmount > 0 ? 'warning' : 'success'}
                detail="予約売上から入金額を控除"
              />
              <Metric
                label="返金済み"
                value={yen(report.reservations.refundedAmount)}
                detail="対象月の返金"
              />
              <Metric
                label="キャディ費用"
                value={yen(report.caddieFees.total, report.caddieFees.currency)}
                detail={`${report.caddieFees.assignmentCount} 件の割当`}
              />
              <Metric
                label="未収キャンセル料"
                value={yen(report.cancellations.feeOutstandingAmount)}
                tone={report.cancellations.count > 0 ? 'danger' : 'success'}
                detail={`${report.cancellations.count} 件`}
              />
              <Metric
                label="Square入金"
                value={yen(report.square.paymentsTotal)}
                detail="取込済み照合行"
              />
              <Metric
                label="Square返金"
                value={yen(report.square.refundsTotal)}
                detail={`純入金 ${yen(netSquare)}`}
              />
              <Metric
                label="Square未照合"
                value={report.square.unreconciledLines.toLocaleString('ja-JP')}
                tone={report.square.unreconciledLines > 0 ? 'warning' : 'success'}
                detail="未突合の取込行"
              />
            </MetricGrid>
            {squareWarning ? (
              <Notice tone="warning" title="Square照合に注意事項があります">
                {squareWarning}
              </Notice>
            ) : null}
          </Panel>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              title="対象予約"
              description="この月次集計に含まれる予約ID"
              actions={<Badge variant="neutral">{report.drilldown.reservationIds.length} 件</Badge>}
            >
              {report.drilldown.reservationIds.length === 0 ? (
                <EmptyState title="対象予約はありません" />
              ) : (
                <div className="flex max-h-56 flex-wrap gap-1 overflow-auto rounded-md border border-border bg-muted/20 p-3">
                  {report.drilldown.reservationIds.map(id => (
                    <code key={id} className="rounded-sm border border-border bg-background px-1.5 py-1 text-2xs">
                      {id}
                    </code>
                  ))}
                </div>
              )}
            </Panel>
            <Panel
              title="未収キャンセル予約"
              description="請求または入金確認が必要な予約ID"
              actions={(
                <Badge variant={report.drilldown.unpaidCancellationReservationIds.length > 0 ? 'warning' : 'success'}>
                  {report.drilldown.unpaidCancellationReservationIds.length} 件
                </Badge>
              )}
            >
              {report.drilldown.unpaidCancellationReservationIds.length === 0 ? (
                <EmptyState
                  title="未収キャンセル予約はありません"
                  description="対象月のキャンセル料はすべて回収済みです。"
                />
              ) : (
                <div className="flex max-h-56 flex-wrap gap-1 overflow-auto rounded-md border border-border bg-muted/20 p-3">
                  {report.drilldown.unpaidCancellationReservationIds.map(id => (
                    <code key={id} className="rounded-sm border border-border bg-background px-1.5 py-1 text-2xs">
                      {id}
                    </code>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Panel
            title="未収キャンセル料"
            description="Square請求書は同じ予約に対して再実行しても、既存請求を再利用します。"
            actions={(
              <Badge variant={report.drilldown.unpaidCancellationItems.length > 0 ? 'destructive' : 'success'}>
                <FileWarning /> {report.drilldown.unpaidCancellationItems.length} 件
              </Badge>
            )}
          >
            {invoiceError ? (
              <Notice tone="danger" title="Square請求を処理できませんでした">
                {invoiceError}
              </Notice>
            ) : null}
            {issuedInvoice ? (
              <Notice
                tone="success"
                title={issuedInvoice.reusedExistingInvoice
                  ? '既存のSquare請求書を再利用しました'
                  : 'Square請求書を発行しました'}
                actions={(
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void openCheckout(issuedInvoice.checkoutUrl)}
                  >
                    <ExternalLink /> 決済ページを開く
                  </Button>
                )}
              >
                予約 {issuedInvoice.reservationId} の決済URLを確認できます。
              </Notice>
            ) : null}
            <DataTable
              rows={report.drilldown.unpaidCancellationItems}
              rowKey={row => row.reservationId}
              empty={(
                <EmptyState
                  title="未収キャンセル料はありません"
                  description="この期間に追加の請求操作はありません。"
                />
              )}
              columns={[
                {
                  key: 'reservation',
                  header: '予約',
                  cell: row => (
                    <div>
                      <strong>{row.reservationNumber}</strong>
                      <div className="text-2xs text-subtle-foreground">{row.reservationId}</div>
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: '支払状態',
                  cell: row => (
                    <Badge variant={paymentStatusVariant(row.paymentStatus)}>
                      {row.paymentStatus}
                    </Badge>
                  ),
                },
                {
                  key: 'amount',
                  header: 'キャンセル料',
                  align: 'right',
                  cell: row => yen(row.cancellationFeeAmount),
                },
                {
                  key: 'invoice',
                  header: '請求',
                  cell: row => (
                    <div className="grid gap-1">
                      <Badge variant={row.linkIssued ? 'accent' : 'outline'}>
                        {row.linkIssued ? '発行済み' : '未発行'}
                      </Badge>
                      {row.invoiceId ? (
                        <span className="text-2xs text-subtle-foreground">{row.invoiceId}</span>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: 'actions',
                  header: '操作',
                  align: 'right',
                  cell: row => (
                    <div className="flex flex-wrap justify-end gap-1">
                      {row.checkoutUrl ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void openCheckout(row.checkoutUrl as string)}
                        >
                          <ExternalLink /> 開く
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
                          ? '確認中…'
                          : row.linkIssued
                            ? '既存請求を確認'
                            : '請求書を発行'}
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </Panel>

          <Panel
            title="締め前チェック"
            description="この画面はゴルフ運用精算です。会計の月次締めとは分けて実施します。"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                <CalendarCheck className="mt-0.5 size-4 text-primary" />
                <div><strong>予約</strong><p className="text-xs text-muted-foreground">売上・入金・返金の差分を確認</p></div>
              </div>
              <div className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                <Users className="mt-0.5 size-4 text-primary" />
                <div><strong>キャディ</strong><p className="text-xs text-muted-foreground">割当件数と費用を確認</p></div>
              </div>
              <div className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                <ReceiptText className="mt-0.5 size-4 text-primary" />
                <div><strong>決済</strong><p className="text-xs text-muted-foreground">未収とSquare未照合を解消</p></div>
              </div>
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  )
}

export default SettlementPage

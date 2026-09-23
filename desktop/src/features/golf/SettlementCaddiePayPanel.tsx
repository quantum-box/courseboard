import { Badge, Button } from '@tachyon-sdk/native-ui'
import { Users } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, courseboardApiJson, yen } from '../../api'
import {
  DataTable,
  LoadingState,
  Metric,
  MetricGrid,
  Notice,
  Panel,
  ResourceError,
  type DataTableColumn,
} from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { navigate } from '../../lib/router'
import type { PayrollRow, RankTotals } from './caddieRankFees'
import { settlementCaddiePay } from './settlementCaddiePay'

type PayrollResponse = {
  items: PayrollRow[]
}

/**
 * The month's caddie pay, broken down by rank, beside what the assignments
 * committed to (PLT-3347).
 *
 * Read from the payroll summary rather than folded into the settlement
 * response: pay is its own permission, and someone allowed to close the month
 * but not to see pay should still get the rest of the close. A refusal hides
 * the block; any other failure says so here and leaves the page usable.
 */
export function SettlementCaddiePayPanel({
  yearMonth,
  committed,
}: {
  yearMonth: string
  committed: { total: number, currency: string }
}) {
  const { t } = useTranslation(['settlement', 'common'])
  const resource = useResource(
    () => courseboardApiJson<PayrollResponse>(
      `/v1/course/caddie-payroll-summary?yearMonth=${encodeURIComponent(yearMonth)}`,
    ),
    [yearMonth],
    // Same key as the payroll screen: it is the same answer, and moving
    // between the two should not fetch the month twice.
    { cacheKey: `caddie-payroll:${yearMonth}` },
  )
  const pay = useMemo(
    () => resource.data ? settlementCaddiePay(resource.data.items, committed) : null,
    [resource.data, committed],
  )

  if (resource.error instanceof ApiError && resource.error.status === 403) return null

  const columns: DataTableColumn<RankTotals>[] = [
    {
      key: 'rank',
      header: t('settlement:caddiePay.byRank.rank'),
      mobileLabel: t('settlement:caddiePay.byRank.rank'),
      cell: item => <strong>{item.rank}</strong>,
    },
    {
      key: 'caddies',
      header: t('settlement:caddiePay.byRank.caddies'),
      mobileLabel: t('settlement:caddiePay.byRank.caddies'),
      align: 'right',
      cell: item => (
        <div>
          {t('settlement:caddiePay.byRank.caddiesValue', { n: String(item.caddies) })}
          {item.overridden > 0 ? (
            <div className="text-2xs text-subtle-foreground">
              {t('settlement:caddiePay.byRank.overridden', { n: String(item.overridden) })}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'rounds',
      header: t('settlement:caddiePay.byRank.rounds'),
      mobileLabel: t('settlement:caddiePay.byRank.rounds'),
      align: 'right',
      cell: item => item.rounds.toLocaleString(),
    },
    {
      key: 'fees',
      header: t('settlement:caddiePay.byRank.fees'),
      mobileLabel: t('settlement:caddiePay.byRank.fees'),
      align: 'right',
      cell: item => yen(item.fees, pay?.currency),
    },
  ]

  return (
    <Panel
      title={t('settlement:caddiePay.title')}
      description={t('settlement:caddiePay.description')}
      actions={(
        <Button
          type="button"
          variant="secondary"
          onClick={() => navigate(`golf/caddies/payroll?yearMonth=${encodeURIComponent(yearMonth)}`)}
        >
          <Users /> {t('settlement:caddiePay.openPayroll')}
        </Button>
      )}
    >
      {resource.loading && !resource.data ? <LoadingState label={t('settlement:caddiePay.loading')} /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {pay ? (
        <div className="space-y-3">
          <MetricGrid>
            <Metric
              label={t('settlement:caddiePay.metrics.fees')}
              value={yen(pay.fees, pay.currency)}
              detail={t('settlement:caddiePay.metrics.feesDetail', {
                caddies: String(pay.caddiesOnRounds),
                rounds: String(pay.rounds),
              })}
            />
            <Metric
              label={t('settlement:caddiePay.metrics.committed')}
              value={yen(pay.committed, committed.currency)}
              tone={pay.difference ? 'warning' : 'neutral'}
              detail={pay.difference === null
                ? t('settlement:caddiePay.metrics.committedOtherCurrency')
                : t('settlement:caddiePay.metrics.committedDetail', {
                  amount: `${pay.difference > 0 ? '+' : ''}${yen(pay.difference, pay.currency)}`,
                })}
            />
            <Metric
              label={t('settlement:caddiePay.metrics.toCheck')}
              value={t('settlement:caddiePay.metrics.toCheckValue', { n: String(pay.caddiesToCheck) })}
              tone={pay.caddiesToCheck > 0 ? 'warning' : 'success'}
              detail={t('settlement:caddiePay.metrics.toCheckDetail')}
            />
          </MetricGrid>
          {pay.difference ? (
            <Notice tone="warning" title={t('settlement:caddiePay.gap.title')}>
              {t('settlement:caddiePay.gap.description')}
            </Notice>
          ) : null}
          <div className="flex items-center gap-2">
            <strong className="text-sm">{t('settlement:caddiePay.byRank.title')}</strong>
            <Badge variant="outline">{t('settlement:caddiePay.byRank.badge')}</Badge>
          </div>
          <DataTable rows={pay.byRank} rowKey={item => item.rank} columns={columns} />
        </div>
      ) : null}
    </Panel>
  )
}

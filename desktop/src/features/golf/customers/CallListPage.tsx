import { Button, Input } from '@tachyon-sdk/native-ui'
import { ChevronLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import {
  DataTable,
  type DataTableColumn,
  EmptyState,
  Field,
  FormGrid,
  LoadingState,
  NativeSelect,
  Notice,
  Panel,
  ResourceError,
} from '../../../components/Page'
import { useTenantTimezone } from '../../../context/TenantTimezoneProvider'
import { useResource } from '../../../hooks/useResource'
import { navigate, navigateFromClick } from '../../../lib/router'
import {
  CALL_LIST_DEFAULTS,
  CALL_LIST_ROWS,
  callListQuery,
  daysSince,
  isStale,
  type CallListFilters,
  type CallListSort,
  type CustomerSummaryPage,
  type CustomerSummaryRow,
} from './callList'
import { visitDate } from './visits'

/** Same as the other rosters: a screenful of rows, then a pager. */
const PAGE_SIZE = 20

const SORTS: CallListSort[] = ['total_amount', 'visits', 'last_visit']

/**
 * Who to ring, and why them.
 *
 * The club rings people to ask them back, and until now picked who by reading
 * down a printed list. Nothing could rank the ledger by what somebody is worth
 * or by how long since they last played, because those figures only existed one
 * customer at a time.
 *
 * So this screen is a filter, not a table: the desk describes the slice it
 * wants — spent this much, came this often, has not been seen for this long —
 * and works down what comes back. The default is the one the club already means
 * by "again soon": regulars who have gone quiet, richest first.
 *
 * Its own route rather than a panel under the ledger, because it is a morning's
 * work and has to survive a reload with its filters intact.
 */
export function CallListPage() {
  const { t } = useTranslation(['customers', 'common'])
  const timezone = useTenantTimezone()
  const [filters, setFilters] = useState<CallListFilters>(CALL_LIST_DEFAULTS)
  const query = callListQuery(filters)

  // Keyed by the query so changing a filter re-reads rather than showing the
  // previous segment under the new description of it.
  const resource = useResource(
    () => courseboardApiJson<CustomerSummaryPage>(query),
    [query],
    { cacheKey: `customer:summaries:${query}` },
  )

  const page = resource.data ?? null
  const rows = page?.items ?? []
  // One clock for the whole render, so two rows measured a millisecond apart
  // cannot disagree about what "90 days ago" means.
  const now = Date.now()
  const stale = isStale(page?.lastRun, now)

  const columns = useMemo<DataTableColumn<CustomerSummaryRow>[]>(() => [
    {
      key: 'name',
      header: t('customers:field.name'),
      cell: row => <strong>{row.name ?? t('customers:callList.unnamed')}</strong>,
      sortValue: row => row.name ?? null,
    },
    {
      key: 'phone',
      header: t('customers:field.phone'),
      // The one column the desk cannot work without. A row with no number is
      // kept — it is still a lapsed regular, and somebody may have the number
      // elsewhere — but it says so rather than leaving a blank to squint at.
      cell: row => row.phone ?? <span className="muted">{t('customers:noContact')}</span>,
      sortValue: row => row.phone ?? null,
    },
    {
      key: 'lastVisit',
      header: t('customers:callList.column.lastVisit'),
      cell: row => {
        if (!row.lastVisitAt) return null
        const days = daysSince(row.lastVisitAt, now)
        return (
          <>
            {visitDate(row.lastVisitAt, timezone)}
            {days === null ? null : (
              <>
                {' '}
                <span className="muted">{t('customers:callList.daysAgo', { count: days })}</span>
              </>
            )}
          </>
        )
      },
      sortValue: row => (row.lastVisitAt ? Date.parse(row.lastVisitAt) : null),
    },
    {
      key: 'visits',
      header: t('customers:visits.metric.visits'),
      align: 'right',
      cell: row => row.visits,
      sortValue: row => row.visits,
    },
    {
      key: 'totalAmount',
      header: t('customers:callList.column.totalAmount'),
      align: 'right',
      // Zero means "nothing recorded" far more often than it means free rounds,
      // which is why it is blank rather than a nought.
      cell: row => (row.totalAmount > 0 ? row.totalAmount.toLocaleString() : ''),
      sortValue: row => (row.totalAmount > 0 ? row.totalAmount : null),
    },
    {
      key: 'spendPerPlayer',
      header: t('customers:visits.metric.spendPerPlayer'),
      align: 'right',
      cell: row => (row.spendPerPlayer ? row.spendPerPlayer.toLocaleString() : ''),
      sortValue: row => row.spendPerPlayer ?? null,
    },
    {
      key: 'grade',
      header: t('customers:visits.metric.grade'),
      align: 'right',
      // Only a real grade is shown. "Not configured" is about the club and
      // "unknown" is about a partial count — neither is a fact about this
      // person, and putting either in a column would read as one.
      cell: row => (row.grade === 'graded' ? row.gradeName : null),
      sortValue: row => (row.grade === 'graded' ? row.gradeName ?? null : null),
    },
  ], [now, t, timezone])

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
        title={t('customers:callList.filters.title')}
        description={t('customers:callList.filters.description')}
      >
        <FormGrid columns={2}>
          <Field label={t('customers:callList.filters.sort')}>
            <NativeSelect
              value={filters.sort}
              onChange={event => setFilters(current => ({
                ...current,
                sort: event.target.value as CallListSort,
              }))}
            >
              {SORTS.map(sort => (
                <option key={sort} value={sort}>
                  {t(`customers:callList.sort.${sort}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label={t('customers:callList.filters.minDays')}
            hint={t('customers:callList.filters.minDaysHint')}
          >
            <Input
              inputMode="numeric"
              value={filters.minDaysSinceLastVisit}
              onChange={event => setFilters(current => ({
                ...current,
                minDaysSinceLastVisit: event.target.value,
              }))}
            />
          </Field>
          <Field
            label={t('customers:callList.filters.minVisits')}
            hint={t('customers:callList.filters.minVisitsHint')}
          >
            <Input
              inputMode="numeric"
              value={filters.minVisits}
              onChange={event => setFilters(current => ({
                ...current,
                minVisits: event.target.value,
              }))}
            />
          </Field>
          <Field label={t('customers:callList.filters.minTotalAmount')}>
            <Input
              inputMode="numeric"
              value={filters.minTotalAmount}
              onChange={event => setFilters(current => ({
                ...current,
                minTotalAmount: event.target.value,
              }))}
            />
          </Field>
        </FormGrid>
      </Panel>

      <Panel
        title={t('customers:callList.results.title')}
        description={page
          ? t('customers:callList.results.description', { count: page.total })
          : undefined}
      >
        {/* Nothing in the figures admits to being three months old, so the
            screen has to. A stale list is worse than no list: it sends the desk
            to people who came in last week. */}
        {page?.lastRun ? (
          <Notice tone={stale ? 'warning' : 'info'}>
            {page.lastRun.status === 'failed'
              ? t('customers:callList.run.failed', {
                date: visitDate(page.lastRun.finishedAt ?? page.lastRun.startedAt, timezone),
              })
              : t('customers:callList.run.succeeded', {
                date: visitDate(page.lastRun.finishedAt ?? page.lastRun.startedAt, timezone),
              })}
          </Notice>
        ) : null}
        {!resource.loading && !resource.error && !page?.lastRun ? (
          <Notice tone="warning">{t('customers:callList.run.never')}</Notice>
        ) : null}

        {resource.loading ? <LoadingState /> : null}
        {resource.error ? (
          <ResourceError error={resource.error} onRetry={() => void resource.refresh()} />
        ) : null}

        {/* Said once, above the rows: the segment can be larger than what is
            listed, and a desk that worked to the bottom should know there is
            more rather than conclude it has rung everybody. */}
        {page && page.total > rows.length ? (
          <p className="customer-ledger-hint">
            {t('customers:callList.results.capped', { count: CALL_LIST_ROWS })}
          </p>
        ) : null}

        {!resource.loading && !resource.error ? (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={row => row.customerId}
            onRowClick={row => navigate(`golf/customers/${row.customerId}`)}
            pageSize={PAGE_SIZE}
            empty={(
              <EmptyState
                title={t('customers:callList.empty.title')}
                description={t('customers:callList.empty.description')}
              />
            )}
          />
        ) : null}
      </Panel>
    </div>
  )
}

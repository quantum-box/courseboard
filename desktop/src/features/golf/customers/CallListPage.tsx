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
import { useKeptData } from '../../../hooks/useKeptData'
import { useResource } from '../../../hooks/useResource'
import { navigate, navigateFromClick } from '../../../lib/router'
import {
  CALL_LIST_DEFAULTS,
  CALL_LIST_PAGE_SIZE,
  CALL_LIST_SORT_COLUMNS,
  callListQuery,
  callListSortForColumn,
  daysSince,
  isStale,
  naturalAscending,
  type CallListFilters,
  type CallListSort,
  type CustomerSummaryPage,
  type CustomerSummaryRow,
} from './callList'
import { visitDate } from './visits'

const SORTS: CallListSort[] = ['total_amount', 'visits', 'last_visit', 'spend_per_player']

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
  const [filters, setFiltersState] = useState<CallListFilters>(CALL_LIST_DEFAULTS)
  const [pageIndex, setPageIndex] = useState(0)
  const query = callListQuery(filters, pageIndex)
  // A new segment starts from its first page; page three of the old one means
  // nothing under the new filters.
  const setFilters = (change: (current: CallListFilters) => CallListFilters) => {
    setFiltersState(change)
    setPageIndex(0)
  }

  // Keyed by the query so changing a filter re-reads rather than showing the
  // previous segment under the new description of it.
  const resource = useResource(
    () => courseboardApiJson<CustomerSummaryPage>(query),
    [query],
    { cacheKey: `customer:summaries:${query}` },
  )

  // The segment can run to thousands, so the server sorts and pages it and
  // only the page on screen is fetched. The previous page stays up, dimmed,
  // while the next one loads.
  const page = useKeptData(resource.data)
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
    },
    {
      key: 'phone',
      header: t('customers:field.phone'),
      // The one column the desk cannot work without. A row with no number is
      // kept — it is still a lapsed regular, and somebody may have the number
      // elsewhere — but it says so rather than leaving a blank to squint at.
      cell: row => row.phone ?? <span className="muted">{t('customers:noContact')}</span>,
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
      serverSortable: true,
    },
    {
      key: 'visits',
      header: t('customers:visits.metric.visits'),
      align: 'right',
      cell: row => row.visits,
      serverSortable: true,
    },
    {
      key: 'totalAmount',
      header: t('customers:callList.column.totalAmount'),
      align: 'right',
      // Zero means "nothing recorded" far more often than it means free rounds,
      // which is why it is blank rather than a nought.
      cell: row => (row.totalAmount > 0 ? row.totalAmount.toLocaleString() : ''),
      serverSortable: true,
    },
    {
      key: 'spendPerPlayer',
      header: t('customers:visits.metric.spendPerPlayer'),
      align: 'right',
      cell: row => (row.spendPerPlayer ? row.spendPerPlayer.toLocaleString() : ''),
      serverSortable: true,
    },
    {
      key: 'grade',
      header: t('customers:visits.metric.grade'),
      align: 'right',
      // Only a real grade is shown. "Not configured" is about the club and
      // "unknown" is about a partial count — neither is a fact about this
      // person, and putting either in a column would read as one.
      cell: row => (row.grade === 'graded' ? row.gradeName : null),
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
              onChange={event => {
                const sort = event.target.value as CallListSort
                setFilters(current => ({ ...current, sort, ascending: naturalAscending(sort) }))
              }}
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

        {resource.loading && !page ? <LoadingState /> : null}
        {resource.error ? (
          <ResourceError error={resource.error} onRetry={() => void resource.refresh()} />
        ) : null}


        {page && !resource.error ? (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={row => row.customerId}
            onRowClick={row => navigate(`golf/customers/${row.customerId}`)}
            pageSize={CALL_LIST_PAGE_SIZE}
            server={{
              page: pageIndex,
              onPageChange: setPageIndex,
              total: page.total,
              loading: resource.loading || resource.data !== page,
              sort: {
                key: CALL_LIST_SORT_COLUMNS[filters.sort],
                direction: filters.ascending ? 'asc' : 'desc',
              },
              onSortChange: next => {
                const sort = callListSortForColumn(next.key)
                if (!sort) return
                setFilters(current => ({
                  ...current,
                  sort,
                  // A new column starts the way round the desk reads it; the
                  // same column again turns it over.
                  ascending: current.sort === sort ? !current.ascending : naturalAscending(sort),
                }))
              },
            }}
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

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import {
  DataTable,
  type DataTableColumn,
  EmptyState,
  LoadingState,
  Metric,
  MetricGrid,
  Notice,
  Panel,
  ResourceError,
} from '../../../components/Page'
import { useTenantTimezone } from '../../../context/TenantTimezoneProvider'
import { useResource } from '../../../hooks/useResource'
import {
  customerVisitsPath,
  roundsPerYear,
  visitDate,
  visitTime,
  type CustomerVisit,
  type CustomerVisitHistory,
} from './visits'

type CourseList = { items: { id: string; name: string }[] }

/**
 * What one person has played here.
 *
 * The half of a customer's page the desk actually opens it for: a regular is
 * recognised by how often they come and what they spend, not by their kana.
 *
 * These are the bookings taken *for* this person. Field records one customer
 * per reservation, so somebody who plays every month in a colleague's group has
 * nothing here — which is why the panel says whose bookings it is showing
 * rather than letting an empty table read as "never been".
 */
export function CustomerVisitsPanel({ customerId }: { customerId: string }) {
  const { t } = useTranslation(['customers', 'common'])
  const timezone = useTenantTimezone()

  const resource = useResource(
    () => courseboardApiJson<CustomerVisitHistory>(customerVisitsPath(customerId)),
    [customerId],
    { cacheKey: `customer:visits:${customerId}` },
  )

  // Shares the ledger's cache key, so opening a customer costs no extra call
  // on a desk that has already had the tee sheet open.
  const coursesResource = useResource(
    () => courseboardApiJson<CourseList>('/v1/course/courses'),
    [],
    { cacheKey: 'courses:list' },
  )

  const courseNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const course of coursesResource.data?.items ?? []) names.set(course.id, course.name)
    return names
  }, [coursesResource.data])

  const history = resource.data ?? null
  const summary = history?.summary ?? null
  const frequency = summary ? roundsPerYear(summary) : null

  const columns = useMemo<DataTableColumn<CustomerVisit>[]>(
    () => [
      {
        key: 'date',
        header: t('customers:visits.column.date'),
        cell: visit => (
          <>
            <strong>{visitDate(visit.startsAt, timezone)}</strong>{' '}
            <span className="muted">{visitTime(visit.startsAt, timezone)}</span>
          </>
        ),
        sortValue: visit => visit.startsAt,
      },
      {
        key: 'kind',
        header: t('customers:visits.column.kind'),
        // `other` has no golf word for what it is, so it shows Field's status
        // rather than a label invented to fill the cell.
        cell: visit =>
          visit.kind === 'other' ? (
            <span className="muted">{visit.status}</span>
          ) : (
            <span className={`visit-kind visit-kind-${visit.kind.replace('_', '-')}`}>
              {t(`customers:visits.kind.${visit.kind}`)}
            </span>
          ),
        sortValue: visit => visit.kind,
      },
      {
        key: 'course',
        header: t('customers:visits.column.course'),
        // Blank, not a dash: a booking taken before the group was put on a
        // course is normal, and this column has nothing to say about it.
        cell: visit => (visit.courseId ? (courseNames.get(visit.courseId) ?? '') : ''),
        sortValue: visit => (visit.courseId ? (courseNames.get(visit.courseId) ?? '') : null),
      },
      {
        key: 'players',
        header: t('customers:visits.column.players'),
        align: 'right',
        cell: visit => visit.players,
        sortValue: visit => visit.players,
      },
      {
        key: 'amount',
        header: t('customers:visits.column.amount'),
        align: 'right',
        // Zero means "no amount recorded" far more often than it means free,
        // and a column of ¥0 reads as a course giving rounds away.
        cell: visit => (visit.amount > 0 ? visit.amount.toLocaleString() : ''),
        sortValue: visit => (visit.amount > 0 ? visit.amount : null),
      },
      {
        key: 'reservationNumber',
        header: t('customers:visits.column.reservationNumber'),
        cell: visit => <span className="muted">{visit.reservationNumber}</span>,
        sortValue: visit => visit.reservationNumber,
      },
    ],
    [courseNames, t, timezone],
  )

  return (
    <Panel title={t('customers:visits.title')} description={t('customers:visits.description')}>
      {resource.loading ? <LoadingState /> : null}
      {resource.error ? (
        <ResourceError error={resource.error} onRetry={() => void resource.refresh()} />
      ) : null}

      {history && summary ? (
        <>
          {/* Hidden when there is nothing to summarise: the empty state below
              says it already, and a row of zeroes above it only makes the desk
              read four figures to learn the same thing. */}
          {history.items.length > 0 ? (
            <MetricGrid>
              {/* Only shown when the club actually grades people. A club with
                  no ladder should see no gap where a grade would be, rather
                  than a tile reading "not set" about their own setup. */}
              {history.grade !== 'not_configured' ? (
                <Metric
                  label={t('customers:visits.metric.grade')}
                  value={
                    history.grade === 'graded' && history.gradeName
                      ? history.gradeName
                      : t('common:state.unset')
                  }
                  tone={history.grade === 'graded' ? 'success' : 'neutral'}
                  detail={
                    history.grade === 'graded'
                      ? undefined
                      : t(`customers:visits.metric.grade_${history.grade}`)
                  }
                />
              ) : null}
              <Metric
                label={t('customers:visits.metric.visits')}
                value={summary.visits.toLocaleString()}
                detail={
                  summary.lastVisitAt
                    ? t('customers:visits.metric.lastVisit', {
                        date: visitDate(summary.lastVisitAt, timezone),
                      })
                    : undefined
                }
              />
              <Metric
                label={t('customers:visits.metric.spendPerPlayer')}
                value={
                  summary.spendPerPlayer != null
                    ? summary.spendPerPlayer.toLocaleString()
                    : t('common:state.unset')
                }
                detail={
                  summary.unpricedVisits > 0
                    ? t('customers:visits.metric.unpriced', { count: summary.unpricedVisits })
                    : undefined
                }
              />
              <Metric
                label={t('customers:visits.metric.frequency')}
                value={frequency != null ? String(frequency) : t('common:state.unset')}
                // Why it is blank, and the truncated case first: on a long
                // history the reason is that the earlier rounds were never
                // read, not that there are too few of them to measure.
                detail={
                  frequency != null
                    ? undefined
                    : history.truncated
                      ? t('customers:visits.metric.frequencyTruncated')
                      : t('customers:visits.metric.frequencyUnknown')
                }
              />
              <Metric
                label={t('customers:visits.metric.cancelled')}
                value={summary.cancelled.toLocaleString()}
                tone={summary.noShows > 0 ? 'warning' : 'neutral'}
                detail={
                  summary.noShows > 0
                    ? t('customers:visits.metric.noShows', { count: summary.noShows })
                    : undefined
                }
              />
            </MetricGrid>
          ) : null}

          {/* Said before the table is read, not after: a count that quietly
              meant "the last fifty" is the one mistake this panel can make. */}
          {history.truncated ? (
            <Notice tone="warning">
              {t('customers:visits.truncated', { count: history.items.length })}
            </Notice>
          ) : null}

          <DataTable
            rows={history.items}
            columns={columns}
            rowKey={visit => visit.reservationId}
            pageSize={10}
            empty={
              <EmptyState
                title={t('customers:visits.empty.title')}
                description={t('customers:visits.empty.description')}
              />
            }
          />
        </>
      ) : null}
    </Panel>
  )
}

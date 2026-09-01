import { Button } from '@tachyon-sdk/native-ui'
import { History } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import { EmptyState, LoadingState, Panel, ResourceError } from '../../../components/Page'
import { useTenantTimezone } from '../../../context/TenantTimezoneProvider'
import { useResource } from '../../../hooks/useResource'
import {
  formatMembershipActivity,
  formatMembershipActivityActor,
  formatMembershipActivityDateTime,
  formatMembershipActivitySnapshot,
  formatMembershipActivitySource,
  formatMembershipActivityTarget,
  membershipActivitiesPath,
  MEMBERSHIP_ACTIVITY_PAGE_SIZE,
  type MembershipActivity,
  type MembershipActivityPage,
  type MembershipActivityTranslate,
} from './membership-activities'

function uniqueActivities(items: readonly MembershipActivity[]) {
  const seen = new Set<string>()
  return items.filter(activity => {
    if (seen.has(activity.id)) return false
    seen.add(activity.id)
    return true
  })
}

type PaginationState = Readonly<{
  scopeKey: string
  items: readonly MembershipActivity[]
  continuationCursor: string | null
  hasLoadedMore: boolean
  loadingRequestId: number | null
  error: unknown | null
}>

function emptyPagination(scopeKey: string): PaginationState {
  return {
    scopeKey,
    items: [],
    continuationCursor: null,
    hasLoadedMore: false,
    loadingRequestId: null,
    error: null,
  }
}

let nextLoadMoreRequestId = 0

function ActivityRow({
  activity,
  timezone,
  locale,
  translate,
  t,
}: {
  activity: MembershipActivity
  timezone: string
  locale: string
  translate: MembershipActivityTranslate
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const formatContext = { timezone, locale }
  const presentation = formatMembershipActivity(activity, translate, formatContext)
  const target = formatMembershipActivityTarget(activity.target)
  const source = formatMembershipActivitySource(activity.source, translate)
  const before = formatMembershipActivitySnapshot(activity.kind, activity.before, translate, formatContext)
  const after = formatMembershipActivitySnapshot(activity.kind, activity.after, translate, formatContext)
  const hasSnapshots = activity.before !== null || activity.after !== null

  return (
    <li className="membership-activity-row">
      <History aria-hidden="true" className="membership-activity-icon" />
      <div className="membership-activity-copy">
        <div className="membership-activity-heading">
          <strong>{presentation.kindLabel}</strong>
          <span>{presentation.summary}</span>
        </div>
        <dl className="membership-activity-meta">
          <div>
            <dt>{t('date')}</dt>
            <dd>
              <time dateTime={activity.occurredAt}>
                {formatMembershipActivityDateTime(activity.occurredAt, timezone, locale)}
              </time>
            </dd>
          </div>
          <div>
            <dt>{t('actor')}</dt>
            <dd>{formatMembershipActivityActor(activity.actor)}</dd>
          </div>
          {target ? (
            <div>
              <dt>{t('target')}</dt>
              <dd>{target}</dd>
            </div>
          ) : null}
          {source ? (
            <div>
              <dt>{t('source')}</dt>
              <dd>{source}</dd>
            </div>
          ) : null}
        </dl>
        {hasSnapshots ? (
          <details className="membership-activity-snapshots">
            <summary>{t('details')}</summary>
            <dl>
              {activity.before !== null ? (
                <div>
                  <dt>{t('before')}</dt>
                  <dd>{before || t('snapshot.unavailable')}</dd>
                </div>
              ) : null}
              {activity.after !== null ? (
                <div>
                  <dt>{t('after')}</dt>
                  <dd>{after || t('snapshot.unavailable')}</dd>
                </div>
              ) : null}
            </dl>
          </details>
        ) : null}
      </div>
    </li>
  )
}

/**
 * Field-owned membership changes, kept as a panel of their own so the Golf
 * visit history remains about rounds and check-ins.  A successful empty page
 * is the only state that renders EmptyState; a 404 remains ResourceError.
 */
export function MembershipActivityPanel({
  customerId,
  refreshRevision = 0,
}: {
  customerId: string
  /** Advances after a sibling membership mutation succeeds. */
  refreshRevision?: number
}) {
  const { t, i18n } = useTranslation(['membershipActivity', 'common'])
  const timezone = useTenantTimezone()
  const scopeKey = `${customerId}\u0000${refreshRevision}`
  // Scope the shared resource as well: on a revision change, useResource must
  // not synchronously surface the prior revision's first-page data or error.
  const resourceCacheKey = `customer:membership-activities:${scopeKey}`
  const [pagination, setPagination] = useState<PaginationState>(() => emptyPagination(scopeKey))

  const resource = useResource(
    () =>
      courseboardApiJson<MembershipActivityPage>(
        membershipActivitiesPath(customerId, MEMBERSHIP_ACTIVITY_PAGE_SIZE),
      ),
    [customerId, refreshRevision],
    { cacheKey: resourceCacheKey },
  )

  // Do not let a previous customer/revision's local pagination state cross the
  // render boundary. The effect installs the new scope after commit; until it
  // does, rendering derives only from the current resource.
  const activePagination = pagination.scopeKey === scopeKey ? pagination : null

  useEffect(() => {
    let effectIsCurrent = true
    setPagination(current => {
      if (!effectIsCurrent || current.scopeKey === scopeKey) return current
      return emptyPagination(scopeKey)
    })
    return () => {
      effectIsCurrent = false
    }
  }, [scopeKey])

  useEffect(() => {
    let effectIsCurrent = true
    if (resource.data) {
      const firstPage = resource.data
      setPagination(current => {
        if (!effectIsCurrent || current.scopeKey !== scopeKey) return current
        // Field's feed is append-only. A revalidated first page can gain a new
        // head and drop an old tail without invalidating items previously shown,
        // so retain their union and let the newest first page win duplicate ids.
        return {
          ...current,
          items: uniqueActivities([...firstPage.items, ...current.items]),
          continuationCursor: current.hasLoadedMore
            ? current.continuationCursor
            : (firstPage.nextCursor ?? null),
        }
      })
    }
    return () => {
      effectIsCurrent = false
    }
  }, [resource.data, scopeKey])

  // Apply a just-arrived first page synchronously for this render as well as
  // persisting it in the effect above. This prevents a transient duplicate or
  // gap while React schedules the merge.
  const items = resource.data
    ? uniqueActivities([...resource.data.items, ...(activePagination?.items ?? [])])
    : activePagination && activePagination.items.length > 0
      ? activePagination.items
      : null
  const nextCursor = activePagination?.continuationCursor ?? null
  const loadingMore = activePagination?.loadingRequestId !== null
  const loadMoreError = activePagination?.error ?? null

  const loadMore = async () => {
    if (!activePagination || !items || !nextCursor || loadingMore) return
    const capturedScope = scopeKey
    const capturedCursor = nextCursor
    const requestId = nextLoadMoreRequestId + 1
    nextLoadMoreRequestId = requestId
    setPagination(current => {
      if (
        current.scopeKey !== capturedScope ||
        current.continuationCursor !== capturedCursor ||
        current.loadingRequestId !== null
      ) return current
      return { ...current, loadingRequestId: requestId, error: null }
    })
    try {
      const page = await courseboardApiJson<MembershipActivityPage>(
        membershipActivitiesPath(customerId, MEMBERSHIP_ACTIVITY_PAGE_SIZE, capturedCursor),
      )
      setPagination(current => {
        if (current.scopeKey !== capturedScope || current.loadingRequestId !== requestId) {
          return current
        }
        return {
          ...current,
          items: uniqueActivities([...current.items, ...page.items]),
          continuationCursor: page.nextCursor ?? null,
          hasLoadedMore: true,
          loadingRequestId: null,
        }
      })
    } catch (error) {
      setPagination(current => {
        if (current.scopeKey !== capturedScope || current.loadingRequestId !== requestId) {
          return current
        }
        return { ...current, error, loadingRequestId: null }
      })
    }
  }

  const text = (key: string, options?: Record<string, unknown>) =>
    String(t(key as never, options as never))
  const translate: MembershipActivityTranslate = text
  const retry = resource.error
    ? () => void resource.refresh()
    : () => void loadMore()
  const locale = i18n.language

  return (
    <Panel
      title={t('title')}
      description={t('description')}
      className="membership-activity-panel"
    >
      {resource.loading && !items ? <LoadingState label={t('loading')} /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={retry} /> : null}
      {loadMoreError && !resource.error ? (
        <ResourceError error={loadMoreError} onRetry={retry} />
      ) : null}

      {!resource.loading && !resource.error && items && items.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : null}

      {items && items.length > 0 ? (
        <ul className="membership-activity-list">
          {items.map(activity => (
            <ActivityRow
              activity={activity}
              key={activity.id}
              locale={locale}
              t={text}
              timezone={timezone}
              translate={translate}
            />
          ))}
        </ul>
      ) : null}

      {items && nextCursor ? (
        <div className="membership-activity-load-more">
          <Button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            size="sm"
            variant="secondary"
          >
            {loadingMore ? t('loadingMore') : t('loadMore')}
          </Button>
        </div>
      ) : null}
    </Panel>
  )
}

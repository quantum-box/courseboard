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
  const presentation = formatMembershipActivity(activity, translate)
  const target = formatMembershipActivityTarget(activity.target)
  const source = formatMembershipActivitySource(activity.source, translate)
  const before = formatMembershipActivitySnapshot(activity.kind, activity.before, translate)
  const after = formatMembershipActivitySnapshot(activity.kind, activity.after, translate)
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
export function MembershipActivityPanel({ customerId }: { customerId: string }) {
  const { t, i18n } = useTranslation(['membershipActivity', 'common'])
  const timezone = useTenantTimezone()
  const [items, setItems] = useState<readonly MembershipActivity[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<unknown | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const resource = useResource(
    () =>
      courseboardApiJson<MembershipActivityPage>(
        membershipActivitiesPath(customerId, MEMBERSHIP_ACTIVITY_PAGE_SIZE),
      ),
    [customerId],
    { cacheKey: `customer:membership-activities:${customerId}` },
  )

  // Keep pagination state separate from useResource: the first page is
  // cached/revalidated by the shared hook, while subsequent pages are appended
  // without replacing the first page.
  useEffect(() => {
    if (resource.data) {
      setItems(resource.data.items)
      setNextCursor(resource.data.nextCursor ?? null)
      setLoadMoreError(null)
      return
    }
    if (resource.loading && !resource.error) {
      setItems(null)
      setNextCursor(null)
      setLoadMoreError(null)
    }
  }, [customerId, resource.data, resource.error, resource.loading])

  const loadMore = async () => {
    if (!items || !nextCursor || loadingMore) return
    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      const page = await courseboardApiJson<MembershipActivityPage>(
        membershipActivitiesPath(customerId, MEMBERSHIP_ACTIVITY_PAGE_SIZE, nextCursor),
      )
      setItems(current => [...(current ?? []), ...page.items])
      setNextCursor(page.nextCursor ?? null)
    } catch (error) {
      setLoadMoreError(error)
    } finally {
      setLoadingMore(false)
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

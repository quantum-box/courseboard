import { Badge, Button } from '@tachyon-sdk/native-ui'
import { ArrowLeft, CalendarCheck, CalendarClock, Save, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson } from '../../api'
import { formatCourseDate } from '../../lib/clock'
import { i18next } from '../../i18n'
import { useRegisterPageReload } from '../../lib/pageReload'
import { navigate, useNavigationGuard } from '../../lib/router'
import { showToast } from '../../lib/toast'
import { useResource } from '../../hooks/useResource'
import {
  EmptyState,
  LoadingState,
  Notice,
  PageHeader,
  Panel,
  ResourceError,
  resourceErrorText,
} from '../../components/Page'
import { WeekScheduleEditor, toEditableRule, type EditableRule } from './WeekScheduleEditor'
import {
  countRuleIssues,
  isCourseLinkedToResource,
  ruleChangeCount,
  sortRules,
  summarizeRuleChanges,
  weeklyStartCount,
  type CourseResource,
  type GolfAvailabilityRule,
} from './schedule'
import type { GolfCourse } from './models'

const coursesPath = '/v1/course/courses'
const bookingHorizonPath = '/v1/course/booking-horizon'

const listRoute = 'golf/courses'

function schedulePath(courseId: string) {
  return `${coursesPath}/${encodeURIComponent(courseId)}/schedule`
}

const resourcesPath = '/v1/course/resources'

function resourceLinkPath(courseId: string) {
  return `${coursesPath}/${encodeURIComponent(courseId)}/resource`
}

function toStoredRule(rule: EditableRule): GolfAvailabilityRule {
  return {
    ...(rule.id ? { id: rule.id } : {}),
    weekday: rule.weekday,
    startTime: rule.startTime,
    endTime: rule.endTime,
    capacity: rule.capacity,
    slotIntervalMinutes: rule.slotIntervalMinutes,
  }
}

type SaveAvailabilityRule = GolfAvailabilityRule & { isNew?: true }

/**
 * Full-replace requests cannot otherwise tell an intentional create from a
 * persisted row whose id was accidentally dropped. Keep that intent explicit
 * at the UI/API boundary and fail before sending an ambiguous replacement.
 */
function toSaveRule(rule: EditableRule): SaveAvailabilityRule {
  const stored = toStoredRule(rule)
  if (rule.isNew) {
    if (rule.id) throw new Error(i18next.t('schedule:newRuleHasId'))
    return { ...stored, isNew: true }
  }
  if (!rule.id) throw new Error(i18next.t('schedule:missingRuleId'))
  return stored
}

function errorMessage(error: unknown) {
  return error instanceof Error ? resourceErrorText(error) : i18next.t('products:error.generic')
}

function courseLabel(course: GolfCourse) {
  return course.shortName?.trim() || course.name
}


type GenerationSummary = {
  created: number
  updated: number
  deactivated: number
  unchanged: number
}

type SavedSchedule = {
  items: GolfAvailabilityRule[]
  /** `null` when the week stored but its tee times were not built. */
  bookableThrough: string | null
  built: GenerationSummary | null
}

type BookingHorizon = {
  days: number
  bookableThrough: string
}

/**
 * The course's bookable week.
 *
 * Inventory belongs to the course: one tee sends out one group at a time, and
 * every plan sold on the course draws from that same line. Editing it per plan
 * is what let the same tee time be sold twice.
 *
 * Saving builds the tee times too. They used to be a second thing the operator
 * had to remember, and a week saved without them put nothing on sale at all.
 */
export function CourseSchedulePage({ courseId }: { courseId: string }) {
  const { t } = useTranslation(['schedule', 'common', 'products'])
  const coursesResource = useResource(
    () => courseboardApiJson<{ items: GolfCourse[] }>(coursesPath),
    [],
    { cacheKey: 'courses:list' },
  )
  const course = coursesResource.data?.items.find(item => item.id === courseId) ?? null
  const resourcesResource = useResource(
    () => courseboardApiJson<{ items: CourseResource[] }>(resourcesPath),
    [],
    { cacheKey: 'courses:resources', enabled: Boolean(course) },
  )
  const scheduleResource = useResource(
    () => courseboardApiJson<{ items: GolfAvailabilityRule[] }>(schedulePath(courseId)),
    [courseId],
    { cacheKey: `course:schedule:${courseId}`, enabled: Boolean(course) },
  )
  const initialRules = scheduleResource.data?.items.map(toEditableRule) ?? []
  const [rules, setRules] = useState<EditableRule[]>(initialRules)
  /** What the server holds, so the bar can name what a save would change. */
  const [savedRules, setSavedRules] = useState<GolfAvailabilityRule[]>(
    initialRules.map(toStoredRule),
  )
  const acceptNextScheduleRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [linking, setLinking] = useState(false)
  const horizonResource = useResource(
    () => courseboardApiJson<BookingHorizon>(bookingHorizonPath),
    [],
    { cacheKey: 'course:booking-horizon', enabled: Boolean(course) },
  )
  /** What the last save actually put on sale, which outranks the loaded value. */
  const [bookableThrough, setBookableThrough] = useState<string | null>(null)
  const [buildFailed, setBuildFailed] = useState(false)

  const changes = useMemo(
    () => summarizeRuleChanges(savedRules, rules.map(toStoredRule)),
    [savedRules, rules],
  )
  const changeCount = ruleChangeCount(changes)
  const weeklyStarts = useMemo(() => weeklyStartCount(rules.map(toStoredRule)), [rules])
  const onSaleThrough = bookableThrough ?? horizonResource.data?.bookableThrough ?? null

  useEffect(() => {
    if (!scheduleResource.data) return
    if (changeCount > 0 && !acceptNextScheduleRef.current) return
    acceptNextScheduleRef.current = false
    const loaded = scheduleResource.data.items.map(toEditableRule)
    setRules(loaded)
    setSavedRules(loaded.map(toStoredRule))
  }, [changeCount, scheduleResource.data])

  const linked = resourcesResource.data
    ? isCourseLinkedToResource(resourcesResource.data.items, courseId)
    : true
  const scheduleError = scheduleResource.error
    ? errorMessage(scheduleResource.error)
    : null
  const loading = (coursesResource.loading && !coursesResource.data)
    || (Boolean(course) && scheduleResource.loading && !scheduleResource.data)

  const requestReload = useCallback(() => {
    if (changeCount > 0 && !window.confirm(i18next.t('schedule:confirm.discardOnReload'))) return
    acceptNextScheduleRef.current = true
    void Promise.all([
      coursesResource.refresh(),
      resourcesResource.refresh(),
      scheduleResource.refresh(),
    ]).then(([, , refreshedSchedule]) => {
      if (!refreshedSchedule) acceptNextScheduleRef.current = false
    })
  }, [
    changeCount,
    coursesResource.refresh,
    resourcesResource.refresh,
    scheduleResource.refresh,
  ])

  useRegisterPageReload(requestReload)

  useNavigationGuard(
    changeCount > 0 ? () => window.confirm(t('schedule:confirm.discardOnLeave')) : null,
  )

  function revert() {
    setRules(savedRules.map(toEditableRule))
  }

  async function link() {
    setLinking(true)
    try {
      const linkedResource = await courseboardApiJson<CourseResource>(
        resourceLinkPath(courseId),
        { method: 'POST' },
      )
      resourcesResource.setData(current => ({
        items: [
          ...(current?.items ?? []).filter(resource =>
            resource.golfCourseId !== courseId || resource.resourceKind !== 'course',
          ),
          linkedResource,
        ],
      }))
      showToast({
        tone: 'success',
        title: t('schedule:link.done.title'),
        message: t('schedule:link.done.body', { course: course ? courseLabel(course) : courseId }),
      })
      await scheduleResource.refresh()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('schedule:link.failed'),
        message: errorMessage(error),
      })
    } finally {
      setLinking(false)
    }
  }

  async function save() {
    const issueCount = countRuleIssues(rules)
    if (issueCount > 0) {
      showToast({
        tone: 'danger',
        title: t('schedule:saveFailed'),
        message: t('schedule:hasIssues', { n: String(issueCount) }),
      })
      return
    }
    if (
      changes.removed > 0
      && !window.confirm(t('schedule:confirmRemove', { n: String(changes.removed) }))
    ) return

    setSaving(true)
    try {
      const payload = sortRules(rules).map(toSaveRule)
      const response = await courseboardApiJson<SavedSchedule>(
        schedulePath(courseId),
        { method: 'PUT', body: JSON.stringify({ rules: payload }) },
      )
      const saved = response.items.map(toEditableRule)
      scheduleResource.setData({ items: response.items })
      setRules(saved)
      setSavedRules(saved.map(toStoredRule))
      setBookableThrough(response.bookableThrough)
      // The week is stored either way. Saying "saved" over a failed build would
      // hide that nothing is on sale, so the two are reported apart.
      setBuildFailed(response.bookableThrough === null)
      showToast({
        tone: response.bookableThrough === null ? 'warning' : 'success',
        title: response.bookableThrough === null
          ? t('schedule:saved.notBuilt.title')
          : t('schedule:saved.title'),
        message: response.bookableThrough === null
          ? t('schedule:saved.notBuilt.body')
          : t('schedule:saved.body', {
              course: course ? courseLabel(course) : courseId,
              date: formatCourseDate(response.bookableThrough),
            }),
      })
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('schedule:saveFailed'),
        message: errorMessage(error),
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="page-stack">
        <LoadingState label={t('common:state.loading')} />
      </div>
    )
  }

  if (coursesResource.error && !coursesResource.data) {
    return (
      <div className="page-stack">
        <BackToCourses />
        <ResourceError error={coursesResource.error} onRetry={coursesResource.refresh} />
      </div>
    )
  }

  if (!course) {
    return (
      <div className="page-stack">
        <BackToCourses />
        <EmptyState
          title={t('schedule:notLinked.title')}
          description={courseId}
          action={(
            <Button type="button" variant="primary" onClick={() => navigate(listRoute)}>
              {t('schedule:back')}
            </Button>
          )}
        />
      </div>
    )
  }

  const name = courseLabel(course)

  return (
    <div className="page-stack">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackToCourses />
      </div>

      <PageHeader
        eyebrow={t('schedule:eyebrow')}
        title={t('schedule:title', { course: name })}
        description={t('schedule:description')}
      />

      {/* What editing this week actually changes. The hours are a rule; what a
          customer can book is the dated inventory built from it, and only this
          date says how far that reaches. */}
      {onSaleThrough && !buildFailed ? (
        <p className="on-sale-through">
          <CalendarCheck aria-hidden="true" />
          <span>{t('schedule:onSale.through', { date: formatCourseDate(onSaleThrough) })}</span>
          <button type="button" className="link-button" onClick={() => navigate('golf/policy')}>
            {t('schedule:onSale.change')}
          </button>
        </p>
      ) : null}

      {buildFailed ? (
        <Notice tone="warning" title={t('schedule:saved.notBuilt.title')}>
          {t('schedule:saved.notBuilt.body')}
          <div className="mt-2">
            <Button type="button" variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? t('common:action.saving') : t('schedule:saved.notBuilt.retry')}
            </Button>
          </div>
        </Notice>
      ) : null}

      {coursesResource.error ? (
        <ResourceError error={coursesResource.error} onRetry={coursesResource.refresh} />
      ) : null}

      {linked ? null : (
        <Notice tone="warning" title={t('schedule:link.title')}>
          {t('schedule:link.description')}
          <div className="mt-2">
            <Button type="button" variant="primary" disabled={linking} onClick={() => void link()}>
              {linking ? t('schedule:link.working') : t('schedule:link.action')}
            </Button>
          </div>
        </Notice>
      )}

      {scheduleError && linked ? (
        <Notice tone="warning" title={t('schedule:loadFailed.title')}>
          {scheduleError}
          {t('schedule:loadFailed.description')}
        </Notice>
      ) : null}

      <Panel
        title={t('schedule:week.title')}
        description={t('schedule:week.description')}
        actions={<Badge variant="outline"><CalendarClock /> {t('schedule:week.badge')}</Badge>}
      >
        <WeekScheduleEditor rules={rules} disabled={saving} onChange={setRules} />
        {/* The two numbers on each row decide this, but neither says it. */}
        <p className="slot-week-total">
          {weeklyStarts > 0
            ? t('schedule:week.total', { n: String(weeklyStarts) })
            : t('schedule:week.empty')}
        </p>
      </Panel>

      {changeCount > 0 ? (
        <div className="sticky-submit">
          <div>
            <span>{t('schedule:pending.title', { course: name })}</span>
            <strong className="slot-diff">
              {changes.added > 0 ? (
                <span className="slot-diff-added">
                  {t('schedule:pending.added', { n: String(changes.added) })}
                </span>
              ) : null}
              {changes.removed > 0 ? (
                <span className="slot-diff-removed">
                  {t('schedule:pending.removed', { n: String(changes.removed) })}
                </span>
              ) : null}
              {changes.changed > 0 ? (
                <span className="slot-diff-changed">
                  {t('schedule:pending.changed', { n: String(changes.changed) })}
                </span>
              ) : null}
              <span className="slot-diff-weekly">
                {t('schedule:pending.weekly', {
                  n: String(weeklyStartCount(rules.map(toStoredRule))),
                })}
              </span>
            </strong>
          </div>
          <div className="sticky-submit-actions">
            <Button type="button" size="sm" disabled={saving} onClick={revert}>
              <Undo2 /> {t('schedule:pending.revert')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={saving || Boolean(scheduleError)}
              onClick={() => void save()}
            >
              <Save /> {saving ? t('common:action.saving') : t('schedule:save')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function BackToCourses() {
  const { t } = useTranslation('schedule')
  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => navigate(listRoute)}>
      <ArrowLeft /> {t('back')}
    </Button>
  )
}

export default CourseSchedulePage

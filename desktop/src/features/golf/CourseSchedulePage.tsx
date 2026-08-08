import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { ArrowLeft, CalendarDays, Save, Sparkles, Undo2, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson } from '../../api'
import { today } from '../../lib/clock'
import { i18next } from '../../i18n'
import { useRegisterPageReload } from '../../lib/pageReload'
import { navigate, useNavigationGuard } from '../../lib/router'
import { showToast } from '../../lib/toast'
import {
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
  resourceErrorText,
} from '../../components/Page'
import { WeekScheduleEditor, toEditableRule, type EditableRule } from './WeekScheduleEditor'
import {
  applyCapacityToRules,
  countRuleIssues,
  ruleChangeCount,
  sortRules,
  summarizeRuleChanges,
  weeklyStartCount,
  type GolfAvailabilityRule,
} from './schedule'
import {
  calculateCaddieCapacity,
  weekdayForIsoDate,
  weekdayLabel,
  type CaddieSlotCapacity,
  type CapacityAvailability,
  type CapacityProfile,
  type GolfCourse,
} from './models'

const coursesPath = '/v1/course/courses'
const caddieProfilesPath = '/v1/course/caddie-profiles'
const caddieAvailabilitiesPath = '/v1/course/caddie-availabilities'

const listRoute = 'golf/courses'

function schedulePath(courseId: string) {
  return `${coursesPath}/${encodeURIComponent(courseId)}/schedule`
}

function generatePath(courseId: string) {
  return `${coursesPath}/${encodeURIComponent(courseId)}/time-slots/generate`
}

const resourcesPath = '/v1/course/resources'

function resourceLinkPath(courseId: string) {
  return `${coursesPath}/${encodeURIComponent(courseId)}/resource`
}

/**
 * The resource a course keeps its tee times on.
 *
 * Without one there is no schedule to read and no inventory to generate, and
 * every save on this page fails. Asking outright is clearer than reading it
 * back out of the error text.
 */
type CourseResource = {
  golfCourseId?: string
  reservationResourceId?: string
}

function isLinked(resources: CourseResource[], courseId: string) {
  return resources.some(
    resource => resource.golfCourseId === courseId && Boolean(resource.reservationResourceId),
  )
}

function toStoredRule(rule: EditableRule): GolfAvailabilityRule {
  return {
    weekday: rule.weekday,
    startTime: rule.startTime,
    endTime: rule.endTime,
    capacity: rule.capacity,
    slotIntervalMinutes: rule.slotIntervalMinutes,
  }
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

/**
 * The course's bookable week, and the tee times it builds.
 *
 * Inventory belongs to the course: one tee sends out one group at a time, and
 * every plan sold on the course draws from that same line. Editing it per plan
 * is what let the same tee time be sold twice.
 */
export function CourseSchedulePage({ courseId }: { courseId: string }) {
  const { t } = useTranslation(['schedule', 'common', 'products'])
  const [course, setCourse] = useState<GolfCourse | null>(null)
  const [rules, setRules] = useState<EditableRule[]>([])
  /** What the server holds, so the bar can name what a save would change. */
  const [savedRules, setSavedRules] = useState<GolfAvailabilityRule[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [linked, setLinked] = useState(true)
  const [linking, setLinking] = useState(false)

  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [preview, setPreview] = useState<GenerationSummary | null>(null)

  const [capacityDate, setCapacityDate] = useState(today)
  const [capacity, setCapacity] = useState<CaddieSlotCapacity | null>(null)
  const [capacityLoading, setCapacityLoading] = useState(false)
  const [capacityError, setCapacityError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setScheduleError(null)
    try {
      const courseResponse = await courseboardApiJson<{ items: GolfCourse[] }>(coursesPath)
      const found = courseResponse.items.find(item => item.id === courseId) ?? null
      setCourse(found)
      if (!found) return

      try {
        const resources = await courseboardApiJson<{ items: CourseResource[] }>(resourcesPath)
        setLinked(isLinked(resources.items, courseId))
      } catch {
        // A resource list this page could not read is not itself a reason to
        // claim the course is unlinked; the schedule below says so if it is.
        setLinked(true)
      }

      try {
        const response = await courseboardApiJson<{ items: GolfAvailabilityRule[] }>(
          schedulePath(courseId),
        )
        const loaded = response.items.map(toEditableRule)
        setRules(loaded)
        setSavedRules(loaded.map(toStoredRule))
      } catch (error) {
        setRules([])
        setSavedRules([])
        setScheduleError(errorMessage(error))
      }
    } catch (error) {
      setLoadError(error)
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    void load()
  }, [load])

  const changes = useMemo(
    () => summarizeRuleChanges(savedRules, rules.map(toStoredRule)),
    [savedRules, rules],
  )
  const changeCount = ruleChangeCount(changes)

  const requestReload = useCallback(() => {
    if (changeCount > 0 && !window.confirm(i18next.t('schedule:confirm.discardOnReload'))) return
    void load()
  }, [changeCount, load])

  useRegisterPageReload(requestReload)

  useNavigationGuard(
    changeCount > 0 ? () => window.confirm(t('schedule:confirm.discardOnLeave')) : null,
  )

  function revert() {
    setRules(savedRules.map(toEditableRule))
    setScheduleError(null)
  }

  async function link() {
    setLinking(true)
    try {
      await courseboardApiJson<CourseResource>(resourceLinkPath(courseId), { method: 'POST' })
      showToast({
        tone: 'success',
        title: t('schedule:link.done.title'),
        message: t('schedule:link.done.body', { course: course ? courseLabel(course) : courseId }),
      })
      await load()
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
      const payload = sortRules(rules).map(toStoredRule)
      const response = await courseboardApiJson<{ items: GolfAvailabilityRule[] }>(
        schedulePath(courseId),
        { method: 'PUT', body: JSON.stringify({ rules: payload }) },
      )
      const saved = response.items.map(toEditableRule)
      setRules(saved)
      setSavedRules(saved.map(toStoredRule))
      setScheduleError(null)
      showToast({
        tone: 'success',
        title: t('schedule:saved.title'),
        message: t('schedule:saved.body', { course: course ? courseLabel(course) : courseId }),
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

  async function generate(dryRun: boolean) {
    setGenerating(true)
    setGenerateError(null)
    if (!dryRun) setPreview(null)
    try {
      const summary = await courseboardApiJson<GenerationSummary>(generatePath(courseId), {
        method: 'POST',
        body: JSON.stringify({ from, to, dryRun }),
      })
      if (dryRun) {
        setPreview(summary)
        return
      }
      setPreview(null)
      showToast({
        tone: 'success',
        title: t('schedule:generate.result.title'),
        message: t('schedule:generate.result.body', {
          created: String(summary.created),
          updated: String(summary.updated),
          deactivated: String(summary.deactivated),
          unchanged: String(summary.unchanged),
        }),
      })
    } catch (error) {
      setGenerateError(errorMessage(error))
    } finally {
      setGenerating(false)
    }
  }

  async function calculateCapacity() {
    if (!capacityDate) return
    setCapacityLoading(true)
    setCapacityError(null)
    setCapacity(null)
    try {
      const query = `from=${encodeURIComponent(capacityDate)}&to=${encodeURIComponent(capacityDate)}`
      const [profilesResponse, availabilityResponse] = await Promise.all([
        courseboardApiJson<{ items: CapacityProfile[] }>(caddieProfilesPath),
        courseboardApiJson<{ items: CapacityAvailability[] }>(`${caddieAvailabilitiesPath}?${query}`),
      ])
      setCapacity(calculateCaddieCapacity(profilesResponse.items, availabilityResponse.items))
    } catch (error) {
      setCapacityError(errorMessage(error))
    } finally {
      setCapacityLoading(false)
    }
  }

  /**
   * One schedule per course means the caddie supply lands on it whole. Nothing
   * to share out between plans, which is what the old per-plan subtraction was
   * compensating for.
   */
  function applyCapacity() {
    if (!capacity || !capacityDate) return
    setRules(applyCapacityToRules(rules, capacityDate, capacity)
      .map(rule => ('clientKey' in rule ? rule as EditableRule : toEditableRule(rule))))
  }

  const capacityWeekday = capacityDate ? weekdayForIsoDate(capacityDate) : null

  if (loading) {
    return (
      <div className="page-stack">
        <LoadingState label={t('common:state.loading')} />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page-stack">
        <BackToCourses />
        <ResourceError error={loadError} onRetry={() => void load()} />
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
        <PageRefreshButton size="sm" variant="secondary" onClick={requestReload} />
      </div>

      <PageHeader
        eyebrow={t('schedule:eyebrow')}
        title={t('schedule:title', { course: name })}
        description={t('schedule:description')}
      />

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
        actions={changeCount > 0 ? (
          <Badge variant="warning">{t('schedule:pending.added', { n: String(changes.added) })}</Badge>
        ) : null}
      >
        <WeekScheduleEditor rules={rules} disabled={saving} onChange={setRules} />
      </Panel>

      <Panel
        title={t('schedule:generate.title')}
        description={t('schedule:generate.description')}
        actions={<Badge variant="outline"><CalendarDays /> {t('schedule:generate.badge')}</Badge>}
      >
        <div className="flex flex-wrap items-end gap-3">
          <Field requirement="none" label={t('schedule:generate.from')} className="w-full sm:w-44">
            <Input type="date" value={from} onChange={event => setFrom(event.target.value)} />
          </Field>
          <Field requirement="none" label={t('schedule:generate.to')} className="w-full sm:w-44">
            <Input type="date" value={to} onChange={event => setTo(event.target.value)} />
          </Field>
          <Button type="button" disabled={generating} onClick={() => void generate(true)}>
            <Sparkles />
            {generating ? t('schedule:generate.previewing') : t('schedule:generate.preview')}
          </Button>
        </div>

        {changeCount > 0 ? (
          <p className="capacity-weekday-note">{t('schedule:generate.unsavedFirst')}</p>
        ) : null}

        {generateError ? (
          <Notice tone="danger" title={t('schedule:generate.failed')}>{generateError}</Notice>
        ) : null}

        {preview ? (
          <div className="grid gap-3 pt-3">
            <Notice tone="info" title={t('schedule:generate.preview_result.title')}>
              {t('schedule:generate.preview_result.body', {
                created: String(preview.created),
                updated: String(preview.updated),
                deactivated: String(preview.deactivated),
                unchanged: String(preview.unchanged),
              })}
              <span className="notice-detail">{t('schedule:generate.keepsReserved')}</span>
            </Notice>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="primary"
                disabled={generating}
                onClick={() => void generate(false)}
              >
                <CalendarDays />
                {generating ? t('schedule:generate.running') : t('schedule:generate.run')}
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel
        title={t('products:capacity.title')}
        description={t('products:capacity.description')}
        actions={<Badge variant="outline"><Users /> {t('products:capacity.badge')}</Badge>}
      >
        <div className="flex flex-wrap items-end gap-3">
          <Field requirement="none" label={t('products:capacity.date')} className="w-full sm:w-44">
            <Input
              type="date"
              value={capacityDate}
              onChange={event => {
                setCapacityDate(event.target.value)
                setCapacity(null)
                setCapacityError(null)
              }}
            />
          </Field>
          <Button
            type="button"
            disabled={capacityLoading || !capacityDate}
            onClick={() => void calculateCapacity()}
          >
            <Sparkles />
            {capacityLoading
              ? t('products:capacity.calculating')
              : t('products:capacity.calculate')}
          </Button>
        </div>

        {capacityWeekday === null ? null : (
          <p className="capacity-weekday-note">
            {t('products:capacity.targetWeekday', { day: weekdayLabel(capacityWeekday) })}
          </p>
        )}

        {capacityError ? (
          <Notice tone="danger" title={t('products:capacity.failed')}>{capacityError}</Notice>
        ) : null}

        {capacity ? (
          <div className="grid gap-3 pt-3">
            <MetricGrid>
              <Metric
                label={t('products:capacity.morning')}
                value={t('products:capacity.groups', { n: String(capacity.morningCapacity) })}
                detail={t('products:capacity.limit')}
              />
              <Metric
                label={t('products:capacity.afternoon')}
                value={t('products:capacity.groups', { n: String(capacity.afternoonCapacity) })}
                detail={t('products:capacity.limit')}
              />
              <Metric
                label={t('products:capacity.activeCaddies')}
                value={t('products:capacity.activeCaddiesValue', {
                  available: String(capacity.activeCaddies - capacity.unavailable),
                  total: String(capacity.activeCaddies),
                })}
                detail={capacity.assumedAvailable > 0
                  ? t('products:capacity.assumed', { n: String(capacity.assumedAvailable) })
                  : t('products:capacity.allRegistered')}
                tone={capacity.assumedAvailable > 0 ? 'warning' : 'success'}
              />
            </MetricGrid>
            {capacity.assumedAvailable > 0 ? (
              <Notice tone="warning" title={t('products:capacity.warning.title')}>
                {t('products:capacity.warning.description', {
                  n: String(capacity.assumedAvailable),
                })}
              </Notice>
            ) : null}
            <div className="flex justify-end">
              <Button type="button" variant="primary" onClick={applyCapacity}>
                <CalendarDays />
                {t('products:capacity.applyTo', { day: weekdayLabel(capacityWeekday ?? 0) })}
              </Button>
            </div>
          </div>
        ) : null}
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

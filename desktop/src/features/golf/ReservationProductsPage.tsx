import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Undo2,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson } from '../../api'
import { today } from '../../lib/clock'
import { i18next } from '../../i18n'
import { useRegisterPageReload } from '../../lib/pageReload'
import { navigate, useNavigationGuard } from '../../lib/router'
import { showToast } from '../../lib/toast'
import {
  DataTable,
  EmptyState,
  Field,
  FormGrid,
  LoadingState,
  Metric,
  MetricGrid,
  NativeSelect,
  Notice,
  PageHeader,
  PageRefreshButton,
  Panel,
  ResourceError,
  resourceErrorText,
  type DataTableColumn,
} from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import { WeekSlotEditor, toEditableSlot, type EditableSlot } from './WeekSlotEditor'
import {
  applyCapacityToSlots,
  calculateCaddieCapacity,
  capacityAfterLoad,
  countSlotIssues,
  defaultDuration,
  emptyProductDraft,
  productToDraft,
  slotChangeCount,
  sortSlots,
  summarizeSlotChanges,
  weekdayForIsoDate,
  weekdayLabel,
  type CapacityAvailability,
  type CapacityProfile,
  type CaddieSlotCapacity,
  type GolfCourse,
  type GolfProductSlot,
  type GolfReservationProduct,
  type GolfReservationProductDraft,
  type PlayType,
  type WeekdayGroupLoad,
  validateProduct,
  weekdayGroupLoad,
} from './models'

const productsPath = '/v1/course/reservation-products'
const coursesPath = '/v1/course/courses'
const caddieProfilesPath = '/v1/course/caddie-profiles'
const caddieAvailabilitiesPath = '/v1/course/caddie-availabilities'

const listRoute = 'golf/products'

function slotsPath(serviceId: string) {
  return `${productsPath}/${encodeURIComponent(serviceId)}/slots`
}

function detailRoute(serviceId: string) {
  return `${listRoute}/${encodeURIComponent(serviceId)}`
}

/** The shape the API stores, stripped of the keys the editor added. */
function toStoredSlot(slot: EditableSlot): GolfProductSlot {
  return {
    weekday: slot.weekday,
    startTime: slot.startTime,
    endTime: slot.endTime,
    maxGroups: slot.maxGroups,
    maxPlayers: slot.maxPlayers,
  }
}

/**
 * Save failures reach the operator as a toast, which used to print the server's
 * own English. Route them through the shared mapping so the sentence they read
 * first follows the active locale.
 */
function errorMessage(error: unknown) {
  return error instanceof Error ? resourceErrorText(error) : i18next.t('products:error.generic')
}

function formatUpdatedAt(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function productDisplayName(product: GolfReservationProduct) {
  return product.displayName?.trim() || product.reservationServiceId
}

function courseLabel(course: GolfCourse) {
  return course.shortName?.trim() || course.name
}

/**
 * The course a plan is sold on, or a warning that it has none.
 *
 * Courses differ in opening hours and in what they sell, so a plan that names
 * no course cannot be checked against either — saying so is more useful than
 * printing an empty cell.
 */
function CourseCell({
  product,
  courses,
}: {
  product: GolfReservationProduct
  courses: GolfCourse[]
}) {
  const { t } = useTranslation('products')
  const course = courses.find(item => item.id === product.golfCourseId)
  if (course) return <>{courseLabel(course)}</>
  if (product.golfCourseId) {
    return <Badge variant="warning">{t('course.unknown')}</Badge>
  }
  return <Badge variant="warning">{t('course.unset')}</Badge>
}

function PlayTypeBadge({ playType }: { playType: PlayType }) {
  const { t } = useTranslation('products')
  return (
    <Badge variant={playType === 'caddie' ? 'accent' : 'neutral'}>
      {playType === 'caddie' ? t('playType.caddie') : t('playType.self')}
    </Badge>
  )
}

/**
 * The list and the week editor are separate screens.
 *
 * Stacking them meant the page held two things at once — a table whose rows
 * selected, and an editor whose rows were edited — and the same click could
 * mean either. One service per screen removes the ambiguity, and the route now
 * says which service is open.
 */
export function ReservationProductsPage({ serviceId }: { serviceId?: string }) {
  if (serviceId) return <ReservationProductDetail key={serviceId} serviceId={serviceId} />
  return <ReservationProductList />
}

function ReservationProductList() {
  const { t } = useTranslation(['products', 'common'])
  const [products, setProducts] = useState<GolfReservationProduct[]>([])
  const [courses, setCourses] = useState<GolfCourse[]>([])
  const [slotCounts, setSlotCounts] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [response, courseResponse] = await Promise.all([
        courseboardApiJson<{ items: GolfReservationProduct[] }>(productsPath),
        courseboardApiJson<{ items: GolfCourse[] }>(coursesPath),
      ])
      setProducts(response.items)
      setCourses(courseResponse.items)
      setLoading(false)

      // Counts decorate the list; a service whose slots fail to load still has
      // to be reachable, so they resolve after the table is already on screen.
      const counts = await Promise.all(response.items.map(async product => {
        try {
          const slots = await courseboardApiJson<{ items: GolfProductSlot[] }>(
            slotsPath(product.reservationServiceId),
          )
          return [product.reservationServiceId, slots.items.length] as const
        } catch {
          return [product.reservationServiceId, null] as const
        }
      }))
      setSlotCounts(Object.fromEntries(counts))
    } catch (error) {
      setLoadError(error)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useRegisterPageReload(load)

  const columns: DataTableColumn<GolfReservationProduct>[] = [
    {
      key: 'service',
      header: t('products:list.table.service'),
      mobileLabel: t('products:list.table.service'),
      cell: product => (
        <div className="grid gap-0.5">
          <strong>{productDisplayName(product)}</strong>
          <span className="text-xs text-muted-foreground">
            {t('products:slots.subtitle', { serviceId: product.reservationServiceId })}
          </span>
        </div>
      ),
    },
    {
      key: 'course',
      header: t('products:list.table.course'),
      mobileLabel: t('products:list.table.course'),
      cell: product => <CourseCell product={product} courses={courses} />,
    },
    {
      key: 'playType',
      header: t('products:list.table.playType'),
      mobileLabel: t('products:list.table.playType'),
      cell: product => <PlayTypeBadge playType={product.playType} />,
    },
    {
      key: 'holes',
      header: t('products:list.table.holes'),
      mobileLabel: t('products:list.table.holes'),
      align: 'right',
      cell: product => `${product.holeCount}H`,
    },
    {
      key: 'duration',
      header: t('products:list.table.duration'),
      mobileLabel: t('products:list.table.duration'),
      align: 'right',
      cell: product => t('common:unit.minutes', { n: String(product.expectedDurationMinutes) }),
    },
    {
      key: 'slots',
      header: t('products:list.table.slots'),
      mobileLabel: t('products:list.table.slots'),
      align: 'right',
      cell: product => {
        const count = slotCounts[product.reservationServiceId]
        if (count === undefined) return '…'
        if (count === null) return '—'
        return t('products:list.table.slotCount', { n: String(count) })
      },
    },
    {
      key: 'updated',
      header: t('products:list.table.updated'),
      mobileLabel: t('products:list.table.updated'),
      cell: product => formatUpdatedAt(product.updatedAt),
    },
    {
      key: 'open',
      header: <span className="sr-only">{t('products:list.table.actions')}</span>,
      align: 'right',
      cell: product => (
        <span className="row-open" aria-label={t('products:list.open', {
          name: productDisplayName(product),
        })}>
          <ChevronRight aria-hidden="true" />
        </span>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="page-stack">
        <LoadingState label={t('products:loading')} />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page-stack">
        <ResourceError error={loadError} onRetry={() => void load()} />
      </div>
    )
  }

  // Plans written before courses were split carry no course, and a plan with no
  // course cannot be checked against opening hours, tee interval, or the caddies
  // it shares. New plans are made to name one; these are the backlog.
  const withoutCourse = products.filter(product => !product.golfCourseId)

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <PageRefreshButton onClick={() => void load()} />
        <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus /> {t('products:addService')}
        </Button>
      </div>

      {withoutCourse.length > 0 ? (
        <Notice tone="warning" title={t('products:course.backlog.title', {
          n: String(withoutCourse.length),
        })}>
          {t('products:course.backlog.description')}
          <span className="course-backlog-links">
            {withoutCourse.map(product => (
              <Button
                key={product.id}
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => navigate(detailRoute(product.reservationServiceId))}
              >
                {productDisplayName(product)}
              </Button>
            ))}
          </span>
        </Notice>
      ) : null}

      <ProductEditorSheet
        open={createOpen}
        product={null}
        courses={courses}
        onOpenChange={setCreateOpen}
        onSaved={serviceId => {
          setCreateOpen(false)
          navigate(detailRoute(serviceId))
        }}
      />

      <Panel
        title={t('products:list.title')}
        description={t('products:list.description')}
        actions={<Badge variant="outline">{t('products:list.badge', { n: String(products.length) })}</Badge>}
      >
        <DataTable
          rows={products}
          columns={columns}
          rowKey={product => product.id}
          onRowClick={product => navigate(detailRoute(product.reservationServiceId))}
          empty={(
            <EmptyState
              title={t('products:list.empty.title')}
              description={t('products:list.empty.description')}
              action={(
                <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus /> {t('products:list.empty.action')}
                </Button>
              )}
            />
          )}
        />
      </Panel>
    </div>
  )
}

function ReservationProductDetail({ serviceId }: { serviceId: string }) {
  const { t } = useTranslation(['products', 'common'])
  const [product, setProduct] = useState<GolfReservationProduct | null>(null)
  /** Every plan, so the caddie panel can find the ones sharing this course. */
  const [allProducts, setAllProducts] = useState<GolfReservationProduct[]>([])
  const [courses, setCourses] = useState<GolfCourse[]>([])
  const [slots, setSlots] = useState<EditableSlot[]>([])
  /** What the server holds, so the editor can name what a save would change. */
  const [savedSlots, setSavedSlots] = useState<GolfProductSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [slotLoadError, setSlotLoadError] = useState<string | null>(null)
  const [slotSaving, setSlotSaving] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)

  const [capacityDate, setCapacityDate] = useState(today)
  const [capacity, setCapacity] = useState<CaddieSlotCapacity | null>(null)
  const [capacityLoading, setCapacityLoading] = useState(false)
  const [capacityError, setCapacityError] = useState<string | null>(null)
  /** What the other caddie plans on this course already take. */
  const [sharedLoad, setSharedLoad] = useState<WeekdayGroupLoad | null>(null)
  const [sharedLoadFailed, setSharedLoadFailed] = useState(false)

  /**
   * course-api answers products as a collection; the detail screen picks its
   * own out rather than inventing a single-item endpoint that is not there.
   *
   * Kept apart from the week so saving the plan settings can refresh the header
   * without replacing slots the operator has not saved yet.
   */
  const loadProduct = useCallback(async () => {
    const [response, courseResponse] = await Promise.all([
      courseboardApiJson<{ items: GolfReservationProduct[] }>(productsPath),
      courseboardApiJson<{ items: GolfCourse[] }>(coursesPath),
    ])
    const found = response.items.find(item => item.reservationServiceId === serviceId) ?? null
    setProduct(found)
    setAllProducts(response.items)
    setCourses(courseResponse.items)
    return found
  }, [serviceId])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setSlotLoadError(null)
    try {
      const found = await loadProduct()
      if (!found) {
        setSlots([])
        setSavedSlots([])
        return
      }
      try {
        const slotResponse = await courseboardApiJson<{ items: GolfProductSlot[] }>(
          slotsPath(serviceId),
        )
        const loaded = slotResponse.items.map(toEditableSlot)
        setSlots(loaded)
        setSavedSlots(loaded.map(toStoredSlot))
      } catch (error) {
        setSlots([])
        setSavedSlots([])
        setSlotLoadError(errorMessage(error))
      }
    } catch (error) {
      setLoadError(error)
    } finally {
      setLoading(false)
    }
  }, [loadProduct, serviceId])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * One summary rather than a dirty flag: an edit the operator undid by hand
   * should stop counting as unsaved, and the save bar has to name how many
   * bands a whole-week replace would drop.
   */
  const changes = useMemo(
    () => summarizeSlotChanges(savedSlots, slots.map(toStoredSlot)),
    [savedSlots, slots],
  )
  const changeCount = slotChangeCount(changes)

  const requestReload = useCallback(() => {
    if (
      changeCount > 0
      && !window.confirm(i18next.t('products:confirm.discardOnReload'))
    ) return
    void load()
  }, [changeCount, load])

  useRegisterPageReload(requestReload)

  // Covers the sidebar, ⌘K, the browser's back button and the back link below,
  // so unsaved slots cannot be lost by leaving through any of them.
  useNavigationGuard(
    changeCount > 0 ? () => window.confirm(t('products:confirm.discardOnLeave')) : null,
  )

  function revertSlots() {
    setSlots(savedSlots.map(toEditableSlot))
  }

  async function saveSlots() {
    const issueCount = countSlotIssues(slots)
    if (issueCount > 0) {
      showToast({
        tone: 'danger',
        title: t('products:slots.saveFailed'),
        message: t('products:slots.hasIssues', { n: String(issueCount) }),
      })
      return
    }
    if (
      changes.removed > 0
      && !window.confirm(t('products:slots.confirmRemove', { n: String(changes.removed) }))
    ) return

    setSlotSaving(true)
    try {
      const payload = sortSlots(slots).map(toStoredSlot)
      await courseboardApiJson(slotsPath(serviceId), {
        method: 'PUT',
        body: JSON.stringify({ slots: payload }),
      })
      setSavedSlots(payload)
      setSlotLoadError(null)
      showToast({
        tone: 'success',
        title: t('products:slots.saved.title'),
        message: t('products:slots.saved.body', { serviceId, n: String(payload.length) }),
      })
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('products:slots.saveFailed'),
        message: errorMessage(error),
      })
    } finally {
      setSlotSaving(false)
    }
  }

  async function calculateCapacity() {
    if (!capacityDate) return
    setCapacityLoading(true)
    setCapacityError(null)
    setCapacity(null)
    setSharedLoad(null)
    setSharedLoadFailed(false)
    try {
      const query = `from=${encodeURIComponent(capacityDate)}&to=${encodeURIComponent(capacityDate)}`
      const [profilesResponse, availabilityResponse] = await Promise.all([
        courseboardApiJson<{ items: CapacityProfile[] }>(caddieProfilesPath),
        courseboardApiJson<{ items: CapacityAvailability[] }>(`${caddieAvailabilitiesPath}?${query}`),
      ])
      setCapacity(calculateCaddieCapacity(
        profilesResponse.items,
        availabilityResponse.items,
      ))

      // The other caddie plans on this course draw on the same people, so their
      // weekday comes off the supply before this plan is offered any of it.
      if (sharedPlans.length > 0) {
        try {
          const weekday = weekdayForIsoDate(capacityDate)
          const sibling = await Promise.all(sharedPlans.map(plan => (
            courseboardApiJson<{ items: GolfProductSlot[] }>(
              slotsPath(plan.reservationServiceId),
            )
          )))
          setSharedLoad(weekdayGroupLoad(sibling.flatMap(one => one.items), weekday))
        } catch {
          // Subtracting a number we could not read would understate the load;
          // saying the supply is un-netted is the honest fallback.
          setSharedLoadFailed(true)
        }
      }
    } catch (error) {
      setCapacityError(errorMessage(error))
    } finally {
      setCapacityLoading(false)
    }
  }

  /** Like the weekday copy, the change lands in the editor above and in the
   *  unsaved bar, so it needs no message of its own. */
  function applyCapacity() {
    if (!capacity || !capacityDate) return
    setSlots(applyCapacityToSlots(slots, capacityDate, capacityAfterLoad(capacity, sharedLoad))
      .map(slot => 'clientKey' in slot ? slot as EditableSlot : toEditableSlot(slot)))
  }

  const capacityWeekday = capacityDate ? weekdayForIsoDate(capacityDate) : null
  const productCourse = courses.find(course => course.id === product?.golfCourseId) ?? null

  /**
   * Caddies belong to the course, so every other caddie plan on it is drawing
   * on the same roster as this one.
   */
  const sharedPlans = useMemo(() => (
    product?.golfCourseId
      ? allProducts.filter(item => (
          item.reservationServiceId !== serviceId
          && item.playType === 'caddie'
          && item.golfCourseId === product.golfCourseId
        ))
      : []
  ), [allProducts, product, serviceId])

  const netCapacity = capacity ? capacityAfterLoad(capacity, sharedLoad) : null
  const netted = Boolean(sharedLoad && !sharedLoad.unlimited
    && (sharedLoad.morning > 0 || sharedLoad.afternoon > 0))

  if (loading) {
    return (
      <div className="page-stack">
        <LoadingState label={t('products:loading')} />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="page-stack">
        <BackToList />
        <ResourceError error={loadError} onRetry={() => void load()} />
      </div>
    )
  }

  if (!product) {
    return (
      <div className="page-stack">
        <BackToList />
        <EmptyState
          title={t('products:detail.notFound.title')}
          description={t('products:detail.notFound.description', { serviceId })}
          action={(
            <Button type="button" variant="primary" onClick={() => navigate(listRoute)}>
              {t('products:detail.back')}
            </Button>
          )}
        />
      </div>
    )
  }

  return (
    <div className="page-stack">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackToList />
        <PageRefreshButton size="sm" variant="secondary" onClick={requestReload} />
      </div>

      <PageHeader
        eyebrow={t('products:list.title')}
        title={productDisplayName(product)}
        description={t('products:slots.subtitle', { serviceId })}
        actions={(
          <Button type="button" onClick={() => setEditorOpen(true)}>
            <Settings2 /> {t('products:list.editPlan')}
          </Button>
        )}
      />

      <ProductEditorSheet
        open={editorOpen}
        product={product}
        courses={courses}
        onOpenChange={setEditorOpen}
        onSaved={() => {
          setEditorOpen(false)
          void loadProduct()
        }}
      />

      {product.golfCourseId ? null : (
        <Notice
          tone="warning"
          title={t('products:course.required.title')}
          actions={(
            <Button type="button" size="sm" onClick={() => setEditorOpen(true)}>
              <Settings2 /> {t('products:list.editPlan')}
            </Button>
          )}
        >
          {t('products:course.required.description')}
        </Notice>
      )}

      <Panel
        title={t('products:detail.summary')}
        actions={<PlayTypeBadge playType={product.playType} />}
      >
        <dl className="detail-list">
          <div>
            <dt>{t('products:editor.course')}</dt>
            <dd><CourseCell product={product} courses={courses} /></dd>
          </div>
          <div>
            <dt>{t('products:detail.startInterval')}</dt>
            <dd>
              {productCourse
                ? t('common:unit.minutes', { n: String(productCourse.startIntervalMinutes) })
                : '—'}
            </dd>
          </div>
          <div>
            <dt>{t('products:editor.playType')}</dt>
            <dd>
              {product.playType === 'caddie'
                ? t('products:playType.caddie')
                : t('products:playType.self')}
            </dd>
          </div>
          <div>
            <dt>{t('products:editor.holeCount')}</dt>
            <dd>{`${product.holeCount}H`}</dd>
          </div>
          <div>
            <dt>{t('products:editor.duration')}</dt>
            <dd>{t('common:unit.minutes', { n: String(product.expectedDurationMinutes) })}</dd>
          </div>
          <div>
            <dt>{t('products:list.table.updated')}</dt>
            <dd>{formatUpdatedAt(product.updatedAt)}</dd>
          </div>
        </dl>
      </Panel>

      <Panel
        title={t('products:slots.title', { name: productDisplayName(product) })}
        description={t('products:slots.week.legend')}
        actions={changeCount > 0 ? (
          <Badge variant="warning">{t('products:list.table.unsaved')}</Badge>
        ) : null}
      >
        {slotLoadError ? (
          <Notice tone="warning" title={t('products:slots.loadFailed.title')}>
            {slotLoadError}
            {t('products:slots.loadFailed.description')}
          </Notice>
        ) : null}

        <WeekSlotEditor
          slots={slots}
          disabled={slotSaving}
          startIntervalMinutes={productCourse?.startIntervalMinutes}
          onChange={setSlots}
        />
      </Panel>

      {product.playType === 'caddie' ? (
        <Panel
          title={t('products:capacity.title')}
          description={t('products:capacity.description')}
          actions={<Badge variant="outline"><Users /> {t('products:capacity.badge')}</Badge>}
        >
          <div className="flex flex-wrap items-end gap-3">
            <Field
              requirement="none"
              label={t('products:capacity.date')}
              className="w-full sm:w-44"
            >
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
              {capacityLoading ? t('products:capacity.calculating') : t('products:capacity.calculate')}
            </Button>
          </div>

          {/* Which weekday a date lands on is the step this panel used to leave
              the operator to work out for themselves. */}
          {capacityWeekday === null ? null : (
            <p className="capacity-weekday-note">
              {t('products:capacity.targetWeekday', { day: weekdayLabel(capacityWeekday) })}
            </p>
          )}

          {capacityError ? (
            <Notice tone="danger" title={t('products:capacity.failed')}>{capacityError}</Notice>
          ) : null}

          {capacity && netCapacity ? (
            <div className="grid gap-3 pt-3">
              {sharedLoadFailed ? (
                <Notice tone="warning" title={t('products:capacity.shared.title')}>
                  {t('products:capacity.shared.failed')}
                </Notice>
              ) : null}
              {sharedLoad?.unlimited ? (
                <Notice tone="warning" title={t('products:capacity.shared.title')}>
                  {t('products:capacity.shared.unlimited')}
                </Notice>
              ) : null}
              {netted && capacityWeekday !== null ? (
                <Notice tone="info" title={t('products:capacity.shared.title')}>
                  {t('products:capacity.shared.description', {
                    n: String(sharedPlans.length),
                    day: weekdayLabel(capacityWeekday),
                    morning: String(sharedLoad?.morning ?? 0),
                    afternoon: String(sharedLoad?.afternoon ?? 0),
                  })}
                </Notice>
              ) : null}

              <MetricGrid>
                <Metric
                  label={t('products:capacity.morning')}
                  value={t('products:capacity.groups', { n: String(netCapacity.morningCapacity) })}
                  detail={netted
                    ? t('products:capacity.deduction', {
                        total: String(capacity.morningCapacity),
                        used: String(sharedLoad?.morning ?? 0),
                      })
                    : t('products:capacity.limit')}
                  tone={netted && netCapacity.morningCapacity === 0 ? 'warning' : 'neutral'}
                />
                <Metric
                  label={t('products:capacity.afternoon')}
                  value={t('products:capacity.groups', { n: String(netCapacity.afternoonCapacity) })}
                  detail={netted
                    ? t('products:capacity.deduction', {
                        total: String(capacity.afternoonCapacity),
                        used: String(sharedLoad?.afternoon ?? 0),
                      })
                    : t('products:capacity.limit')}
                  tone={netted && netCapacity.afternoonCapacity === 0 ? 'warning' : 'neutral'}
                />
                <Metric
                  label={t('products:capacity.rounds')}
                  value={t('products:capacity.roundsValue', { n: String(capacity.totalRounds) })}
                  detail={t('products:capacity.roundsDetail')}
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
      ) : (
        <Notice tone="info" title={t('products:capacity.selfNotice.title')}>
          {t('products:capacity.selfNotice.description')}
        </Notice>
      )}

      {changeCount > 0 ? (
        <div className="sticky-submit">
          <div>
            <span>{t('products:slots.pending.title', { name: productDisplayName(product) })}</span>
            <strong className="slot-diff">
              {changes.added > 0 ? (
                <span className="slot-diff-added">
                  {t('products:slots.pending.added', { n: String(changes.added) })}
                </span>
              ) : null}
              {changes.removed > 0 ? (
                <span className="slot-diff-removed">
                  {t('products:slots.pending.removed', { n: String(changes.removed) })}
                </span>
              ) : null}
              {changes.changed > 0 ? (
                <span className="slot-diff-changed">
                  {t('products:slots.pending.changed', { n: String(changes.changed) })}
                </span>
              ) : null}
            </strong>
          </div>
          <div className="sticky-submit-actions">
            <Button type="button" size="sm" disabled={slotSaving} onClick={revertSlots}>
              <Undo2 /> {t('products:slots.pending.revert')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={slotSaving || Boolean(slotLoadError)}
              onClick={() => void saveSlots()}
            >
              <Save /> {slotSaving ? t('common:action.saving') : t('products:slots.save')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function BackToList() {
  const { t } = useTranslation('products')
  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => navigate(listRoute)}>
      <ArrowLeft /> {t('detail.back')}
    </Button>
  )
}

/**
 * Creating a service and editing one are the same five fields, so they are the
 * same sheet; only the service id is fixed once it exists.
 */
function ProductEditorSheet({
  open,
  product,
  courses,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  product: GolfReservationProduct | null
  courses: GolfCourse[]
  onOpenChange: (open: boolean) => void
  onSaved: (serviceId: string) => void
}) {
  const { t } = useTranslation(['products', 'common', 'courses'])
  const [draft, setDraft] = useState<GolfReservationProductDraft>(emptyProductDraft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = Boolean(product)

  useEffect(() => {
    if (!open) return
    // A plan saved without a name is the same vintage as a plan saved without a
    // course, and the name is required — so opening the sheet to set the course
    // would dead-end on an empty name field. Seed it with the service id, which
    // is already what the list shows and what the API stores for these plans.
    setDraft(product
      ? {
          ...productToDraft(product),
          displayName: productToDraft(product).displayName || product.reservationServiceId,
        }
      : emptyProductDraft())
    setError(null)
  }, [open, product])

  function changePlayType(playType: PlayType) {
    setDraft(current => ({
      ...current,
      playType,
      expectedDurationMinutes: defaultDuration(playType, current.holeCount),
    }))
  }

  function changeHoleCount(holeCount: number) {
    setDraft(current => ({
      ...current,
      holeCount,
      expectedDurationMinutes: defaultDuration(current.playType, holeCount),
    }))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validateProduct(draft, { requireCourse: !editing })
    if (validationError) {
      setError(validationError)
      return
    }

    const serviceId = draft.serviceId.trim()
    setSaving(true)
    setError(null)
    try {
      await courseboardApiJson(`${productsPath}/${encodeURIComponent(serviceId)}`, {
        method: 'POST',
        body: JSON.stringify({
          displayName: draft.displayName.trim(),
          playType: draft.playType,
          holeCount: draft.holeCount,
          expectedDurationMinutes: draft.expectedDurationMinutes,
          golfCourseId: draft.golfCourseId.trim() || null,
        }),
      })
      showToast({
        tone: 'success',
        title: t('products:editor.saved.title'),
        message: t('products:editor.saved.body', { name: draft.displayName.trim(), serviceId }),
      })
      onSaved(serviceId)
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? t('products:editor.editTitle') : t('products:editor.createTitle')}
      description={t('products:editor.description')}
    >
      <form className="grid gap-4" onSubmit={save}>
        <FormGrid columns={1}>
          <Field
            label={t('products:editor.displayName')}
            hint={t('products:editor.displayNameHint')}
            required
          >
            <Input
              value={draft.displayName}
              maxLength={255}
              onChange={event => setDraft(current => ({
                ...current,
                displayName: event.target.value,
              }))}
              placeholder={t('products:editor.displayNamePlaceholder')}
              required
              autoFocus={!editing}
            />
          </Field>
          <Field
            label={t('products:editor.serviceId')}
            hint={editing
              ? t('products:editor.serviceIdHintEdit')
              : t('products:editor.serviceIdHintNew')}
            required
          >
            <Input
              value={draft.serviceId}
              disabled={editing}
              onChange={event => setDraft(current => ({
                ...current,
                serviceId: event.target.value,
              }))}
              placeholder="golf-weekday-standard"
              required
            />
          </Field>
          <Field
            label={t('products:editor.course')}
            hint={t('products:editor.courseHint')}
            requirement="none"
          >
            <NativeSelect
              value={draft.golfCourseId}
              onChange={event => setDraft(current => ({
                ...current,
                golfCourseId: event.target.value,
              }))}
            >
              <option value="">{t('products:editor.courseUnset')}</option>
              {courses.map(course => (
                <option key={course.id} value={course.id}>{courseLabel(course)}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('products:editor.playType')} required>
            <NativeSelect
              value={draft.playType}
              onChange={event => changePlayType(event.target.value as PlayType)}
            >
              <option value="caddie">{t('products:playType.caddie')}</option>
              <option value="self">{t('products:playType.self')}</option>
            </NativeSelect>
          </Field>
          <Field label={t('products:editor.holeCount')} required>
            <NativeSelect
              value={draft.holeCount}
              onChange={event => changeHoleCount(Number(event.target.value))}
            >
              <option value={18}>{t('courses:option.holes18')}</option>
              <option value={9}>{t('courses:option.holes9')}</option>
            </NativeSelect>
          </Field>
          <Field
            label={t('products:editor.duration')}
            hint={t('products:editor.durationHint')}
            required
          >
            <Input
              type="number"
              min={30}
              max={720}
              step={1}
              value={draft.expectedDurationMinutes}
              onChange={event => setDraft(current => ({
                ...current,
                expectedDurationMinutes: Number(event.target.value),
              }))}
              required
            />
          </Field>
        </FormGrid>
        {error ? (
          <Notice tone="danger" title={t('products:editor.saveFailed')}>{error}</Notice>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" disabled={saving} onClick={() => onOpenChange(false)}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            <Save /> {saving ? t('common:action.saving') : t('products:editor.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

export default ReservationProductsPage

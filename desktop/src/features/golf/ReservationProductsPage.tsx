import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Plus,
  Save,
  Settings2,
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson } from '../../api'
import { useTenantTimezone } from '../../context/TenantTimezoneProvider'
import { i18next } from '../../i18n'
import { useRegisterPageReload } from '../../lib/pageReload'
import { navigate } from '../../lib/router'
import { showToast } from '../../lib/toast'
import {
  DataTable,
  EmptyState,
  Field,
  FormGrid,
  LoadingState,
  Notice,
  PageHeader,
  Panel,
  ResourceError,
  resourceErrorText,
  type DataTableColumn,
} from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import { useResource } from '../../hooks/useResource'
import { holeCountLabel, holeCountOptions } from './holeCount'
import {
  defaultDuration,
  emptyProductDraft,
  productCourseIds,
  productToDraft,
  sortSlots,
  weekdayLabel,
  type GolfCourse,
  type GolfProductSlot,
  type GolfReservationProduct,
  type GolfReservationProductDraft,
  type PlayType,
  validateProduct,
} from './models'

const productsPath = '/v1/course/reservation-products'
const coursesPath = '/v1/course/courses'

const listRoute = 'golf/products'

function slotsPath(serviceId: string) {
  return `${productsPath}/${encodeURIComponent(serviceId)}/slots`
}

function detailRoute(serviceId: string) {
  return `${listRoute}/${encodeURIComponent(serviceId)}`
}

function scheduleRoute(courseId: string) {
  return `golf/courses/${encodeURIComponent(courseId)}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? resourceErrorText(error) : i18next.t('products:error.generic')
}

function formatUpdatedAt(value: string | null | undefined, timezone: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: timezone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function productDisplayName(product: GolfReservationProduct) {
  return product.displayName?.trim() || product.reservationServiceId
}

function upsertProduct(
  products: GolfReservationProduct[],
  saved: GolfReservationProduct,
) {
  const exists = products.some(product => product.reservationServiceId === saved.reservationServiceId)
  return exists
    ? products.map(product =>
        product.reservationServiceId === saved.reservationServiceId ? saved : product,
      )
    : [...products, saved]
}

function courseLabel(course: GolfCourse) {
  return course.shortName?.trim() || course.name
}

/**
 * The courses a plan is sold on, named rather than listed by id.
 *
 * A plan can name a course that no longer exists — the plan keeps selling on
 * an id nothing answers to — so an unresolved id is called out beside the ones
 * that resolved instead of being dropped from the line.
 */
function CourseCell({
  product,
  courses,
}: {
  product: GolfReservationProduct
  courses: GolfCourse[]
}) {
  const { t } = useTranslation('products')
  const courseIds = productCourseIds(product)
  if (courseIds.length === 0) return <Badge variant="warning">{t('course.unset')}</Badge>

  return (
    <span className="course-cell">
      {courseIds.map(courseId => {
        const course = courses.find(item => item.id === courseId)
        return course
          ? <span key={courseId}>{courseLabel(course)}</span>
          : <Badge key={courseId} variant="warning">{t('course.unknown')}</Badge>
      })}
    </span>
  )
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
 * Plans say how the course's tee times are sold; the course says how many there
 * are. The week used to be edited here, per plan, which duplicated the stock
 * every plan drew from — it now lives on the course.
 */
export function ReservationProductsPage({ serviceId }: { serviceId?: string }) {
  if (serviceId) return <ReservationProductDetail key={serviceId} serviceId={serviceId} />
  return <ReservationProductList />
}

function ReservationProductList() {
  const { t } = useTranslation(['products', 'common'])
  const timezone = useTenantTimezone()
  const productsResource = useResource(
    () => courseboardApiJson<{ items: GolfReservationProduct[] }>(productsPath),
    [],
    { cacheKey: 'reservation-products:list' },
  )
  const coursesResource = useResource(
    () => courseboardApiJson<{ items: GolfCourse[] }>(coursesPath),
    [],
    { cacheKey: 'courses:list' },
  )
  const products = productsResource.data?.items ?? []
  const courses = coursesResource.data?.items ?? []
  const [createOpen, setCreateOpen] = useState(false)

  const refreshAll = () => {
    productsResource.refresh()
    coursesResource.refresh()
  }
  useRegisterPageReload(refreshAll)

  const columns: DataTableColumn<GolfReservationProduct>[] = [
    {
      key: 'service',
      header: t('products:list.table.service'),
      mobileLabel: t('products:list.table.service'),
      cell: product => <strong>{productDisplayName(product)}</strong>,
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
      key: 'updated',
      header: t('products:list.table.updated'),
      mobileLabel: t('products:list.table.updated'),
      cell: product => formatUpdatedAt(product.updatedAt, timezone),
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

  const resources = [productsResource, coursesResource]
  const hardError = resources.find(resource => resource.error && !resource.data)?.error
  const refreshError = resources.find(resource => resource.error)?.error
  const loading = resources.some(resource => resource.loading && !resource.data)

  if (hardError) {
    return (
      <div className="page-stack">
        <ResourceError error={hardError} onRetry={refreshAll} />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page-stack">
        <LoadingState label={t('products:loading')} />
      </div>
    )
  }

  const withoutCourse = products.filter(product => productCourseIds(product).length === 0)

  return (
    <div className="page-stack">
      {refreshError ? <ResourceError error={refreshError} onRetry={refreshAll} /> : null}
      <div className="page-toolbar">
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
        onSaved={savedProduct => {
          productsResource.setData({ items: upsertProduct(products, savedProduct) })
          setCreateOpen(false)
          navigate(detailRoute(savedProduct.reservationServiceId))
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
  const timezone = useTenantTimezone()
  const productsResource = useResource(
    () => courseboardApiJson<{ items: GolfReservationProduct[] }>(productsPath),
    [],
    { cacheKey: 'reservation-products:list' },
  )
  const coursesResource = useResource(
    () => courseboardApiJson<{ items: GolfCourse[] }>(coursesPath),
    [],
    { cacheKey: 'courses:list' },
  )
  const product = productsResource.data?.items.find(
    item => item.reservationServiceId === serviceId,
  ) ?? null
  const courses = coursesResource.data?.items ?? []
  /** Slots from before inventory moved to the course. Read-only. */
  const slotsResource = useResource(
    () => courseboardApiJson<{ items: GolfProductSlot[] }>(slotsPath(serviceId)),
    [serviceId],
    {
      cacheKey: `reservation-product-slots:${serviceId}`,
      enabled: Boolean(product),
    },
  )
  const legacySlots = slotsResource.data?.items ?? []
  const [editorOpen, setEditorOpen] = useState(false)

  const refreshAll = () => {
    productsResource.refresh()
    coursesResource.refresh()
    slotsResource.refresh()
  }
  useRegisterPageReload(refreshAll)

  const productCourses = useMemo(
    () => {
      if (!product) return []
      const courseIds = productCourseIds(product)
      return courses.filter(course => courseIds.includes(course.id))
    },
    [courses, product],
  )

  const resources = [productsResource, coursesResource]
  const hardError = resources.find(resource => resource.error && !resource.data)?.error
  const refreshError = resources.find(resource => resource.error)?.error
  const loading = resources.some(resource => resource.loading && !resource.data)
    || (Boolean(product) && slotsResource.loading && !slotsResource.data)

  if (hardError) {
    return (
      <div className="page-stack">
        <BackToList />
        <ResourceError error={hardError} onRetry={refreshAll} />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="page-stack">
        <LoadingState label={t('products:loading')} />
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
      {refreshError ? <ResourceError error={refreshError} onRetry={refreshAll} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackToList />
      </div>

      <PageHeader
        eyebrow={t('products:list.title')}
        title={productDisplayName(product)}
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
        onSaved={savedProduct => {
          productsResource.setData(current => ({
            items: upsertProduct(current?.items ?? [], savedProduct),
          }))
          setEditorOpen(false)
        }}
      />

      {productCourseIds(product).length > 0 ? null : (
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
            <dt>{t('products:editor.maxPlayers')}</dt>
            <dd>
              {product.maxPlayersPerGroup
                ? t('products:editor.maxPlayersValue', { n: String(product.maxPlayersPerGroup) })
                : t('products:editor.maxPlayersFromPolicy')}
            </dd>
          </div>
          <div>
            <dt>{t('products:list.table.updated')}</dt>
            <dd>{formatUpdatedAt(product.updatedAt, timezone)}</dd>
          </div>
        </dl>
      </Panel>

      {/* The week is the course's now. Sending the operator there beats showing
          a second, per-plan copy of the same stock. */}
      <Panel
        title={t('products:inventory.title')}
        description={t('products:inventory.description')}
      >
        {/* One button per course: the plan is shared, the tee times are not. */}
        {productCourses.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {productCourses.map(course => (
              <Button
                key={course.id}
                type="button"
                variant="primary"
                onClick={() => navigate(scheduleRoute(course.id))}
              >
                <CalendarDays />
                {t('products:inventory.open', { course: courseLabel(course) })}
              </Button>
            ))}
          </div>
        ) : (
          <Notice tone="info" title={t('products:inventory.needsCourse.title')}>
            {t('products:inventory.needsCourse.description')}
          </Notice>
        )}

        {legacySlots.length > 0 ? (
          <div className="grid gap-2 pt-4">
            <Notice tone="warning" title={t('products:inventory.legacy.title')}>
              {t('products:inventory.legacy.description')}
            </Notice>
            <ul className="legacy-slot-list">
              {sortSlots(legacySlots).map((slot, index) => (
                <li key={`${slot.weekday}-${slot.startTime}-${index}`}>
                  <strong>{t('products:slots.week.dayLabel', {
                    day: weekdayLabel(slot.weekday),
                  })}</strong>
                  <span>{`${slot.startTime.slice(0, 5)}–${slot.endTime.slice(0, 5)}`}</span>
                  <span>{t('products:inventory.legacy.limits', {
                    groups: String(slot.maxGroups),
                    players: String(slot.maxPlayers),
                  })}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>
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
  onSaved: (product: GolfReservationProduct) => void
}) {
  const { t } = useTranslation(['products', 'common', 'courses'])
  const [draft, setDraft] = useState<GolfReservationProductDraft>(emptyProductDraft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = Boolean(product)

  useEffect(() => {
    if (!open) return
    // A plan saved without a name is the same vintage as one saved without a
    // course, and the name is required — so opening the sheet to set the course
    // would dead-end on an empty name field.
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
    const validationError = validateProduct(draft, {
      requireCourse: !editing,
      existingHoleCount: product?.holeCount,
    })
    if (validationError) {
      setError(validationError)
      return
    }

    const savedServiceId = draft.serviceId.trim()
    setSaving(true)
    setError(null)
    try {
      const savedProduct = await courseboardApiJson<GolfReservationProduct>(
        `${productsPath}/${encodeURIComponent(savedServiceId)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            displayName: draft.displayName.trim(),
            playType: draft.playType,
            holeCount: draft.holeCount,
            expectedDurationMinutes: draft.expectedDurationMinutes,
            // The API takes one shape or the other, never both. An empty
            // selection has no array to send, so it clears the course through
            // the scalar the way it always did.
            ...(draft.golfCourseIds.length > 0
              ? { golfCourseIds: draft.golfCourseIds }
              : { golfCourseId: null }),
            maxPlayersPerGroup: draft.maxPlayersPerGroup === ''
              ? null
              : Number(draft.maxPlayersPerGroup),
          }),
        },
      )
      showToast({
        tone: 'success',
        title: t('products:editor.saved.title'),
        message: t('products:editor.saved.body', {
          name: draft.displayName.trim(),
          serviceId: savedServiceId,
        }),
      })
      onSaved(savedProduct)
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
          {/* `Field` is a <label>, and a label inside a label sends every
              click to the same checkbox — so this one row lays out the same
              classes itself. */}
          <div className="field">
            <span className="field-label">{t('products:editor.course')}</span>
            <CourseChecklist
              courses={courses}
              selected={draft.golfCourseIds}
              onChange={golfCourseIds => setDraft(current => ({ ...current, golfCourseIds }))}
            />
            <span className="field-hint">{t('products:editor.courseHint')}</span>
          </div>
          <Field label={t('products:editor.playType')} required>
            <NativeSelectField
              value={draft.playType}
              onChange={value => changePlayType(value as PlayType)}
              options={[
                { value: 'caddie', label: t('products:playType.caddie') },
                { value: 'self', label: t('products:playType.self') },
              ]}
            />
          </Field>
          <Field label={t('products:editor.holeCount')} required>
            <NativeSelectField
              value={String(draft.holeCount)}
              onChange={value => changeHoleCount(Number(value))}
              options={holeCountOptions(draft.holeCount).map(holes => ({
                value: String(holes),
                label: holeCountLabel(holes),
              }))}
            />
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
          <Field
            label={t('products:editor.maxPlayers')}
            hint={t('products:editor.maxPlayersHint')}
            requirement="none"
          >
            <Input
              type="number"
              min={1}
              max={99}
              step={1}
              value={draft.maxPlayersPerGroup}
              placeholder={t('products:editor.maxPlayersFromPolicy')}
              onChange={event => setDraft(current => ({
                ...current,
                maxPlayersPerGroup: event.target.value,
              }))}
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

/**
 * Which courses the plan is sold on.
 *
 * Checkboxes rather than a multi-select list: the desk reads the row it is
 * about to tick, and a plan usually covers either one course or all of them —
 * both of which are a glance here and a drag in a list box. Selection order is
 * ignored on purpose; the courses are stored in the order the club lists them
 * so two plans on the same pair read the same way.
 */
function CourseChecklist({
  courses,
  selected,
  onChange,
}: {
  courses: GolfCourse[]
  selected: string[]
  onChange: (courseIds: string[]) => void
}) {
  const { t } = useTranslation('products')
  if (courses.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('editor.courseNone')}</p>
  }

  const allIds = courses.map(course => course.id)
  const allSelected = allIds.every(id => selected.includes(id))
  const someSelected = allIds.some(id => selected.includes(id))

  return (
    <div className="course-checklist">
      {/* A plan sold on every course is common enough that ticking them one by
          one is busywork. One row toggles the lot; it shows the mixed state so
          it never reads as "nothing is selected" while some course is. */}
      {courses.length > 1 ? (
        <label className="course-checklist-item course-checklist-all">
          <input
            type="checkbox"
            checked={allSelected}
            ref={node => {
              if (node) {
                node.indeterminate = someSelected && !allSelected
              }
            }}
            onChange={event => onChange(event.target.checked ? allIds : [])}
          />
          <span>{t('editor.courseSelectAll')}</span>
        </label>
      ) : null}
      <div className="course-checklist-items">
        {courses.map(course => (
          <label key={course.id} className="course-checklist-item">
            <input
              type="checkbox"
              checked={selected.includes(course.id)}
              onChange={event => onChange(
                event.target.checked
                  ? allIds.filter(id => id === course.id || selected.includes(id))
                  : selected.filter(id => id !== course.id),
              )}
            />
            <span>{courseLabel(course)}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function NativeSelectField({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
}) {
  return (
    <select
      className="native-select"
      value={value}
      onChange={event => onChange(event.target.value)}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map(option => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}

export default ReservationProductsPage

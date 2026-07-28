import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Separator,
} from '@tachyon-sdk/native-ui'
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Download,
  Link2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  downloadText,
  courseboardApiJson,
  courseboardApiText,
  fieldApiJson,
  fieldApiText,
} from '../../api'
import { i18next } from '../../i18n'
import { useRegisterPageReload } from '../../lib/pageReload'
import {
  DataTable,
  EmptyState,
  Field,
  FormGrid,
  LoadingState,
  Metric,
  MetricGrid,
  NativeSelect,
  NativeTextarea,
  Notice,
  PageHeader,
  PageRefreshButton,
  Panel,
  ResourceError,
  SearchInput,
  type DataTableColumn,
} from '../../components/Page'
import { weekdayIndexes, weekdayLabel } from './models'
import { useResource } from '../../hooks/useResource'
import { navigate } from '../../lib/router'
import { caddieLoadPlan } from './caddieLoadPlan'

const COURSE_API = '/v1/course'

type ListResponse<T> = { items: T[] }
type CaddieRosterResponse = ListResponse<CaddieProfile> & { staff?: StaffMember[] }
type View = 'roster' | 'dispatch' | 'attendance' | 'payroll'
type SkillLevel = 'rookie' | 'regular' | 'veteran'
type Rank = 'A' | 'B' | 'C' | 'D'
type AvailabilityStatus =
  | 'available'
  | 'unavailable'
  | 'morning_only'
  | 'afternoon_only'
  | 'light_duty'

type CaddieProfile = {
  id: string
  displayName: string
  staffId?: string | null
  staffReferenceType?: string
  staffReferenceId?: string | null
  active?: boolean
  skillLevel: SkillLevel
  rank?: Rank
  monthlyContractRounds?: number
  canTwoRounds?: boolean
  desiredIncome?: number
  employmentStatus: string
  baseFeeAmount: number
  currency: string
  maxRoundsPerDay: number
  ratingAverage?: number | null
  ratingCount: number
}

type StaffMember = {
  id: string
  name: string
  active: boolean
}

type GolfCourse = {
  id: string
  name: string
  shortName?: string | null
  isActive: boolean
}

type CaddieAssignment = {
  id: string
  caddieProfileId: string
  reservationId?: string | null
  roundReference?: string | null
  scheduledAt: string
  status: string
  assignmentRole: string
  feeAmount: number
  feeCurrency: string
  recommendationScore?: number | null
  nominatedBy?: string | null
  notes?: string | null
  metadataJson?: unknown
}

type CaddieRecommendation = {
  caddieProfileId: string
  displayName: string
  skillLevel: string
  ratingAverage?: number | null
  ratingCount: number
  roundsAssigned: number
  recommendationScore: number
  recommendedRole: string
  pairingDisplayName?: string | null
  rationale: string[]
}

type AttendanceSnapshot = {
  caddieProfileId: string
  displayName: string
  staffId?: string | null
  attendanceStatus: 'not_linked' | 'not_clocked' | 'working' | 'clocked_out'
  todayAssignments: number
  roundsWithoutClockInToday: number
}

type AttendanceResponse = {
  date: string
  items: AttendanceSnapshot[]
}

type CaddieSupply = {
  date: string
  availableCaddies: number
  twoRoundCapable: number
  caddieSupply: number
  morningCapacity: number
  afternoonCapacity: number
  safetyBuffer: number
  caddieAttachedCap: number
  currentCaddieAttached: number
  remaining: number
}

type AutoAssignPlanItem = {
  reservationId: string
  scheduledAt: string
  caddieProfileId: string
  caddieDisplayName: string
  rationale: string[]
}

type AutoAssignResult = {
  dryRun: boolean
  assigned: AutoAssignPlanItem[]
  skipped: { reservationId: string; reason: string }[]
}

type CourseMembership = {
  id: string
  caddieProfileId: string
  golfCourseId: string
  isPrimary: boolean
}

type AvailabilityRecord = {
  id: string
  caddieProfileId: string
  date: string
  status: AvailabilityStatus
  twoRoundRequest: boolean
  healthNote?: string | null
  updatedAt: string
}

type CaddieRating = {
  id: string
  caddieProfileId: string
  assignmentId?: string | null
  reservationId?: string | null
  customerId: string
  score: number
  comment?: string | null
  createdAt: string
}

type PayrollRow = {
  caddieProfileId: string
  displayName: string
  staffId?: string | null
  workedMinutes: number
  shiftedMinutes: number
  assignedRounds: number
  confirmedFeeTotal: number
  currency: string
  openClockIn: boolean
  roundsWithoutClockIn: number
}

type PayrollResponse = {
  period: {
    yearMonth: string
    startDate: string
    endDate: string
  }
  items: PayrollRow[]
}

type Flash = {
  tone: 'success' | 'danger' | 'warning' | 'info'
  title: string
  message: string
} | null

type ResourceValue<T> = {
  data: T | null
  error: unknown
  loading: boolean
  refresh: () => void
}

function request(method: string, payload?: unknown): RequestInit {
  return {
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }
}

function todayJst() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function previousYearMonth() {
  const now = new Date()
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`
}

function formatMoney(amount: number, currency = 'JPY') {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'JPY' ? 0 : 2,
  }).format(amount)
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function dateKey(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 10)
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.trunc(minutes))
  return i18next.t('caddies:duration', {
    hours: String(Math.floor(safe / 60)),
    minutes: String(safe % 60),
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : i18next.t('caddies:error.generic')
}

function resolveStaffId(profile: CaddieProfile) {
  if (profile.staffId) return profile.staffId
  if (profile.staffReferenceType === 'staff_member' && profile.staffReferenceId) {
    return profile.staffReferenceId
  }
  return null
}

function profilePatchPayload(
  profile: CaddieProfile,
  overrides: Partial<{
    displayName: string
    skillLevel: SkillLevel
    employmentStatus: string
    baseFeeAmount: number
    currency: string
    maxRoundsPerDay: number
    staffId: string | null
  }> = {},
) {
  const staffId = overrides.staffId === undefined
    ? resolveStaffId(profile)
    : overrides.staffId
  const employmentStatus = overrides.employmentStatus ?? profile.employmentStatus
  return {
    staffId,
    caddieCode: null,
    staffReferenceType: staffId ? 'staff_member' : (profile.staffReferenceType ?? 'external'),
    staffReferenceId: staffId,
    displayName: overrides.displayName ?? profile.displayName,
    skillLevel: overrides.skillLevel ?? profile.skillLevel,
    active: employmentStatus === 'active',
    employmentStatus,
    baseFeeAmount: overrides.baseFeeAmount ?? profile.baseFeeAmount,
    currency: overrides.currency ?? profile.currency,
    maxRoundsPerDay: overrides.maxRoundsPerDay ?? profile.maxRoundsPerDay,
  }
}

/** The API also returns the legacy `junior` code for rookies. */
const SKILL_KEYS: Record<string, 'rookie' | 'regular' | 'veteran'> = {
  rookie: 'rookie',
  junior: 'rookie',
  regular: 'regular',
  veteran: 'veteran',
}
const EMPLOYMENT_STATUSES = ['active', 'inactive', 'suspended'] as const

function skillLabel(skill: string) {
  const key = SKILL_KEYS[skill]
  if (!key) return skill
  return i18next.t(`caddies:skill.${key}` as 'caddies:skill.rookie')
}

function employmentLabel(status: string) {
  if (!(EMPLOYMENT_STATUSES as readonly string[]).includes(status)) return status
  return i18next.t(`caddies:employment.${status}` as 'caddies:employment.active')
}

/** The API returns raw role codes; anything unexpected is shown as-is. */
function roleLabel(role: string) {
  if (role === 'primary' || role === 'lead') return i18next.t('caddies:role.primary')
  if (role === 'assistant' || role === 'support') return i18next.t('caddies:role.assistant')
  return role
}

function attendanceLabel(status: AttendanceSnapshot['attendanceStatus']) {
  return i18next.t(`caddies:attendanceStatus.${status}` as 'caddies:attendanceStatus.working')
}

function attendanceVariant(status: AttendanceSnapshot['attendanceStatus']) {
  if (status === 'working') return 'success' as const
  if (status === 'not_clocked') return 'warning' as const
  if (status === 'not_linked') return 'destructive' as const
  return 'neutral' as const
}

function assignmentVariant(status: string) {
  if (status === 'completed') return 'success' as const
  if (status === 'assigned') return 'accent' as const
  if (status === 'cancelled' || status === 'absent' || status === 'no_show') {
    return 'destructive' as const
  }
  return 'warning' as const
}

function FlashNotice({ flash, onDismiss }: { flash: Flash; onDismiss: () => void }) {
  if (!flash) return null
  return (
    <Notice
      tone={flash.tone}
      title={flash.title}
      actions={(
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          {i18next.t('common:action.close')}
        </Button>
      )}
    >
      {flash.message}
    </Notice>
  )
}

function viewCopy(view: View) {
  return {
    title: i18next.t(`caddies:view.${view}.title` as 'caddies:view.roster.title'),
    description: i18next.t(`caddies:view.${view}.description` as 'caddies:view.roster.description'),
  }
}

export function CaddiesPage({
  initialView = 'roster',
  initialProfileId,
}: {
  initialView?: View
  initialProfileId?: string
} = {}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [view, setView] = useState<View>(initialView)
  const [operationDate, setOperationDate] = useState(todayJst)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(initialProfileId ?? null)
  const [createOpen, setCreateOpen] = useState(false)
  const [flash, setFlash] = useState<Flash>(null)

  const profilesResource = useResource(
    () => courseboardApiJson<CaddieRosterResponse>(`${COURSE_API}/caddie-profiles`),
    [],
    { enabled: view !== 'payroll' },
  )
  const loadPlan = caddieLoadPlan(
    view,
    profilesResource.data !== null,
  )
  const assignmentMonth = view === 'dispatch'
    ? operationDate.slice(0, 7)
    : todayJst().slice(0, 7)
  const assignmentBounds = monthBounds(assignmentMonth)
  const assignmentsResource = useResource(
    () => courseboardApiJson<ListResponse<CaddieAssignment>>(
      `${COURSE_API}/caddie-assignments?from=${assignmentBounds.from}&to=${assignmentBounds.to}`,
    ),
    [assignmentBounds.from, assignmentBounds.to],
    {
      enabled: loadPlan.assignments,
      cacheKey: `caddie-assignments:${assignmentBounds.from}:${assignmentBounds.to}`,
    },
  )
  const recommendationsResource = useResource(
    () => courseboardApiJson<ListResponse<CaddieRecommendation>>(
      `${COURSE_API}/caddie-recommendations?playerCount=4&includeRookiePairing=true&limit=5`,
    ),
    [],
    { enabled: loadPlan.recommendations },
  )
  const coursesResource = useResource(
    () => courseboardApiJson<ListResponse<GolfCourse>>(`${COURSE_API}/courses`),
    [],
    { enabled: loadPlan.courses },
  )
  const attendanceResource = useResource(
    () => courseboardApiJson<AttendanceResponse>(
      `${COURSE_API}/caddie-attendance-snapshot?date=${encodeURIComponent(operationDate)}`,
    ),
    [operationDate],
    { enabled: loadPlan.attendance },
  )
  const staffResource = useMemo<ResourceValue<ListResponse<StaffMember>>>(
    () => ({
      data: profilesResource.data ? { items: profilesResource.data.staff ?? [] } : null,
      error: profilesResource.error,
      loading: profilesResource.loading,
      refresh: profilesResource.refresh,
    }),
    [profilesResource.data, profilesResource.error, profilesResource.loading, profilesResource.refresh],
  )

  const profiles = useMemo(
    () => profilesResource.data?.items ?? [],
    [profilesResource.data],
  )

  useEffect(() => {
    setView(initialView)
  }, [initialView])

  useEffect(() => {
    if (initialProfileId) {
      setSelectedProfileId(initialProfileId)
      setView('roster')
    }
  }, [initialProfileId])

  useEffect(() => {
    if (view !== 'roster' || profiles.length === 0) return
    if (selectedProfileId && profiles.some(profile => profile.id === selectedProfileId)) return
    // Only follow the route; landing on the roster must show the list, not the
    // first caddie's detail.
    if (initialProfileId && profiles.some(profile => profile.id === initialProfileId)) {
      setSelectedProfileId(initialProfileId)
    }
  }, [initialProfileId, profiles, selectedProfileId, view])

  function refreshPeople() {
    profilesResource.refresh()
    attendanceResource.refresh()
  }

  function refreshDispatch() {
    assignmentsResource.refresh()
    attendanceResource.refresh()
    recommendationsResource.refresh()
  }

  function selectProfile(profileId: string) {
    setSelectedProfileId(profileId)
    setView('roster')
    navigate(`golf/caddies/${encodeURIComponent(profileId)}`)
  }

  function backToRoster() {
    setSelectedProfileId(null)
    navigate('golf/caddies')
  }

  const refreshCurrentView = useCallback(() => {
    if (view === 'roster') {
      profilesResource.refresh()
      coursesResource.refresh()
      assignmentsResource.refresh()
      attendanceResource.refresh()
      return
    }
    if (view === 'dispatch') {
      profilesResource.refresh()
      assignmentsResource.refresh()
      recommendationsResource.refresh()
      attendanceResource.refresh()
      return
    }
    if (view === 'attendance') {
      profilesResource.refresh()
      attendanceResource.refresh()
    }
  }, [
    view,
    profilesResource.refresh,
    coursesResource.refresh,
    assignmentsResource.refresh,
    attendanceResource.refresh,
    recommendationsResource.refresh,
  ])

  useRegisterPageReload(view === 'payroll' ? null : refreshCurrentView)

  const copy = viewCopy(view)
  const showingProfileDetail = view === 'roster' && Boolean(selectedProfileId)

  return (
    <div className="page-stack">
      {showingProfileDetail ? null : (
      <PageHeader
        title={copy.title}
        description={copy.description}
        actions={(
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {view !== 'payroll' ? (
              <PageRefreshButton
                variant="secondary"
                className="min-h-10 flex-1 sm:flex-none"
                label={t('common:action.refresh')}
                onClick={refreshCurrentView}
              />
            ) : null}
            {view === 'roster' ? (
              <Button
                type="button"
                variant="primary"
                className="min-h-10 flex-1 sm:flex-none"
                onClick={() => setCreateOpen(true)}
              >
                <Plus /> {t('caddies:add')}
              </Button>
            ) : null}
          </div>
        )}
      />
      )}

      <FlashNotice flash={flash} onDismiss={() => setFlash(null)} />

      {view === 'roster' ? (
        <ProfilesView
          profilesResource={profilesResource}
          assignmentsResource={assignmentsResource}
          staffResource={staffResource}
          coursesResource={coursesResource}
          attendanceResource={attendanceResource}
          selectedProfileId={selectedProfileId}
          onSelectProfile={selectProfile}
          onBack={backToRoster}
          onRefresh={refreshCurrentView}
          onCreate={() => setCreateOpen(true)}
          onPeopleChanged={refreshPeople}
          onAssignmentsChanged={refreshDispatch}
          setFlash={setFlash}
        />
      ) : null}

      {view === 'dispatch' ? (
        <DispatchView
          date={operationDate}
          onDateChange={setOperationDate}
          profilesResource={profilesResource}
          assignmentsResource={assignmentsResource}
          recommendationsResource={recommendationsResource}
          attendanceResource={attendanceResource}
          onChanged={refreshDispatch}
          setFlash={setFlash}
        />
      ) : null}

      {view === 'attendance' ? (
        <AttendanceView
          date={operationDate}
          onDateChange={setOperationDate}
          profiles={profiles}
          attendanceResource={attendanceResource}
          onChanged={() => {
            attendanceResource.refresh()
            assignmentsResource.refresh()
          }}
          setFlash={setFlash}
        />
      ) : null}

      {view === 'payroll' ? (
        <PayrollView setFlash={setFlash} />
      ) : null}

      <ProfileCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        staff={staffResource.data?.items ?? []}
        staffLoading={staffResource.loading}
        staffError={staffResource.error}
        onRetryStaff={staffResource.refresh}
        onCreated={id => {
          setCreateOpen(false)
          setView('roster')
          if (id) selectProfile(id)
          refreshPeople()
          setFlash({
            tone: 'success',
            title: t('caddies:added.title'),
            message: t('caddies:added.message'),
          })
        }}
      />
    </div>
  )
}

function DispatchView({
  date,
  onDateChange,
  profilesResource,
  assignmentsResource,
  recommendationsResource,
  attendanceResource,
  onChanged,
  setFlash,
}: {
  date: string
  onDateChange: (date: string) => void
  profilesResource: ResourceValue<ListResponse<CaddieProfile>>
  assignmentsResource: ResourceValue<ListResponse<CaddieAssignment>>
  recommendationsResource: ResourceValue<ListResponse<CaddieRecommendation>>
  attendanceResource: ResourceValue<AttendanceResponse>
  onChanged: () => void
  setFlash: (flash: Flash) => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const profiles = profilesResource.data?.items ?? []
  const assignments = assignmentsResource.data?.items ?? []
  const attendance = attendanceResource.data?.items ?? []
  const dayAssignments = assignments.filter(item => dateKey(item.scheduledAt) === date)
  const activeAssignments = dayAssignments.filter(item => item.status !== 'cancelled')
  const working = attendance.filter(item => item.attendanceStatus === 'working').length
  const waiting = activeAssignments.filter(item =>
    ['pending', 'requested', 'draft'].includes(item.status),
  ).length

  return (
    <div className="space-y-6">
      <section className="app-section space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="section-title">{t('caddies:dispatch.boardTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('caddies:dispatch.boardDescription', { date })}
            </p>
          </div>
          <Field label={t('caddies:operationDate')} className="w-full sm:w-44">
            <Input
              type="date"
              aria-label={t('caddies:operationDate')}
              value={date}
              onChange={event => onDateChange(event.target.value)}
              className="min-h-10"
            />
          </Field>
        </div>
        <MetricGrid>
          <Metric
            label={t('caddies:dispatch.metrics.registered')}
            value={t('caddies:people', { n: String(profiles.length) })}
            detail={t('caddies:dispatch.metrics.registeredDetail')}
          />
          <Metric
            label={t('caddies:dispatch.metrics.working')}
            value={t('caddies:people', { n: String(working) })}
            detail={t('caddies:dispatch.metrics.workingDetail', { n: String(attendance.length) })}
            tone={working > 0 ? 'success' : 'warning'}
          />
          <Metric
            label={t('caddies:dispatch.metrics.todayAssignments')}
            value={t('caddies:groups', { n: String(activeAssignments.length) })}
            detail={t('caddies:dispatch.metrics.todayAssignmentsDetail', {
              n: String(dayAssignments.length - activeAssignments.length),
            })}
          />
          <Metric
            label={t('caddies:dispatch.metrics.needsCheck')}
            value={t('caddies:items', { n: String(waiting) })}
            detail={t('caddies:dispatch.metrics.needsCheckDetail')}
            tone={waiting > 0 ? 'warning' : 'success'}
          />
        </MetricGrid>
        {assignmentsResource.loading ? <LoadingState label={t('caddies:dispatch.loading')} /> : null}
        {assignmentsResource.error ? (
          <ResourceError error={assignmentsResource.error} onRetry={assignmentsResource.refresh} />
        ) : null}
        {!assignmentsResource.loading && !assignmentsResource.error ? (
          <AssignmentsTable
            assignments={dayAssignments}
            profiles={profiles}
            onChanged={onChanged}
            setFlash={setFlash}
          />
        ) : null}
      </section>

      <section className="app-section space-y-4">
        <div>
          <h2 className="section-title">{t('caddies:dispatch.supportTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('caddies:dispatch.supportDescription')}
          </p>
        </div>
        <DailySupplyPanel date={date} />
        <div className="grid gap-4 xl:grid-cols-2">
          <AutoAssignPanel
            date={date}
            onChanged={onChanged}
            setFlash={setFlash}
          />
          <RecommendationsPanel resource={recommendationsResource} />
        </div>
      </section>
    </div>
  )
}

function AttendanceView({
  date,
  onDateChange,
  profiles,
  attendanceResource,
  onChanged,
  setFlash,
}: {
  date: string
  onDateChange: (date: string) => void
  profiles: CaddieProfile[]
  attendanceResource: ResourceValue<AttendanceResponse>
  onChanged: () => void
  setFlash: (flash: Flash) => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  return (
    <div className="space-y-4">
      <section className="app-section space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="section-title">{t('caddies:attendance.boardTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('caddies:attendance.boardDescription', { date })}
            </p>
          </div>
          <Field label={t('caddies:operationDate')} className="w-full sm:w-44">
            <Input
              type="date"
              aria-label={t('caddies:operationDate')}
              value={date}
              onChange={event => onDateChange(event.target.value)}
              className="min-h-10"
            />
          </Field>
        </div>
      </section>
      <AttendancePanel
        resource={attendanceResource}
        profiles={profiles}
        onChanged={onChanged}
        setFlash={setFlash}
        showHeader={false}
      />
    </div>
  )
}

function DailySupplyPanel({ date }: { date: string }) {
  const { t } = useTranslation(['caddies', 'common'])
  const [safetyBuffer, setSafetyBuffer] = useState(0)
  const resource = useResource(
    () => courseboardApiJson<CaddieSupply>(
      `${COURSE_API}/caddie-supply?date=${encodeURIComponent(date)}&safetyBuffer=${safetyBuffer}`,
    ),
    [date, safetyBuffer],
  )

  return (
    <Panel
      title={t('caddies:supply.title')}
      description={t('caddies:supply.description')}
      actions={(
        <Field label={t('caddies:supply.buffer')} className="w-full sm:w-36">
          <Input
            type="number"
            min={0}
            value={safetyBuffer}
            onChange={event => setSafetyBuffer(Math.max(0, Number.parseInt(event.target.value, 10) || 0))}
            className="min-h-10"
          />
        </Field>
      )}
    >
      {resource.loading ? <LoadingState label={t('caddies:supply.loading')} /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {resource.data ? (
        <div className="space-y-3">
          <MetricGrid>
            <Metric
              label={t('caddies:supply.metrics.supply')}
              value={t('caddies:groups', { n: String(resource.data.caddieSupply) })}
              detail={t('caddies:supply.metrics.supplyDetail', {
                available: String(resource.data.availableCaddies),
                twoRounds: String(resource.data.twoRoundCapable),
              })}
            />
            <Metric
              label={t('caddies:supply.metrics.cap')}
              value={t('caddies:groups', { n: String(resource.data.caddieAttachedCap) })}
              detail={t('caddies:supply.metrics.capDetail', { n: String(resource.data.safetyBuffer) })}
            />
            <Metric
              label={t('caddies:supply.metrics.booked')}
              value={t('caddies:groups', { n: String(resource.data.currentCaddieAttached) })}
              detail={t('caddies:supply.metrics.bookedDetail')}
            />
            <Metric
              label={t('caddies:supply.metrics.remaining')}
              value={t('caddies:groups', { n: String(resource.data.remaining) })}
              detail={resource.data.remaining < 0
                ? t('caddies:supply.metrics.over')
                : t('caddies:supply.metrics.ok')}
              tone={resource.data.remaining < 0 ? 'danger' : 'success'}
            />
          </MetricGrid>
          <p className="text-xs text-muted-foreground">
            {t('caddies:supply.note', {
              morning: String(resource.data.morningCapacity),
              afternoon: String(resource.data.afternoonCapacity),
            })}
          </p>
        </div>
      ) : null}
    </Panel>
  )
}

function AutoAssignPanel({
  date,
  onChanged,
  setFlash,
}: {
  date: string
  onChanged: () => void
  setFlash: (flash: Flash) => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [plan, setPlan] = useState<AutoAssignResult | null>(null)
  const [busy, setBusy] = useState<'preview' | 'execute' | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    setPlan(null)
    setError(null)
  }, [date])

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'preview' : 'execute')
    setError(null)
    try {
      const result = await courseboardApiJson<AutoAssignResult>(
      `${COURSE_API}/caddie-auto-assignments`,
        request('POST', { date, dryRun }),
      )
      setPlan(result)
      if (!dryRun) {
        onChanged()
        setFlash({
          tone: 'success',
          title: t('caddies:autoAssign.done.title'),
          message: t('caddies:autoAssign.done.message', {
            assigned: String(result.assigned.length),
            skipped: String(result.skipped.length),
          }),
        })
      }
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel
      title={t('caddies:autoAssign.title')}
      description={t('caddies:autoAssign.description')}
      actions={<Sparkles className="size-5 text-primary" aria-hidden="true" />}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="secondary"
          className="min-h-10 flex-1"
          disabled={busy !== null || !date}
          onClick={() => void run(true)}
        >
          <Sparkles />
          {busy === 'preview' ? t('caddies:autoAssign.previewing') : t('caddies:autoAssign.preview')}
        </Button>
        <Button
          type="button"
          variant="primary"
          className="min-h-10 flex-1"
          disabled={busy !== null || !plan || plan.assigned.length === 0}
          onClick={() => void run(false)}
        >
          <CheckCircle2 />
          {busy === 'execute' ? t('caddies:autoAssign.executing') : t('caddies:autoAssign.execute')}
        </Button>
      </div>

      {error ? (
        <div className="mt-3">
          <Notice tone="danger" title={t('caddies:autoAssign.failed')}>
            {errorMessage(error)}
          </Notice>
        </div>
      ) : null}

      {plan ? (
        <div className="mt-4 space-y-3">
          {plan.assigned.length === 0 ? (
            <EmptyState
              title={t('caddies:autoAssign.empty.title')}
              description={t('caddies:autoAssign.empty.description')}
            />
          ) : (
            <div className="space-y-2">
              {plan.assigned.map(item => (
                <div key={`${item.reservationId}-${item.caddieProfileId}`} className="rounded-lg border border-border bg-background p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground">{item.caddieDisplayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(item.scheduledAt)} · {item.reservationId}
                      </p>
                    </div>
                    <Badge variant="accent">{t('caddies:autoAssign.candidate')}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{item.rationale.join(' · ')}</p>
                </div>
              ))}
            </div>
          )}
          {plan.skipped.length > 0 ? (
            <Notice
              tone="warning"
              title={t('caddies:autoAssign.skipped', { n: String(plan.skipped.length) })}
            >
              <ul className="list-inside list-disc space-y-1">
                {plan.skipped.map(item => (
                  <li key={item.reservationId}>{item.reservationId}: {item.reason}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}

function RecommendationsPanel({
  resource,
}: {
  resource: ResourceValue<ListResponse<CaddieRecommendation>>
}) {
  const { t } = useTranslation(['caddies', 'common'])
  return (
    <Panel
      title={t('caddies:recommendations.title')}
      description={t('caddies:recommendations.description')}
      actions={(
        <Button type="button" variant="ghost" size="sm" className="min-h-9" onClick={resource.refresh}>
          <RefreshCw /> {t('common:action.refresh')}
        </Button>
      )}
    >
      {resource.loading ? <LoadingState label={t('caddies:recommendations.loading')} /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {!resource.loading && !resource.error && (resource.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title={t('caddies:recommendations.empty.title')}
          description={t('caddies:recommendations.empty.description')}
        />
      ) : null}
      <div className="space-y-2">
        {resource.data?.items.map((item, index) => (
          <div key={item.caddieProfileId} className="flex gap-3 rounded-lg border border-border bg-background p-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-selected font-semibold text-primary">
              {index + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-foreground">{item.displayName}</p>
                <Badge variant="neutral">{skillLabel(item.skillLevel)}</Badge>
                <Badge variant="accent">
                  {t('caddies:recommendations.score', { n: String(item.recommendationScore) })}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('caddies:recommendations.meta', {
                  role: roleLabel(item.recommendedRole),
                  rounds: String(item.roundsAssigned),
                  rating: item.ratingAverage?.toFixed(1) ?? '—',
                })}
              </p>
              {item.pairingDisplayName ? (
                <p className="mt-1 text-xs text-foreground">
                  {t('caddies:recommendations.pair', { name: item.pairingDisplayName })}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">{item.rationale.join(' · ')}</p>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function AttendancePanel({
  resource,
  profiles,
  onChanged,
  setFlash,
  showHeader = true,
}: {
  resource: ResourceValue<AttendanceResponse>
  profiles: CaddieProfile[]
  onChanged: () => void
  setFlash: (flash: Flash) => void
  showHeader?: boolean
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [busyId, setBusyId] = useState<string | null>(null)
  const profileMap = useMemo(
    () => new Map(profiles.map(profile => [profile.id, profile])),
    [profiles],
  )

  async function clock(snapshot: AttendanceSnapshot, direction: 'in' | 'out') {
    const profile = profileMap.get(snapshot.caddieProfileId)
    const staffId = snapshot.staffId ?? (profile ? resolveStaffId(profile) : null)
    if (!staffId) {
      setFlash({
        tone: 'warning',
        title: t('caddies:attendance.notLinked.title'),
        message: t('caddies:attendance.notLinked.message'),
      })
      return
    }
    setBusyId(snapshot.caddieProfileId)
    try {
      await fieldApiText(
        `/v1/erp/staff/${encodeURIComponent(staffId)}/clock-${direction}`,
        request('POST', direction === 'out' ? { breakMinutes: 0 } : {}),
      )
      onChanged()
      setFlash({
        tone: 'success',
        title: direction === 'in'
          ? t('caddies:attendance.clockedIn')
          : t('caddies:attendance.clockedOut'),
        message: t('caddies:attendance.updated', { name: snapshot.displayName }),
      })
    } catch (error) {
      setFlash({
        tone: 'danger',
        title: t('caddies:attendance.failed'),
        message: errorMessage(error),
      })
    } finally {
      setBusyId(null)
    }
  }

  const columns: DataTableColumn<AttendanceSnapshot>[] = [
    {
      key: 'name',
      header: t('caddies:attendance.table.caddie'),
      mobileLabel: t('caddies:attendance.table.caddie'),
      cell: row => (
        <div>
          <p className="font-medium">{row.displayName}</p>
          <p className="text-xs text-muted-foreground">
            {t('caddies:attendance.table.todayGroups', { n: String(row.todayAssignments) })}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('caddies:attendance.table.status'),
      mobileLabel: t('caddies:attendance.table.status'),
      cell: row => <Badge variant={attendanceVariant(row.attendanceStatus)}>{attendanceLabel(row.attendanceStatus)}</Badge>,
    },
    {
      key: 'warning',
      header: t('caddies:attendance.table.needsCheck'),
      mobileLabel: t('caddies:attendance.table.needsCheck'),
      cell: row => row.roundsWithoutClockInToday > 0
        ? (
          <span className="text-warning">
            {t('caddies:attendance.table.missingClockIn', {
              n: String(row.roundsWithoutClockInToday),
            })}
          </span>
        )
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'action',
      header: t('caddies:attendance.table.actions'),
      mobileLabel: t('caddies:attendance.table.actions'),
      align: 'right',
      cell: row => (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="min-h-9"
            disabled={busyId === row.caddieProfileId || row.attendanceStatus === 'working' || row.attendanceStatus === 'not_linked'}
            onClick={() => void clock(row, 'in')}
          >
            <Clock /> {t('caddies:attendance.clockIn')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-9"
            disabled={busyId === row.caddieProfileId || row.attendanceStatus !== 'working'}
            onClick={() => void clock(row, 'out')}
          >
            {t('caddies:attendance.clockOut')}
          </Button>
        </div>
      ),
    },
  ]

  const body = (
    <>
      {resource.loading ? <LoadingState label={t('caddies:attendance.loading')} /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {resource.data ? (
        <DataTable
          rows={resource.data.items}
          columns={columns}
          rowKey={row => row.caddieProfileId}
          empty={(
            <EmptyState
              title={t('caddies:attendance.empty.title')}
              description={t('caddies:attendance.empty.description')}
            />
          )}
        />
      ) : null}
    </>
  )

  if (!showHeader) return <div className="space-y-3">{body}</div>

  return (
    <Panel
      title={t('caddies:attendance.panelTitle')}
      description={t('caddies:attendance.panelDescription')}
      actions={(
        <Button type="button" variant="secondary" size="sm" className="min-h-9" onClick={resource.refresh}>
          <RefreshCw /> {t('common:action.refresh')}
        </Button>
      )}
    >
      {body}
    </Panel>
  )
}

function AssignmentsTable({
  assignments,
  profiles,
  onChanged,
  setFlash,
}: {
  assignments: CaddieAssignment[]
  profiles: CaddieProfile[]
  onChanged: () => void
  setFlash: (flash: Flash) => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [busyId, setBusyId] = useState<string | null>(null)
  const profileNames = useMemo(
    () => new Map(profiles.map(profile => [profile.id, profile.displayName])),
    [profiles],
  )
  const sorted = useMemo(
    () => [...assignments].sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt)),
    [assignments],
  )

  async function updateStatus(assignment: CaddieAssignment, status: 'completed' | 'cancelled') {
    setBusyId(assignment.id)
    try {
      await courseboardApiJson(
        `${COURSE_API}/caddie-assignments/${encodeURIComponent(assignment.id)}`,
        request('PATCH', {
          caddieProfileId: assignment.caddieProfileId,
          reservationId: assignment.reservationId ?? null,
          roundReference: assignment.roundReference ?? null,
          scheduledAt: assignment.scheduledAt,
          status,
          assignmentRole: assignment.assignmentRole,
          feeAmount: assignment.feeAmount,
          feeCurrency: assignment.feeCurrency,
          recommendationScore: assignment.recommendationScore ?? null,
          notes: assignment.notes ?? null,
          metadataJson: assignment.metadataJson ?? null,
        }),
      )
      onChanged()
      setFlash({
        tone: 'success',
        title: status === 'completed'
          ? t('caddies:assignments.completed')
          : t('caddies:assignments.cancelled'),
        message: assignment.roundReference ?? assignment.reservationId ?? assignment.id,
      })
    } catch (error) {
      setFlash({
        tone: 'danger',
        title: t('caddies:assignments.failed'),
        message: errorMessage(error),
      })
    } finally {
      setBusyId(null)
    }
  }

  const columns: DataTableColumn<CaddieAssignment>[] = [
    {
      key: 'time',
      header: t('caddies:assignments.table.schedule'),
      mobileLabel: t('caddies:assignments.table.schedule'),
      cell: row => formatDateTime(row.scheduledAt),
    },
    {
      key: 'round',
      header: t('caddies:assignments.table.round'),
      mobileLabel: t('caddies:assignments.table.round'),
      cell: row => (
        <div>
          <p className="font-medium">{row.roundReference ?? row.reservationId ?? row.id}</p>
          <p className="text-xs text-muted-foreground">{row.assignmentRole}</p>
        </div>
      ),
    },
    {
      key: 'caddie',
      header: t('caddies:assignments.table.caddie'),
      mobileLabel: t('caddies:assignments.table.caddie'),
      cell: row => profileNames.get(row.caddieProfileId) ?? row.caddieProfileId,
    },
    {
      key: 'fee',
      header: t('caddies:assignments.table.fee'),
      mobileLabel: t('caddies:assignments.table.fee'),
      align: 'right',
      cell: row => formatMoney(row.feeAmount, row.feeCurrency),
    },
    {
      key: 'status',
      header: t('caddies:assignments.table.status'),
      mobileLabel: t('caddies:assignments.table.status'),
      cell: row => <Badge variant={assignmentVariant(row.status)}>{row.status}</Badge>,
    },
    {
      key: 'action',
      header: t('caddies:assignments.table.actions'),
      mobileLabel: t('caddies:assignments.table.actions'),
      align: 'right',
      cell: row => row.status === 'assigned' ? (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="min-h-9"
            disabled={busyId === row.id}
            onClick={() => void updateStatus(row, 'completed')}
          >
            <CheckCircle2 /> {t('caddies:assignments.complete')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-9 text-destructive"
            disabled={busyId === row.id}
            onClick={() => void updateStatus(row, 'cancelled')}
          >
            <XCircle /> {t('caddies:assignments.cancel')}
          </Button>
        </div>
      ) : <span className="text-muted-foreground">—</span>,
    },
  ]

  return (
    <DataTable
      rows={sorted}
      columns={columns}
      rowKey={row => row.id}
      empty={(
        <EmptyState
          title={t('caddies:assignments.empty.title')}
          description={t('caddies:assignments.empty.description')}
        />
      )}
    />
  )
}

function ProfilesView({
  profilesResource,
  assignmentsResource,
  staffResource,
  coursesResource,
  attendanceResource,
  selectedProfileId,
  onSelectProfile,
  onBack,
  onRefresh,
  onCreate,
  onPeopleChanged,
  onAssignmentsChanged,
  setFlash,
}: {
  profilesResource: ResourceValue<ListResponse<CaddieProfile>>
  assignmentsResource: ResourceValue<ListResponse<CaddieAssignment>>
  staffResource: ResourceValue<ListResponse<StaffMember>>
  coursesResource: ResourceValue<ListResponse<GolfCourse>>
  attendanceResource: ResourceValue<AttendanceResponse>
  selectedProfileId: string | null
  onSelectProfile: (id: string) => void
  onBack: () => void
  onRefresh: () => void
  onCreate: () => void
  onPeopleChanged: () => void
  onAssignmentsChanged: () => void
  setFlash: (flash: Flash) => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [skill, setSkill] = useState('all')
  const [link, setLink] = useState('all')
  const profiles = profilesResource.data?.items ?? []
  const normalizedQuery = query.trim().toLocaleLowerCase('ja')
  const filtered = profiles.filter(profile => {
    const staffId = resolveStaffId(profile)
    const queryMatches = !normalizedQuery
      || profile.displayName.toLocaleLowerCase('ja').includes(normalizedQuery)
      || profile.id.toLocaleLowerCase('ja').includes(normalizedQuery)
      || staffId?.toLocaleLowerCase('ja').includes(normalizedQuery)
    const statusMatches = status === 'all' || profile.employmentStatus === status
    const skillMatches = skill === 'all' || profile.skillLevel === skill
    const linkMatches = link === 'all'
      || (link === 'linked' ? Boolean(staffId) : !staffId)
    return queryMatches && statusMatches && skillMatches && linkMatches
  })
  const selected = profiles.find(profile => profile.id === selectedProfileId) ?? null
  const unlinked = profiles.filter(profile => !resolveStaffId(profile)).length

  // The roster is a list *or* a detail, never both: the old split view squeezed
  // the detail into a third of the width, which is what made it unreadable.
  if (selected) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft /> {t('caddies:roster.backToList')}
          </Button>
          <PageRefreshButton
            variant="secondary"
            size="sm"
            label={t('common:action.refresh')}
            onClick={onRefresh}
          />
        </div>
        <ProfileDetail
          key={selected.id}
          profile={selected}
          assignments={assignmentsResource.data?.items.filter(item => item.caddieProfileId === selected.id) ?? []}
          assignmentsLoading={assignmentsResource.loading}
          assignmentsError={assignmentsResource.error}
          staff={staffResource.data?.items ?? []}
          staffError={staffResource.error}
          courses={coursesResource.data?.items.filter(course => course.isActive !== false) ?? []}
          coursesError={coursesResource.error}
          attendance={attendanceResource.data?.items.find(item => item.caddieProfileId === selected.id) ?? null}
          onPeopleChanged={onPeopleChanged}
          onAssignmentsChanged={onAssignmentsChanged}
          setFlash={setFlash}
        />
      </div>
    )
  }

  const columns: DataTableColumn<CaddieProfile>[] = [
    {
      key: 'name',
      header: t('caddies:roster.table.name'),
      mobileLabel: t('caddies:roster.table.name'),
      cell: profile => (
        <div className="grid gap-0.5">
          <strong>{profile.displayName}</strong>
          <span className="text-xs text-muted-foreground">{profile.id}</span>
        </div>
      ),
    },
    {
      key: 'employment',
      header: t('caddies:roster.table.employment'),
      mobileLabel: t('caddies:roster.table.employment'),
      cell: profile => (
        <Badge variant={profile.employmentStatus === 'active' ? 'success' : 'neutral'}>
          {employmentLabel(profile.employmentStatus)}
        </Badge>
      ),
    },
    {
      key: 'skill',
      header: t('caddies:roster.table.skill'),
      mobileLabel: t('caddies:roster.table.skill'),
      cell: profile => (
        <span>
          {profile.rank ? t('caddies:roster.rank', { rank: profile.rank }) : ''}
          {skillLabel(profile.skillLevel)}
        </span>
      ),
    },
    {
      key: 'rating',
      header: t('caddies:roster.table.rating'),
      mobileLabel: t('caddies:roster.table.rating'),
      align: 'right',
      cell: profile => (
        <span className="inline-flex items-center gap-1">
          <Star className="size-3 fill-warning text-warning" aria-hidden="true" />
          {profile.ratingAverage?.toFixed(1) ?? '—'} ({profile.ratingCount})
        </span>
      ),
    },
    {
      key: 'link',
      header: t('caddies:roster.table.link'),
      mobileLabel: t('caddies:roster.table.link'),
      cell: profile => (
        <span className={resolveStaffId(profile) ? 'text-success' : 'text-warning'}>
          {resolveStaffId(profile)
            ? t('caddies:roster.linked')
            : t('caddies:roster.notLinked')}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      {staffResource.error ? (
        <ResourceError error={staffResource.error} onRetry={staffResource.refresh} />
      ) : null}
      {unlinked > 0 ? (
        <Notice
          tone="warning"
          title={t('caddies:roster.unlinkedWarning.title', { n: String(unlinked) })}
          actions={(
            <Button type="button" size="sm" variant="secondary" onClick={() => setLink('unlinked')}>
              {t('caddies:roster.unlinkedWarning.showOnly')}
            </Button>
          )}
        >
          {t('caddies:roster.unlinkedWarning.description')}
        </Notice>
      ) : null}

      <Panel
        description={t('caddies:roster.count', {
          shown: String(filtered.length),
          total: String(profiles.length),
        })}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative sm:max-w-72 sm:flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden="true" />
            <SearchInput
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('caddies:roster.search')}
              aria-label={t('caddies:roster.searchLabel')}
              className="min-h-10 pl-8"
            />
          </div>
          <NativeSelect
            value={status}
            onChange={event => setStatus(event.target.value)}
            aria-label={t('caddies:roster.filter.employment')}
            className="sm:w-44"
          >
            <option value="all">{t('caddies:roster.filter.allEmployment')}</option>
            <option value="active">{t('caddies:employment.active')}</option>
            <option value="inactive">{t('caddies:employment.inactive')}</option>
            <option value="suspended">{t('caddies:employment.suspended')}</option>
          </NativeSelect>
          <NativeSelect
            value={skill}
            onChange={event => setSkill(event.target.value)}
            aria-label={t('caddies:roster.filter.skill')}
            className="sm:w-44"
          >
            <option value="all">{t('caddies:roster.filter.allSkills')}</option>
            <option value="rookie">{t('caddies:skill.rookie')}</option>
            <option value="regular">{t('caddies:skill.regular')}</option>
            <option value="veteran">{t('caddies:skill.veteran')}</option>
          </NativeSelect>
          <NativeSelect
            value={link}
            onChange={event => setLink(event.target.value)}
            aria-label={t('caddies:roster.filter.link')}
            className="sm:w-52"
          >
            <option value="all">{t('caddies:roster.filter.allLinks')}</option>
            <option value="linked">{t('caddies:roster.filter.linked')}</option>
            <option value="unlinked">{t('caddies:roster.filter.unlinked')}</option>
          </NativeSelect>
        </div>

        <Separator className="my-3" />

        {profilesResource.loading && !profilesResource.data ? (
          <LoadingState label={t('caddies:roster.loading')} />
        ) : null}
        {profilesResource.error ? (
          <ResourceError error={profilesResource.error} onRetry={profilesResource.refresh} />
        ) : null}
        {!profilesResource.loading && !profilesResource.error ? (
          <DataTable
            rows={filtered}
            columns={columns}
            rowKey={profile => profile.id}
            onRowClick={profile => onSelectProfile(profile.id)}
            empty={(
              <EmptyState
                title={profiles.length === 0
                  ? t('caddies:roster.empty.titleNoData')
                  : t('caddies:roster.empty.titleNoMatch')}
                description={profiles.length === 0
                  ? t('caddies:roster.empty.descriptionNoData')
                  : t('caddies:roster.empty.descriptionNoMatch')}
                action={profiles.length === 0 ? (
                  <Button type="button" variant="primary" className="min-h-10" onClick={onCreate}>
                    <Plus /> {t('caddies:add')}
                  </Button>
                ) : undefined}
              />
            )}
          />
        ) : null}
      </Panel>
    </div>
  )
}

function ProfileCreateDialog({
  open,
  onOpenChange,
  staff,
  staffLoading,
  staffError,
  onRetryStaff,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  staff: StaffMember[]
  staffLoading: boolean
  staffError: unknown
  onRetryStaff: () => void
  onCreated: (id?: string) => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [displayName, setDisplayName] = useState('')
  const [skillLevel, setSkillLevel] = useState<SkillLevel>('regular')
  const [rank, setRank] = useState<Rank>('D')
  const [baseFeeAmount, setBaseFeeAmount] = useState('12000')
  const [staffMode, setStaffMode] = useState<'existing' | 'new'>('existing')
  const [staffQuery, setStaffQuery] = useState('')
  const [staffId, setStaffId] = useState('')
  const [newStaffName, setNewStaffName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const availableStaff = staff
    .filter(item => item.active)
    .filter(item => {
      const normalized = staffQuery.trim().toLocaleLowerCase('ja')
      return !normalized
        || item.name.toLocaleLowerCase('ja').includes(normalized)
        || item.id.toLocaleLowerCase('ja').includes(normalized)
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'ja'))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (staffError) {
      setError(t('caddies:create.error.staffUnavailable'))
      return
    }
    const name = displayName.trim()
    const fee = Number.parseInt(baseFeeAmount, 10)
    if (!name) {
      setError(t('caddies:create.error.displayName'))
      return
    }
    if (!Number.isFinite(fee) || fee < 0) {
      setError(t('caddies:create.error.baseFee'))
      return
    }
    if (staffMode === 'existing' && !staffId) {
      setError(t('caddies:create.error.staffRequired'))
      return
    }
    if (staffMode === 'new' && !newStaffName.trim()) {
      setError(t('caddies:create.error.newStaffName'))
      return
    }

    setBusy(true)
    setError(null)
    try {
      let resolvedStaffId = staffId
      if (staffMode === 'new') {
        const createdStaff = await fieldApiJson<StaffMember>('/v1/erp/staff', request('POST', {
          name: newStaffName.trim(),
          employmentType: 'part_time',
          active: true,
        }))
        resolvedStaffId = createdStaff.id
      }
      const created = await courseboardApiJson<{ id?: string }>(`${COURSE_API}/caddie-profiles`, request('POST', {
        displayName: name,
        skillLevel,
        rank,
        baseFeeAmount: fee,
        currency: 'JPY',
        staffId: resolvedStaffId,
        staffReferenceType: 'staff_member',
        staffReferenceId: resolvedStaffId,
        active: true,
        employmentStatus: 'active',
        maxRoundsPerDay: 2,
      }))
      const createdId = created?.id
      setDisplayName('')
      setSkillLevel('regular')
      setRank('D')
      setBaseFeeAmount('12000')
      setStaffMode('existing')
      setStaffQuery('')
      setStaffId('')
      setNewStaffName('')
      onCreated(createdId)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('caddies:create.title')}</DialogTitle>
          <DialogDescription>
            {t('caddies:create.description')}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => void submit(event)}>
          <FormGrid columns={2}>
            <Field label={t('caddies:create.displayName')} required>
              <Input value={displayName} onChange={event => setDisplayName(event.target.value)} className="min-h-10" autoFocus />
            </Field>
            <Field label={t('caddies:create.baseFee')} required>
              <Input type="number" min={0} value={baseFeeAmount} onChange={event => setBaseFeeAmount(event.target.value)} className="min-h-10" />
            </Field>
            <Field label={t('caddies:create.skill')} required>
              <NativeSelect value={skillLevel} onChange={event => setSkillLevel(event.target.value as SkillLevel)}>
                <option value="rookie">{t('caddies:skill.rookie')}</option>
                <option value="regular">{t('caddies:skill.regular')}</option>
                <option value="veteran">{t('caddies:skill.veteran')}</option>
              </NativeSelect>
            </Field>
            <Field label={t('caddies:create.rank')} required>
              <NativeSelect value={rank} onChange={event => setRank(event.target.value as Rank)}>
                <option value="A">{t('caddies:create.rankOption', { rank: 'A', rounds: '41' })}</option>
                <option value="B">{t('caddies:create.rankOption', { rank: 'B', rounds: '33' })}</option>
                <option value="C">{t('caddies:create.rankOption', { rank: 'C', rounds: '25' })}</option>
                <option value="D">{t('caddies:create.rankOption', { rank: 'D', rounds: '14' })}</option>
              </NativeSelect>
            </Field>
          </FormGrid>

          <Separator />

          <Field label={t('caddies:create.staffMode')} required>
            <NativeSelect
              value={staffMode}
              onChange={event => setStaffMode(event.target.value as 'existing' | 'new')}
              disabled={Boolean(staffError)}
            >
              <option value="existing">{t('caddies:create.staffExisting')}</option>
              <option value="new">{t('caddies:create.staffNew')}</option>
            </NativeSelect>
          </Field>
          {staffMode === 'existing' ? (
            <div className="space-y-3">
              <Field label={t('caddies:create.staffSearch')}>
                <Input
                  value={staffQuery}
                  onChange={event => setStaffQuery(event.target.value)}
                  placeholder={t('caddies:create.staffSearchPlaceholder')}
                  className="min-h-10"
                />
              </Field>
              <Field label={t('caddies:create.staff')} required>
                <NativeSelect
                  value={staffId}
                  onChange={event => setStaffId(event.target.value)}
                  disabled={staffLoading || Boolean(staffError)}
                >
                  <option value="">
                    {staffLoading ? t('caddies:create.staffLoading') : t('caddies:create.staffPlaceholder')}
                  </option>
                  {availableStaff.map(item => (
                    <option key={item.id} value={item.id}>{item.name}（{item.id}）</option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          ) : (
            <Field label={t('caddies:create.newStaffName')} required>
              <Input value={newStaffName} onChange={event => setNewStaffName(event.target.value)} className="min-h-10" />
            </Field>
          )}

          {staffError ? <ResourceError error={staffError} onRetry={onRetryStaff} /> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" className="min-h-10" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common:action.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="min-h-10"
              disabled={busy || Boolean(staffError)}
            >
              <UserPlus /> {busy ? t('caddies:create.submitting') : t('caddies:create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type DetailTab = 'basic' | 'availability' | 'assignments' | 'ratings'

function ProfileDetail({
  profile,
  assignments,
  assignmentsLoading,
  assignmentsError,
  staff,
  staffError,
  courses,
  coursesError,
  attendance,
  onPeopleChanged,
  onAssignmentsChanged,
  setFlash,
}: {
  profile: CaddieProfile
  assignments: CaddieAssignment[]
  assignmentsLoading: boolean
  assignmentsError: unknown
  staff: StaffMember[]
  staffError: unknown
  courses: GolfCourse[]
  coursesError: unknown
  attendance: AttendanceSnapshot | null
  onPeopleChanged: () => void
  onAssignmentsChanged: () => void
  setFlash: (flash: Flash) => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [tab, setTab] = useState<DetailTab>('basic')
  const [editOpen, setEditOpen] = useState(false)
  const membershipResource = useResource(
    () => courseboardApiJson<ListResponse<CourseMembership>>(
      `${COURSE_API}/caddie-profiles/${encodeURIComponent(profile.id)}/courses`,
    ),
    [profile.id],
    { cacheKey: `caddie-courses:${profile.id}` },
  )
  const ratingsResource = useResource(
    () => courseboardApiJson<ListResponse<CaddieRating>>(
      `${COURSE_API}/caddie-ratings?caddieProfileId=${encodeURIComponent(profile.id)}`,
    ),
    [profile.id],
    { cacheKey: `caddie-ratings:${profile.id}` },
  )

  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-foreground">{profile.displayName}</h2>
              <Badge variant={profile.employmentStatus === 'active' ? 'success' : 'neutral'}>
                {employmentLabel(profile.employmentStatus)}
              </Badge>
              <Badge variant="outline">{skillLabel(profile.skillLevel)}</Badge>
              {profile.rank ? (
                <Badge variant="accent">{t('caddies:detail.rankBadge', { rank: profile.rank })}</Badge>
              ) : null}
            </div>
            <p className="mt-1 break-all text-xs text-muted-foreground">{profile.id}</p>
          </div>
          <Button type="button" variant="secondary" className="min-h-10 w-full sm:w-auto" onClick={() => setEditOpen(true)}>
            <Pencil /> {t('caddies:detail.edit')}
          </Button>
        </div>
        <MetricGrid>
          <Metric
            label={t('caddies:detail.metrics.baseFee')}
            value={formatMoney(profile.baseFeeAmount, profile.currency)}
            detail={t('caddies:detail.metrics.baseFeeDetail')}
          />
          <Metric
            label={t('caddies:detail.metrics.dailyLimit')}
            value={t('caddies:rounds', { n: String(profile.maxRoundsPerDay) })}
            detail={profile.canTwoRounds
              ? t('caddies:detail.metrics.twoRounds')
              : t('caddies:detail.metrics.registeredLimit')}
          />
          <Metric
            label={t('caddies:detail.metrics.rating')}
            value={profile.ratingAverage?.toFixed(1) ?? '—'}
            detail={t('caddies:detail.metrics.ratingDetail', { n: String(profile.ratingCount) })}
          />
          <Metric
            label={t('caddies:detail.metrics.attendance')}
            value={attendance
              ? attendanceLabel(attendance.attendanceStatus)
              : t('caddies:detail.metrics.attendanceUnknown')}
            detail={attendance
              ? t('caddies:detail.metrics.attendanceDetail', { n: String(attendance.todayAssignments) })
              : t('caddies:detail.metrics.attendanceNoData')}
            tone={attendance?.attendanceStatus === 'working' ? 'success' : 'neutral'}
          />
        </MetricGrid>
      </Panel>

      <div className="grid grid-cols-4 gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1" role="tablist" aria-label={t('caddies:detail.tabs.label')}>
        <DetailTabButton active={tab === 'basic'} onClick={() => setTab('basic')}>
          <Users /> {t('caddies:detail.tabs.basic')}
        </DetailTabButton>
        <DetailTabButton active={tab === 'availability'} onClick={() => setTab('availability')}>
          <CalendarDays /> {t('caddies:detail.tabs.availability')}
        </DetailTabButton>
        <DetailTabButton active={tab === 'assignments'} onClick={() => setTab('assignments')}>
          <ClipboardCheck /> {t('caddies:detail.tabs.assignments')}
        </DetailTabButton>
        <DetailTabButton active={tab === 'ratings'} onClick={() => setTab('ratings')}>
          <Star /> {t('caddies:detail.tabs.ratings')}
        </DetailTabButton>
      </div>

      {tab === 'basic' ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <StaffManagementPanel
            profile={profile}
            attendance={attendance}
            staff={staff}
            staffError={staffError}
            onChanged={onPeopleChanged}
            setFlash={setFlash}
          />
          <CourseMembershipPanel
            profile={profile}
            courses={courses}
            coursesError={coursesError}
            resource={membershipResource}
            setFlash={setFlash}
          />
        </div>
      ) : null}

      {tab === 'availability' ? (
        <AvailabilityCalendar profile={profile} setFlash={setFlash} />
      ) : null}

      {tab === 'assignments' ? (
        <Panel
          title={t('caddies:assignments.historyTitle')}
          description={t('caddies:assignments.historyDescription')}
        >
          {assignmentsLoading ? <LoadingState label={t('caddies:assignments.historyLoading')} /> : null}
          {assignmentsError ? <ResourceError error={assignmentsError} /> : null}
          {!assignmentsLoading && !assignmentsError ? (
            <AssignmentsTable
              assignments={assignments}
              profiles={[profile]}
              onChanged={onAssignmentsChanged}
              setFlash={setFlash}
            />
          ) : null}
        </Panel>
      ) : null}

      {tab === 'ratings' ? <RatingsPanel resource={ratingsResource} /> : null}

      <ProfileEditDialog
        profile={profile}
        open={editOpen}
        onOpenChange={setEditOpen}
        onChanged={onPeopleChanged}
        setFlash={setFlash}
      />
    </div>
  )
}

function DetailTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex min-h-10 min-w-[6.5rem] items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  )
}

function ProfileEditDialog({
  profile,
  open,
  onOpenChange,
  onChanged,
  setFlash,
}: {
  profile: CaddieProfile
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: () => void
  setFlash: (flash: Flash) => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [skillLevel, setSkillLevel] = useState<SkillLevel>(profile.skillLevel)
  const [employmentStatus, setEmploymentStatus] = useState(profile.employmentStatus)
  const [baseFeeAmount, setBaseFeeAmount] = useState(String(profile.baseFeeAmount))
  const [currency, setCurrency] = useState(profile.currency)
  const [maxRounds, setMaxRounds] = useState(String(profile.maxRoundsPerDay))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const fee = Number.parseInt(baseFeeAmount, 10)
    const rounds = Number.parseInt(maxRounds, 10)
    if (!displayName.trim()) {
      setError(t('caddies:edit.error.displayName'))
      return
    }
    if (!Number.isFinite(fee) || fee < 0 || !Number.isFinite(rounds) || rounds < 1) {
      setError(t('caddies:edit.error.numbers'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await courseboardApiJson(
        `${COURSE_API}/caddie-profiles/${encodeURIComponent(profile.id)}`,
        request('PATCH', profilePatchPayload(profile, {
          displayName: displayName.trim(),
          skillLevel,
          employmentStatus,
          baseFeeAmount: fee,
          currency: currency.trim() || 'JPY',
          maxRoundsPerDay: rounds,
        })),
      )
      onOpenChange(false)
      onChanged()
      setFlash({
        tone: 'success',
        title: t('caddies:edit.saved.title'),
        message: t('caddies:edit.saved.message', { name: displayName.trim() }),
      })
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1.5rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('caddies:edit.title')}</DialogTitle>
          <DialogDescription>{t('caddies:edit.description')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => void submit(event)}>
          <FormGrid columns={2}>
            <Field label={t('caddies:edit.displayName')} required>
              <Input value={displayName} onChange={event => setDisplayName(event.target.value)} className="min-h-10" />
            </Field>
            <Field label={t('caddies:edit.skill')} required>
              <NativeSelect value={skillLevel} onChange={event => setSkillLevel(event.target.value as SkillLevel)}>
                <option value="rookie">{t('caddies:skill.rookie')}</option>
                <option value="regular">{t('caddies:skill.regular')}</option>
                <option value="veteran">{t('caddies:skill.veteran')}</option>
              </NativeSelect>
            </Field>
            <Field label={t('caddies:edit.employment')} required>
              <NativeSelect value={employmentStatus} onChange={event => setEmploymentStatus(event.target.value)}>
                <option value="active">{t('caddies:employment.active')}</option>
                <option value="inactive">{t('caddies:employment.inactive')}</option>
                <option value="suspended">{t('caddies:employment.suspended')}</option>
              </NativeSelect>
            </Field>
            <Field label={t('caddies:edit.baseFee')} required>
              <Input type="number" min={0} value={baseFeeAmount} onChange={event => setBaseFeeAmount(event.target.value)} className="min-h-10" />
            </Field>
            <Field label={t('caddies:edit.currency')} required>
              <Input maxLength={3} value={currency} onChange={event => setCurrency(event.target.value.toUpperCase())} className="min-h-10" />
            </Field>
            <Field label={t('caddies:edit.dailyLimit')} required>
              <Input type="number" min={1} value={maxRounds} onChange={event => setMaxRounds(event.target.value)} className="min-h-10" />
            </Field>
          </FormGrid>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" className="min-h-10" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" variant="primary" className="min-h-10" disabled={busy}>
              <CheckCircle2 /> {busy ? t('common:action.saving') : t('common:action.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function StaffManagementPanel({
  profile,
  attendance,
  staff,
  staffError,
  onChanged,
  setFlash,
}: {
  profile: CaddieProfile
  attendance: AttendanceSnapshot | null
  staff: StaffMember[]
  staffError: unknown
  onChanged: () => void
  setFlash: (flash: Flash) => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [linkOpen, setLinkOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const staffId = resolveStaffId(profile)
  const linkedStaff = staff.find(item => item.id === staffId)

  async function clock(direction: 'in' | 'out') {
    if (!staffId) return
    setBusy(true)
    try {
      await fieldApiText(
        `/v1/erp/staff/${encodeURIComponent(staffId)}/clock-${direction}`,
        request('POST', direction === 'out' ? { breakMinutes: 0 } : {}),
      )
      onChanged()
      setFlash({
        tone: 'success',
        title: direction === 'in'
          ? t('caddies:attendance.clockedIn')
          : t('caddies:attendance.clockedOut'),
        message: t('caddies:attendance.updated', { name: profile.displayName }),
      })
    } catch (reason) {
      setFlash({
        tone: 'danger',
        title: t('caddies:attendance.failed'),
        message: errorMessage(reason),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title={t('caddies:staff.title')}
      description={t('caddies:staff.description')}
      actions={<Link2 className="size-5 text-primary" aria-hidden="true" />}
    >
      {staffError ? <ResourceError error={staffError} /> : null}
      {staffId ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{linkedStaff?.name ?? profile.displayName}</p>
                <p className="mt-1 break-all text-xs text-muted-foreground">{staffId}</p>
              </div>
              <Badge variant={attendance ? attendanceVariant(attendance.attendanceStatus) : 'neutral'}>
                {attendance
                  ? attendanceLabel(attendance.attendanceStatus)
                  : t('caddies:staff.attendanceUnknown')}
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              className="min-h-10"
              disabled={busy || attendance?.attendanceStatus === 'working'}
              onClick={() => void clock('in')}
            >
              <Clock /> {t('caddies:attendance.clockIn')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-10"
              disabled={busy || attendance?.attendanceStatus !== 'working'}
              onClick={() => void clock('out')}
            >
              {t('caddies:attendance.clockOut')}
            </Button>
          </div>
          <Button type="button" variant="ghost" className="min-h-10 w-full" onClick={() => setLinkOpen(true)}>
            <Link2 /> {t('caddies:staff.changeLink')}
          </Button>
        </div>
      ) : (
        <Notice
          tone="warning"
          title={t('caddies:staff.notLinked.title')}
          actions={(
            <Button type="button" variant="primary" size="sm" className="min-h-9" onClick={() => setLinkOpen(true)}>
              <Link2 /> {t('caddies:staff.linkAction')}
            </Button>
          )}
        >
          {t('caddies:staff.notLinked.description')}
        </Notice>
      )}
      <StaffLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        profile={profile}
        staff={staff}
        staffError={staffError}
        onChanged={onChanged}
        setFlash={setFlash}
      />
    </Panel>
  )
}

function StaffLinkDialog({
  open,
  onOpenChange,
  profile,
  staff,
  staffError,
  onChanged,
  setFlash,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: CaddieProfile
  staff: StaffMember[]
  staffError: unknown
  onChanged: () => void
  setFlash: (flash: Flash) => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [query, setQuery] = useState('')
  const [staffId, setStaffId] = useState(resolveStaffId(profile) ?? '')
  const [newName, setNewName] = useState(profile.displayName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const filtered = staff.filter(item => {
    const normalized = query.trim().toLocaleLowerCase('ja')
    return item.active && (!normalized
      || item.name.toLocaleLowerCase('ja').includes(normalized)
      || item.id.toLocaleLowerCase('ja').includes(normalized))
  })

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (staffError) {
      setError(t('caddies:staff.error.unavailable'))
      return
    }
    if (mode === 'existing' && !staffId) {
      setError(t('caddies:staff.error.required'))
      return
    }
    if (mode === 'new' && !newName.trim()) {
      setError(t('caddies:staff.error.name'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      let resolved = staffId
      if (mode === 'new') {
        const created = await fieldApiJson<StaffMember>('/v1/erp/staff', request('POST', {
          name: newName.trim(),
          employmentType: 'part_time',
          active: true,
        }))
        resolved = created.id
      }
      await courseboardApiJson(
        `${COURSE_API}/caddie-profiles/${encodeURIComponent(profile.id)}`,
        request('PATCH', profilePatchPayload(profile, { staffId: resolved })),
      )
      onOpenChange(false)
      onChanged()
      setFlash({
        tone: 'success',
        title: t('caddies:staff.linked.title'),
        message: t('caddies:staff.linked.message', {
          name: profile.displayName,
          staff: resolved,
        }),
      })
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('caddies:staff.dialog.title')}</DialogTitle>
          <DialogDescription>{t('caddies:staff.dialog.description')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => void submit(event)}>
          {staffError ? <ResourceError error={staffError} /> : null}
          <Field label={t('caddies:staff.dialog.mode')} required>
            <NativeSelect
              value={mode}
              onChange={event => setMode(event.target.value as 'existing' | 'new')}
              disabled={Boolean(staffError)}
            >
              <option value="existing">{t('caddies:staff.dialog.existing')}</option>
              <option value="new">{t('caddies:staff.dialog.new')}</option>
            </NativeSelect>
          </Field>
          {mode === 'existing' ? (
            <>
              <Field label={t('caddies:staff.dialog.search')}>
                <Input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder={t('caddies:staff.dialog.searchPlaceholder')}
                  className="min-h-10"
                />
              </Field>
              <Field label={t('caddies:staff.dialog.staff')} required>
                <NativeSelect
                  value={staffId}
                  onChange={event => setStaffId(event.target.value)}
                  disabled={Boolean(staffError)}
                >
                  <option value="">{t('caddies:staff.dialog.staffPlaceholder')}</option>
                  {filtered.map(item => <option key={item.id} value={item.id}>{item.name}（{item.id}）</option>)}
                </NativeSelect>
              </Field>
            </>
          ) : (
            <Field label={t('caddies:staff.dialog.newName')} required>
              <Input value={newName} onChange={event => setNewName(event.target.value)} className="min-h-10" />
            </Field>
          )}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" className="min-h-10" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common:action.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="min-h-10"
              disabled={busy || Boolean(staffError)}
            >
              <Link2 />
              {busy ? t('caddies:staff.dialog.submitting') : t('caddies:staff.dialog.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CourseMembershipPanel({
  profile,
  courses,
  coursesError,
  resource,
  setFlash,
}: {
  profile: CaddieProfile
  courses: GolfCourse[]
  coursesError: unknown
  resource: ResourceValue<ListResponse<CourseMembership>>
  setFlash: (flash: Flash) => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [primary, setPrimary] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const memberships = resource.data?.items ?? []
    setSelected(new Set(memberships.map(item => item.golfCourseId)))
    setPrimary(memberships.find(item => item.isPrimary)?.golfCourseId ?? null)
  }, [resource.data])

  function toggle(id: string) {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
        if (primary === id) setPrimary(null)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function save() {
    setBusy(true)
    try {
      await courseboardApiJson(
        `${COURSE_API}/caddie-profiles/${encodeURIComponent(profile.id)}/courses`,
        request('PUT', { courseIds: [...selected], primaryCourseId: primary }),
      )
      resource.refresh()
      setFlash({
        tone: 'success',
        title: t('caddies:courses.saved.title'),
        message: t('caddies:courses.saved.message', { n: String(selected.size) }),
      })
    } catch (reason) {
      setFlash({ tone: 'danger', title: t('caddies:courses.failed'), message: errorMessage(reason) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title={t('caddies:courses.title')}
      description={t('caddies:courses.description')}
      actions={<MapPin className="size-5 text-primary" aria-hidden="true" />}
    >
      {coursesError ? <ResourceError error={coursesError} /> : null}
      {resource.loading && !resource.data ? <LoadingState label={t('caddies:courses.loading')} /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {!resource.loading && !resource.error && courses.length === 0 ? (
        <EmptyState
          title={t('caddies:courses.empty.title')}
          description={t('caddies:courses.empty.description')}
        />
      ) : null}
      <div className="space-y-2">
        {courses.map(course => {
          const checked = selected.has(course.id)
          return (
            <div key={course.id} className="flex min-h-12 flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input type="checkbox" checked={checked} onChange={() => toggle(course.id)} className="size-5 accent-primary" />
                <span className="truncate font-medium">{course.name}</span>
              </label>
              {checked ? (
                <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input type="radio" name={`primary-${profile.id}`} checked={primary === course.id} onChange={() => setPrimary(course.id)} className="size-4 accent-primary" />
                  {t('caddies:courses.main')}
                </label>
              ) : null}
            </div>
          )
        })}
      </div>
      {courses.length > 0 ? (
        <Button type="button" variant="primary" className="mt-3 min-h-10 w-full" onClick={() => void save()} disabled={busy}>
          <CheckCircle2 /> {busy ? t('common:action.saving') : t('caddies:courses.save')}
        </Button>
      ) : null}
    </Panel>
  )
}

const AVAILABILITY_STATUSES: AvailabilityStatus[] = [
  'available',
  'unavailable',
  'morning_only',
  'afternoon_only',
  'light_duty',
]

function availabilityLabel(status: AvailabilityStatus) {
  return i18next.t(`caddies:availability.${status}` as 'caddies:availability.available')
}

function monthBounds(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number)
  const last = new Date(year, month, 0).getDate()
  return {
    from: `${yearMonth}-01`,
    to: `${yearMonth}-${String(last).padStart(2, '0')}`,
    year,
    month,
  }
}

function shiftMonth(yearMonth: string, amount: number) {
  const [year, month] = yearMonth.split('-').map(Number)
  const shifted = new Date(year, month - 1 + amount, 1)
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`
}

function calendarCells(year: number, month: number) {
  const start = new Date(year, month - 1, 1).getDay()
  const last = new Date(year, month, 0).getDate()
  const values: Array<number | null> = Array.from({ length: start }, () => null)
  for (let day = 1; day <= last; day += 1) values.push(day)
  while (values.length % 7) values.push(null)
  return values
}

function AvailabilityCalendar({ profile, setFlash }: { profile: CaddieProfile; setFlash: (flash: Flash) => void }) {
  const { t } = useTranslation(['caddies', 'common'])
  const [yearMonth, setYearMonth] = useState(todayJst().slice(0, 7))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [status, setStatus] = useState<AvailabilityStatus>('available')
  const [twoRounds, setTwoRounds] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const bounds = monthBounds(yearMonth)
  const resource = useResource(
    () => courseboardApiJson<ListResponse<AvailabilityRecord>>(
      `${COURSE_API}/caddie-availabilities?caddieProfileId=${encodeURIComponent(profile.id)}&from=${bounds.from}&to=${bounds.to}`,
    ),
    [profile.id, bounds.from, bounds.to],
    { cacheKey: `caddie-availability:${profile.id}:${bounds.from}:${bounds.to}` },
  )
  const records = useMemo(
    () => new Map((resource.data?.items ?? []).map(record => [record.date, record])),
    [resource.data],
  )
  const selectedRecord = selectedDate ? records.get(selectedDate) : undefined

  useEffect(() => {
    setSelectedDate(null)
  }, [profile.id, yearMonth])

  function select(date: string) {
    const record = records.get(date)
    setSelectedDate(date)
    setStatus(record?.status ?? 'available')
    setTwoRounds(record?.twoRoundRequest ?? false)
    setNote(record?.healthNote ?? '')
  }

  async function save() {
    if (!selectedDate) return
    setBusy(true)
    try {
      await courseboardApiJson(`${COURSE_API}/caddie-availabilities`, request('POST', {
        caddieProfileId: profile.id,
        date: selectedDate,
        status,
        twoRoundRequest: twoRounds,
        healthNote: note.trim() || null,
      }))
      resource.refresh()
      setFlash({
        tone: 'success',
        title: t('caddies:calendar.saved.title'),
        message: t('caddies:calendar.saved.message', {
          date: selectedDate,
          status: availabilityLabel(status),
        }),
      })
    } catch (reason) {
      setFlash({
        tone: 'danger',
        title: t('caddies:calendar.saveFailed'),
        message: errorMessage(reason),
      })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!selectedDate) return
    setBusy(true)
    try {
      await courseboardApiText(
        `${COURSE_API}/caddie-availabilities/${encodeURIComponent(profile.id)}/${selectedDate}`,
        request('DELETE'),
      )
      setSelectedDate(null)
      resource.refresh()
      setFlash({
        tone: 'success',
        title: t('caddies:calendar.removed.title'),
        message: t('caddies:calendar.removed.message', { date: selectedDate }),
      })
    } catch (reason) {
      setFlash({
        tone: 'danger',
        title: t('caddies:calendar.removeFailed'),
        message: errorMessage(reason),
      })
    } finally {
      setBusy(false)
    }
  }

  const cells = calendarCells(bounds.year, bounds.month)

  return (
    <Panel
      title={t('caddies:calendar.title')}
      description={t('caddies:calendar.description')}
      actions={(
        <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1">
          <Button type="button" variant="ghost" size="icon" className="min-h-9 min-w-9" aria-label={t('caddies:calendar.prevMonth')} onClick={() => setYearMonth(value => shiftMonth(value, -1))}><ChevronLeft /></Button>
          <span className="min-w-24 text-center text-sm font-medium">
            {t('caddies:calendar.monthLabel', {
              year: String(bounds.year),
              month: String(bounds.month),
            })}
          </span>
          <Button type="button" variant="ghost" size="icon" className="min-h-9 min-w-9" aria-label={t('caddies:calendar.nextMonth')} onClick={() => setYearMonth(value => shiftMonth(value, 1))}><ChevronRight /></Button>
        </div>
      )}
    >
      {resource.loading && !resource.data ? <LoadingState label={t('caddies:calendar.loading')} /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {!resource.loading && !resource.error ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <div className="min-w-[320px]">
              <div className="grid grid-cols-7 border-b border-border bg-surface text-center text-xs font-medium text-muted-foreground">
                {weekdayIndexes.map(day => (
                  <div key={day} className="py-2">{weekdayLabel(day)}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {cells.map((day, index) => {
                  if (day === null) return <div key={`blank-${index}`} className="min-h-16 border-b border-r border-border/60" />
                  const date = `${yearMonth}-${String(day).padStart(2, '0')}`
                  const record = records.get(date)
                  const active = date === selectedDate
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => select(date)}
                      className={`flex min-h-16 flex-col items-center justify-start gap-1 border-b border-r border-border/60 p-1 text-xs transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                        active ? 'bg-selected' : 'hover:bg-muted/50'
                      }`}
                    >
                      <span className="font-medium">{day}</span>
                      {record ? (
                        <Badge variant={record.status === 'unavailable' ? 'destructive' : record.status === 'available' ? 'success' : 'warning'} className="max-w-full truncate px-1">
                          {availabilityLabel(record.status)}
                        </Badge>
                      ) : null}
                      {record?.twoRoundRequest ? <span className="text-[10px] text-primary">2R</span> : null}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-background p-4">
            {selectedDate ? (
              <div className="space-y-4">
                <div>
                  <p className="font-semibold">{selectedDate}</p>
                  <p className="text-xs text-muted-foreground">{t('caddies:calendar.editPrompt')}</p>
                </div>
                <Field label={t('caddies:calendar.status')} required>
                  <NativeSelect value={status} onChange={event => setStatus(event.target.value as AvailabilityStatus)}>
                    {AVAILABILITY_STATUSES.map(value => (
                      <option key={value} value={value}>{availabilityLabel(value)}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3">
                  <input type="checkbox" checked={twoRounds} onChange={event => setTwoRounds(event.target.checked)} className="size-5 accent-primary" />
                  <span className="text-sm font-medium">{t('caddies:calendar.twoRounds')}</span>
                </label>
                <Field label={t('caddies:calendar.note')}>
                  <NativeTextarea
                    rows={4}
                    maxLength={500}
                    value={note}
                    onChange={event => setNote(event.target.value)}
                    placeholder={t('caddies:calendar.notePlaceholder')}
                  />
                </Field>
                <Button type="button" variant="primary" className="min-h-10 w-full" disabled={busy} onClick={() => void save()}>
                  <CheckCircle2 /> {busy ? t('caddies:calendar.saving') : t('caddies:calendar.save')}
                </Button>
                {selectedRecord ? (
                  <Button type="button" variant="ghost" className="min-h-10 w-full text-destructive" disabled={busy} onClick={() => void remove()}>
                    <XCircle /> {t('caddies:calendar.remove')}
                  </Button>
                ) : null}
              </div>
            ) : (
              <EmptyState
                title={t('caddies:calendar.empty.title')}
                description={t('caddies:calendar.empty.description')}
              />
            )}
          </div>
        </div>
      ) : null}
    </Panel>
  )
}

function RatingsPanel({ resource }: { resource: ResourceValue<ListResponse<CaddieRating>> }) {
  const { t } = useTranslation(['caddies', 'common'])
  const ratings = resource.data?.items ?? []
  const average = ratings.length
    ? ratings.reduce((total, rating) => total + rating.score, 0) / ratings.length
    : null
  const columns: DataTableColumn<CaddieRating>[] = [
    {
      key: 'score',
      header: t('caddies:ratings.table.rating'),
      mobileLabel: t('caddies:ratings.table.rating'),
      cell: row => (
        <div className="flex items-center gap-1 text-warning">
          {Array.from({ length: 5 }, (_, index) => <Star key={index} className={`size-4 ${index < row.score ? 'fill-current' : ''}`} />)}
          <span className="ml-1 font-medium text-foreground">{row.score}</span>
        </div>
      ),
    },
    {
      key: 'comment',
      header: t('caddies:ratings.table.comment'),
      mobileLabel: t('caddies:ratings.table.comment'),
      cell: row => row.comment || '—',
    },
    {
      key: 'customer',
      header: t('caddies:ratings.table.customer'),
      mobileLabel: t('caddies:ratings.table.customer'),
      cell: row => <span className="break-all">{row.customerId}</span>,
    },
    {
      key: 'created',
      header: t('caddies:ratings.table.created'),
      mobileLabel: t('caddies:ratings.table.created'),
      cell: row => formatDateTime(row.createdAt),
    },
  ]
  return (
    <Panel
      title={t('caddies:ratings.title')}
      description={t('caddies:ratings.description')}
      actions={(
        <Badge variant={average === null ? 'neutral' : 'warning'}>
          <Star className="fill-current" />
          {t('caddies:ratings.badge', {
            average: average?.toFixed(1) ?? '—',
            total: String(ratings.length),
          })}
        </Badge>
      )}
    >
      {resource.loading && !resource.data ? <LoadingState label={t('caddies:ratings.loading')} /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {resource.data ? (
        <DataTable
          rows={ratings}
          columns={columns}
          rowKey={row => row.id}
          empty={(
            <EmptyState
              title={t('caddies:ratings.empty.title')}
              description={t('caddies:ratings.empty.description')}
            />
          )}
        />
      ) : null}
    </Panel>
  )
}

function PayrollView({ setFlash }: { setFlash: (flash: Flash) => void }) {
  const { t } = useTranslation(['caddies', 'common'])
  const [yearMonth, setYearMonth] = useState(previousYearMonth)
  const [downloading, setDownloading] = useState(false)
  const resource = useResource(
    () => courseboardApiJson<PayrollResponse>(
      `${COURSE_API}/caddie-payroll-summary?yearMonth=${encodeURIComponent(yearMonth)}`,
    ),
    [yearMonth],
  )
  useRegisterPageReload(resource.refresh)
  const rows = resource.data?.items ?? []
  const totals = rows.reduce(
    (value, row) => ({
      workedMinutes: value.workedMinutes + row.workedMinutes,
      rounds: value.rounds + row.assignedRounds,
      fees: value.fees + row.confirmedFeeTotal,
      warnings: value.warnings + row.roundsWithoutClockIn + (row.openClockIn ? 1 : 0),
    }),
    { workedMinutes: 0, rounds: 0, fees: 0, warnings: 0 },
  )

  async function downloadCsv() {
    setDownloading(true)
    try {
      const csv = await courseboardApiText(
        `${COURSE_API}/caddie-payroll-summary/export.csv?yearMonth=${encodeURIComponent(yearMonth)}`,
      )
      downloadText(`caddie-payroll-${yearMonth}.csv`, csv)
      setFlash({
        tone: 'success',
        title: t('caddies:payroll.downloaded.title'),
        message: t('caddies:payroll.downloaded.message', { month: yearMonth }),
      })
    } catch (reason) {
      setFlash({ tone: 'danger', title: t('caddies:payroll.failed'), message: errorMessage(reason) })
    } finally {
      setDownloading(false)
    }
  }

  const columns: DataTableColumn<PayrollRow>[] = [
    {
      key: 'caddie',
      header: t('caddies:payroll.table.caddie'),
      mobileLabel: t('caddies:payroll.table.caddie'),
      cell: row => (
        <div>
          <p className="font-medium">{row.displayName}</p>
          <p className="text-xs text-muted-foreground">
            {row.staffId ?? t('caddies:payroll.table.noStaff')}
          </p>
        </div>
      ),
    },
    {
      key: 'worked',
      header: t('caddies:payroll.table.worked'),
      mobileLabel: t('caddies:payroll.table.worked'),
      cell: row => formatMinutes(row.workedMinutes),
    },
    {
      key: 'shifted',
      header: t('caddies:payroll.table.shifted'),
      mobileLabel: t('caddies:payroll.table.shifted'),
      cell: row => formatMinutes(row.shiftedMinutes),
    },
    {
      key: 'rounds',
      header: t('caddies:payroll.table.rounds'),
      mobileLabel: t('caddies:payroll.table.rounds'),
      align: 'right',
      cell: row => t('caddies:rounds', { n: String(row.assignedRounds) }),
    },
    {
      key: 'fees',
      header: t('caddies:payroll.table.fees'),
      mobileLabel: t('caddies:payroll.table.fees'),
      align: 'right',
      cell: row => formatMoney(row.confirmedFeeTotal, row.currency),
    },
    {
      key: 'warning',
      header: t('caddies:payroll.table.check'),
      mobileLabel: t('caddies:payroll.table.check'),
      cell: row => row.openClockIn || row.roundsWithoutClockIn > 0 ? (
        <Badge variant="warning">
          {row.openClockIn
            ? t('caddies:payroll.table.openClockIn')
            : t('caddies:payroll.table.missingClockIn', { n: String(row.roundsWithoutClockIn) })}
        </Badge>
      ) : <Badge variant="success">{t('caddies:payroll.table.ok')}</Badge>,
    },
  ]

  return (
    <div className="space-y-4">
      <Panel
        title={t('caddies:payroll.title')}
        description={t('caddies:payroll.description')}
        actions={(
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Input type="month" value={yearMonth} onChange={event => setYearMonth(event.target.value)} className="min-h-10 sm:w-40" aria-label={t('caddies:payroll.monthLabel')} />
            <Button type="button" variant="primary" className="min-h-10" disabled={downloading || !resource.data} onClick={() => void downloadCsv()}>
              <Download /> {downloading ? t('caddies:payroll.exporting') : t('caddies:payroll.exportCsv')}
            </Button>
          </div>
        )}
      >
        {resource.loading ? <LoadingState label={t('caddies:payroll.loading')} /> : null}
        {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
        {resource.data ? (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {t('caddies:payroll.period', {
                from: resource.data.period.startDate,
                to: resource.data.period.endDate,
              })}
            </p>
            <MetricGrid>
              <Metric
                label={t('caddies:payroll.metrics.worked')}
                value={formatMinutes(totals.workedMinutes)}
                detail={t('caddies:payroll.metrics.workedDetail', { n: String(rows.length) })}
              />
              <Metric
                label={t('caddies:payroll.metrics.rounds')}
                value={t('caddies:rounds', { n: String(totals.rounds) })}
                detail={t('caddies:payroll.metrics.roundsDetail')}
              />
              <Metric
                label={t('caddies:payroll.metrics.fees')}
                value={formatMoney(totals.fees)}
                detail={t('caddies:payroll.metrics.feesDetail')}
              />
              <Metric
                label={t('caddies:payroll.metrics.warnings')}
                value={t('caddies:items', { n: String(totals.warnings) })}
                detail={t('caddies:payroll.metrics.warningsDetail')}
                tone={totals.warnings > 0 ? 'warning' : 'success'}
              />
            </MetricGrid>
          </div>
        ) : null}
      </Panel>

      <Panel
        title={t('caddies:payroll.listTitle')}
        description={t('caddies:payroll.listDescription')}
        actions={(
          <Button type="button" variant="secondary" size="sm" className="min-h-9" onClick={resource.refresh} title="⌘R">
            <RefreshCw /> {t('common:action.refresh')}
          </Button>
        )}
      >
        {resource.data ? (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={row => row.caddieProfileId}
            empty={(
              <EmptyState
                title={t('caddies:payroll.empty.title')}
                description={t('caddies:payroll.empty.description')}
              />
            )}
          />
        ) : null}
      </Panel>
    </div>
  )
}

export default CaddiesPage

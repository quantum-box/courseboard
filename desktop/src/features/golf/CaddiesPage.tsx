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
  today,
  COURSE_TIME_ZONE,
} from '../../api'
import { i18next } from '../../i18n'
import { useRegisterPageReload } from '../../lib/pageReload'
import {
  CollapsibleSection,
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
  Panel,
  ResourceError,
  SearchInput,
  resourceErrorText,
  type DataTableColumn,
} from '../../components/Page'
import { SectionErrorBoundary } from '../../components/SectionErrorBoundary'
import { YearMonthPicker, useYearMonthValue } from '../../components/YearMonthPicker'
import { weekdayIndexes, weekdayLabel } from './models'
import {
  RecommendationExplanation,
  type RecommendationAttendanceStatus,
  type RecommendationForExplanation,
} from './RecommendationExplanation'
import { useResource } from '../../hooks/useResource'
import { navigate, useNavigationGuard } from '../../lib/router'
import { caddieLoadPlan } from './caddieLoadPlan'
import { Sheet } from '../../components/Sheet'
import { UnassignedRoundsPanel } from './UnassignedRounds'
import { showToast } from '../../lib/toast'
import {
  caddieCreatePayload,
  exactStaffMatch,
  resolveStaffId,
  skillLabelKey,
  staffSuggestions,
} from './caddieRegistration'
import {
  RANKS,
  buildRankFees,
  rankFeeDraft,
  rankFeeDraftIsDirty,
  type CaddieRankFeeDraft,
  type CaddieRankFees,
  type PayrollRow,
  type Rank,
} from './caddieRankFees'
import { profilePatchPayload } from './caddieProfileEdit'
import {
  calendarDateInTimezone,
  calendarSelectionAfterClick,
  emptyCalendarDateSelection,
  tenantTimezoneFromConfig,
} from './availabilityCalendar'

const COURSE_API = '/v1/course'

/** Rows per page on the payroll sheet — a screenful without a scroll hunt. */
const PAYROLL_PAGE_SIZE = 20

type ListResponse<T> = { items: T[] }
type CaddieRosterResponse = ListResponse<CaddieProfile> & { staff?: StaffMember[] }
type View = 'roster' | 'dispatch' | 'attendance' | 'payroll'
type SkillLevel = 'rookie' | 'regular' | 'veteran'
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

type CaddieRecommendation = RecommendationForExplanation & {
  caddieProfileId: string
  displayName: string
  recommendedRole: string
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

export type AttendanceLookup = Map<string, AttendanceSnapshot['attendanceStatus']>

export function attendanceLookup(items: AttendanceSnapshot[]): AttendanceLookup {
  return new Map(items.map(item => [item.caddieProfileId, item.attendanceStatus]))
}

/**
 * Why a candidate is not on duty, or `null` when they are.
 *
 * Dispatch is planned before the course opens, so at 6am nobody has clocked in
 * yet and hiding un-clocked caddies would leave the board empty every morning.
 * They stay selectable; the screen says which ones are not on duty and warns
 * again before the assignment is committed.
 *
 * A caddie missing from the day's snapshot is treated as not clocked in — the
 * safe reading, since the snapshot is what the clock-in writes to.
 */
export function offDutyReason(
  status: AttendanceSnapshot['attendanceStatus'] | undefined,
): 'notClocked' | 'clockedOut' | 'notLinked' | null {
  if (status === 'working') return null
  if (status === 'clocked_out') return 'clockedOut'
  if (status === 'not_linked') return 'notLinked'
  return 'notClocked'
}

export function offDutyCandidates<T extends { caddieProfileId: string }>(
  candidates: T[],
  attendance: AttendanceLookup,
): { candidate: T; reason: Exclude<ReturnType<typeof offDutyReason>, null> }[] {
  return candidates.flatMap(candidate => {
    const reason = offDutyReason(attendance.get(candidate.caddieProfileId))
    return reason ? [{ candidate, reason }] : []
  })
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

type DeadlineWarning = {
  deadlineDate: string
  unsubmittedCaddieNames: string[]
}

type AutoAssignResult = {
  dryRun: boolean
  assigned: AutoAssignPlanItem[]
  skipped: { reservationId: string; reason: string }[]
  deadlineWarning?: DeadlineWarning | null
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

/** Announcements are toasts now; the call sites still read `setFlash(...)`. */
const setFlash = showToast

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

/**
 * The body of a clock-in or clock-out.
 *
 * `businessDate` is the point of this: Field files attendance under the UTC
 * calendar date unless it is told which working day the punch belongs to, and
 * a course opens hours before midnight UTC has passed. Without it every
 * morning punch lands on the previous day, where the day's own board cannot
 * see it and the open shift can never be closed.
 */
export function clockRequestBody(direction: 'in' | 'out', businessDate: string) {
  return direction === 'out'
    ? { businessDate, breakMinutes: 0 }
    : { businessDate }
}

function punchClock(staffId: string, direction: 'in' | 'out', businessDate: string) {
  return fieldApiText(
    `/v1/erp/staff/${encodeURIComponent(staffId)}/clock-${direction}`,
    request('POST', clockRequestBody(direction, businessDate)),
  )
}

/** Re-exported so the call sites below read the same as the rest of the app. */
const todayJst = today

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
    timeZone: COURSE_TIME_ZONE,
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
    timeZone: COURSE_TIME_ZONE,
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

/**
 * Save failures land in dialogs and flash messages, which used to print the
 * server's own English (`caddie profile was not found`). Route them through the
 * shared mapping so the sentence the operator reads first follows the locale
 * and the original text survives as a support detail.
 */
function errorMessage(error: unknown) {
  return error instanceof Error ? resourceErrorText(error) : i18next.t('caddies:error.generic')
}

/** The API also returns the legacy `junior` code for rookies. */
const EMPLOYMENT_STATUSES = ['active', 'inactive', 'suspended'] as const
const ACTIVE_EMPLOYMENT = 'active'

/** Shared by the create and the edit form so both offer the same choices. */
const RANK_OPTIONS: { rank: Rank; rounds: number }[] = [
  { rank: 'A', rounds: 41 },
  { rank: 'B', rounds: 33 },
  { rank: 'C', rounds: 25 },
  { rank: 'D', rounds: 14 },
]
/** Matches the server-side default for a caddie created without a rank. */
const DEFAULT_RANK: Rank = 'C'

/** The API returns raw status codes; anything unexpected is shown as-is. */
const ASSIGNMENT_STATUSES = [
  'draft',
  'pending',
  'requested',
  'assigned',
  'completed',
  'cancelled',
  'absent',
  'no_show',
] as const

function skillLabel(skill: string) {
  const key = skillLabelKey(skill)
  if (!key) return skill
  return i18next.t(`caddies:skill.${key}` as 'caddies:skill.rookie')
}

/**
 * The API is not consistent about the case of its status codes and the server
 * compares them case-insensitively, so `"Active"` has to mean the same thing as
 * `"active"` here too — otherwise a caddie is wrongly blocked from clocking in
 * and the raw code leaks into the copy. Codes we do not know keep their
 * original spelling so nothing is silently rewritten.
 */
function employmentStatusCode(status: string) {
  const folded = status.trim().toLowerCase()
  return (EMPLOYMENT_STATUSES as readonly string[]).includes(folded) ? folded : status.trim()
}

function isEmploymentActive(status: string) {
  return employmentStatusCode(status) === ACTIVE_EMPLOYMENT
}

function employmentLabel(status: string) {
  const code = employmentStatusCode(status)
  if (!(EMPLOYMENT_STATUSES as readonly string[]).includes(code)) return status
  return i18next.t(`caddies:employment.${code}` as 'caddies:employment.active')
}

/** The API returns raw role codes; anything unexpected is shown as-is. */
function roleLabel(role: string) {
  if (role === 'primary' || role === 'lead') return i18next.t('caddies:role.primary')
  if (role === 'assistant' || role === 'support') return i18next.t('caddies:role.assistant')
  return role
}

function rankOptionLabel(rank: Rank, rounds: number) {
  return i18next.t('caddies:rankOption', { rank, rounds: String(rounds) })
}

function assignmentStatusLabel(status: string) {
  if (!(ASSIGNMENT_STATUSES as readonly string[]).includes(status)) return status
  return i18next.t(`caddies:assignments.status.${status}` as 'caddies:assignments.status.assigned')
}

/** True when a caddie may not be clocked in because they are off the roster. */
function clockInBlocked(profile: CaddieProfile | undefined) {
  return profile !== undefined && !isEmploymentActive(profile.employmentStatus)
}

/** The `key=value` debug pairs the upstream API mixes into its explanations. */
const RATIONALE_TOKEN = /^([a-z][a-z0-9_]*)=(.*)$/

function rationaleTokenLabel(key: string, rawValue: string) {
  const value = Number(rawValue)
  const numeric = rawValue.trim() !== '' && Number.isFinite(value)
  if (!numeric) return null
  if (key === 'rating_count') {
    return value > 0
      ? i18next.t('caddies:rationale.ratingCount', { n: String(value) })
      : i18next.t('caddies:rationale.ratingCountNone')
  }
  if (key === 'rounds_assigned_today') {
    return i18next.t('caddies:rationale.roundsAssignedToday', { n: String(value) })
  }
  if (key === 'rating_avg' || key === 'rating_average') {
    return i18next.t('caddies:rationale.ratingAverage', { value: String(value) })
  }
  if (key === 'score' || key === 'match_score') {
    return i18next.t('caddies:rationale.score', { value: String(value) })
  }
  return null
}

/**
 * The upstream Field API explains itself with a mix of debug tokens
 * (`rating_count=0`, `rating_avg=4.6`) and free prose (`veteran preferred for
 * full foursome`). None of it can be translated here, so the tokens we know are
 * rewritten into readable copy, an unknown token is unpacked into `key: value`,
 * and prose is passed through untouched.
 *
 * Nothing is dropped on purpose. Hiding an explanation we cannot read leaves
 * the caller with an empty list and a generic stand-in in its place, which
 * states a reason that may not be the real one — worse than showing the real
 * one in the wrong language.
 */
/**
 * Free prose the Field API is known to return verbatim. Translated rather than
 * dropped, so the reason still reads as a reason. Keyed on the exact upstream
 * sentence, lowercased — anything not listed here still passes through.
 */
const RATIONALE_PROSE: Record<string, string> = {
  'no historical ratings yet; neutral score applied': 'caddies:rationale.neutralScore',
}

/**
 * Stable keys the course API emits now that CourseBoard ranks caddies itself.
 * Unlike the upstream debug tokens these were designed to be translated, so a
 * miss here is a missing key rather than English reaching the operator.
 */
const RATIONALE_KEYS: Record<string, string> = {
  on_duty: 'caddies:rationale.onDuty',
  not_clocked_in: 'caddies:rationale.notClockedIn',
  clocked_out: 'caddies:rationale.clockedOut',
  no_staff_link: 'caddies:rationale.noStaffLink',
  no_ratings: 'caddies:rationale.ratingCountNone',
  at_daily_limit: 'caddies:rationale.atDailyLimit',
  rookie_paired_with_veteran: 'caddies:rationale.rookiePaired',
  veteran_for_foursome: 'caddies:rationale.veteranForFoursome',
  // Why the planner left a round unstaffed.
  no_caddie_available: 'caddies:rationale.noCaddieAvailable',
  all_caddies_at_daily_limit: 'caddies:rationale.allAtDailyLimit',
  no_caddie_on_the_course: 'caddies:rationale.noCaddieOnCourse',
}

export function readableRationale(rationale: string[]) {
  const readable = rationale
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const known = RATIONALE_KEYS[entry] ?? RATIONALE_PROSE[entry.toLowerCase()]
      if (known) return i18next.t(known as 'caddies:rationale.neutralScore')
      const match = RATIONALE_TOKEN.exec(entry)
      if (!match) return entry
      const [, key, rawValue] = match
      const value = rawValue.trim()
      return rationaleTokenLabel(key, rawValue) ?? (value ? `${key}: ${value}` : key)
    })
  return Array.from(new Set(readable))
}

/** Says only that there is nothing to show, never why the caddie was picked. */
function rationaleText(rationale: string[]) {
  const reasons = readableRationale(rationale)
  return reasons.length > 0 ? reasons.join(' · ') : i18next.t('caddies:rationale.unavailable')
}

function RationaleText({ rationale }: { rationale: string[] }) {
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {rationaleText(rationale)}
    </p>
  )
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

  const profilesResource = useResource(
    () => courseboardApiJson<CaddieRosterResponse>(`${COURSE_API}/caddie-profiles`),
    [],
    { enabled: view !== 'payroll', cacheKey: 'caddie-profiles:list' },
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
    {
      enabled: loadPlan.recommendations,
      cacheKey: 'caddie-recommendations:default',
    },
  )
  const coursesResource = useResource(
    () => courseboardApiJson<ListResponse<GolfCourse>>(`${COURSE_API}/courses`),
    [],
    { enabled: loadPlan.courses, cacheKey: 'courses:list' },
  )
  const attendanceResource = useResource(
    () => courseboardApiJson<AttendanceResponse>(
      `${COURSE_API}/caddie-attendance-snapshot?date=${encodeURIComponent(operationDate)}`,
    ),
    [operationDate],
    {
      enabled: loadPlan.attendance,
      cacheKey: `caddie-attendance:${operationDate}`,
    },
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

  // Follow the route in both directions: `golf/caddies/{id}` opens that
  // caddie, and going back to `golf/caddies` (history, sidebar, ⌘K) returns
  // to the list. Unknown ids also fall back to the list once data is in.
  useEffect(() => {
    if (view !== 'roster') return
    if (!initialProfileId) {
      setSelectedProfileId(null)
      return
    }
    if (profiles.length === 0) return
    setSelectedProfileId(
      profiles.some(profile => profile.id === initialProfileId) ? initialProfileId : null,
    )
  }, [initialProfileId, profiles, view])

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
    // Going back unmounts the detail screen and with it the day-off form, so ask
    // `navigate` first: it runs the unsaved-changes guard the detail registers.
    if (!navigate('golf/caddies')) return
    setSelectedProfileId(null)
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

  const showingProfileDetail = view === 'roster' && Boolean(selectedProfileId)

  return (
    <div className="page-stack">
      {view === 'roster' && !showingProfileDetail ? (
        <div className="page-toolbar">
          <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus /> {t('caddies:add')}
          </Button>
        </div>
      ) : null}


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
        <SectionErrorBoundary resetKey={view}>
          <PayrollView setFlash={setFlash} />
        </SectionErrorBoundary>
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
  const attendanceById = attendanceLookup(attendance)
  const dayAssignments = assignments.filter(item => dateKey(item.scheduledAt) === date)

  // Deciding who walks each group is the whole job of this screen, so the day
  // picker, the groups still missing somebody and the automatic run come first
  // and the settled assignments follow. The figures consulted while deciding —
  // sellable capacity, the per-course balance, the ranked roster — are one
  // click away instead of pushing the work below the fold.
  return (
    <div className="space-y-6">
      <div className="page-toolbar">
        <Input
          type="date"
          aria-label={t('caddies:operationDate')}
          className="w-full sm:w-44"
          value={date}
          onChange={event => onDateChange(event.target.value)}
        />
      </div>

      <UnassignedRoundsPanel
        date={date}
        assignments={dayAssignments}
        onChanged={onChanged}
      />

      <AutoAssignPanel
        date={date}
        attendance={attendanceById}
        onChanged={onChanged}
        setFlash={setFlash}
      />

      <section className="app-section space-y-3">
        <h2 className="section-title">{t('caddies:dispatch.boardTitle')}</h2>
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

      <CollapsibleSection title={t('caddies:dispatch.supportTitle')}>
        <DailySupplyPanel date={date} />
        <CourseBalancePanel date={date} onChanged={onChanged} />
        <RecommendationsPanel
          resource={recommendationsResource}
          attendance={attendanceById}
        />
      </CollapsibleSection>
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
          <Field label={t('caddies:operationDate')} requirement="none" className="w-full sm:w-44">
            <Input
              type="date"
              aria-label={t('caddies:operationDate')}
              value={date}
              onChange={event => onDateChange(event.target.value)}
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
        <Field label={t('caddies:supply.buffer')} requirement="none" className="w-full sm:w-36">
          <Input
            type="number"
            min={0}
            value={safetyBuffer}
            onChange={event => setSafetyBuffer(Math.max(0, Number.parseInt(event.target.value, 10) || 0))}
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

/** One course's caddie day, as the balance board reads it. */
type CourseCaddieSupply = {
  golfCourseId: string
  courseName: string
  workingCaddies: number
  roundsCapacity: number
  caddieAttachedGroups: number
  movableCaddies: number
  shortfall: number
}

type DayCaddieSupply = {
  date: string
  courses: CourseCaddieSupply[]
  unplacedCaddies: number
}

type Reinforcement = {
  caddieProfileId: string
  displayName: string
  fromGolfCourseId: string | null
  roundsCapacity: number
  span: string
  returnsHome: boolean
}

/**
 * The day course by course, and the way to even it out.
 *
 * The tenant-wide supply above answers whether the day can be sold at all.
 * This answers where the people are: a course can be short while the tenant
 * as a whole has room, and the fix is to move somebody across for that day.
 */
function CourseBalancePanel({ date, onChanged }: { date: string; onChanged: () => void }) {
  const { t } = useTranslation(['caddies', 'common'])
  const [reinforcing, setReinforcing] = useState<CourseCaddieSupply | null>(null)
  const resource = useResource(
    () => courseboardApiJson<DayCaddieSupply>(
      `${COURSE_API}/caddie-course-supply?date=${encodeURIComponent(date)}`,
    ),
    [date],
  )

  const columns: DataTableColumn<CourseCaddieSupply>[] = [
    {
      key: 'course',
      header: t('caddies:balance.table.course'),
      mobileLabel: t('caddies:balance.table.course'),
      cell: row => <span className="font-medium">{row.courseName}</span>,
    },
    {
      key: 'caddies',
      header: t('caddies:balance.table.caddies'),
      mobileLabel: t('caddies:balance.table.caddies'),
      align: 'right',
      cell: row => t('caddies:people', { n: String(row.workingCaddies) }),
    },
    {
      key: 'capacity',
      header: t('caddies:balance.table.capacity'),
      mobileLabel: t('caddies:balance.table.capacity'),
      align: 'right',
      cell: row => t('caddies:groups', { n: String(row.roundsCapacity) }),
    },
    {
      key: 'booked',
      header: t('caddies:balance.table.booked'),
      mobileLabel: t('caddies:balance.table.booked'),
      align: 'right',
      cell: row => t('caddies:groups', { n: String(row.caddieAttachedGroups) }),
    },
    {
      key: 'shortfall',
      header: t('caddies:balance.table.shortfall'),
      mobileLabel: t('caddies:balance.table.shortfall'),
      align: 'right',
      cell: row => (
        <Badge variant={row.shortfall < 0 ? 'destructive' : 'success'}>
          {row.shortfall < 0
            ? t('caddies:balance.short', { n: String(-row.shortfall) })
            : t('caddies:balance.spare', { n: String(row.shortfall) })}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t('caddies:balance.table.actions'),
      mobileLabel: t('caddies:balance.table.actions'),
      align: 'right',
      cell: row => (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-9"
          onClick={() => setReinforcing(row)}
        >
          <UserPlus /> {t('caddies:balance.callIn')}
        </Button>
      ),
    },
  ]

  const short = (resource.data?.courses ?? []).filter(course => course.shortfall < 0)

  return (
    <Panel title={t('caddies:balance.title')} description={t('caddies:balance.description')}>
      {resource.loading ? <LoadingState label={t('caddies:balance.loading')} /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {resource.data ? (
        <div className="space-y-3">
          {short.length > 0 ? (
            <Notice tone="warning" title={t('caddies:balance.shortTitle')}>
              {t('caddies:balance.shortBody', {
                names: short.map(course => course.courseName).join('、'),
              })}
            </Notice>
          ) : null}
          {resource.data.unplacedCaddies > 0 ? (
            <Notice tone="warning" title={t('caddies:balance.unplacedTitle')}>
              {t('caddies:balance.unplacedBody', {
                n: String(resource.data.unplacedCaddies),
              })}
            </Notice>
          ) : null}
          {resource.data.courses.length === 0 ? (
            <EmptyState
              title={t('caddies:balance.empty.title')}
              description={t('caddies:balance.empty.description')}
            />
          ) : (
            <DataTable
              columns={columns}
              rows={resource.data.courses}
              rowKey={row => row.golfCourseId}
            />
          )}
        </div>
      ) : null}

      <ReinforcementSheet
        course={reinforcing}
        date={date}
        onClose={() => setReinforcing(null)}
        onMoved={() => {
          setReinforcing(null)
          resource.refresh()
          onChanged()
        }}
      />
    </Panel>
  )
}

/**
 * Pick who comes over for the day.
 *
 * The list is already filtered to caddies who may work this course — a sub
 * membership is what permits the move — and leaves out anybody the desk
 * pinned somewhere.
 */
function ReinforcementSheet({
  course,
  date,
  onClose,
  onMoved,
}: {
  course: CourseCaddieSupply | null
  date: string
  onClose: () => void
  onMoved: () => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [moving, setMoving] = useState<string | null>(null)
  const courseId = course?.golfCourseId ?? null

  const candidates = useResource(
    () => {
      if (!courseId) return Promise.resolve({ items: [] as Reinforcement[] })
      const params = new URLSearchParams({ date, golfCourseId: courseId })
      return courseboardApiJson<ListResponse<Reinforcement>>(
        `${COURSE_API}/caddie-reinforcements?${params}`,
      )
    },
    [courseId, date],
    { enabled: courseId !== null },
  )

  async function move(candidate: Reinforcement) {
    if (!course) return
    setMoving(candidate.caddieProfileId)
    try {
      await courseboardApiJson(
        `${COURSE_API}/caddie-shifts/${encodeURIComponent(candidate.caddieProfileId)}/${date}`,
        request('PUT', {
          isWorking: true,
          span: candidate.span,
          roundsCapacity: candidate.roundsCapacity,
          golfCourseId: course.golfCourseId,
          // Moved for the day, not pinned there: the next monthly run should
          // put them back on their own course unless the desk says otherwise.
          pinned: false,
        }),
      )
      showToast({
        tone: 'success',
        message: t('caddies:balance.moved', {
          name: candidate.displayName,
          course: course.courseName,
        }),
      })
      onMoved()
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('caddies:balance.moveFailed'),
        message: errorMessage(error),
      })
    } finally {
      setMoving(null)
    }
  }

  return (
    <Sheet
      open={course !== null}
      onOpenChange={open => {
        if (!open) onClose()
      }}
      title={t('caddies:balance.sheetTitle')}
      description={course
        ? t('caddies:balance.sheetDescription', { course: course.courseName, date })
        : undefined}
    >
      <div className="space-y-2">
        {candidates.loading ? <LoadingState label={t('caddies:balance.loadingCandidates')} /> : null}
        {candidates.error ? (
          <ResourceError error={candidates.error} onRetry={candidates.refresh} />
        ) : null}
        {!candidates.loading && !candidates.error && (candidates.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title={t('caddies:balance.noCandidates.title')}
            description={t('caddies:balance.noCandidates.description')}
          />
        ) : null}

        {candidates.data?.items.map(candidate => (
          <div
            key={candidate.caddieProfileId}
            className="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">{candidate.displayName}</p>
              <p className="text-xs text-muted-foreground">
                {candidate.returnsHome
                  ? t('caddies:balance.returnsHome')
                  : candidate.fromGolfCourseId
                    ? t('caddies:balance.borrowedFrom')
                    : t('caddies:balance.fromUnplaced')}
                {' · '}
                {t('caddies:groups', { n: String(candidate.roundsCapacity) })}
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="min-h-11"
              disabled={moving !== null}
              onClick={() => void move(candidate)}
            >
              {moving === candidate.caddieProfileId
                ? t('caddies:balance.moving')
                : t('caddies:balance.move')}
            </Button>
          </div>
        ))}
      </div>
    </Sheet>
  )
}

function AutoAssignPanel({
  date,
  attendance,
  onChanged,
  setFlash,
}: {
  date: string
  attendance: AttendanceLookup
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

  // Surfaced before the plan is committed, not used to filter it: the morning
  // plan is drawn up before anyone has clocked in.
  const offDuty = offDutyCandidates(plan?.assigned ?? [], attendance)

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
          className="flex-1"
          disabled={busy !== null || !date}
          onClick={() => void run(true)}
        >
          <Sparkles />
          {busy === 'preview' ? t('caddies:autoAssign.previewing') : t('caddies:autoAssign.preview')}
        </Button>
        <Button
          type="button"
          variant="primary"
          className="flex-1"
          disabled={busy !== null || !plan || plan.assigned.length === 0}
          onClick={() => {
            if (
              plan?.deadlineWarning
              && !window.confirm(
                t('caddies:autoAssign.deadlineWarning.confirmExecute', {
                  names: plan.deadlineWarning.unsubmittedCaddieNames.join('、'),
                }),
              )
            ) {
              return
            }
            void run(false)
          }}
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
          {plan.deadlineWarning ? (
            <Notice
              tone="warning"
              title={t('caddies:autoAssign.deadlineWarning.title', {
                deadline: plan.deadlineWarning.deadlineDate,
              })}
            >
              <p>
                {t('caddies:autoAssign.deadlineWarning.body', {
                  names: plan.deadlineWarning.unsubmittedCaddieNames.join('、'),
                })}
              </p>
            </Notice>
          ) : null}
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
                  <RationaleText rationale={item.rationale} />
                </div>
              ))}
            </div>
          )}
          {offDuty.length > 0 ? (
            <Notice
              tone="warning"
              title={t('caddies:autoAssign.offDuty.title', { n: String(offDuty.length) })}
            >
              <p>{t('caddies:autoAssign.offDuty.description')}</p>
              <ul className="mt-1 list-inside list-disc space-y-1">
                {offDuty.map(({ candidate, reason }) => (
                  <li key={`${candidate.reservationId}-${candidate.caddieProfileId}`}>
                    {candidate.caddieDisplayName}: {t(`caddies:offDuty.${reason}`)}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {plan.skipped.length > 0 ? (
            <Notice
              tone="warning"
              title={t('caddies:autoAssign.skipped', { n: String(plan.skipped.length) })}
            >
              <ul className="list-inside list-disc space-y-1">
                {plan.skipped.map(item => (
                  <li key={item.reservationId}>
                    {item.reservationId}: {rationaleText([item.reason])}
                  </li>
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
  attendance,
}: {
  resource: ResourceValue<ListResponse<CaddieRecommendation>>
  attendance: AttendanceLookup
}) {
  const { t } = useTranslation(['caddies', 'common'])
  return (
    <Panel
      title={t('caddies:recommendations.title')}
      description={t('caddies:recommendations.description')}
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
            <div className="flex h-11 min-w-11 shrink-0 self-start items-center justify-center rounded-full bg-selected px-2 font-semibold text-primary">
              {t('caddies:recommendations.rank', { n: String(index + 1) })}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-foreground">{item.displayName}</p>
                <Badge variant="neutral">{skillLabel(item.skillLevel)}</Badge>
                {(() => {
                  const status = item.attendanceStatus
                    ?? attendance.get(item.caddieProfileId) as RecommendationAttendanceStatus | undefined
                  const reason = offDutyReason(status)
                  return reason ? (
                    <Badge variant="warning">{t(`caddies:offDuty.${reason}`)}</Badge>
                  ) : null
                })()}
              </div>
              <RecommendationExplanation
                item={item}
                attendanceFallback={attendance.get(item.caddieProfileId) as RecommendationAttendanceStatus | undefined}
              />
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
      // The day this board is showing — the same day the punch has to be
      // filed under for the row to come back on the next refresh.
      await punchClock(staffId, direction, resource.data?.date ?? todayJst())
      onChanged()
      setFlash({
        tone: 'success',
        title: direction === 'in'
          ? t('caddies:attendance.clockedIn')
          : t('caddies:attendance.clockedOut'),
        message: direction === 'in'
          ? t('caddies:attendance.updatedIn', { name: snapshot.displayName })
          : t('caddies:attendance.updatedOut', { name: snapshot.displayName }),
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
      cell: row => {
        const profile = profileMap.get(row.caddieProfileId)
        // Somebody who is on leave or suspended must not be clocked in, but
        // clocking out stays open so an ongoing shift can always be closed.
        const blocked = clockInBlocked(profile)
        const blockedReason = blocked && profile
          ? t('caddies:attendance.clockInBlocked', { status: employmentLabel(profile.employmentStatus) })
          : undefined
        return (
          <div className="flex flex-col items-end gap-1">
            <div className="flex justify-end gap-2">
              <span title={blockedReason}>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="min-h-9"
                  disabled={busyId === row.caddieProfileId || blocked || row.attendanceStatus === 'working' || row.attendanceStatus === 'not_linked'}
                  onClick={() => void clock(row, 'in')}
                >
                  <Clock /> {t('caddies:attendance.clockIn')}
                </Button>
              </span>
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
            {blockedReason ? (
              <p className="text-right text-xs text-warning">{blockedReason}</p>
            ) : null}
          </div>
        )
      },
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
          <p className="text-xs text-muted-foreground">{roleLabel(row.assignmentRole)}</p>
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
      cell: row => (
        <Badge variant={assignmentVariant(row.status)}>{assignmentStatusLabel(row.status)}</Badge>
      ),
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
    const statusMatches = status === 'all' || employmentStatusCode(profile.employmentStatus) === status
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
          businessDate={attendanceResource.data?.date ?? todayJst()}
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
        <Badge variant={isEmploymentActive(profile.employmentStatus) ? 'success' : 'neutral'}>
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
              className="pl-8"
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
        {profilesResource.data ? (
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
                  <Button type="button" variant="primary" onClick={onCreate}>
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
  // Zero means "pay them what their rank pays", which is the normal case.
  const [baseFeeAmount, setBaseFeeAmount] = useState('0')
  const [pickedStaffId, setPickedStaffId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickedStaff = pickedStaffId
    ? staff.find(item => item.id === pickedStaffId) ?? null
    : null
  // A name that stands for exactly one staff member links to that person on its
  // own; anything else is registered by the API under the name as typed.
  const matchedStaff = pickedStaff ?? exactStaffMatch(staff, displayName)
  const suggestions = matchedStaff ? [] : staffSuggestions(staff, displayName)

  function reset() {
    setDisplayName('')
    setSkillLevel('regular')
    setRank('D')
    setBaseFeeAmount('12000')
    setPickedStaffId(null)
  }

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

    setBusy(true)
    setError(null)
    try {
      const created = await courseboardApiJson<{ id?: string }>(
        `${COURSE_API}/caddie-profiles`,
        request('POST', caddieCreatePayload({
          name,
          skillLevel,
          rank,
          baseFeeAmount: fee,
          staffId: matchedStaff?.id ?? null,
        })),
      )
      const createdId = created?.id
      reset()
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
            <Field
              label={t('caddies:create.displayName')}
              hint={staffLoading ? t('caddies:create.staffLoading') : t('caddies:create.nameHint')}
              required
            >
              <Input
                value={displayName}
                onChange={event => {
                  setDisplayName(event.target.value)
                  setPickedStaffId(null)
                }}
                placeholder={t('caddies:create.namePlaceholder')}
                autoFocus
              />
            </Field>
            <Field label={t('caddies:create.baseFee')} hint={t('caddies:create.baseFeeHint')}>
              <Input type="number" min={0} value={baseFeeAmount} onChange={event => setBaseFeeAmount(event.target.value)} />
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
                {RANK_OPTIONS.map(option => (
                  <option key={option.rank} value={option.rank}>
                    {rankOptionLabel(option.rank, option.rounds)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </FormGrid>

          <Separator />

          {matchedStaff ? (
            <Notice tone="info">
              {t('caddies:create.staffMatched', { name: matchedStaff.name, id: matchedStaff.id })}
            </Notice>
          ) : suggestions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{t('caddies:create.staffSuggestions')}</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map(item => (
                  <Button
                    key={item.id}
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setDisplayName(item.name)
                      setPickedStaffId(item.id)
                    }}
                  >
                    <Link2 /> {item.name}（{item.id}）
                  </Button>
                ))}
              </div>
            </div>
          ) : displayName.trim() ? (
            <Notice tone="info">{t('caddies:create.staffWillBeRegistered')}</Notice>
          ) : null}

          {staffError ? <ResourceError error={staffError} onRetry={onRetryStaff} /> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common:action.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
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
  businessDate,
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
  businessDate: string
  onPeopleChanged: () => void
  onAssignmentsChanged: () => void
  setFlash: (flash: Flash) => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [tab, setTab] = useState<DetailTab>('basic')
  const [editOpen, setEditOpen] = useState(false)
  // The day-off form only lives while its tab is mounted, so leaving the tab
  // would silently drop whatever the user typed. Ask first.
  const [availabilityDirty, setAvailabilityDirty] = useState(false)
  const guarded = tab === 'availability' && availabilityDirty

  // Leaving the whole screen drops the form just as surely as leaving the tab:
  // "back to the list", the sidebar, ⌘K and the back/forward buttons all route
  // through `navigate`, so one guard covers them.
  useNavigationGuard(
    guarded ? () => window.confirm(t('caddies:calendar.confirmDiscard')) : null,
  )

  function changeTab(next: DetailTab) {
    if (next === tab) return
    if (guarded && !window.confirm(t('caddies:calendar.confirmDiscard'))) return
    setAvailabilityDirty(false)
    setTab(next)
  }

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
              <Badge variant={isEmploymentActive(profile.employmentStatus) ? 'success' : 'neutral'}>
                {employmentLabel(profile.employmentStatus)}
              </Badge>
              <Badge variant="outline">{skillLabel(profile.skillLevel)}</Badge>
              {profile.rank ? (
                <Badge variant="accent">{t('caddies:detail.rankBadge', { rank: profile.rank })}</Badge>
              ) : null}
            </div>
            <p className="mt-1 break-all text-xs text-muted-foreground">{profile.id}</p>
          </div>
          <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setEditOpen(true)}>
            <Pencil /> {t('caddies:detail.edit')}
          </Button>
        </div>
        <MetricGrid>
          <Metric
            label={t('caddies:detail.metrics.baseFee')}
            value={profile.baseFeeAmount > 0
              ? formatMoney(profile.baseFeeAmount, profile.currency)
              : t('caddies:detail.metrics.baseFeeByRank')}
            detail={profile.baseFeeAmount > 0
              ? t('caddies:detail.metrics.baseFeeDetail')
              : t('caddies:detail.metrics.baseFeeByRankDetail', { rank: profile.rank ?? '—' })}
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
        <DetailTabButton active={tab === 'basic'} onClick={() => changeTab('basic')}>
          <Users /> {t('caddies:detail.tabs.basic')}
        </DetailTabButton>
        <DetailTabButton active={tab === 'availability'} onClick={() => changeTab('availability')}>
          <CalendarDays /> {t('caddies:detail.tabs.availability')}
          {availabilityDirty ? (
            <Badge variant="warning">{t('caddies:calendar.unsaved')}</Badge>
          ) : null}
        </DetailTabButton>
        <DetailTabButton active={tab === 'assignments'} onClick={() => changeTab('assignments')}>
          <ClipboardCheck /> {t('caddies:detail.tabs.assignments')}
        </DetailTabButton>
        <DetailTabButton active={tab === 'ratings'} onClick={() => changeTab('ratings')}>
          <Star /> {t('caddies:detail.tabs.ratings')}
        </DetailTabButton>
      </div>

      {tab === 'basic' ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <StaffManagementPanel
            profile={profile}
            attendance={attendance}
            businessDate={businessDate}
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
        <AvailabilityCalendar
          profile={profile}
          setFlash={setFlash}
          onDirtyChange={setAvailabilityDirty}
        />
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
      className={`flex min-w-[6.5rem] items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
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
  const staffId = resolveStaffId(profile)
  const [displayName, setDisplayName] = useState(profile.displayName)
  const [skillLevel, setSkillLevel] = useState<SkillLevel>(profile.skillLevel)
  const [rank, setRank] = useState<Rank>(profile.rank ?? DEFAULT_RANK)
  // Folded to the canonical code so the select actually preselects the current
  // status when the API answers with `"Active"`.
  const [employmentStatus, setEmploymentStatus] = useState(
    () => employmentStatusCode(profile.employmentStatus),
  )
  const [baseFeeAmount, setBaseFeeAmount] = useState(String(profile.baseFeeAmount))
  const [currency, setCurrency] = useState(profile.currency)
  const [maxRounds, setMaxRounds] = useState(String(profile.maxRoundsPerDay))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const fee = Number.parseInt(baseFeeAmount, 10)
    const rounds = Number.parseInt(maxRounds, 10)
    const currencyCode = currency.trim().toUpperCase()
    if (!staffId && !displayName.trim()) {
      setError(t('caddies:edit.error.displayName'))
      return
    }
    if (!Number.isFinite(fee) || fee < 0 || !Number.isFinite(rounds) || rounds < 1) {
      setError(t('caddies:edit.error.numbers'))
      return
    }
    // Same ISO 4217 shape the extension settings validate against, instead of
    // quietly falling back to JPY and saving something the user never typed.
    if (!/^[A-Z]{3}$/.test(currencyCode)) {
      setError(t('caddies:edit.error.currency'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await courseboardApiJson<CaddieProfile>(
        `${COURSE_API}/caddie-profiles/${encodeURIComponent(profile.id)}`,
        request('PATCH', profilePatchPayload(profile, {
          ...(!staffId ? { displayName: displayName.trim() } : {}),
          skillLevel,
          rank,
          employmentStatus,
          baseFeeAmount: fee,
          currency: currencyCode,
          maxRoundsPerDay: rounds,
        })),
      )
      onOpenChange(false)
      onChanged()
      setFlash({
        tone: 'success',
        title: t('caddies:edit.saved.title'),
        message: t('caddies:edit.saved.message', { name: saved.displayName }),
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
          <DialogDescription>
            {t(staffId ? 'caddies:edit.descriptionLinked' : 'caddies:edit.descriptionUnlinked')}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => void submit(event)}>
          {staffId ? (
            <Notice
              tone="info"
              title={t('caddies:edit.staffName.title', { name: profile.displayName })}
              actions={(
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false)
                    navigate(`staff/${encodeURIComponent(staffId)}`)
                  }}
                >
                  <Pencil /> {t('caddies:edit.staffName.action')}
                </Button>
              )}
            >
              {t('caddies:edit.staffName.description')}
            </Notice>
          ) : null}
          <FormGrid columns={2}>
            {!staffId ? (
              <Field label={t('caddies:edit.displayName')} required>
                <Input value={displayName} onChange={event => setDisplayName(event.target.value)} />
              </Field>
            ) : null}
            <Field label={t('caddies:edit.skill')} required>
              <NativeSelect value={skillLevel} onChange={event => setSkillLevel(event.target.value as SkillLevel)}>
                <option value="rookie">{t('caddies:skill.rookie')}</option>
                <option value="regular">{t('caddies:skill.regular')}</option>
                <option value="veteran">{t('caddies:skill.veteran')}</option>
              </NativeSelect>
            </Field>
            <Field label={t('caddies:edit.rank')} required>
              <NativeSelect value={rank} onChange={event => setRank(event.target.value as Rank)}>
                {RANK_OPTIONS.map(option => (
                  <option key={option.rank} value={option.rank}>
                    {rankOptionLabel(option.rank, option.rounds)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t('caddies:edit.employment')} required>
              <NativeSelect value={employmentStatus} onChange={event => setEmploymentStatus(event.target.value)}>
                <option value="active">{t('caddies:employment.active')}</option>
                <option value="inactive">{t('caddies:employment.inactive')}</option>
                <option value="suspended">{t('caddies:employment.suspended')}</option>
              </NativeSelect>
            </Field>
            <Field label={t('caddies:edit.baseFee')} hint={t('caddies:edit.baseFeeHint')}>
              <Input type="number" min={0} value={baseFeeAmount} onChange={event => setBaseFeeAmount(event.target.value)} />
            </Field>
            <Field label={t('caddies:edit.currency')} required hint={t('caddies:edit.currencyHint')}>
              <Input maxLength={3} value={currency} onChange={event => setCurrency(event.target.value.toUpperCase())} />
            </Field>
            <Field label={t('caddies:edit.dailyLimit')} required>
              <Input type="number" min={1} value={maxRounds} onChange={event => setMaxRounds(event.target.value)} />
            </Field>
          </FormGrid>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
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
  businessDate,
  staff,
  staffError,
  onChanged,
  setFlash,
}: {
  profile: CaddieProfile
  attendance: AttendanceSnapshot | null
  businessDate: string
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
  // Clocking in is closed while the caddie is on leave or suspended; clocking
  // out stays open so an ongoing shift can always be closed.
  const clockInBlockedReason = clockInBlocked(profile)
    ? t('caddies:attendance.clockInBlocked', { status: employmentLabel(profile.employmentStatus) })
    : undefined

  async function clock(direction: 'in' | 'out') {
    if (!staffId) return
    setBusy(true)
    try {
      await punchClock(staffId, direction, businessDate)
      onChanged()
      setFlash({
        tone: 'success',
        title: direction === 'in'
          ? t('caddies:attendance.clockedIn')
          : t('caddies:attendance.clockedOut'),
        message: direction === 'in'
          ? t('caddies:attendance.updatedIn', { name: profile.displayName })
          : t('caddies:attendance.updatedOut', { name: profile.displayName }),
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
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <span title={clockInBlockedReason}>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  disabled={busy || clockInBlocked(profile) || attendance?.attendanceStatus === 'working'}
                  onClick={() => void clock('in')}
                >
                  <Clock /> {t('caddies:attendance.clockIn')}
                </Button>
              </span>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || attendance?.attendanceStatus !== 'working'}
                onClick={() => void clock('out')}
              >
                {t('caddies:attendance.clockOut')}
              </Button>
            </div>
            {clockInBlockedReason ? (
              <p className="text-xs text-warning">{clockInBlockedReason}</p>
            ) : null}
          </div>
          <Button type="button" variant="ghost" className="w-full" onClick={() => setLinkOpen(true)}>
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
              <Field label={t('caddies:staff.dialog.search')} requirement="none">
                <Input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder={t('caddies:staff.dialog.searchPlaceholder')}
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
              <Input value={newName} onChange={event => setNewName(event.target.value)} />
            </Field>
          )}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('common:action.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
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
        <Button type="button" variant="primary" className="mt-3 w-full" onClick={() => void save()} disabled={busy}>
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

function AvailabilityCalendar({
  profile,
  setFlash,
  onDirtyChange,
}: {
  profile: CaddieProfile
  setFlash: (flash: Flash) => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const [yearMonth, setYearMonth] = useState<string | null>(null)
  const [selection, setSelection] = useState(emptyCalendarDateSelection)
  const [status, setStatus] = useState<AvailabilityStatus>('available')
  const [twoRounds, setTwoRounds] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const extensionResource = useResource(
    () => courseboardApiJson<{ configJson?: Record<string, unknown> | null } | null>(
      `${COURSE_API}/extension-status`,
    ),
    [],
    { cacheKey: 'course:extension-status' },
  )
  let tenantToday: string | null = null
  let tenantClockError: unknown = extensionResource.error
  if (!extensionResource.loading && !tenantClockError) {
    try {
      const timezone = tenantTimezoneFromConfig(extensionResource.data?.configJson)
      tenantToday = calendarDateInTimezone(new Date(), timezone)
    } catch {
      tenantClockError = new Error(t('caddies:calendar.timezoneInvalid'))
    }
  }

  useEffect(() => {
    if (!tenantToday) return
    setYearMonth(current => current ?? tenantToday.slice(0, 7))
  }, [tenantToday])

  // Bounds are not requested until the tenant clock resolves. The inert value
  // only keeps the hook signature stable while the timezone request is pending.
  const bounds = monthBounds(yearMonth ?? '1970-01')
  const resource = useResource(
    () => courseboardApiJson<ListResponse<AvailabilityRecord>>(
      `${COURSE_API}/caddie-availabilities?caddieProfileId=${encodeURIComponent(profile.id)}&from=${bounds.from}&to=${bounds.to}`,
    ),
    [profile.id, bounds.from, bounds.to],
    {
      cacheKey: yearMonth
        ? `caddie-availability:${profile.id}:${bounds.from}:${bounds.to}`
        : null,
      enabled: yearMonth !== null,
    },
  )
  const records = useMemo(
    () => new Map((resource.data?.items ?? []).map(record => [record.date, record])),
    [resource.data],
  )
  const selectedDates = selection.dates
  const selectedDate = selection.anchor
  const selectedRecord = selectedDate ? records.get(selectedDate) : undefined
  // The anchor supplies the shared form values. Other selected dates may have
  // mixed stored values without making range selection itself an unsaved edit.
  const dirty = selectedDate !== null && (
    status !== (selectedRecord?.status ?? 'available')
    || twoRounds !== (selectedRecord?.twoRoundRequest ?? false)
    || note.trim() !== (selectedRecord?.healthNote ?? '').trim()
  )

  useEffect(() => {
    onDirtyChange(dirty)
    return () => onDirtyChange(false)
  }, [dirty, onDirtyChange])

  /** Guards anything that would throw away the day-off form. */
  function confirmDiscard() {
    return !dirty || window.confirm(t('caddies:calendar.confirmDiscard'))
  }

  useEffect(() => {
    setSelection(emptyCalendarDateSelection())
  }, [profile.id, yearMonth])

  function changeMonth(amount: number) {
    if (!confirmDiscard()) return
    setYearMonth(value => shiftMonth(value ?? tenantToday!.slice(0, 7), amount))
  }

  function select(date: string, shiftKey: boolean) {
    const next = calendarSelectionAfterClick(selection, date, shiftKey)
    if (next.anchor === selectedDate
      && next.dates.length === selectedDates.length
      && next.dates.every((value, index) => value === selectedDates[index])) return
    if (!confirmDiscard()) return
    const record = records.get(next.anchor!)
    setSelection(next)
    setStatus(record?.status ?? 'available')
    setTwoRounds(record?.twoRoundRequest ?? false)
    setNote(record?.healthNote ?? '')
  }

  /** Closing the sheet is the same decision as leaving the month. */
  function closeEditor() {
    if (!confirmDiscard()) return
    setSelection(emptyCalendarDateSelection())
  }

  async function save() {
    if (!selectedDate || selectedDates.length === 0) return
    const dates = [...selectedDates]
    setBusy(true)
    try {
      const results = await Promise.allSettled(dates.map(date => (
        courseboardApiJson(`${COURSE_API}/caddie-availabilities`, request('POST', {
          caddieProfileId: profile.id,
          date,
          status,
          twoRoundRequest: twoRounds,
          healthNote: note.trim() || null,
        }))
      )))
      const failed = results.find(result => result.status === 'rejected')
      resource.refresh()
      if (failed?.status === 'rejected') throw failed.reason
      // The sheet covers the calendar it was opened from, and the toast already
      // says what was saved — leaving it open would hide the month it changed.
      setSelection(emptyCalendarDateSelection())
      setFlash({
        tone: 'success',
        title: t('caddies:calendar.saved.title'),
        message: t('caddies:calendar.saved.message', {
          date: dates.length === 1
            ? dates[0]
            : t('caddies:calendar.dateRange', {
                from: dates[0],
                to: dates[dates.length - 1],
                n: String(dates.length),
              }),
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
      setSelection(emptyCalendarDateSelection())
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
  const selectionLabel = selectedDates.length > 1
    ? t('caddies:calendar.dateRange', {
        from: selectedDates[0],
        to: selectedDates[selectedDates.length - 1],
        n: String(selectedDates.length),
      })
    : (selectedDate ?? '')
  const loading = yearMonth === null
    || extensionResource.loading
    || (resource.loading && !resource.data)

  return (
    <Panel
      title={t('caddies:calendar.title')}
      description={t('caddies:calendar.description')}
      actions={(
        <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1">
          <Button type="button" variant="ghost" size="icon" className="min-h-9 min-w-9" aria-label={t('caddies:calendar.prevMonth')} onClick={() => changeMonth(-1)}><ChevronLeft /></Button>
          <span className="min-w-24 text-center text-sm font-medium">
            {t('caddies:calendar.monthLabel', {
              year: String(bounds.year),
              month: String(bounds.month),
            })}
          </span>
          <Button type="button" variant="ghost" size="icon" className="min-h-9 min-w-9" aria-label={t('caddies:calendar.nextMonth')} onClick={() => changeMonth(1)}><ChevronRight /></Button>
        </div>
      )}
    >
      {loading ? <LoadingState label={t('caddies:calendar.loading')} /> : null}
      {tenantClockError ? (
        <ResourceError error={tenantClockError} onRetry={extensionResource.refresh} />
      ) : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {!loading && !tenantClockError && !resource.error ? (
        <div className="space-y-3">
          <Notice tone="info" title={t('caddies:calendar.guide.title')}>
            <p>{t('caddies:calendar.guide.body')}</p>
            <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <li className="flex items-center gap-1.5">
                <Badge variant="success" className="px-1">{availabilityLabel('available')}</Badge>
                <span>{t('caddies:calendar.guide.legendRegistered')}</span>
              </li>
              <li className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-primary">2R</span>
                <span>{t('caddies:calendar.guide.legendTwoRounds')}</span>
              </li>
              <li>{t('caddies:calendar.guide.legendBlank')}</li>
            </ul>
          </Notice>
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
                  const active = selectedDates.includes(date)
                  const current = date === tenantToday
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={event => select(date, event.shiftKey)}
                      // Says what the click does, for a screen reader and for
                      // the tooltip — a bare date gives neither.
                      aria-label={t('caddies:calendar.dayAction', { date })}
                      aria-current={current ? 'date' : undefined}
                      aria-pressed={active}
                      title={t('caddies:calendar.dayAction', { date })}
                      className={`flex min-h-16 flex-col items-center justify-start gap-1 border-b border-r border-border/60 p-1 text-xs transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                        active ? 'bg-selected' : 'hover:bg-muted/50'
                      } ${current ? 'ring-2 ring-inset ring-primary' : ''}`}
                    >
                      <span className="font-medium">{day}</span>
                      {current ? (
                        <span className="text-[10px] font-semibold text-primary">
                          {t('common:time.today')}
                        </span>
                      ) : null}
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

          <Sheet
            open={selectedDates.length > 0}
            onOpenChange={open => {
              if (!open) closeEditor()
            }}
            title={t('caddies:calendar.sheetTitle', { date: selectionLabel })}
            description={dirty
              ? t('caddies:calendar.unsavedHint')
              : t('caddies:calendar.sheetDescription')}
          >
            <div className="space-y-4 px-1 pb-1">
              {dirty ? (
                <Badge variant="warning">{t('caddies:calendar.unsaved')}</Badge>
              ) : null}
              <Field label={t('caddies:calendar.status')} required>
                <NativeSelect
                  value={status}
                  onChange={event => setStatus(event.target.value as AvailabilityStatus)}
                >
                  {AVAILABILITY_STATUSES.map(value => (
                    <option key={value} value={value}>{availabilityLabel(value)}</option>
                  ))}
                </NativeSelect>
              </Field>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3">
                <input
                  type="checkbox"
                  checked={twoRounds}
                  onChange={event => setTwoRounds(event.target.checked)}
                  className="size-5 accent-primary"
                />
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
              <Button type="button" variant="primary" className="w-full" disabled={busy} onClick={() => void save()}>
                <CheckCircle2 /> {busy ? t('caddies:calendar.saving') : t('caddies:calendar.save')}
              </Button>
              {selectedDates.length === 1 && selectedRecord ? (
                <Button type="button" variant="ghost" className="w-full text-destructive" disabled={busy} onClick={() => void remove()}>
                  <XCircle /> {t('caddies:calendar.remove')}
                </Button>
              ) : null}
            </div>
          </Sheet>
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

/**
 * What the club owes for a month, one caddie per row.
 *
 * Deliberately just the list. Month totals and a rank split are analysis, and
 * analysis put above a sheet somebody has to reconcile line by line pushes the
 * work below the fold — the numbers belong on a screen built to compare months,
 * not on the one used to check this one. What stays here is what the table
 * needs: the month, the export, and the fee table that prices the rows.
 */
function PayrollView({ setFlash }: { setFlash: (flash: Flash) => void }) {
  const { t } = useTranslation(['caddies', 'common'])
  const {
    value: yearMonth,
    error: yearMonthError,
    setCandidate: setYearMonth,
  } = useYearMonthValue(previousYearMonth())
  const [downloading, setDownloading] = useState(false)
  const [editingFees, setEditingFees] = useState(false)
  const feesResource = useResource(
    () => courseboardApiJson<CaddieRankFees>(`${COURSE_API}/caddie-rank-fees`),
    [],
  )
  const resource = useResource(
    () => courseboardApiJson<PayrollResponse>(
      `${COURSE_API}/caddie-payroll-summary?yearMonth=${encodeURIComponent(yearMonth)}`,
    ),
    [yearMonth],
    { cacheKey: `caddie-payroll:${yearMonth}` },
  )
  const refreshAll = useCallback(() => {
    feesResource.refresh()
    resource.refresh()
  }, [feesResource.refresh, resource.refresh])
  useRegisterPageReload(refreshAll)
  const rows = resource.data?.items ?? []

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
      sortValue: row => row.displayName,
      // The staff id is on the row and is what payroll cross-references, so it
      // has to be findable even though nobody reads it at a glance.
      searchValue: row => `${row.displayName} ${row.staffId ?? ''}`,
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
      // Rank and the fee it implies are one fact, and splitting them into two
      // columns made the row read as two unrelated numbers.
      key: 'roundFee',
      header: t('caddies:payroll.table.rankAndFee'),
      mobileLabel: t('caddies:payroll.table.rankAndFee'),
      sortValue: row => row.roundFee,
      searchValue: row => row.rank,
      cell: row => (
        <div className="flex items-center gap-2">
          <Badge variant="accent">{row.rank}</Badge>
          <div>
            <p className="tabular-nums">{formatMoney(row.roundFee, row.currency)}</p>
            {row.feeOverridden ? (
              <p className="text-xs text-muted-foreground">
                {t('caddies:payroll.table.ownFee')}
              </p>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: 'rounds',
      header: t('caddies:payroll.table.rounds'),
      mobileLabel: t('caddies:payroll.table.rounds'),
      align: 'right',
      sortValue: row => row.assignedRounds,
      cell: row => t('caddies:rounds', { n: String(row.assignedRounds) }),
    },
    {
      key: 'fees',
      header: t('caddies:payroll.table.fees'),
      mobileLabel: t('caddies:payroll.table.fees'),
      align: 'right',
      sortValue: row => row.feeTotal,
      // The one number the sheet exists to state, so it carries more weight
      // than the inputs it is derived from.
      cell: row => (
        <span className="font-semibold tabular-nums">{formatMoney(row.feeTotal, row.currency)}</span>
      ),
    },
    {
      // Worked against rostered is a comparison, so the two belong side by side
      // rather than in columns the eye has to travel between.
      key: 'worked',
      header: t('caddies:payroll.table.workedAgainstShift'),
      mobileLabel: t('caddies:payroll.table.workedAgainstShift'),
      sortValue: row => row.workedMinutes,
      cell: row => (
        <span className="whitespace-nowrap tabular-nums">
          {formatMinutes(row.workedMinutes)}
          <span className="text-muted-foreground"> / {formatMinutes(row.shiftedMinutes)}</span>
        </span>
      ),
    },
    {
      key: 'warning',
      header: t('caddies:payroll.table.check'),
      mobileLabel: t('caddies:payroll.table.check'),
      // Sorted so the rows needing a second look come to the top first, which
      // is the only reason to sort this column at all.
      sortValue: row => -(row.roundsWithoutClockIn + (row.openClockIn ? 1 : 0)),
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
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
            <YearMonthPicker
              label={t('caddies:payroll.monthLabel')}
              value={yearMonth}
              error={yearMonthError}
              onChange={setYearMonth}
              className="sm:w-56"
            />
            <Button type="button" variant="secondary" onClick={() => setEditingFees(true)}>
              <Pencil /> {t('caddies:payroll.rankFees.open')}
            </Button>
            <Button type="button" variant="primary" disabled={downloading || !resource.data} onClick={() => void downloadCsv()}>
              <Download /> {downloading ? t('caddies:payroll.exporting') : t('caddies:payroll.exportCsv')}
            </Button>
          </div>
        )}
      >
        {resource.loading && !resource.data ? <LoadingState label={t('caddies:payroll.loading')} /> : null}
        {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
        {resource.data ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('caddies:payroll.period', {
                from: resource.data.period.startDate,
                to: resource.data.period.endDate,
              })}
            </p>
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={row => row.caddieProfileId}
              searchable
              searchPlaceholder={t('caddies:payroll.searchPlaceholder')}
              // Biggest payout first: the amounts worth checking twice are the
              // large ones, and a roster sorted by name buries them.
              defaultSort={{ key: 'fees', direction: 'desc' }}
              pageSize={PAYROLL_PAGE_SIZE}
              empty={(
                <EmptyState
                  title={t('caddies:payroll.empty.title')}
                  description={t('caddies:payroll.empty.description')}
                />
              )}
            />
          </div>
        ) : null}
      </Panel>

      <RankFeeSheet
        open={editingFees}
        onClose={() => setEditingFees(false)}
        resource={feesResource}
        setFlash={setFlash}
        onSaved={resource.refresh}
      />
    </div>
  )
}

/**
 * The per-round fee each rank is paid.
 *
 * Saving re-prices every month, past ones included — the club that corrects a
 * rate here means the rate was wrong, not that it changes from today. The
 * warning says so before the save rather than after.
 */
function RankFeeSheet({
  open,
  onClose,
  resource,
  setFlash,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  resource: ResourceValue<CaddieRankFees>
  setFlash: (flash: Flash) => void
  onSaved: () => void
}) {
  const { t } = useTranslation(['caddies', 'common'])
  const fees = resource.data
  const [draft, setDraft] = useState<CaddieRankFeeDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // The form starts from whatever the club is paying by now. Reloading after a
  // save re-seeds it, so the fields never keep an amount the server refused.
  useEffect(() => {
    setDraft(fees ? rankFeeDraft(fees) : null)
    setSaveError(null)
  }, [fees])

  const dirty = draft !== null && fees !== null && rankFeeDraftIsDirty(draft, fees)

  async function save() {
    if (!draft || !fees) return
    let next: CaddieRankFees
    try {
      next = buildRankFees(draft, fees.currency)
    } catch (reason) {
      setSaveError(errorMessage(reason))
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await courseboardApiJson<CaddieRankFees>(`${COURSE_API}/caddie-rank-fees`, {
        method: 'PUT',
        body: JSON.stringify(next),
      })
      resource.refresh()
      onSaved()
      onClose()
      setFlash({
        tone: 'success',
        title: t('caddies:payroll.rankFees.saved.title'),
        message: t('caddies:payroll.rankFees.saved.message'),
      })
    } catch (reason) {
      setSaveError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
      title={t('caddies:payroll.rankFees.title')}
      description={t('caddies:payroll.rankFees.description')}
    >
      <div className="space-y-4 px-1 pb-1">
        {resource.loading ? <LoadingState label={t('caddies:payroll.rankFees.loading')} /> : null}
        {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
        {draft && fees ? (
          <>
            {dirty ? <Badge variant="warning">{t('caddies:payroll.rankFees.unsaved')}</Badge> : null}
            <FormGrid columns={2}>
              {RANKS.map(rank => (
                <Field
                  key={rank}
                  label={t('caddies:payroll.rankFees.rankLabel', { rank })}
                  hint={t('caddies:payroll.rankFees.rankHint', { currency: fees.currency })}
                  required
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={100}
                    value={draft[rank]}
                    onChange={event => {
                      const value = event.target.value
                      setDraft(current => current ? { ...current, [rank]: value } : current)
                      setSaveError(null)
                    }}
                  />
                </Field>
              ))}
            </FormGrid>
            <Notice tone="info" title={t('caddies:payroll.rankFees.scope.title')}>
              {t('caddies:payroll.rankFees.scope.description')}
            </Notice>
            {saveError ? (
              <Notice tone="danger" title={t('caddies:payroll.rankFees.failed')}>{saveError}</Notice>
            ) : null}
            <Button
              type="button"
              variant="primary"
              className="w-full"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              <CheckCircle2 /> {saving ? t('common:action.saving') : t('caddies:payroll.rankFees.save')}
            </Button>
          </>
        ) : null}
      </div>
    </Sheet>
  )
}

export default CaddiesPage

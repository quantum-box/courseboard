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
import {
  downloadText,
  courseboardApiJson,
  courseboardApiText,
  fieldApiJson,
  fieldApiText,
  fieldTenant,
} from '../../api'
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
import { useResource } from '../../hooks/useResource'
import { navigate } from '../../lib/router'

const COURSE_API = '/v1/course'

type ListResponse<T> = { items: T[] }
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
  return `${Math.floor(safe / 60)}時間${safe % 60}分`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作を完了できませんでした'
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

function skillLabel(skill: string) {
  return ({ rookie: '新人', regular: 'レギュラー', veteran: 'ベテラン' } as Record<string, string>)[skill] ?? skill
}

function employmentLabel(status: string) {
  return ({ active: '稼働中', inactive: '休止', suspended: '停止' } as Record<string, string>)[status] ?? status
}

function attendanceLabel(status: AttendanceSnapshot['attendanceStatus']) {
  return {
    not_linked: '未紐付け',
    not_clocked: '未出勤',
    working: '勤務中',
    clocked_out: '退勤済み',
  }[status]
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
          閉じる
        </Button>
      )}
    >
      {flash.message}
    </Notice>
  )
}

const VIEW_COPY: Record<View, { title: string; description: string }> = {
  roster: {
    title: 'キャディ名簿',
    description: 'プロフィール、スタッフ連携、希望休、評価を管理します。',
  },
  dispatch: {
    title: 'キャディ配置',
    description: '当日の割当を主作業にし、供給判断と自動配置は補助ツールとして使います。',
  },
  attendance: {
    title: 'キャディ勤怠',
    description: '出勤状態と割当を照合し、その場で打刻します。',
  },
  payroll: {
    title: 'キャディ給与',
    description: '勤怠と確定費用を月次で照合し、給与CSVへ渡します。',
  },
}

export function CaddiesPage({
  initialView = 'roster',
  initialProfileId,
}: {
  initialView?: View
  initialProfileId?: string
} = {}) {
  const tenant = fieldTenant()
  const [view, setView] = useState<View>(initialView)
  const [operationDate, setOperationDate] = useState(todayJst)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(initialProfileId ?? null)
  const [createOpen, setCreateOpen] = useState(false)
  const [flash, setFlash] = useState<Flash>(null)

  const profilesResource = useResource(
    () => courseboardApiJson<ListResponse<CaddieProfile>>(`${COURSE_API}/caddie-profiles`),
    [],
  )
  const assignmentsResource = useResource(
    () => courseboardApiJson<ListResponse<CaddieAssignment>>(`${COURSE_API}/caddie-assignments`),
    [],
  )
  const recommendationsResource = useResource(
    () => courseboardApiJson<ListResponse<CaddieRecommendation>>(
      `${COURSE_API}/caddie-recommendations?playerCount=4&includeRookiePairing=true&limit=5`,
    ),
    [],
  )
  const staffResource = useResource(
    () => fieldApiJson<ListResponse<StaffMember>>('/v1/erp/staff'),
    [],
  )
  const coursesResource = useResource(
    () => courseboardApiJson<ListResponse<GolfCourse>>(`${COURSE_API}/courses`),
    [],
  )
  const attendanceResource = useResource(
    () => courseboardApiJson<AttendanceResponse>(
      `${COURSE_API}/caddie-attendance-snapshot?date=${encodeURIComponent(operationDate)}`,
    ),
    [operationDate],
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
    if (initialProfileId && profiles.some(profile => profile.id === initialProfileId)) {
      setSelectedProfileId(initialProfileId)
      return
    }
    setSelectedProfileId(profiles[0]?.id ?? null)
  }, [initialProfileId, profiles, selectedProfileId, view])

  function refreshPeople() {
    profilesResource.refresh()
    staffResource.refresh()
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

  const refreshCurrentView = useCallback(() => {
    if (view === 'roster') {
      profilesResource.refresh()
      staffResource.refresh()
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
    staffResource.refresh,
    coursesResource.refresh,
    assignmentsResource.refresh,
    attendanceResource.refresh,
    recommendationsResource.refresh,
  ])

  useRegisterPageReload(view === 'payroll' ? null : refreshCurrentView)

  const copy = VIEW_COPY[view]

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={`Golf operations · ${tenant}`}
        title={copy.title}
        description={copy.description}
        actions={(
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {view !== 'payroll' ? (
              <PageRefreshButton
                variant="secondary"
                className="min-h-10 flex-1 sm:flex-none"
                label="更新"
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
                <Plus /> キャディを追加
              </Button>
            ) : null}
          </div>
        )}
      />

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
        onCreated={id => {
          setCreateOpen(false)
          setView('roster')
          if (id) selectProfile(id)
          refreshPeople()
          setFlash({
            tone: 'success',
            title: 'キャディを追加しました',
            message: 'プロフィールとスタッフの紐付けを作成しました。',
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
            <h2 className="section-title">割当ボード</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {date} の担当を完了・キャンセルまで更新します。勤怠打刻はサイドバーの「勤怠」へ。
            </p>
          </div>
          <Field label="運用日" className="w-full sm:w-44">
            <Input
              type="date"
              aria-label="運用日"
              value={date}
              onChange={event => onDateChange(event.target.value)}
              className="min-h-10"
            />
          </Field>
        </div>
        <MetricGrid>
          <Metric label="登録キャディ" value={`${profiles.length}人`} detail="全プロフィール" />
          <Metric
            label="勤務中"
            value={`${working}人`}
            detail={`${attendance.length}人の勤怠を取得`}
            tone={working > 0 ? 'success' : 'warning'}
          />
          <Metric label="本日の割当" value={`${activeAssignments.length}組`} detail={`取消 ${dayAssignments.length - activeAssignments.length}件`} />
          <Metric
            label="要確認"
            value={`${waiting}件`}
            detail="未確定の割当"
            tone={waiting > 0 ? 'warning' : 'success'}
          />
        </MetricGrid>
        {assignmentsResource.loading ? <LoadingState label="割当を読み込み中" /> : null}
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
          <h2 className="section-title">供給と自動配置</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            キャディ付枠の残量確認と、未割当予約への提案です。販売枠の変更はコース予約側で行います。
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
  return (
    <div className="space-y-4">
      <section className="app-section space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="section-title">出勤ボード</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {date} の割当と出勤状態を照合します。スタッフ未連携のキャディは名簿で紐付けてください。
            </p>
          </div>
          <Field label="運用日" className="w-full sm:w-44">
            <Input
              type="date"
              aria-label="運用日"
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
  const [safetyBuffer, setSafetyBuffer] = useState(0)
  const resource = useResource(
    () => courseboardApiJson<CaddieSupply>(
      `${COURSE_API}/caddie-supply?date=${encodeURIComponent(date)}&safetyBuffer=${safetyBuffer}`,
    ),
    [date, safetyBuffer],
  )

  return (
    <Panel
      title="キャディ付枠"
      description="勤務希望と2ラウンド可否から、安全に販売できる上限を算出します。"
      actions={(
        <Field label="安全予備（組）" className="w-full sm:w-36">
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
      {resource.loading ? <LoadingState label="供給力を算出中" /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {resource.data ? (
        <div className="space-y-3">
          <MetricGrid>
            <Metric
              label="供給力"
              value={`${resource.data.caddieSupply}組`}
              detail={`勤務可 ${resource.data.availableCaddies}人 · 2R可 ${resource.data.twoRoundCapable}人`}
            />
            <Metric label="安全上限" value={`${resource.data.caddieAttachedCap}組`} detail={`予備 ${resource.data.safetyBuffer}組`} />
            <Metric label="予約済み" value={`${resource.data.currentCaddieAttached}組`} detail="キャディ付き予約" />
            <Metric
              label="残枠"
              value={`${resource.data.remaining}組`}
              detail={resource.data.remaining < 0 ? '上限超過' : '受付可能'}
              tone={resource.data.remaining < 0 ? 'danger' : 'success'}
            />
          </MetricGrid>
          <p className="text-xs text-muted-foreground">
            午前対応 {resource.data.morningCapacity}人 · 午後対応 {resource.data.afternoonCapacity}人
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
          title: '自動配置を確定しました',
          message: `${result.assigned.length}件を割り当て、${result.skipped.length}件をスキップしました。`,
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
      title="スマート自動配置"
      description="未割当のキャディ付き予約を、勤務状況とスキルから組み合わせます。"
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
          <Sparkles /> {busy === 'preview' ? '算出中…' : '配置をプレビュー'}
        </Button>
        <Button
          type="button"
          variant="primary"
          className="min-h-10 flex-1"
          disabled={busy !== null || !plan || plan.assigned.length === 0}
          onClick={() => void run(false)}
        >
          <CheckCircle2 /> {busy === 'execute' ? '確定中…' : 'この配置を確定'}
        </Button>
      </div>

      {error ? (
        <div className="mt-3">
          <Notice tone="danger" title="自動配置を実行できませんでした">
            {errorMessage(error)}
          </Notice>
        </div>
      ) : null}

      {plan ? (
        <div className="mt-4 space-y-3">
          {plan.assigned.length === 0 ? (
            <EmptyState
              title="配置対象はありません"
              description="未割当のキャディ付き予約がないか、勤務可能なキャディがいません。"
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
                    <Badge variant="accent">候補</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{item.rationale.join(' · ')}</p>
                </div>
              ))}
            </div>
          )}
          {plan.skipped.length > 0 ? (
            <Notice tone="warning" title={`${plan.skipped.length}件をスキップ`}>
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
  return (
    <Panel
      title="推薦候補"
      description="4名プレー・新人ペアリングを考慮した候補です。"
      actions={(
        <Button type="button" variant="ghost" size="sm" className="min-h-9" onClick={resource.refresh}>
          <RefreshCw /> 更新
        </Button>
      )}
    >
      {resource.loading ? <LoadingState label="候補を計算中" /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {!resource.loading && !resource.error && (resource.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="推薦候補はありません" description="勤務条件やプロフィールを確認してください。" />
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
                <Badge variant="accent">{item.recommendationScore}点</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                役割 {item.recommendedRole} · 担当 {item.roundsAssigned}R · 評価 {item.ratingAverage?.toFixed(1) ?? '—'}
              </p>
              {item.pairingDisplayName ? (
                <p className="mt-1 text-xs text-foreground">ペア: {item.pairingDisplayName}</p>
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
        title: 'スタッフが未紐付けです',
        message: '名簿でスタッフを紐付けてから勤怠を記録してください。',
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
        title: direction === 'in' ? '出勤を記録しました' : '退勤を記録しました',
        message: `${snapshot.displayName}さんの勤怠を更新しました。`,
      })
    } catch (error) {
      setFlash({ tone: 'danger', title: '勤怠を更新できませんでした', message: errorMessage(error) })
    } finally {
      setBusyId(null)
    }
  }

  const columns: DataTableColumn<AttendanceSnapshot>[] = [
    {
      key: 'name',
      header: 'キャディ',
      mobileLabel: 'キャディ',
      cell: row => (
        <div>
          <p className="font-medium">{row.displayName}</p>
          <p className="text-xs text-muted-foreground">本日 {row.todayAssignments}組</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: '出勤状態',
      mobileLabel: '出勤状態',
      cell: row => <Badge variant={attendanceVariant(row.attendanceStatus)}>{attendanceLabel(row.attendanceStatus)}</Badge>,
    },
    {
      key: 'warning',
      header: '要確認',
      mobileLabel: '要確認',
      cell: row => row.roundsWithoutClockInToday > 0
        ? <span className="text-warning">未出勤の割当 {row.roundsWithoutClockInToday}件</span>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'action',
      header: '操作',
      mobileLabel: '操作',
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
            <Clock /> 出勤
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-9"
            disabled={busyId === row.caddieProfileId || row.attendanceStatus !== 'working'}
            onClick={() => void clock(row, 'out')}
          >
            退勤
          </Button>
        </div>
      ),
    },
  ]

  const body = (
    <>
      {resource.loading ? <LoadingState label="勤怠を読み込み中" /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {resource.data ? (
        <DataTable
          rows={resource.data.items}
          columns={columns}
          rowKey={row => row.caddieProfileId}
          empty={<EmptyState title="本日の勤怠対象はいません" description="割当またはプロフィールを確認してください。" />}
        />
      ) : null}
    </>
  )

  if (!showHeader) return <div className="space-y-3">{body}</div>

  return (
    <Panel
      title="出勤ボード"
      description="本日の割当と出勤状態を照合し、その場で打刻します。"
      actions={(
        <Button type="button" variant="secondary" size="sm" className="min-h-9" onClick={resource.refresh}>
          <RefreshCw /> 更新
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
        title: status === 'completed' ? '割当を完了しました' : '割当をキャンセルしました',
        message: assignment.roundReference ?? assignment.reservationId ?? assignment.id,
      })
    } catch (error) {
      setFlash({ tone: 'danger', title: '割当を更新できませんでした', message: errorMessage(error) })
    } finally {
      setBusyId(null)
    }
  }

  const columns: DataTableColumn<CaddieAssignment>[] = [
    {
      key: 'time',
      header: '予定',
      mobileLabel: '予定',
      cell: row => formatDateTime(row.scheduledAt),
    },
    {
      key: 'round',
      header: '予約・ラウンド',
      mobileLabel: '予約・ラウンド',
      cell: row => (
        <div>
          <p className="font-medium">{row.roundReference ?? row.reservationId ?? row.id}</p>
          <p className="text-xs text-muted-foreground">{row.assignmentRole}</p>
        </div>
      ),
    },
    {
      key: 'caddie',
      header: 'キャディ',
      mobileLabel: 'キャディ',
      cell: row => profileNames.get(row.caddieProfileId) ?? row.caddieProfileId,
    },
    {
      key: 'fee',
      header: '費用',
      mobileLabel: '費用',
      align: 'right',
      cell: row => formatMoney(row.feeAmount, row.feeCurrency),
    },
    {
      key: 'status',
      header: '状態',
      mobileLabel: '状態',
      cell: row => <Badge variant={assignmentVariant(row.status)}>{row.status}</Badge>,
    },
    {
      key: 'action',
      header: '操作',
      mobileLabel: '操作',
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
            <CheckCircle2 /> 完了
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-9 text-destructive"
            disabled={busyId === row.id}
            onClick={() => void updateStatus(row, 'cancelled')}
          >
            <XCircle /> 取消
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
      empty={<EmptyState title="対象日の割当はありません" description="自動配置をプレビューするか、予約状況を確認してください。" />}
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
  onCreate: () => void
  onPeopleChanged: () => void
  onAssignmentsChanged: () => void
  setFlash: (flash: Flash) => void
}) {
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

  return (
    <div className="space-y-4">
      {unlinked > 0 ? (
        <Notice
          tone="warning"
          title={`${unlinked}人のスタッフ紐付けが未完了です`}
          actions={(
            <Button type="button" size="sm" variant="secondary" onClick={() => setLink('unlinked')}>
              未紐付けだけ表示
            </Button>
          )}
        >
          勤怠と給与CSVへ反映するには、Fieldスタッフとの紐付けが必要です。
        </Notice>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(270px,340px)_minmax(0,1fr)]">
        <Panel
          title="キャディ名簿"
          description={`${filtered.length} / ${profiles.length}人`}
          actions={(
            <Button type="button" size="sm" variant="primary" className="min-h-9" onClick={onCreate}>
              <UserPlus /> 追加
            </Button>
          )}
        >
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" aria-hidden="true" />
              <SearchInput
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="名前・ID・スタッフID"
                aria-label="キャディを検索"
                className="min-h-10 pl-8"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NativeSelect value={status} onChange={event => setStatus(event.target.value)} aria-label="雇用状態">
                <option value="all">すべての状態</option>
                <option value="active">稼働中</option>
                <option value="inactive">休止</option>
                <option value="suspended">停止</option>
              </NativeSelect>
              <NativeSelect value={skill} onChange={event => setSkill(event.target.value)} aria-label="スキル">
                <option value="all">すべてのスキル</option>
                <option value="rookie">新人</option>
                <option value="regular">レギュラー</option>
                <option value="veteran">ベテラン</option>
              </NativeSelect>
              <NativeSelect value={link} onChange={event => setLink(event.target.value)} aria-label="スタッフ紐付け" className="col-span-2">
                <option value="all">すべての紐付け</option>
                <option value="linked">紐付け済み</option>
                <option value="unlinked">未紐付け</option>
              </NativeSelect>
            </div>
          </div>

          <Separator className="my-3" />

          {profilesResource.loading && !profilesResource.data ? (
            <LoadingState label="名簿を読み込み中" />
          ) : null}
          {profilesResource.error ? <ResourceError error={profilesResource.error} onRetry={profilesResource.refresh} /> : null}
          {!profilesResource.loading && !profilesResource.error && filtered.length === 0 ? (
            <EmptyState
              title={profiles.length === 0 ? 'キャディが登録されていません' : '条件に一致するキャディはいません'}
              description={profiles.length === 0 ? '最初のプロフィールとスタッフを作成してください。' : '検索または絞り込み条件を変更してください。'}
              action={profiles.length === 0 ? (
                <Button type="button" variant="primary" className="min-h-10" onClick={onCreate}>
                  <Plus /> キャディを追加
                </Button>
              ) : undefined}
            />
          ) : null}
          <div className="max-h-[56dvh] space-y-1 overflow-y-auto pr-1 lg:max-h-[calc(100dvh-19rem)]">
            {filtered.map(profile => {
              const active = profile.id === selectedProfileId
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => onSelectProfile(profile.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
                    active
                      ? 'border-primary/30 bg-selected text-foreground'
                      : 'border-transparent hover:border-border hover:bg-muted/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{profile.displayName}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {profile.rank ? `${profile.rank}ランク · ` : ''}{skillLabel(profile.skillLevel)}
                      </p>
                    </div>
                    <Badge variant={profile.employmentStatus === 'active' ? 'success' : 'neutral'}>
                      {employmentLabel(profile.employmentStatus)}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Star className="size-3 fill-warning text-warning" />
                      {profile.ratingAverage?.toFixed(1) ?? '—'} ({profile.ratingCount})
                    </span>
                    <span className={resolveStaffId(profile) ? 'text-success' : 'text-warning'}>
                      {resolveStaffId(profile) ? 'スタッフ連携済み' : '未連携'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </Panel>

        <div className="min-w-0">
          {selected ? (
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
          ) : (
            <Panel>
              <EmptyState title="プロフィールを選択してください" description="名簿からキャディを選ぶと詳細を表示します。" />
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}

function ProfileCreateDialog({
  open,
  onOpenChange,
  staff,
  staffLoading,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  staff: StaffMember[]
  staffLoading: boolean
  onCreated: (id?: string) => void
}) {
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
    const name = displayName.trim()
    const fee = Number.parseInt(baseFeeAmount, 10)
    if (!name) {
      setError('表示名を入力してください。')
      return
    }
    if (!Number.isFinite(fee) || fee < 0) {
      setError('基本費用は0円以上で入力してください。')
      return
    }
    if (staffMode === 'existing' && !staffId) {
      setError('紐付けるスタッフを選択してください。')
      return
    }
    if (staffMode === 'new' && !newStaffName.trim()) {
      setError('新しいスタッフ名を入力してください。')
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
          <DialogTitle>キャディを追加</DialogTitle>
          <DialogDescription>
            勤怠と給与連携のため、既存または新しいFieldスタッフと同時に紐付けます。
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => void submit(event)}>
          <FormGrid columns={2}>
            <Field label="表示名" required>
              <Input value={displayName} onChange={event => setDisplayName(event.target.value)} className="min-h-10" autoFocus />
            </Field>
            <Field label="基本費用（円）" required>
              <Input type="number" min={0} value={baseFeeAmount} onChange={event => setBaseFeeAmount(event.target.value)} className="min-h-10" />
            </Field>
            <Field label="スキル" required>
              <NativeSelect value={skillLevel} onChange={event => setSkillLevel(event.target.value as SkillLevel)}>
                <option value="rookie">新人</option>
                <option value="regular">レギュラー</option>
                <option value="veteran">ベテラン</option>
              </NativeSelect>
            </Field>
            <Field label="ランク" required>
              <NativeSelect value={rank} onChange={event => setRank(event.target.value as Rank)}>
                <option value="A">A（41R/月）</option>
                <option value="B">B（33R/月）</option>
                <option value="C">C（25R/月）</option>
                <option value="D">D（14R/月）</option>
              </NativeSelect>
            </Field>
          </FormGrid>

          <Separator />

          <Field label="スタッフ登録方法" required>
            <NativeSelect value={staffMode} onChange={event => setStaffMode(event.target.value as 'existing' | 'new')}>
              <option value="existing">既存スタッフに紐付ける</option>
              <option value="new">新しいスタッフを作成する</option>
            </NativeSelect>
          </Field>
          {staffMode === 'existing' ? (
            <div className="space-y-3">
              <Field label="スタッフ検索">
                <Input value={staffQuery} onChange={event => setStaffQuery(event.target.value)} placeholder="名前またはスタッフID" className="min-h-10" />
              </Field>
              <Field label="スタッフ" required>
                <NativeSelect value={staffId} onChange={event => setStaffId(event.target.value)} disabled={staffLoading}>
                  <option value="">{staffLoading ? '読み込み中…' : 'スタッフを選択'}</option>
                  {availableStaff.map(item => (
                    <option key={item.id} value={item.id}>{item.name}（{item.id}）</option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          ) : (
            <Field label="新しいスタッフ名" required>
              <Input value={newStaffName} onChange={event => setNewStaffName(event.target.value)} className="min-h-10" />
            </Field>
          )}

          {error ? <Notice tone="danger">{error}</Notice> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" className="min-h-10" onClick={() => onOpenChange(false)} disabled={busy}>
              キャンセル
            </Button>
            <Button type="submit" variant="primary" className="min-h-10" disabled={busy}>
              <UserPlus /> {busy ? '作成中…' : 'キャディを作成'}
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
              {profile.rank ? <Badge variant="accent">{profile.rank}ランク</Badge> : null}
            </div>
            <p className="mt-1 break-all text-xs text-muted-foreground">{profile.id}</p>
          </div>
          <Button type="button" variant="secondary" className="min-h-10 w-full sm:w-auto" onClick={() => setEditOpen(true)}>
            <Pencil /> 基本情報を編集
          </Button>
        </div>
        <MetricGrid>
          <Metric label="基本費用" value={formatMoney(profile.baseFeeAmount, profile.currency)} detail="1ラウンド基準" />
          <Metric label="日次上限" value={`${profile.maxRoundsPerDay}R`} detail={profile.canTwoRounds ? '2ラウンド可' : '登録上限'} />
          <Metric label="平均評価" value={profile.ratingAverage?.toFixed(1) ?? '—'} detail={`${profile.ratingCount}件`} />
          <Metric
            label="勤怠"
            value={attendance ? attendanceLabel(attendance.attendanceStatus) : '未取得'}
            detail={attendance ? `本日 ${attendance.todayAssignments}組` : '運用日データなし'}
            tone={attendance?.attendanceStatus === 'working' ? 'success' : 'neutral'}
          />
        </MetricGrid>
      </Panel>

      <div className="grid grid-cols-4 gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1" role="tablist" aria-label="プロフィール詳細">
        <DetailTabButton active={tab === 'basic'} onClick={() => setTab('basic')}><Users /> 基本・連携</DetailTabButton>
        <DetailTabButton active={tab === 'availability'} onClick={() => setTab('availability')}><CalendarDays /> 希望休</DetailTabButton>
        <DetailTabButton active={tab === 'assignments'} onClick={() => setTab('assignments')}><ClipboardCheck /> 割当</DetailTabButton>
        <DetailTabButton active={tab === 'ratings'} onClick={() => setTab('ratings')}><Star /> 評価</DetailTabButton>
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
        <Panel title="割当履歴" description="日付順に表示し、進行中の割当を完了・キャンセルできます。">
          {assignmentsLoading ? <LoadingState label="割当履歴を読み込み中" /> : null}
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
      setError('表示名を入力してください。')
      return
    }
    if (!Number.isFinite(fee) || fee < 0 || !Number.isFinite(rounds) || rounds < 1) {
      setError('基本費用は0円以上、日次上限は1以上で入力してください。')
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
      setFlash({ tone: 'success', title: 'プロフィールを保存しました', message: `${displayName.trim()}さんの基本情報を更新しました。` })
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
          <DialogTitle>基本情報を編集</DialogTitle>
          <DialogDescription>表示名、スキル、雇用状態、費用と担当上限を更新します。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => void submit(event)}>
          <FormGrid columns={2}>
            <Field label="表示名" required>
              <Input value={displayName} onChange={event => setDisplayName(event.target.value)} className="min-h-10" />
            </Field>
            <Field label="スキル" required>
              <NativeSelect value={skillLevel} onChange={event => setSkillLevel(event.target.value as SkillLevel)}>
                <option value="rookie">新人</option>
                <option value="regular">レギュラー</option>
                <option value="veteran">ベテラン</option>
              </NativeSelect>
            </Field>
            <Field label="雇用状態" required>
              <NativeSelect value={employmentStatus} onChange={event => setEmploymentStatus(event.target.value)}>
                <option value="active">稼働中</option>
                <option value="inactive">休止</option>
                <option value="suspended">停止</option>
              </NativeSelect>
            </Field>
            <Field label="基本費用" required>
              <Input type="number" min={0} value={baseFeeAmount} onChange={event => setBaseFeeAmount(event.target.value)} className="min-h-10" />
            </Field>
            <Field label="通貨" required>
              <Input maxLength={3} value={currency} onChange={event => setCurrency(event.target.value.toUpperCase())} className="min-h-10" />
            </Field>
            <Field label="日次上限" required>
              <Input type="number" min={1} value={maxRounds} onChange={event => setMaxRounds(event.target.value)} className="min-h-10" />
            </Field>
          </FormGrid>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" className="min-h-10" onClick={() => onOpenChange(false)} disabled={busy}>キャンセル</Button>
            <Button type="submit" variant="primary" className="min-h-10" disabled={busy}><CheckCircle2 /> {busy ? '保存中…' : '変更を保存'}</Button>
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
        title: direction === 'in' ? '出勤を記録しました' : '退勤を記録しました',
        message: `${profile.displayName}さんの勤怠を更新しました。`,
      })
    } catch (reason) {
      setFlash({ tone: 'danger', title: '勤怠を更新できませんでした', message: errorMessage(reason) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="スタッフ・勤怠"
      description="Fieldスタッフとの紐付けと今日の打刻を管理します。"
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
                {attendance ? attendanceLabel(attendance.attendanceStatus) : '勤怠未取得'}
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
              <Clock /> 出勤
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-10"
              disabled={busy || attendance?.attendanceStatus !== 'working'}
              onClick={() => void clock('out')}
            >
              退勤
            </Button>
          </div>
          <Button type="button" variant="ghost" className="min-h-10 w-full" onClick={() => setLinkOpen(true)}>
            <Link2 /> 紐付け先を変更
          </Button>
        </div>
      ) : (
        <Notice
          tone="warning"
          title="スタッフが未紐付けです"
          actions={(
            <Button type="button" variant="primary" size="sm" className="min-h-9" onClick={() => setLinkOpen(true)}>
              <Link2 /> 紐付ける
            </Button>
          )}
        >
          勤怠と給与CSVを利用するにはスタッフを選択または新規作成してください。
        </Notice>
      )}
      <StaffLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        profile={profile}
        staff={staff}
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
  onChanged,
  setFlash,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: CaddieProfile
  staff: StaffMember[]
  onChanged: () => void
  setFlash: (flash: Flash) => void
}) {
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
    if (mode === 'existing' && !staffId) {
      setError('スタッフを選択してください。')
      return
    }
    if (mode === 'new' && !newName.trim()) {
      setError('スタッフ名を入力してください。')
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
      setFlash({ tone: 'success', title: 'スタッフを紐付けました', message: `${profile.displayName}さんをスタッフ ${resolved} と連携しました。` })
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
          <DialogTitle>スタッフを紐付け</DialogTitle>
          <DialogDescription>既存スタッフを選ぶか、新しいスタッフを作成します。</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => void submit(event)}>
          <Field label="登録方法" required>
            <NativeSelect value={mode} onChange={event => setMode(event.target.value as 'existing' | 'new')}>
              <option value="existing">既存スタッフ</option>
              <option value="new">新しいスタッフ</option>
            </NativeSelect>
          </Field>
          {mode === 'existing' ? (
            <>
              <Field label="検索">
                <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="名前またはスタッフID" className="min-h-10" />
              </Field>
              <Field label="スタッフ" required>
                <NativeSelect value={staffId} onChange={event => setStaffId(event.target.value)}>
                  <option value="">スタッフを選択</option>
                  {filtered.map(item => <option key={item.id} value={item.id}>{item.name}（{item.id}）</option>)}
                </NativeSelect>
              </Field>
            </>
          ) : (
            <Field label="新しいスタッフ名" required>
              <Input value={newName} onChange={event => setNewName(event.target.value)} className="min-h-10" />
            </Field>
          )}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" className="min-h-10" onClick={() => onOpenChange(false)} disabled={busy}>キャンセル</Button>
            <Button type="submit" variant="primary" className="min-h-10" disabled={busy}><Link2 /> {busy ? '紐付け中…' : '紐付けを保存'}</Button>
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
      setFlash({ tone: 'success', title: '対応コースを保存しました', message: `${selected.size}コースを担当可能として登録しました。` })
    } catch (reason) {
      setFlash({ tone: 'danger', title: '対応コースを保存できませんでした', message: errorMessage(reason) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="対応コース" description="担当可能なコースとメイン拠点を設定します。" actions={<MapPin className="size-5 text-primary" aria-hidden="true" />}>
      {coursesError ? <ResourceError error={coursesError} /> : null}
      {resource.loading && !resource.data ? <LoadingState label="対応コースを読み込み中" /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {!resource.loading && !resource.error && courses.length === 0 ? (
        <EmptyState title="コースが登録されていません" description="先にコースマスタを設定してください。" />
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
                  メイン
                </label>
              ) : null}
            </div>
          )
        })}
      </div>
      {courses.length > 0 ? (
        <Button type="button" variant="primary" className="mt-3 min-h-10 w-full" onClick={() => void save()} disabled={busy}>
          <CheckCircle2 /> {busy ? '保存中…' : '対応コースを保存'}
        </Button>
      ) : null}
    </Panel>
  )
}

const availabilityLabels: Record<AvailabilityStatus, string> = {
  available: '勤務可',
  unavailable: '勤務不可',
  morning_only: '午前のみ',
  afternoon_only: '午後のみ',
  light_duty: '軽勤務',
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
      setFlash({ tone: 'success', title: '勤務希望を保存しました', message: `${selectedDate} の勤務状態を「${availabilityLabels[status]}」に更新しました。` })
    } catch (reason) {
      setFlash({ tone: 'danger', title: '勤務希望を保存できませんでした', message: errorMessage(reason) })
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
      setFlash({ tone: 'success', title: '勤務希望を削除しました', message: `${selectedDate} を通常状態へ戻しました。` })
    } catch (reason) {
      setFlash({ tone: 'danger', title: '勤務希望を削除できませんでした', message: errorMessage(reason) })
    } finally {
      setBusy(false)
    }
  }

  const cells = calendarCells(bounds.year, bounds.month)

  return (
    <Panel
      title="希望休・体調カレンダー"
      description="日別の勤務可否、2ラウンド希望、体調メモを管理します。"
      actions={(
        <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1">
          <Button type="button" variant="ghost" size="icon" className="min-h-9 min-w-9" aria-label="前月" onClick={() => setYearMonth(value => shiftMonth(value, -1))}><ChevronLeft /></Button>
          <span className="min-w-24 text-center text-sm font-medium">{bounds.year}年{bounds.month}月</span>
          <Button type="button" variant="ghost" size="icon" className="min-h-9 min-w-9" aria-label="翌月" onClick={() => setYearMonth(value => shiftMonth(value, 1))}><ChevronRight /></Button>
        </div>
      )}
    >
      {resource.loading && !resource.data ? <LoadingState label="勤務希望を読み込み中" /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {!resource.loading && !resource.error ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <div className="min-w-[320px]">
              <div className="grid grid-cols-7 border-b border-border bg-surface text-center text-xs font-medium text-muted-foreground">
                {['日', '月', '火', '水', '木', '金', '土'].map(day => <div key={day} className="py-2">{day}</div>)}
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
                          {availabilityLabels[record.status]}
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
                  <p className="text-xs text-muted-foreground">勤務希望を編集</p>
                </div>
                <Field label="勤務状態" required>
                  <NativeSelect value={status} onChange={event => setStatus(event.target.value as AvailabilityStatus)}>
                    {Object.entries(availabilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </NativeSelect>
                </Field>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3">
                  <input type="checkbox" checked={twoRounds} onChange={event => setTwoRounds(event.target.checked)} className="size-5 accent-primary" />
                  <span className="text-sm font-medium">2ラウンド希望</span>
                </label>
                <Field label="体調メモ">
                  <NativeTextarea rows={4} maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="運用担当者向けのメモ" />
                </Field>
                <Button type="button" variant="primary" className="min-h-10 w-full" disabled={busy} onClick={() => void save()}><CheckCircle2 /> {busy ? '保存中…' : '保存'}</Button>
                {selectedRecord ? (
                  <Button type="button" variant="ghost" className="min-h-10 w-full text-destructive" disabled={busy} onClick={() => void remove()}><XCircle /> 登録を削除</Button>
                ) : null}
              </div>
            ) : (
              <EmptyState title="日付を選択" description="カレンダーの日付を選ぶと勤務希望を登録できます。" />
            )}
          </div>
        </div>
      ) : null}
    </Panel>
  )
}

function RatingsPanel({ resource }: { resource: ResourceValue<ListResponse<CaddieRating>> }) {
  const ratings = resource.data?.items ?? []
  const average = ratings.length
    ? ratings.reduce((total, rating) => total + rating.score, 0) / ratings.length
    : null
  const columns: DataTableColumn<CaddieRating>[] = [
    {
      key: 'score',
      header: '評価',
      mobileLabel: '評価',
      cell: row => (
        <div className="flex items-center gap-1 text-warning">
          {Array.from({ length: 5 }, (_, index) => <Star key={index} className={`size-4 ${index < row.score ? 'fill-current' : ''}`} />)}
          <span className="ml-1 font-medium text-foreground">{row.score}</span>
        </div>
      ),
    },
    { key: 'comment', header: 'コメント', mobileLabel: 'コメント', cell: row => row.comment || '—' },
    { key: 'customer', header: '顧客', mobileLabel: '顧客', cell: row => <span className="break-all">{row.customerId}</span> },
    { key: 'created', header: '日時', mobileLabel: '日時', cell: row => formatDateTime(row.createdAt) },
  ]
  return (
    <Panel
      title="顧客評価"
      description="接客品質の評価とコメントを確認します。"
      actions={<Badge variant={average === null ? 'neutral' : 'warning'}><Star className="fill-current" /> {average?.toFixed(1) ?? '—'} / {ratings.length}件</Badge>}
    >
      {resource.loading && !resource.data ? <LoadingState label="評価を読み込み中" /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {resource.data ? (
        <DataTable rows={ratings} columns={columns} rowKey={row => row.id} empty={<EmptyState title="評価はまだありません" description="プレー後の顧客評価がここに表示されます。" />} />
      ) : null}
    </Panel>
  )
}

function PayrollView({ setFlash }: { setFlash: (flash: Flash) => void }) {
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
      setFlash({ tone: 'success', title: '給与CSVをダウンロードしました', message: `${yearMonth} の集計を出力しました。` })
    } catch (reason) {
      setFlash({ tone: 'danger', title: '給与CSVを出力できませんでした', message: errorMessage(reason) })
    } finally {
      setDownloading(false)
    }
  }

  const columns: DataTableColumn<PayrollRow>[] = [
    {
      key: 'caddie',
      header: 'キャディ',
      mobileLabel: 'キャディ',
      cell: row => (
        <div>
          <p className="font-medium">{row.displayName}</p>
          <p className="text-xs text-muted-foreground">{row.staffId ?? 'スタッフ未連携'}</p>
        </div>
      ),
    },
    { key: 'worked', header: '実働', mobileLabel: '実働', cell: row => formatMinutes(row.workedMinutes) },
    { key: 'shifted', header: 'シフト', mobileLabel: 'シフト', cell: row => formatMinutes(row.shiftedMinutes) },
    { key: 'rounds', header: '担当', mobileLabel: '担当', align: 'right', cell: row => `${row.assignedRounds}R` },
    { key: 'fees', header: '確定費用', mobileLabel: '確定費用', align: 'right', cell: row => formatMoney(row.confirmedFeeTotal, row.currency) },
    {
      key: 'warning',
      header: '確認',
      mobileLabel: '確認',
      cell: row => row.openClockIn || row.roundsWithoutClockIn > 0 ? (
        <Badge variant="warning">{row.openClockIn ? '退勤未記録' : `未出勤 ${row.roundsWithoutClockIn}R`}</Badge>
      ) : <Badge variant="success">確認済み</Badge>,
    },
  ]

  return (
    <div className="space-y-4">
      <Panel
        title="給与連携"
        description="勤怠と確定済みキャディ費用を月次で照合し、給与CSVへ渡します。"
        actions={(
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Input type="month" value={yearMonth} onChange={event => setYearMonth(event.target.value)} className="min-h-10 sm:w-40" aria-label="給与対象月" />
            <Button type="button" variant="primary" className="min-h-10" disabled={downloading || !resource.data} onClick={() => void downloadCsv()}>
              <Download /> {downloading ? '出力中…' : 'CSVを出力'}
            </Button>
          </div>
        )}
      >
        {resource.loading ? <LoadingState label="給与集計を読み込み中" /> : null}
        {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
        {resource.data ? (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              集計期間 {resource.data.period.startDate} 〜 {resource.data.period.endDate}
            </p>
            <MetricGrid>
              <Metric label="実働合計" value={formatMinutes(totals.workedMinutes)} detail={`${rows.length}人`} />
              <Metric label="担当ラウンド" value={`${totals.rounds}R`} detail="対象期間の割当" />
              <Metric label="確定費用" value={formatMoney(totals.fees)} detail="給与連携対象" />
              <Metric label="要確認" value={`${totals.warnings}件`} detail="退勤・出勤照合" tone={totals.warnings > 0 ? 'warning' : 'success'} />
            </MetricGrid>
          </div>
        ) : null}
      </Panel>

      <Panel
        title="キャディ別集計"
        description="未紐付け、退勤未記録、割当に対する未出勤をCSV出力前に確認してください。"
        actions={(
          <Button type="button" variant="secondary" size="sm" className="min-h-9" onClick={resource.refresh} title="⌘R">
            <RefreshCw /> 更新
          </Button>
        )}
      >
        {resource.data ? (
          <DataTable rows={rows} columns={columns} rowKey={row => row.caddieProfileId} empty={<EmptyState title="この月の給与データはありません" description="勤務または割当が確定すると集計されます。" />} />
        ) : null}
      </Panel>
    </div>
  )
}

export default CaddiesPage

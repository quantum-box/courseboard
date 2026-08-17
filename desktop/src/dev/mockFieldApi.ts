/**
 * Development auth (`VITE_COURSEBOARD_AUTH_MODE=development`) only stubs the
 * session. Feature screens still call Field API through the Vite proxy, which
 * fails or returns an empty DB unless a local Rust API is running with seed.
 *
 * When mock data is enabled, `fieldApiJson` / `fieldApiText` and CourseBoard
 * `courseboardApiJson` / `courseboardApiText` paths under `/v1/course/*`
 * short-circuit to in-memory fixtures so the UI stays browsable with the mock user.
 *
 * Enable: default ON while AUTH_MODE=development
 * Disable for a real local API: VITE_COURSEBOARD_MOCK_DATA=false
 */
import {
  generateAssignments,
  generateCaddies,
  generateReservations,
  shiftDate,
} from './mockVolume'

export function isMockFieldDataEnabled() {
  if (import.meta.env.VITE_COURSEBOARD_AUTH_MODE !== 'development') return false
  const flag = import.meta.env.VITE_COURSEBOARD_MOCK_DATA
  return flag !== 'false' && flag !== '0'
}

export type MockFieldResult<T> =
  | { kind: 'disabled' }
  | { kind: 'hit'; data: T }
  | { kind: 'error'; status: number; message: string }

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null

function hit<T>(data: T): MockFieldResult<T> {
  return { kind: 'hit', data }
}

function error(status: number, message: string): MockFieldResult<never> {
  return { kind: 'error', status, message }
}

const TENANT_ID = () =>
  import.meta.env.VITE_COURSEBOARD_TENANT_ID
  ?? (import.meta.env.DEV ? 'courseboard_id' : '')

/**
 * The day the fixtures below are written for. Exported because the demo
 * affordance in the timeline has to send the operator to this day; a second
 * copy of the date in the page drifts the moment these fixtures move.
 */
export const MOCK_FIXTURE_DATE = '2026-07-18'

const NOW = `${MOCK_FIXTURE_DATE}T09:00:00+09:00`
const TODAY = MOCK_FIXTURE_DATE

/** `YYYY-MM-DD`, `days` after the fixture day. */
function daysAfterFixture(days: number): string {
  return shiftDate(MOCK_FIXTURE_DATE, days)
}

/**
 * The club beyond the hand-written few: a full roster, a month of tee sheets,
 * and the assignments already made. See `mockVolume.ts` for why.
 */
const generatedRoster = generateCaddies()

let mockReservationPolicy: Record<string, unknown> = {
  tenantId: 'courseboard_id',
  reservationTypeId: 'golf_standard',
  defaultHoles: 18,
  maxPlayersPerTeeTime: 4,
  cartPolicy: 'optional',
  memberDepositBps: 2000,
  guestDepositBps: 3000,
  cutoffHours: 48,
  policyHooksJson: {
    selfLock: {
      enabled: true,
      windows: [{ weekdays: ['sat', 'sun'], start: '06:00', end: '10:00' }],
    },
    spendJudgment: {
      enabled: true,
      minPerPlayer: 12000,
      action: 'review',
    },
  },
  metadataJson: {},
  updatedAt: NOW,
}

const mockCourses = [
  {
    id: 'course_east',
    name: '東コース',
    shortName: '東',
    holeCount: 18,
    timezone: 'Asia/Tokyo',
    businessHoursJson: { open: '07:00', close: '17:00' },
    startIntervalMinutes: 8,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'course_west',
    name: '西コース',
    shortName: '西',
    holeCount: 18,
    timezone: 'Asia/Tokyo',
    businessHoursJson: { open: '07:00', close: '17:00' },
    startIntervalMinutes: 10,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'course_hill',
    name: '羊ケ丘コース',
    shortName: '羊ケ丘',
    holeCount: 18,
    timezone: 'Asia/Tokyo',
    businessHoursJson: { open: '07:00', close: '17:00' },
    startIntervalMinutes: 10,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
]

/** The club's own bookings for the month around the fixture day. */
const generatedReservations = generateReservations(MOCK_FIXTURE_DATE, mockCourses)

type MockReservationReportEntry = {
  id: string
  sourceCourseKey: string
  sourceCourseName: string
  golfCourseId: string
  date: string
  dayPart: 'morning' | 'afternoon'
  groupCount: number
  caddieAttachedGroupCount: number
  sourceFileSha256: string
  updatedAt: string
}

const MOCK_RESERVATION_REPORT_SOURCE = 'daily_reservation_status_xlsx'
const MOCK_RESERVATION_REPORT_FACILITIES = [
  { sourceCourseKey: '真駒内', sourceCourseName: '真駒内\n36H' },
  { sourceCourseKey: '滝の', sourceCourseName: '滝の\n27H' },
  { sourceCourseKey: '羊ケ丘', sourceCourseName: '羊ケ丘\n18H' },
] as const

function mockReservationReportRows(year: number) {
  const rows: Array<{
    sourceCourseKey: string
    sourceCourseName: string
    date: string
    dayPart: 'morning' | 'afternoon'
    groupCount: number
    caddieAttachedGroupCount: number
  }> = []
  let index = 0
  for (let day = 1; day <= 31; day += 1) {
    const date = `${year}-07-${String(day).padStart(2, '0')}`
    for (const facility of MOCK_RESERVATION_REPORT_FACILITIES) {
      for (const dayPart of ['morning', 'afternoon'] as const) {
        // Keep the mock totals stable for UI and idempotency checks: 186 rows,
        // 6,314 groups, and 2,476 caddie-attached groups.
        rows.push({
          ...facility,
          date,
          dayPart,
          groupCount: 34 - (index < 10 ? 1 : 0),
          caddieAttachedGroupCount: 13 + (index < 58 ? 1 : 0),
        })
        index += 1
      }
    }
  }
  return rows
}

// Initialized after the shared sessionStorage helper below. Keeping the read
// below that helper also lets Vite hot reload restore imported rows instead of
// falling back while the storage-key constant is still in its temporal dead zone.
let mockReservationReportEntries: MockReservationReportEntry[] = []

function productCourseIds(product: { golfCourseIds?: string[] | null; golfCourseId: string | null }) {
  if (product.golfCourseIds) return product.golfCourseIds
  return product.golfCourseId ? [product.golfCourseId] : []
}

const mockProducts: Array<{
  id: string
  tenantId: string
  extensionKey: string
  reservationServiceId: string
  displayName: string | null
  /** Courses the plan is sold on; the scalar below is its one-course alias. */
  golfCourseIds?: string[] | null
  golfCourseId: string | null
  playType: string
  holeCount: number
  expectedDurationMinutes: number
  createdAt: string
  updatedAt: string
}> = [
  {
    id: 'product_caddie_18',
    tenantId: 'courseboard_id',
    extensionKey: 'golf_course',
    reservationServiceId: 'svc:caddie-18',
    displayName: 'キャディ付き18ホール',
    golfCourseId: 'course_east',
    playType: 'caddie',
    holeCount: 18,
    expectedDurationMinutes: 270,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'product_caddie_east_pm',
    tenantId: 'courseboard_id',
    extensionKey: 'golf_course',
    reservationServiceId: 'svc:caddie-18-pm',
    displayName: '東 午後スループレー',
    golfCourseId: 'course_east',
    playType: 'caddie',
    holeCount: 18,
    expectedDurationMinutes: 240,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'product_self_18',
    tenantId: 'courseboard_id',
    extensionKey: 'golf_course',
    reservationServiceId: 'svc:self-18',
    displayName: null,
    golfCourseId: null,
    playType: 'self',
    holeCount: 18,
    expectedDurationMinutes: 240,
    createdAt: NOW,
    updatedAt: NOW,
  },
]

/**
 * How far ahead the club sells, as the golf extension config would hold it.
 *
 * The real value lives in the tenant config and is read by the API; the fixture
 * keeps it here so saving a week can answer with the date it opened the book to.
 * Either a rolling day count or a named closing date, the same two shapes the
 * config stores.
 */
let mockBookingHorizon: { mode: 'days'; days: number } | { mode: 'through'; through: string } = {
  mode: 'days',
  days: 180,
}

/** One start per interval across every band whose weekday falls in the range. */
function mockGeneratedStarts(courseId: string, fromIso: string, toIso: string) {
  const rules = mockSchedulesByCourse[courseId] ?? []
  const from = new Date(fromIso)
  const to = new Date(toIso)
  const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000)) + 1
  let created = 0
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(from.getTime() + offset * 86_400_000)
    const weekday = day.getUTCDay()
    rules
      .filter(rule => rule.weekday === weekday)
      .forEach(rule => {
        const [startHour, startMinute] = rule.startTime.split(':').map(Number)
        const [endHour, endMinute] = rule.endTime.split(':').map(Number)
        const span = (endHour * 60 + endMinute) - (startHour * 60 + startMinute)
        if (span > 0 && rule.slotIntervalMinutes > 0) {
          created += Math.floor(span / rule.slotIntervalMinutes) + 1
        }
      })
  }
  return created
}

function mockBookableThrough(horizon = mockBookingHorizon) {
  if (horizon.mode === 'through') return horizon.through
  const through = new Date(`${TODAY}T00:00:00Z`)
  through.setUTCDate(through.getUTCDate() + horizon.days)
  return through.toISOString().slice(0, 10)
}

function mockHorizonResponse(horizon = mockBookingHorizon) {
  return {
    mode: horizon.mode,
    days: horizon.mode === 'days' ? horizon.days : null,
    through: horizon.mode === 'through' ? horizon.through : null,
    bookableThrough: mockBookableThrough(horizon),
  }
}

const mockSchedulesByCourse: Record<string, Array<{
  id: string
  weekday: number
  startTime: string
  endTime: string
  capacity: number
  slotIntervalMinutes: number
}>> = {
  course_east: [
    { id: 'rule_east_mon_am', weekday: 1, startTime: '07:00', endTime: '12:00', capacity: 1, slotIntervalMinutes: 8 },
    { id: 'rule_east_mon_pm', weekday: 1, startTime: '12:00', endTime: '15:00', capacity: 1, slotIntervalMinutes: 8 },
  ],
  course_west: [],
}

const mockSlotsByService: Record<string, Array<{
  id: string
  golfReservationProductId: string
  weekday: number
  startTime: string
  endTime: string
  maxGroups: number
  maxPlayers: number
}>> = {
  'svc:caddie-18': [
    {
      id: 'slot_caddie_weekday',
      golfReservationProductId: 'product_caddie_18',
      weekday: 1,
      startTime: '07:30',
      endTime: '14:00',
      maxGroups: 4,
      maxPlayers: 16,
    },
  ],
  'svc:caddie-18-pm': [
    {
      id: 'slot_caddie_east_pm',
      golfReservationProductId: 'product_caddie_east_pm',
      weekday: 4,
      startTime: '12:00',
      endTime: '15:00',
      maxGroups: 2,
      maxPlayers: 8,
    },
  ],
  'svc:self-18': [
    {
      id: 'slot_self_weekday',
      golfReservationProductId: 'product_self_18',
      weekday: 1,
      startTime: '07:00',
      endTime: '15:00',
      maxGroups: 6,
      maxPlayers: 24,
    },
  ],
}

const mockCaddies = [
  {
    id: 'caddie_aya',
    displayName: '佐藤 彩',
    staffId: 'staff_aya',
    staffReferenceType: 'erp_staff',
    staffReferenceId: 'staff_aya',
    active: true,
    skillLevel: 'veteran',
    rank: 'A',
    monthlyContractRounds: 20,
    canTwoRounds: true,
    desiredIncome: 280000,
    employmentStatus: 'active',
    baseFeeAmount: 0,
    currency: 'JPY',
    maxRoundsPerDay: 2,
    ratingAverage: 4.8,
    ratingCount: 42,
  },
  {
    id: 'caddie_ken',
    displayName: '渡辺 健',
    staffId: 'staff_ken',
    staffReferenceType: 'erp_staff',
    staffReferenceId: 'staff_ken',
    active: true,
    skillLevel: 'regular',
    rank: 'B',
    monthlyContractRounds: 16,
    canTwoRounds: false,
    desiredIncome: 220000,
    employmentStatus: 'active',
    baseFeeAmount: 0,
    currency: 'JPY',
    maxRoundsPerDay: 1,
    ratingAverage: 4.4,
    ratingCount: 18,
  },
  {
    id: 'caddie_mika',
    displayName: '田中 美香',
    staffId: 'staff_mika',
    staffReferenceType: 'erp_staff',
    staffReferenceId: 'staff_mika',
    active: true,
    skillLevel: 'veteran',
    rank: 'A',
    monthlyContractRounds: 18,
    canTwoRounds: true,
    desiredIncome: 260000,
    employmentStatus: 'active',
    baseFeeAmount: 11500,
    currency: 'JPY',
    maxRoundsPerDay: 2,
    ratingAverage: 4.7,
    ratingCount: 31,
  },
  {
    id: 'caddie_hiro',
    displayName: '中村 浩',
    staffId: 'staff_hiro',
    staffReferenceType: 'erp_staff',
    staffReferenceId: 'staff_hiro',
    active: true,
    skillLevel: 'regular',
    rank: 'B',
    monthlyContractRounds: 14,
    canTwoRounds: true,
    desiredIncome: 210000,
    employmentStatus: 'active',
    baseFeeAmount: 0,
    currency: 'JPY',
    maxRoundsPerDay: 2,
    ratingAverage: 4.2,
    ratingCount: 12,
  },
  {
    id: 'caddie_yuki',
    displayName: '伊藤 優希',
    staffId: 'staff_yuki',
    staffReferenceType: 'erp_staff',
    staffReferenceId: 'staff_yuki',
    active: true,
    skillLevel: 'junior',
    rank: 'C',
    monthlyContractRounds: 12,
    canTwoRounds: false,
    desiredIncome: 180000,
    employmentStatus: 'active',
    baseFeeAmount: 0,
    currency: 'JPY',
    maxRoundsPerDay: 1,
    ratingAverage: 4.0,
    ratingCount: 6,
  },
  // The rest of the club. The five above each stand for a situation worth
  // looking at; these are the volume a real board carries.
  ...generatedRoster.caddies,
]

type MockStaffMember = {
  id: string
  name: string
  active: boolean
  employmentStatus: string
  employmentType: string
  hiredAt?: string | null
  contractEndDate?: string | null
  phone?: string | null
  email?: string | null
  attributesJson?: unknown
}

/**
 * The status Field would store, given what a request named.
 *
 * `employmentStatus` outranks `active` upstream, so a request naming both is
 * resolved the same way here — otherwise a client that still sends the flag
 * would look correct against the mock and retire people against Field.
 */
function mockEmploymentStatus(status: unknown, active: unknown) {
  if (status != null) {
    const folded = String(status).trim().toLowerCase()
    if (folded === 'on_leave' || folded === 'leave' || folded === 'suspended') return 'on_leave'
    if (folded === 'retired' || folded === 'resigned' || folded === 'inactive') return 'retired'
    return 'active'
  }
  return active === false ? 'retired' : 'active'
}

/** The whole payroll, not just the caddies: the roster screen shows both. */
const mockStaff: MockStaffMember[] = [
  {
    id: 'staff_aya',
    name: '佐藤 彩',
    active: true,
    employmentType: 'part_time',
    hiredAt: '2024-04-01',
    phone: '011-000-0000',
    attributesJson: { payrollCode: 'A-17' },
  },
  { id: 'staff_ken', name: '渡辺 健', active: true, employmentType: 'part_time' },
  { id: 'staff_mika', name: '田中 美香', active: true, employmentType: 'part_time' },
  { id: 'staff_hiro', name: '中村 浩', active: true, employmentType: 'part_time' },
  { id: 'staff_yuki', name: '伊藤 優希', active: true, employmentType: 'part_time' },
  { id: 'staff_kitchen', name: '小林 大輔', active: true, employmentType: 'full_time' },
  { id: 'staff_front', name: '松本 里奈', active: true, employmentType: 'full_time' },
  { id: 'staff_green', name: '吉田 誠', active: true, employmentType: 'full_time' },
  // One of each standing, so the roster's filter has something to separate.
  {
    id: 'staff_leave',
    name: '小川 早苗',
    employmentStatus: 'on_leave',
    employmentType: 'full_time',
  },
  { id: 'staff_retired', name: '高橋 一', active: false, employmentType: 'part_time' },
  ...generatedRoster.staff,
].map(member => {
  const record = member as Partial<MockStaffMember> & { id: string; name: string }
  // Field derives `active` from the status, so the fixtures cannot disagree
  // about somebody the way two hand-written fields would.
  const employmentStatus = mockEmploymentStatus(record.employmentStatus, record.active)
  return {
    hiredAt: null,
    contractEndDate: null,
    phone: null,
    email: null,
    attributesJson: null,
    ...record,
    employmentType: record.employmentType ?? 'part_time',
    employmentStatus,
    active: employmentStatus === 'active',
  } satisfies MockStaffMember
})

/** Tenant members mirroring the Field IAM surface `GET /v1/field/iam/users`. */
const mockIamCustomPolicies = [
  // The basic roles are part of the catalogue now, not constants the client
  // holds. The retired names below are still visible upstream, so the fixture
  // carries one to exercise the screen leaving it out of the checklist.
  { id: 'pol_role_administrator', name: 'field:administrator', description: 'テナント全体の管理' },
  { id: 'pol_role_operator', name: 'field:operator', description: '日々の業務操作' },
  { id: 'pol_role_reader', name: 'field:reader', description: '閲覧のみ' },
  { id: 'pol_retired_staff', name: 'field:staff', description: '旧スタッフ（廃止）' },
  { id: 'pol_caddie_viewer', name: 'キャディ管理閲覧者', description: '名簿・配置・勤怠・給与の閲覧' },
  { id: 'pol_caddie_admin', name: 'キャディ管理管理者', description: '名簿・配置・勤怠・給与の作成・更新' },
  { id: 'pol_billing_viewer', name: '経理閲覧者', description: '予算・精算・キャンセル料の閲覧' },
  { id: 'pol_billing_admin', name: '経理管理者', description: '予算・精算・キャンセル料の作成・更新' },
]

const mockIamMembers: Array<{
  id: string
  email: string | null
  name: string | null
  role: string | null
  isOwner: boolean
  customPolicyIds: string[]
  tenants: string[]
}> = [
  {
    id: 'local-operator',
    name: 'Local operator',
    email: 'operator@example.com',
    role: null,
    isOwner: true,
    customPolicyIds: [],
    tenants: ['courseboard_id'],
  },
  {
    id: 'user_front_manager',
    name: '高橋 誠',
    email: 'makoto@example.com',
    role: 'field:administrator',
    isOwner: false,
    customPolicyIds: ['pol_billing_admin'],
    tenants: ['courseboard_id'],
  },
  {
    id: 'user_front_staff',
    name: '鈴木 里奈',
    email: 'rina@example.com',
    role: 'field:operator',
    isOwner: false,
    customPolicyIds: ['pol_caddie_viewer', 'pol_billing_viewer'],
    tenants: ['courseboard_id'],
  },
  {
    id: 'user_viewer',
    name: '木村 大地',
    email: 'daichi@example.com',
    role: 'field:reader',
    isOwner: false,
    customPolicyIds: [],
    tenants: ['courseboard_id'],
  },
]

const IAM_ROLE_BY_REQUEST: Record<string, string> = {
  admin: 'field:administrator',
  staff: 'field:operator',
  viewer: 'field:reader',
}

/** Keyed by catalogue id, the way the real API resolves a role now. */
const IAM_ROLE_BY_POLICY_ID: Record<string, string> = {
  pol_role_administrator: 'field:administrator',
  pol_role_operator: 'field:operator',
  pol_role_reader: 'field:reader',
}

/** Split a flat policy list into (role, customPolicyIds) like the Field API. */
function splitMockPolicyIds(policyIds: string[]): { role: string | null; customPolicyIds: string[] } | { error: string } {
  let role: string | null = null
  const customPolicyIds: string[] = []
  for (const policyId of policyIds) {
    const mapped = IAM_ROLE_BY_POLICY_ID[policyId]
    if (mapped) {
      if (role && role !== mapped) return { error: 'at most one role policy can be attached' }
      role = mapped
    } else if (mockIamCustomPolicies.some(policy => policy.id === policyId)) {
      if (!customPolicyIds.includes(policyId)) customPolicyIds.push(policyId)
    } else {
      return { error: `custom policies are not available for this Field tenant: ${policyId}` }
    }
  }
  return { role, customPolicyIds }
}


/**
 * Writes the ledger makes, kept across reloads.
 *
 * Fixtures are in-memory, which is right for read-only ones: the day always
 * starts the same. Writes are different — a demo where arranging the board and
 * reloading loses the arrangement teaches that the feature does not persist,
 * which is the opposite of what the API does. sessionStorage, so a new tab is
 * still a clean day.
 */
const MOCK_WRITE_STORAGE_KEY = 'courseboard.mock.ledgerWrites'

function loadMockWrites<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(`${MOCK_WRITE_STORAGE_KEY}.${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function saveMockWrites(key: string, value: unknown) {
  try {
    sessionStorage.setItem(`${MOCK_WRITE_STORAGE_KEY}.${key}`, JSON.stringify(value))
  } catch {
    // ignore storage failures
  }
}

mockReservationReportEntries = loadMockWrites('reservationReportEntries', [])

/** The club's column order, as arranged during the session. */
const mockCourseOrder: string[] = loadMockWrites<string[]>('courseOrder', [])

/** What one round pays at each rank, as the payroll screen sets it. */
const mockRankFees = loadMockWrites<{
  a: number
  b: number
  c: number
  d: number
  currency: string
}>('caddieRankFees', { a: 12_000, b: 11_000, c: 10_000, d: 9_000, currency: 'JPY' })

/**
 * The same arithmetic the API does: a caddie's own fee wins when they have one,
 * otherwise their rank decides, and the month is that times the rounds worked.
 */
function payrollRow(profile: (typeof mockCaddies)[number]) {
  const rank = profile.rank as 'A' | 'B' | 'C' | 'D'
  const rankFee = mockRankFees[rank.toLowerCase() as 'a' | 'b' | 'c' | 'd']
  const feeOverridden = profile.baseFeeAmount > 0
  const roundFee = feeOverridden ? profile.baseFeeAmount : rankFee
  const assignedRounds = profile.id === 'caddie_aya' ? 12 : 8
  return {
    caddieProfileId: profile.id,
    displayName: profile.displayName,
    staffId: profile.staffId,
    workedMinutes: profile.id === 'caddie_aya' ? 2_400 : 1_600,
    shiftedMinutes: profile.id === 'caddie_aya' ? 2_520 : 1_680,
    assignedRounds,
    rank,
    roundFee,
    feeOverridden,
    feeTotal: roundFee * assignedRounds,
    roundsWithoutClockIn: 0,
    openClockIn: false,
    currency: mockRankFees.currency,
  }
}


/** Desk marks the mock day starts with, and anything written during the session. */
const mockSlotMarks: Array<{
  golfCourseId: string
  date: string
  teeTime: string
  kind: 'closed' | 'special_rate'
  label?: string
  note?: string
}> = loadMockWrites('slotMarks', [
  { golfCourseId: 'course_east', date: TODAY, teeTime: '07:24', kind: 'special_rate', label: '特別料金' },
  { golfCourseId: 'course_east', date: TODAY, teeTime: '07:32', kind: 'closed', label: '売り止め' },
])

/** Shift-request filing deadline per `YYYY-MM`, and anything set during the session. */
const mockAvailabilityDeadlines: Record<string, string> = loadMockWrites('availabilityDeadlines', {})

/** Group detail entered during the session, by reservation id. */
const mockParties: Record<string, unknown> = loadMockWrites('parties', {})

/** Plans moved onto a booking this session, by reservation id. */
const mockPlans: Record<string, string> = loadMockWrites('plans', {})

/** Callers and headcounts corrected this session, by reservation id. */
const mockBookings: Record<string, { partyName: string; partySize: number }> = loadMockWrites(
  'bookings',
  {},
)

/**
 * A booking with the group detail entered this session laid over its fixture.
 *
 * Applied at read time rather than mutated into the fixture, so a reload starts
 * from the same day and still shows what was typed into it.
 */
function withStoredParty(booking: MockTeeReservation): Omit<MockTeeReservation, 'prepaymentPolicy'> {
  const party = mockParties[booking.id]
  // The real tee-sheet DTO does not expose Field's checkout policy.
  const { prepaymentPolicy: _prepaymentPolicy, ...publicBooking } = booking
  return party ? { ...publicBooking, party: party as Record<string, unknown> } : publicBooking
}

/** The tee times a course's opening hours and interval imply. */
function mockSlotTimes(course: { businessHoursJson: { open: string; close: string }; startIntervalMinutes: number }) {
  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
  const times: string[] = []
  const end = toMinutes(course.businessHoursJson.close)
  for (
    let cursor = toMinutes(course.businessHoursJson.open);
    cursor < end;
    cursor += course.startIntervalMinutes
  ) {
    times.push(
      `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`,
    )
  }
  return times
}

function isMockDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isMockTeeTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60)
}

/** Generated mock inventory counts groups, like Field's resource time slots. */
const MOCK_SLOT_CAPACITY = 2

/** Canonical Field inventory id exposed on a CourseBoard ledger column. */
function mockReservationResourceId(golfCourseId: string) {
  return `res_${golfCourseId.replace(/^course_/, '')}`
}

type MockTeeReservation = {
  id: string
  reservationNumber: string
  reservationServiceId: string | null
  displayName: string | null
  golfCourseId: string
  courseName: string
  teeTime: string
  durationMinutes: number
  playType: 'caddie' | 'self'
  partySize: number
  partyName: string
  status: string
  holes: number
  notes?: string
  party?: Record<string, unknown>
  /** CourseBoard sends this to Field for a desk booking; it is not a public tee-sheet field. */
  prepaymentPolicy?: 'none'
}

/** Day board fixtures for the operations timeline (tee sheet + caddy lanes). */
const initialMockTeeReservations = [
  {
    id: 'res_mock_1',
    reservationNumber: 'R-2026-0100',
    golfCourseId: 'course_east',
    courseName: '東コース',
    teeTime: `${TODAY}T07:00:00+09:00`,
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 4,
    partyName: '山田組',
    status: 'on_course',
    holes: 18,
    notes: 'VIP会員',
    party: {
      competitionName: '山田会',
      organizer: '山田 太郎',
      groupNumber: 1,
      players: [
        { name: '山田 太郎', tag: '共通' },
        { name: '增田 公陽', tag: '共通' },
        { name: '木澤 岳志', tag: '優待' },
        { name: '谷川 南海' },
      ],
    },
  },
  {
    id: 'res_mock_2',
    reservationNumber: 'R-2026-0101',
    golfCourseId: 'course_east',
    courseName: '東コース',
    teeTime: `${TODAY}T07:08:00+09:00`,
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 3,
    partyName: '鈴木組',
    status: 'checked_in',
    holes: 18,
    party: {
      competitionName: '山田会',
      groupNumber: 2,
      players: [{ name: '鈴木 一郎', tag: '共通' }],
    },
  },
  {
    id: 'res_mock_3',
    reservationNumber: 'R-2026-0102',
    golfCourseId: 'course_east',
    courseName: '東コース',
    teeTime: `${TODAY}T07:16:00+09:00`,
    durationMinutes: 240,
    playType: 'self',
    partySize: 4,
    partyName: '当日受付',
    status: 'confirmed',
    holes: 18,
  },
  {
    id: 'res_mock_4',
    reservationNumber: 'R-2026-0103',
    golfCourseId: 'course_east',
    courseName: '東コース',
    teeTime: `${TODAY}T08:00:00+09:00`,
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 4,
    partyName: '高橋組',
    status: 'confirmed',
    holes: 18,
  },
  {
    id: 'res_mock_5',
    reservationNumber: 'R-2026-0104',
    golfCourseId: 'course_east',
    courseName: '東コース',
    teeTime: `${TODAY}T08:08:00+09:00`,
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 2,
    partyName: '法人A',
    status: 'confirmed',
    holes: 18,
  },
  {
    id: 'res_mock_6',
    reservationNumber: 'R-2026-0105',
    golfCourseId: 'course_west',
    courseName: '西コース',
    teeTime: `${TODAY}T07:30:00+09:00`,
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 4,
    partyName: '木村組',
    status: 'on_course',
    holes: 18,
  },
  {
    id: 'res_mock_7',
    reservationNumber: 'R-2026-0106',
    golfCourseId: 'course_west',
    courseName: '西コース',
    teeTime: `${TODAY}T08:30:00+09:00`,
    durationMinutes: 240,
    playType: 'self',
    partySize: 3,
    partyName: 'Web予約',
    status: 'confirmed',
    holes: 18,
  },
  {
    id: 'res_mock_8',
    reservationNumber: 'R-2026-0107',
    golfCourseId: 'course_west',
    courseName: '西コース',
    teeTime: `${TODAY}T09:30:00+09:00`,
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 4,
    partyName: '中村組',
    status: 'confirmed',
    holes: 18,
  },
  {
    id: 'res_mock_9',
    reservationNumber: 'R-2026-0108',
    golfCourseId: 'course_east',
    courseName: '東コース',
    teeTime: `${TODAY}T10:00:00+09:00`,
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 4,
    partyName: '午後クラブ',
    status: 'confirmed',
    holes: 18,
    notes: 'ベテランキャディ希望',
  },
  {
    id: 'res_mock_10',
    reservationNumber: 'R-2026-0109',
    golfCourseId: 'course_east',
    courseName: '東コース',
    teeTime: `${TODAY}T11:00:00+09:00`,
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 3,
    partyName: 'レディース',
    status: 'confirmed',
    holes: 18,
  },
  {
    id: 'res_mock_11',
    reservationNumber: 'R-2026-0110',
    golfCourseId: 'course_west',
    courseName: '西コース',
    teeTime: `${TODAY}T13:00:00+09:00`,
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 4,
    partyName: '午後会員',
    status: 'confirmed',
    holes: 18,
  },
  {
    id: 'res_mock_12',
    reservationNumber: 'R-2026-0111',
    golfCourseId: 'course_east',
    courseName: '東コース',
    teeTime: `${TODAY}T14:00:00+09:00`,
    durationMinutes: 240,
    playType: 'self',
    partySize: 4,
    partyName: 'トワイライト',
    status: 'confirmed',
    holes: 18,
  },
  {
    id: 'res_mock_13',
    reservationNumber: 'R-2026-0112',
    golfCourseId: 'course_east',
    courseName: '東コース',
    teeTime: `${TODAY}T08:00:00+09:00`,
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 3,
    partyName: '佐藤組',
    status: 'confirmed',
    holes: 18,
  },
  // Caddies are named days ahead, so the fixtures carry groups past today —
  // otherwise the week and fortnight views have nothing to show.
  {
    id: 'res_mock_14',
    reservationNumber: 'R-2026-0113',
    golfCourseId: 'course_east',
    courseName: '東コース',
    teeTime: `${daysAfterFixture(1)}T09:00:00+09:00`,
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 4,
    partyName: '山本組',
    status: 'confirmed',
    holes: 18,
  },
  {
    id: 'res_mock_15',
    reservationNumber: 'R-2026-0114',
    golfCourseId: 'course_west',
    courseName: '西コース',
    teeTime: `${daysAfterFixture(3)}T07:40:00+09:00`,
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 3,
    partyName: '木村組',
    status: 'confirmed',
    holes: 18,
  },
  {
    id: 'res_mock_16',
    reservationNumber: 'R-2026-0115',
    golfCourseId: 'course_east',
    courseName: '東コース',
    teeTime: `${daysAfterFixture(9)}T08:00:00+09:00`,
    durationMinutes: 270,
    playType: 'caddie',
    partySize: 4,
    partyName: '法人C',
    status: 'confirmed',
    holes: 18,
  },
  // A month of the club's own bookings around the fixture day. Without them a
  // day board holds a dozen groups, and nothing on these screens is read the
  // way it is read at sixty.
  ...generatedReservations,
].map(item => ({
  ...item,
  reservationServiceId: item.playType === 'caddie' ? 'svc:caddie-18' : 'svc:self-18',
  displayName: item.id === 'res_mock_3'
    ? null
    : item.playType === 'caddie'
      ? 'キャディ付き18ホール'
      : 'セルフ18ホール',
})) as MockTeeReservation[]

/** Reservations created or cancelled at the desk, kept across reloads in this tab. */
const mockTeeReservations = loadMockWrites<MockTeeReservation[]>(
  'teeReservations',
  initialMockTeeReservations,
)

function datesBetween(from: string, to: string): string[] {
  const results: string[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor <= end && results.length < 62) {
    results.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return results
}

/**
 * A long unbroken run for one caddie (2026-07-13..19) so the shift board's
 * consecutive-days warning has something to point at in development.
 */
const mockStreakAssignments = ['13', '14', '15', '16', '17', '18', '19'].map(day => ({
  id: `assign_streak_${day}`,
  caddieProfileId: 'caddie_aya',
  reservationId: `res_streak_${day}`,
  roundReference: `R-2026-07${day}`,
  scheduledAt: `2026-07-${day}T07:30:00+09:00`,
  status: 'assigned',
  assignmentRole: 'primary',
  feeAmount: 12000,
  feeCurrency: 'JPY',
  recommendationScore: null,
  nominatedBy: null,
  notes: null,
  metadataJson: null,
}))

const mockAssignments = [
  ...mockStreakAssignments,
  {
    id: 'assign_mock_1',
    caddieProfileId: 'caddie_aya',
    reservationId: 'res_mock_1',
    roundReference: 'R-2026-0100',
    scheduledAt: `${TODAY}T07:00:00+09:00`,
    durationMinutes: 270,
    status: 'in_progress',
    assignmentRole: 'primary',
    feeAmount: 12000,
    feeCurrency: 'JPY',
    recommendationScore: 0.94,
    nominatedBy: 'mock',
    notes: '午前主担当',
  },
  {
    id: 'assign_mock_2',
    caddieProfileId: 'caddie_ken',
    reservationId: 'res_mock_2',
    roundReference: 'R-2026-0101',
    scheduledAt: `${TODAY}T07:08:00+09:00`,
    durationMinutes: 270,
    status: 'assigned',
    assignmentRole: 'primary',
    feeAmount: 10000,
    feeCurrency: 'JPY',
    recommendationScore: 0.88,
    nominatedBy: 'mock',
    notes: null,
  },
  {
    id: 'assign_mock_3',
    caddieProfileId: 'caddie_mika',
    reservationId: 'res_mock_4',
    roundReference: 'R-2026-0103',
    scheduledAt: `${TODAY}T08:00:00+09:00`,
    durationMinutes: 270,
    status: 'assigned',
    assignmentRole: 'primary',
    feeAmount: 11500,
    feeCurrency: 'JPY',
    recommendationScore: 0.91,
    nominatedBy: 'mock',
    notes: null,
  },
  {
    id: 'assign_mock_4',
    caddieProfileId: 'caddie_hiro',
    reservationId: 'res_mock_5',
    roundReference: 'R-2026-0104',
    scheduledAt: `${TODAY}T08:08:00+09:00`,
    durationMinutes: 270,
    status: 'assigned',
    assignmentRole: 'primary',
    feeAmount: 10000,
    feeCurrency: 'JPY',
    recommendationScore: 0.8,
    nominatedBy: 'mock',
    notes: null,
  },
  {
    id: 'assign_mock_5',
    caddieProfileId: 'caddie_yuki',
    reservationId: 'res_mock_6',
    roundReference: 'R-2026-0105',
    scheduledAt: `${TODAY}T07:30:00+09:00`,
    durationMinutes: 270,
    status: 'in_progress',
    assignmentRole: 'primary',
    feeAmount: 9000,
    feeCurrency: 'JPY',
    recommendationScore: 0.76,
    nominatedBy: 'mock',
    notes: null,
  },
  {
    id: 'assign_mock_6',
    caddieProfileId: 'caddie_aya',
    reservationId: 'res_mock_11',
    roundReference: 'R-2026-0110',
    scheduledAt: `${TODAY}T13:00:00+09:00`,
    durationMinutes: 270,
    status: 'assigned',
    assignmentRole: 'primary',
    feeAmount: 12000,
    feeCurrency: 'JPY',
    recommendationScore: 0.93,
    nominatedBy: 'mock',
    notes: '午後2ラウンド目',
  },
  {
    id: 'assign_mock_7',
    caddieProfileId: 'caddie_mika',
    reservationId: 'res_mock_10',
    roundReference: 'R-2026-0109',
    scheduledAt: `${TODAY}T11:00:00+09:00`,
    durationMinutes: 270,
    status: 'assigned',
    assignmentRole: 'primary',
    feeAmount: 11500,
    feeCurrency: 'JPY',
    recommendationScore: 0.9,
    nominatedBy: 'mock',
    notes: null,
  },
  {
    id: 'assign_mock_8',
    caddieProfileId: 'caddie_hiro',
    reservationId: 'res_mock_8',
    roundReference: 'R-2026-0107',
    scheduledAt: `${TODAY}T09:30:00+09:00`,
    durationMinutes: 270,
    status: 'assigned',
    assignmentRole: 'primary',
    feeAmount: 10000,
    feeCurrency: 'JPY',
    recommendationScore: 0.84,
    nominatedBy: 'mock',
    notes: 'デモ用: 直前ラウンドと時間帯が重複',
  },
  // What the club has already decided: settled through tomorrow, thinning out
  // after that. The far days are what the fortnight view is for.
  ...generateAssignments(
    MOCK_FIXTURE_DATE,
    generatedReservations,
    generatedRoster.caddies.filter(caddie => caddie.active).map(caddie => caddie.id),
  ),
]

const mockInvoices = [
  {
    id: 'inv_mock_001',
    tenantId: 'courseboard_id',
    invoiceNumber: 'CF-2026-0001',
    clientId: 'client_mock_1',
    clientName: 'Taro Yamada',
    clientEmail: 'taro@example.com',
    clientPhone: '09012345678',
    lineItems: [
      {
        description: 'キャンセル料 (東コース / 2026-07-10)',
        quantity: 1,
        unitPrice: 11000,
        amount: 11000,
      },
    ],
    dueDate: '2026-07-25',
    status: 'Sent',
    currency: 'JPY',
    subtotalAmount: 11000,
    taxAmount: 0,
    totalAmount: 11000,
    paymentLinkUrl: 'https://example.com/pay/mock',
    paymentLinkStatus: 'Ready',
    emailDeliveryStatus: 'Sent',
    smsDeliveryStatus: 'Sent',
    notes: '[courseboard:cancellation-fee] mock invoice',
    sentAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  },
]

function items<T>(values: T[]) {
  return { items: values }
}

/**
 * The customer ledger, and the memberships held against it.
 *
 * Mutable because the whole point of the screens above them is adding a
 * customer the desk could not find and granting a membership on the spot; a
 * frozen fixture would let the forms be looked at but not walked through.
 * A reload starts clean, same as the rest of this file.
 */
const mockCustomers: Array<Record<string, unknown>> = [
  {
    id: 'cus_honda',
    name: '本田 康彦',
    nameKana: 'ホンダ ヤスヒコ',
    phone: '090-1234-5678',
    email: 'honda@example.com',
  },
  {
    id: 'cus_masuda',
    name: '増田 公陽',
    nameKana: 'マスダ キミハル',
    phone: '090-2222-3333',
  },
  // No phone and no email: the walk-in nobody would otherwise write down.
  // PLT-3358 is what makes this row possible at all.
  { id: 'cus_tsuji', name: '辻 俊行', nameKana: 'ツジ トシユキ' },
]

const mockMembershipPlans: Array<Record<string, unknown>> = [
  {
    id: 'plan_full',
    name: '正会員',
    feeJpy: 120000,
    active: true,
    sortOrder: 0,
  },
  {
    id: 'plan_weekday',
    name: '平日会員',
    feeJpy: 60000,
    validDays: 365,
    active: true,
    sortOrder: 1,
  },
  // Retired, and still held by a member below: the settings screen has to show
  // it, the booking screens must not offer it.
  {
    id: 'plan_shareholder',
    name: '株主会員',
    active: false,
    sortOrder: 2,
  },
]

/** customerId → planId. Absent means visitor, which is not a lesser state. */
const mockMembershipAssignments = new Map<string, string>([
  ['cus_honda', 'plan_full'],
  ['cus_tsuji', 'plan_shareholder'],
])

function mockMembershipOf(customerId: string) {
  const planId = mockMembershipAssignments.get(customerId)
  const plan = planId
    ? mockMembershipPlans.find(candidate => candidate.id === planId)
    : undefined
  return {
    customerId,
    // Mirrors the server: whether someone is a member is decided in one place
    // and reported, never re-derived by the client from the plan's presence.
    isMember: Boolean(plan),
    ...(plan ? { plan, startedOn: '2026-04-01' } : {}),
  }
}

type MockCustomerSearch = {
  name: string | null
  phone: string | null
  email: string | null
}

function mockPhoneDigits(value: string) {
  return value
    .replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
    .replace(/[^0-9]/g, '')
}

/** Mirrors Field's separate name/kana, phone, and exact-email filters. */
function mockCustomerMatches(customer: Record<string, unknown>, search: MockCustomerSearch) {
  if (search.name) {
    const needle = search.name.toLowerCase()
    const names = [customer.name, customer.nameKana]
      .filter((value): value is string => typeof value === 'string')
      .map(value => value.toLowerCase())
    if (!names.some(value => value.includes(needle))) return false
  }

  if (search.phone) {
    const needle = mockPhoneDigits(search.phone)
    const phone = typeof customer.phone === 'string' ? mockPhoneDigits(customer.phone) : ''
    if (!needle || !phone.includes(needle)) return false
  }

  if (search.email) {
    if (customer.email !== search.email) return false
  }

  return Boolean(search.name || search.phone || search.email)
}

function pathnameOf(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return normalized.split('?')[0] ?? normalized
}

function methodOf(init?: RequestInit) {
  return (init?.method ?? 'GET').toUpperCase()
}

function parseBody(init?: RequestInit): unknown {
  if (typeof init?.body !== 'string' || !init.body) return undefined
  try {
    return JSON.parse(init.body) as unknown
  } catch {
    return undefined
  }
}

function multipartText(init: RequestInit | undefined, key: string) {
  if (typeof FormData === 'undefined' || !(init?.body instanceof FormData)) return undefined
  const value = init.body.get(key)
  return typeof value === 'string' ? value : undefined
}

function notSupported(action: string): MockFieldResult<never> {
  return error(
    501,
    `Mock Field API does not support ${action}. Set VITE_COURSEBOARD_MOCK_DATA=false to use a real API.`,
  )
}

function extensionStatus() {
  return items([
    {
      extensionKey: 'golf_course',
      name: 'Golf Course',
      version: '0.1.0-mock',
      registryStatus: 'published',
      tenantStatus: 'enabled',
      configVersion: 1,
      configJson: {
        defaultCurrency: 'JPY',
        timezone: 'Asia/Tokyo',
      },
      validation: { valid: true, errors: [] },
      updatedAt: NOW,
    },
  ])
}

function settlementReport(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number)
  const startDate = `${yearMonth}-01`
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  const reservationIds = ['res_mock_1', 'res_mock_2']
  return {
    period: { yearMonth, startDate, endDate },
    reservations: {
      grossAmount: 1_280_000,
      collectedAmount: 1_150_000,
      refundedAmount: 40_000,
      paymentPendingAmount: 90_000,
      reservationCount: 86,
    },
    caddieFees: {
      total: 420_000,
      assignmentCount: 72,
      currency: 'JPY',
    },
    cancellations: {
      feeOutstandingAmount: 11_000,
      count: 1,
    },
    square: {
      paymentsTotal: 1_150_000,
      refundsTotal: 40_000,
      unreconciledLines: 0,
      warning: null,
    },
    drilldown: {
      reservationIds,
      reservationItems: reservationIds.flatMap(id => {
        const reservation = mockTeeReservations.find(item => item.id === id)
        return reservation ? [{
          reservationId: reservation.id,
          reservationNumber: reservation.reservationNumber,
          customerName: reservation.partyName,
          teeTime: `${yearMonth}${reservation.teeTime.slice(7)}`,
          courseName: reservation.courseName,
        }] : []
      }),
      reservationDetailsUnavailable: false,
      unpaidCancellationReservationIds: ['res_mock_cancel_1'],
      unpaidCancellationItems: [
        {
          reservationId: 'res_mock_cancel_1',
          reservationNumber: 'R-2026-0101',
          cancellationFeeAmount: 11_000,
          checkoutUrl: 'https://example.com/pay/mock',
          linkIssued: true,
          paymentStatus: 'pending',
          invoiceId: 'inv_mock_001',
        },
      ],
    },
  }
}

function dailyBudgets(from: string, to: string, golfCourseId?: string | null) {
  const courseIds = golfCourseId
    ? [golfCourseId]
    : mockCourses.map(course => course.id)
  const start = new Date(`${from}T00:00:00+09:00`)
  const end = new Date(`${to}T00:00:00+09:00`)
  const itemsOut = []
  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const date = cursor.toISOString().slice(0, 10)
    for (const courseId of courseIds) {
      itemsOut.push({
        id: `budget_${courseId}_${date}`,
        golfCourseId: courseId,
        date,
        targetRevenue: 180_000,
        targetAverageSpend: 18_000,
        targetCaddyAttachedRatio: 0.65,
        updatedAt: NOW,
      })
    }
  }
  return items(itemsOut)
}

function achievements(from: string, to: string) {
  const budgets = dailyBudgets(from, to).items as Array<{
    id: string
    golfCourseId: string
    date: string
    targetRevenue: number
    targetAverageSpend: number
    targetCaddyAttachedRatio: number
  }>
  return items(budgets.map(budget => ({
    date: budget.date,
    targetRevenue: budget.targetRevenue,
    actualRevenue: Math.round(budget.targetRevenue * 0.86),
    revenueAchievementRate: 0.86,
    targetAverageSpend: budget.targetAverageSpend,
    actualAverageSpend: Math.round(budget.targetAverageSpend * 0.9),
    targetCaddyAttachedRatio: budget.targetCaddyAttachedRatio,
    actualCaddyAttachedRatio: 0.58,
    reservationCount: 12,
    playerCount: 44,
  })))
}

/**
 * Map CourseBoard course-api paths onto the shared mock fixtures that originally
 * lived under Field `/v1/erp/extensions/golf-course/*`.
 */
function normalizeMockPath(pathname: string): string {
  if (!pathname.startsWith('/v1/course/')) return pathname

  // CourseBoard-native paths with dedicated mock branches.
  if (
    pathname === '/v1/course/tee-sheet'
    || pathname === '/v1/course/extension-status'
    || pathname === '/v1/course/config'
    // Confirmed shifts and the balance board are CourseBoard's own data, with
    // nothing behind them in Field to map onto.
    || pathname === '/v1/course/caddie-shifts'
    || pathname === '/v1/course/caddie-course-supply'
    || pathname === '/v1/course/caddie-reinforcements'
    || pathname === '/v1/course/caddie-shift-rules'
    // Rank fees are a golf pay rule, kept in the extension config rather than
    // behind a Field endpoint of their own.
    || pathname === '/v1/course/caddie-rank-fees'
    || pathname.startsWith('/v1/course/caddie-shifts/')
    || pathname.startsWith('/v1/course/caddie-shift-plans/')
    // The customer ledger and the memberships against it live in Field's own
    // generic surfaces, not under the golf extension, so there is no
    // `/v1/erp/extensions/golf-course/*` path to map these onto.
    || pathname === '/v1/course/customers'
    || pathname === '/v1/course/membership-plans'
    || pathname.startsWith('/v1/course/customers/')
    || pathname.startsWith('/v1/course/membership-plans/')
  ) {
    return pathname
  }

  const direct: Record<string, string> = {
    '/v1/course/courses': '/v1/erp/extensions/golf-course/courses',
    '/v1/course/resources': '/v1/erp/extensions/golf-course/resources',
    '/v1/course/reservation-products': '/v1/erp/extensions/golf-course/reservation-products',
    '/v1/course/caddie-profiles': '/v1/erp/extensions/golf-course/caddie-profiles',
    '/v1/course/caddie-assignments': '/v1/erp/extensions/golf-course/caddie-assignments',
    '/v1/course/caddie-recommendations': '/v1/erp/extensions/golf-course/caddie-recommendations',
    '/v1/course/caddie-availabilities': '/v1/erp/extensions/golf-course/caddie-availabilities',
    '/v1/course/caddie-attendance-snapshot': '/v1/erp/extensions/golf-course/caddie-attendance-snapshot',
    '/v1/course/caddie-supply': '/v1/erp/extensions/golf-course/caddie-supply',
    '/v1/course/caddie-auto-assignments': '/v1/erp/extensions/golf-course/caddie-auto-assignments',
    '/v1/course/caddie-payroll-summary': '/v1/erp/extensions/golf-course/caddie-payroll-summary',
    '/v1/course/caddie-payroll-summary/export.csv':
      '/v1/erp/extensions/golf-course/caddie-payroll-summary/export.csv',
    '/v1/course/caddie-ratings': '/v1/erp/extensions/golf-course/caddie-ratings',
    '/v1/course/reservation-policy': '/v1/erp/extensions/golf-course/reservation-policy',
    '/v1/course/daily-budgets': '/v1/erp/extensions/golf-course/daily-budgets',
    '/v1/course/daily-budgets/achievement':
      '/v1/erp/extensions/golf-course/daily-budgets/achievement',
    '/v1/course/daily-budgets/import': '/v1/erp/extensions/golf-course/daily-budgets/import',
    '/v1/course/monthly-settlement': '/v1/erp/extensions/golf-course/monthly-settlement',
    '/v1/course/monthly-settlement/export.csv':
      '/v1/erp/extensions/golf-course/monthly-settlement/export.csv',
  }
  if (direct[pathname]) return direct[pathname]!

  const patterns: Array<[RegExp, string]> = [
    [/^\/v1\/course\/courses\/([^/]+)$/, '/v1/erp/extensions/golf-course/courses/$1'],
    [
      /^\/v1\/course\/courses\/([^/]+)\/schedule$/,
      '/v1/erp/extensions/golf-course/courses/$1/schedule',
    ],
    [
      /^\/v1\/course\/courses\/([^/]+)\/time-slots\/generate$/,
      '/v1/erp/extensions/golf-course/courses/$1/time-slots/generate',
    ],
    [
      /^\/v1\/course\/reservation-products\/([^/]+)\/slots$/,
      '/v1/erp/extensions/golf-course/reservation-products/$1/slots',
    ],
    [
      /^\/v1\/course\/reservation-products\/([^/]+)$/,
      '/v1/erp/extensions/golf-course/reservation-products/$1',
    ],
    [/^\/v1\/course\/caddie-profiles\/([^/]+)$/, '/v1/erp/extensions/golf-course/caddie-profiles/$1'],
    [
      /^\/v1\/course\/caddie-profiles\/([^/]+)\/courses$/,
      '/v1/erp/extensions/golf-course/caddie-profiles/$1/courses',
    ],
    [
      /^\/v1\/course\/caddie-assignments\/([^/]+)$/,
      '/v1/erp/extensions/golf-course/caddie-assignments/$1',
    ],
    [
      /^\/v1\/course\/caddie-availabilities\/([^/]+)\/([^/]+)$/,
      '/v1/erp/extensions/golf-course/caddie-availabilities/$1/$2',
    ],
  ]
  for (const [pattern, replacement] of patterns) {
    if (pattern.test(pathname)) {
      return pathname.replace(pattern, replacement)
    }
  }
  return pathname
}


/**
 * Confirmed shifts, as CourseBoard's own table would hold them.
 *
 * Unlike everything else in this file these are not Field fixtures: the
 * placement of a caddie onto a course is CourseBoard's data (ADR-0005). They
 * live here so the shift board and the balance board can be worked on without
 * a database behind the dev server.
 */
type MockShift = {
  caddieProfileId: string
  date: string
  golfCourseId: string | null
  isWorking: boolean
  span: string
  roundsCapacity: number
  origin: string
  note: string | null
  updatedBy: string | null
  updatedAt: string | null
}

const mockShifts: MockShift[] = loadMockWrites<MockShift[]>('caddieShifts', [])

/** Half the roster is based on each course, and can cover the other. */
function mockMemberships(profileId: string) {
  const index = Math.max(0, mockCaddies.findIndex(caddie => caddie.id === profileId))
  const main = index % 2 === 0 ? 'course_east' : 'course_west'
  const sub = main === 'course_east' ? 'course_west' : 'course_east'
  return [
    {
      id: `membership_${profileId}_${main}`,
      caddieProfileId: profileId,
      golfCourseId: main,
      isPrimary: true,
    },
    {
      id: `membership_${profileId}_${sub}`,
      caddieProfileId: profileId,
      golfCourseId: sub,
      isPrimary: false,
    },
  ]
}

function mainCourseOf(profileId: string): string | null {
  return mockMemberships(profileId).find(entry => entry.isPrimary)?.golfCourseId ?? null
}

function shiftKey(caddieProfileId: string, date: string) {
  return `${caddieProfileId}:${date}`
}

function storeShift(shift: MockShift) {
  const index = mockShifts.findIndex(
    entry => shiftKey(entry.caddieProfileId, entry.date) === shiftKey(shift.caddieProfileId, shift.date),
  )
  if (index < 0) mockShifts.push(shift)
  else mockShifts[index] = shift
  // Confirmed shifts outlive a reload, like the desk marks do: a month planned
  // in one screen has to still be there when the balance board is opened.
  saveMockWrites('caddieShifts', mockShifts)
}

/** The statutory ceiling the API clamps to. */
const MOCK_STATUTORY_MAX_CONSECUTIVE_WORK_DAYS = 6
const MOCK_MAX_ROUNDS_CEILING = 2

const MOCK_WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** The club's shift-planning rules, as the API would hold them. */
type MockShiftRules = {
  avoidedRestWeekdays: string[]
  maxConsecutiveWorkDays: number
  maxRoundsPerDay: number
  minRestDaysPerMonth: number
  unfiledRequest: string
}

const mockShiftRules: MockShiftRules = loadMockWrites<MockShiftRules>('shiftRules', {
  avoidedRestWeekdays: ['sat', 'sun'],
  maxConsecutiveWorkDays: MOCK_STATUTORY_MAX_CONSECUTIVE_WORK_DAYS,
  maxRoundsPerDay: MOCK_MAX_ROUNDS_CEILING,
  minRestDaysPerMonth: 0,
  unfiledRequest: 'working',
})

function mockShiftRulesDto() {
  return {
    ...mockShiftRules,
    avoidedRestWeekdays: [...mockShiftRules.avoidedRestWeekdays],
    statutoryMaxConsecutiveWorkDays: MOCK_STATUTORY_MAX_CONSECUTIVE_WORK_DAYS,
    maxRoundsCeiling: MOCK_MAX_ROUNDS_CEILING,
  }
}

function weekdayKeyOf(date: string): string {
  return MOCK_WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? 'mon'
}

/**
 * The same rules the API applies: at most six working days in a row, with the
 * rest day chosen from the window rather than always taken at the deadline —
 * protected weekdays first, then whichever day fewest colleagues are already
 * off, then the latest such day.
 */
function planMockMonth(yearMonth: string, persist = true) {
  const shifts: MockShift[] = []
  const [year, month] = yearMonth.split('-').map(Number)
  if (!year || !month) {
    return {
      daysWritten: 0,
      pinnedKept: 0,
      statutoryRestDays: 0,
      unplaced: [] as string[],
      overworked: [] as string[],
      shifts,
    }
  }
  const first = `${yearMonth}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const last = `${yearMonth}-${String(lastDay).padStart(2, '0')}`
  const days = datesBetween(first, last)
  const filed = resolveGet(
    `/v1/erp/extensions/golf-course/caddie-availabilities?from=${first}&to=${last}`,
  ) as { items: Array<{ caddieProfileId: string; date: string; status: string; twoRoundRequest?: boolean }> } | null
  const requests = new Map<string, { status: string; twoRoundRequest: boolean }>()
  for (const entry of filed?.items ?? []) {
    requests.set(shiftKey(entry.caddieProfileId, entry.date), {
      status: entry.status,
      twoRoundRequest: Boolean(entry.twoRoundRequest),
    })
  }

  let daysWritten = 0
  let pinnedKept = 0
  let statutoryRestDays = 0
  const unplaced = new Set<string>()
  const overworked = new Set<string>()
  const restingByDate = new Map<string, number>()

  for (const caddie of mockCaddies) {
    const main = mainCourseOf(caddie.id)
    const pinnedFor = (date: string) => mockShifts.find(
      entry => shiftKey(entry.caddieProfileId, entry.date) === shiftKey(caddie.id, date)
        && entry.origin === 'pinned',
    )
    const alreadyOff = (date: string) => {
      const pinned = pinnedFor(date)
      if (pinned) return !pinned.isWorking
      const filed = requests.get(shiftKey(caddie.id, date))
      if (filed) return filed.status === 'unavailable'
      return mockShiftRules.unfiledRequest === 'off'
    }

    // Days worked before the 1st, so a run crossing the month boundary is not
    // forgiven by the calendar.
    let carried = 0
    for (let back = 1; back <= mockShiftRules.maxConsecutiveWorkDays; back += 1) {
      const day = new Date(`${first}T00:00:00Z`)
      day.setUTCDate(day.getUTCDate() - back)
      const earlier = mockShifts.find(
        entry => shiftKey(entry.caddieProfileId, entry.date)
          === shiftKey(caddie.id, day.toISOString().slice(0, 10)),
      )
      if (!earlier?.isWorking) break
      carried += 1
    }

    // Pick this caddie's rest days first, then write the month against them.
    const chosenRest = new Set<string>()
    let worked = carried
    let index = 0
    while (index < days.length) {
      const lastOfWindow = index + Math.max(0, mockShiftRules.maxConsecutiveWorkDays - worked)
      if (lastOfWindow >= days.length) break
      const window = days.slice(index, lastOfWindow + 1)
      const filedOffset = window.findIndex(alreadyOff)
      if (filedOffset >= 0) {
        const rest = window[filedOffset]!
        restingByDate.set(rest, (restingByDate.get(rest) ?? 0) + 1)
        index += filedOffset + 1
        worked = 0
        continue
      }
      const choice = window
        .filter(date => !pinnedFor(date)?.isWorking)
        .sort((left, right) => {
          const protectedDay = (date: string) =>
            (mockShiftRules.avoidedRestWeekdays.includes(weekdayKeyOf(date)) ? 1 : 0)
          return protectedDay(left) - protectedDay(right)
            || (restingByDate.get(left) ?? 0) - (restingByDate.get(right) ?? 0)
            || right.localeCompare(left)
        })[0]
      if (!choice) {
        overworked.add(caddie.displayName)
        worked += window.length
        index = lastOfWindow + 1
        continue
      }
      chosenRest.add(choice)
      restingByDate.set(choice, (restingByDate.get(choice) ?? 0) + 1)
      index += window.indexOf(choice) + 1
      worked = 0
    }

    // Top up to the rest days the work rules promise, as the API does.
    let restSoFar = days.filter(date => alreadyOff(date) || chosenRest.has(date)).length
    while (restSoFar < mockShiftRules.minRestDaysPerMonth) {
      const pick = days
        .filter(date => !chosenRest.has(date) && !alreadyOff(date) && !pinnedFor(date)?.isWorking)
        .sort((left, right) => {
          const protectedDay = (date: string) =>
            (mockShiftRules.avoidedRestWeekdays.includes(weekdayKeyOf(date)) ? 1 : 0)
          return protectedDay(left) - protectedDay(right)
            || (restingByDate.get(left) ?? 0) - (restingByDate.get(right) ?? 0)
            || left.localeCompare(right)
        })[0]
      if (!pick) break
      chosenRest.add(pick)
      restingByDate.set(pick, (restingByDate.get(pick) ?? 0) + 1)
      restSoFar += 1
    }

    for (const date of days) {
      const pinned = pinnedFor(date)
      if (pinned) {
        pinnedKept += 1
        daysWritten += 1
        continue
      }
      const request = requests.get(shiftKey(caddie.id, date))
      const status = request?.status
        ?? (mockShiftRules.unfiledRequest === 'off' ? 'unavailable' : 'available')
      const restDue = chosenRest.has(date)
      const off = status === 'unavailable' || restDue
      if (restDue && status !== 'unavailable') statutoryRestDays += 1
      const span = status === 'morning_only'
        ? 'morning'
        : status === 'afternoon_only'
          ? 'afternoon'
          : 'full_day'
      const twoRounds = span === 'full_day'
        && status !== 'light_duty'
        && Boolean(caddie.canTwoRounds)
        && Boolean(request?.twoRoundRequest)
        && mockShiftRules.maxRoundsPerDay >= 2
      const shift: MockShift = {
        caddieProfileId: caddie.id,
        date,
        golfCourseId: off ? null : main,
        isWorking: !off,
        span: off ? 'full_day' : span,
        roundsCapacity: off ? 0 : twoRounds ? 2 : 1,
        origin: 'generated',
        note: null,
        updatedBy: null,
        updatedAt: null,
      }
      shifts.push(shift)
      if (persist) storeShift(shift)
      if (!off && !main) unplaced.add(caddie.displayName)
      daysWritten += 1
    }
  }
  return {
    daysWritten,
    pinnedKept,
    statutoryRestDays,
    unplaced: [...unplaced],
    overworked: [...overworked],
    shifts,
  }
}

function caddieAttachedByCourse(date: string): Map<string, number> {
  const demand = new Map<string, number>()
  for (const reservation of mockTeeReservations) {
    if (!reservation.teeTime.startsWith(date)) continue
    if (reservation.playType !== 'caddie') continue
    if (reservation.status === 'cancelled') continue
    demand.set(reservation.golfCourseId, (demand.get(reservation.golfCourseId) ?? 0) + 1)
  }
  return demand
}

function mockCourseSupply(date: string) {
  const working = mockShifts.filter(shift => shift.date === date && shift.isWorking)
  const demand = caddieAttachedByCourse(date)
  return {
    date,
    courses: mockCourses.filter(course => course.isActive).map(course => {
      const placed = working.filter(shift => shift.golfCourseId === course.id)
      const roundsCapacity = placed.reduce((total, shift) => total + shift.roundsCapacity, 0)
      const caddieAttachedGroups = demand.get(course.id) ?? 0
      return {
        golfCourseId: course.id,
        courseName: course.name,
        workingCaddies: placed.length,
        roundsCapacity,
        caddieAttachedGroups,
        movableCaddies: placed.filter(shift => shift.origin !== 'pinned').length,
        shortfall: roundsCapacity - caddieAttachedGroups,
      }
    }),
    unplacedCaddies: working.filter(shift => shift.golfCourseId === null).length,
  }
}

function mockReinforcements(date: string, courseId: string) {
  return mockShifts
    .filter(shift => shift.date === date && shift.isWorking)
    .filter(shift => shift.origin !== 'pinned')
    .filter(shift => shift.golfCourseId !== courseId)
    .filter(shift => mockMemberships(shift.caddieProfileId)
      .some(entry => entry.golfCourseId === courseId))
    .map(shift => ({
      caddieProfileId: shift.caddieProfileId,
      displayName: mockCaddies.find(caddie => caddie.id === shift.caddieProfileId)?.displayName
        ?? shift.caddieProfileId,
      fromGolfCourseId: shift.golfCourseId,
      roundsCapacity: shift.roundsCapacity,
      span: shift.span,
      returnsHome: mainCourseOf(shift.caddieProfileId) === courseId,
    }))
    .sort((left, right) => {
      const cost = (entry: typeof left) =>
        entry.fromGolfCourseId === null ? 0 : entry.returnsHome ? 1 : 2
      return cost(left) - cost(right) || left.caddieProfileId.localeCompare(right.caddieProfileId)
    })
}

function resolveGet(path: string): Json | null | undefined {
  const rawPathname = pathnameOf(path)
  const pathname = normalizeMockPath(rawPathname)
  const url = new URL(path, 'http://mock.local')

  if (pathname === '/v1/erp/extensions/status') return extensionStatus()

  if (pathname === '/v1/course/booking-horizon') {
    return mockHorizonResponse()
  }

  if (pathname === '/v1/course/customers') {
    const search: MockCustomerSearch = {
      name: url.searchParams.get('name')?.trim() || null,
      phone: url.searchParams.get('phone')?.trim() || null,
      email: url.searchParams.get('email')?.trim() || null,
    }
    const limit = Number(url.searchParams.get('limit')) || 20
    // Nothing typed is the ledger listing the screen opens with, newest first
    // — the same shape the server answers, so the empty state is exercised
    // here rather than only against Field.
    if (!search.name && !search.phone && !search.email) {
      return items([...mockCustomers].reverse().slice(0, limit))
    }
    return items(
      mockCustomers.filter(customer => mockCustomerMatches(customer, search)).slice(0, limit),
    )
  }

  if (pathname === '/v1/course/membership-plans') {
    const includeInactive = url.searchParams.get('includeInactive') === 'true'
    return items(mockMembershipPlans.filter(plan => includeInactive || plan.active === true))
  }

  const customerMembershipMatch = pathname.match(/^\/v1\/course\/customers\/([^/]+)\/membership$/)
  if (customerMembershipMatch) {
    return mockMembershipOf(decodeURIComponent(customerMembershipMatch[1] ?? ''))
  }

  const customerMatch = pathname.match(/^\/v1\/course\/customers\/([^/]+)$/)
  if (customerMatch) {
    const customerId = decodeURIComponent(customerMatch[1] ?? '')
    // `null` rather than `undefined`: an id nobody holds is a missing customer,
    // not a path this mock forgot to cover.
    return mockCustomers.find(customer => customer.id === customerId) ?? null
  }

  if (rawPathname === '/v1/course/extension-status') {
    const status = extensionStatus() as { items: Array<Record<string, unknown>> }
    return status.items.find(item => item.extensionKey === 'golf_course') ?? null
  }

  if (
    rawPathname === '/v1/course/config'
    || pathname === `/v1/erp/extensions/golf_course/config`
    || pathname === '/v1/erp/extensions/golf-course/config'
  ) {
    return {
      extensionKey: 'golf_course',
      configVersion: 1,
      configJson: { defaultCurrency: 'JPY', timezone: 'Asia/Tokyo' },
      validation: { valid: true, errors: [] },
      updatedAt: NOW,
    }
  }

  if (rawPathname === '/v1/course/reservation-report-entries') {
    const from = url.searchParams.get('from') ?? ''
    const to = url.searchParams.get('to') ?? ''
    return items(mockReservationReportEntries
      .filter(entry => (!from || entry.date >= from) && (!to || entry.date <= to))
      .map(entry => ({ ...entry })))
  }

  if (pathname === '/v1/erp/extensions/golf-course/courses') {
    return items(mockCourses.map(course => ({ ...course })))
  }

  if (pathname === '/v1/erp/extensions/golf-course/resources') {
    return items(mockCourses.map(course => ({
      id: `resource_${course.id}`,
      name: course.name,
      reservationResourceId: mockReservationResourceId(course.id),
      golfCourseId: course.id,
      resourceKind: 'course',
      active: course.isActive,
    })))
  }

  if (pathname === '/v1/erp/extensions/golf-course/reservation-products') {
    return items(mockProducts.map(product => ({
      ...product,
      // The API always answers with the array and adds the scalar only for a
      // plan on one course, so the fixtures have to read back the same way.
      golfCourseIds: productCourseIds(product),
      tenantId: TENANT_ID() || product.tenantId,
    })))
  }

  const slotsMatch = pathname.match(
    /^\/v1\/erp\/extensions\/golf-course\/reservation-products\/([^/]+)\/slots$/,
  )
  if (slotsMatch) {
    const serviceId = decodeURIComponent(slotsMatch[1] ?? '')
    return items(mockSlotsByService[serviceId] ?? [])
  }

  const scheduleMatch = pathname.match(
    /^\/v1\/erp\/extensions\/golf-course\/courses\/([^/]+)\/schedule$/,
  )
  if (scheduleMatch) {
    const courseId = decodeURIComponent(scheduleMatch[1] ?? '')
    return items(mockSchedulesByCourse[courseId] ?? [])
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-profiles') {
    // course-api answers the roster with the HRM staff index alongside the
    // profiles, which is what the create dialog suggests existing people from.
    return {
      ...items(mockCaddies.map(profile => ({ ...profile }))),
      staff: mockStaff.map(member => ({ ...member })),
    }
  }

  // CourseBoard course-api tee-sheet (not Field golf-course extension).
  if (rawPathname === '/v1/course/caddie-shifts') {
    const from = url.searchParams.get('from') ?? TODAY
    const to = url.searchParams.get('to') ?? from
    return items(
      mockShifts
        .filter(shift => shift.date >= from && shift.date <= to)
        .sort((left, right) => left.date.localeCompare(right.date)
          || left.caddieProfileId.localeCompare(right.caddieProfileId)),
    )
  }

  if (rawPathname === '/v1/course/caddie-shift-rules') {
    return mockShiftRulesDto()
  }

  if (rawPathname === '/v1/course/caddie-course-supply') {
    return mockCourseSupply(url.searchParams.get('date') ?? TODAY)
  }

  if (rawPathname === '/v1/course/caddie-reinforcements') {
    return items(mockReinforcements(
      url.searchParams.get('date') ?? TODAY,
      url.searchParams.get('golfCourseId') ?? '',
    ))
  }

  if (rawPathname === '/v1/course/tee-sheet') {
    const date = url.searchParams.get('date') ?? TODAY
    // The API answers a range when asked, for staffing planned days ahead.
    const to = url.searchParams.get('to')
    const lastDay = to && to > date ? to : date
    const courseId = url.searchParams.get('golfCourseId')
    const filtered = mockTeeReservations.filter(item => {
      const day = item.teeTime.slice(0, 10)
      if (day < date || day > lastDay) return false
      if (courseId && item.golfCourseId !== courseId) return false
      return true
    })
    return {
      date,
      timezone: 'Asia/Tokyo',
      dayStart: `${date}T06:00:00+09:00`,
      dayEnd: `${date}T18:00:00+09:00`,
      items: filtered.map(withStoredParty),
    }
  }

  // CourseBoard start ledger. Built from the same fixtures as the tee sheet so
  // the two boards never disagree about the day, with the slot grid derived
  // from each course's opening hours and interval — the same fallback the API
  // uses when Field has generated no inventory.
  if (rawPathname === '/v1/course/tee-ledger') {
    const date = url.searchParams.get('date') ?? TODAY
    // Empty means every course, matching the API: a board with no columns
    // answers nothing.
    const courseIds = (url.searchParams.get('golfCourseIds') ?? url.searchParams.get('golfCourseId') ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
    const columns = [...mockCourses]
      .sort((left, right) => {
        const a = mockCourseOrder.indexOf(left.id)
        const b = mockCourseOrder.indexOf(right.id)
        if (a !== -1 && b !== -1) return a - b
        if (a !== -1) return -1
        if (b !== -1) return 1
        return left.name.localeCompare(right.name)
      })
      .filter(course => courseIds.length === 0 || courseIds.includes(course.id))
      .map(course => {
        const bookings = mockTeeReservations.filter(
          item => item.teeTime.startsWith(date) && item.golfCourseId === course.id,
        )
        const byTime = new Map<string, Array<Omit<MockTeeReservation, 'prepaymentPolicy'>>>()
        for (const time of mockSlotTimes(course)) byTime.set(time, [])
        for (const booking of bookings) {
          const time = booking.teeTime.slice(11, 16)
          if (!byTime.has(time)) byTime.set(time, [])
          byTime.get(time)!.push(withStoredParty(booking))
        }
        const slots = [...byTime.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([teeTime, slotItems]) => {
            const mark = mockSlotMarks.find(
              entry =>
                entry.golfCourseId === course.id
                && entry.date === date
                && entry.teeTime === teeTime,
            )
            const capacity = MOCK_SLOT_CAPACITY
            const available = Math.max(capacity - slotItems.length, 0)
            return {
              teeTime,
              capacity,
              availableGroups: available,
              bookedGroups: slotItems.length,
              playerCount: slotItems.reduce((sum, item) => sum + item.partySize, 0),
              isActive: true,
              isSellable: available > 0 && mark?.kind !== 'closed',
              ...(mark ? { mark: { ...mark } } : {}),
              items: slotItems,
            }
          })
        const groupCount = bookings.length
        const selfGroupCount = bookings.filter(item => item.playType === 'self').length
        return {
          golfCourseId: course.id,
          courseName: course.name,
          resourceId: mockReservationResourceId(course.id),
          startIntervalMinutes: course.startIntervalMinutes,
          gridSource: 'inventory',
          groupCount,
          playerCount: bookings.reduce((sum, item) => sum + item.partySize, 0),
          selfGroupCount,
          caddieGroupCount: groupCount - selfGroupCount,
          openSlotCount: slots.filter(slot => slot.isSellable).length,
          slots,
        }
      })
    return { date, timezone: 'Asia/Tokyo', columns }
  }

  if (rawPathname === '/v1/course/course-order') {
    return { golfCourseIds: [...mockCourseOrder] }
  }

  if (rawPathname === '/v1/course/slot-overrides') {
    const date = url.searchParams.get('date') ?? TODAY
    return items(mockSlotMarks.filter(mark => mark.date === date).map(mark => ({ ...mark })))
  }

  const deadlineGetMatch = rawPathname.match(
    /^\/v1\/course\/caddie-availability-deadlines\/([^/]+)$/,
  )
  if (deadlineGetMatch) {
    const yearMonth = deadlineGetMatch[1]
    // The real API can return no deadline, but the generic mock resolver uses
    // null to mean a missing resource. Give every demo month a harmless local
    // default so the shift board stays browsable without a false 404 notice.
    const deadlineDate = mockAvailabilityDeadlines[yearMonth] ?? `${yearMonth}-20`
    return { yearMonth, deadlineDate }
  }

  const submissionsMatch = rawPathname.match(
    /^\/v1\/course\/caddie-availability-submissions\/([^/]+)$/,
  )
  if (submissionsMatch) {
    // The fixture generates some availability row for every caddie in almost
    // every month; picking a fixed one to omit keeps the "who hasn't filed"
    // notice demonstrable without depending on that generator's spread.
    return items(mockCaddies.slice(0, 1).map(profile => ({
      caddieProfileId: profile.id,
      displayName: profile.displayName,
    })))
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-assignments') {
    return items(mockAssignments.map(item => ({ ...item })))
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-recommendations') {
    return items([
      {
        caddieProfileId: 'caddie_aya',
        displayName: '佐藤 彩',
        skillLevel: 'veteran',
        ratingAverage: 4.8,
        ratingCount: 42,
        roundsAssigned: 1,
        remainingRounds: 1,
        attendanceStatus: 'working',
        recommendationScore: 161,
        recommendedRole: 'primary',
        pairingDisplayName: null,
        rationale: ['on_duty', 'veteran_for_foursome'],
      },
    ])
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-availabilities') {
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    // Range queries feed the shift board: deterministic days off per caddie so
    // the month view has some texture without Math.random().
    if (from && to) {
      const statuses = ['unavailable', 'morning_only', 'afternoon_only', 'light_duty'] as const
      const results: Array<Record<string, unknown>> = []
      for (const date of datesBetween(from, to)) {
        const day = Number(date.slice(8, 10))
        mockCaddies.forEach((profile, index) => {
          // Two marked days per caddie per week, staggered by roster position.
          if ((day + index) % 7 !== 0 && (day + index * 3) % 11 !== 0) return
          results.push({
            id: `avail_${profile.id}_${date}`,
            caddieProfileId: profile.id,
            date,
            status: statuses[(day + index) % statuses.length],
            twoRoundRequest: Boolean(profile.canTwoRounds),
            healthNote: null,
            updatedAt: NOW,
          })
        })
      }
      return items(results)
    }
    return items(mockCaddies.map(profile => ({
      id: `avail_${profile.id}_${TODAY}`,
      caddieProfileId: profile.id,
      date: url.searchParams.get('date') ?? TODAY,
      status: 'available',
      twoRoundRequest: Boolean(profile.canTwoRounds),
      healthNote: null,
      updatedAt: NOW,
    })))
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-attendance-snapshot') {
    const date = url.searchParams.get('date') ?? TODAY
    // Whoever has a round that day has come in, plus a few on standby. Naming
    // three by hand left a forty-strong club looking almost entirely absent.
    const onTheBoard = new Set(
      mockAssignments
        .filter(item => item.scheduledAt.startsWith(date) && item.status !== 'cancelled')
        .map(item => item.caddieProfileId),
    )
    const working = new Set([
      ...onTheBoard,
      ...['caddie_aya', 'caddie_ken', 'caddie_yuki'],
    ])
    const assignmentCounts = mockAssignments.reduce<Record<string, number>>((acc, item) => {
      if (!item.scheduledAt.startsWith(date)) return acc
      acc[item.caddieProfileId] = (acc[item.caddieProfileId] ?? 0) + 1
      return acc
    }, {})
    return {
      date,
      items: mockCaddies.map(profile => ({
        caddieProfileId: profile.id,
        displayName: profile.displayName,
        staffId: profile.staffId,
        attendanceStatus: working.has(profile.id) ? 'working' : 'not_clocked',
        todayAssignments: assignmentCounts[profile.id] ?? 0,
        roundsWithoutClockInToday: 0,
      })),
    }
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-supply') {
    const date = url.searchParams.get('date') ?? TODAY
    const safetyBuffer = Number(url.searchParams.get('safetyBuffer') ?? 1)
    // Derived from the roster and the day's board rather than fixed: with a
    // club-sized roster the old constants said eight groups next to a sheet
    // holding forty.
    const available = mockCaddies.filter(caddie => caddie.employmentStatus === 'active')
    const twoRoundCapable = available.filter(caddie => caddie.canTwoRounds)
    const caddieSupply = available.length + twoRoundCapable.length
    const currentCaddieAttached = mockTeeReservations.filter(
      item => item.teeTime.startsWith(date) && item.playType === 'caddie',
    ).length
    const caddieAttachedCap = Math.max(caddieSupply - safetyBuffer, 0)
    return {
      date,
      availableCaddies: available.length,
      twoRoundCapable: twoRoundCapable.length,
      caddieSupply,
      morningCapacity: available.length,
      afternoonCapacity: twoRoundCapable.length,
      safetyBuffer,
      caddieAttachedCap,
      currentCaddieAttached,
      remaining: caddieAttachedCap - currentCaddieAttached,
    }
  }

  if (pathname === '/v1/course/caddie-rank-fees') return mockRankFees

  if (pathname === '/v1/erp/extensions/golf-course/caddie-payroll-summary') {
    const yearMonth = url.searchParams.get('yearMonth') ?? TODAY.slice(0, 7)
    const [year, month] = yearMonth.split('-').map(Number)
    return {
      period: {
        yearMonth,
        startDate: `${yearMonth}-01`,
        endDate: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
      },
      items: mockCaddies.map(profile => payrollRow(profile)),
    }
  }

  const membershipMatch = pathname.match(
    /^\/v1\/erp\/extensions\/golf-course\/caddie-profiles\/([^/]+)\/courses$/,
  )
  if (membershipMatch) {
    const profileId = decodeURIComponent(membershipMatch[1] ?? '')
    return items(mockMemberships(profileId))
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-ratings') {
    const profileId = url.searchParams.get('caddieProfileId')
    return items(profileId
      ? [{
          id: `rating_${profileId}_1`,
          caddieProfileId: profileId,
          score: 5,
          comment: 'デモ評価',
          createdAt: NOW,
        }]
      : [])
  }

  if (pathname === '/v1/erp/staff') return items(mockStaff.map(member => ({ ...member })))

  if (pathname === '/v1/field/iam/users') {
    return {
      users: mockIamMembers.map(member => ({ ...member })),
      customPolicies: mockIamCustomPolicies.map(policy => ({ ...policy })),
    }
  }

  if (pathname === '/v1/erp/extensions/golf-course/reservation-policy') {
    return { ...mockReservationPolicy, tenantId: TENANT_ID() || 'courseboard_id' }
  }

  if (pathname === '/v1/erp/extensions/golf-course/daily-budgets') {
    return dailyBudgets(
      url.searchParams.get('from') ?? TODAY,
      url.searchParams.get('to') ?? TODAY,
      url.searchParams.get('golfCourseId'),
    )
  }

  if (pathname === '/v1/erp/extensions/golf-course/daily-budgets/achievement') {
    return achievements(
      url.searchParams.get('from') ?? TODAY,
      url.searchParams.get('to') ?? TODAY,
    )
  }

  if (pathname === '/v1/erp/extensions/golf-course/monthly-settlement') {
    return settlementReport(url.searchParams.get('yearMonth') ?? TODAY.slice(0, 7))
  }

  if (pathname === '/v1/invoices') {
    const status = url.searchParams.get('status')
    const filtered = status
      ? mockInvoices.filter(invoice => invoice.status === status)
      : mockInvoices
    return items(filtered.map(invoice => ({
      ...invoice,
      tenantId: TENANT_ID() || invoice.tenantId,
      lineItems: invoice.lineItems.map(item => ({ ...item })),
    })))
  }

  const invoiceMatch = pathname.match(/^\/v1\/invoices\/([^/]+)$/)
  if (invoiceMatch) {
    const invoiceId = decodeURIComponent(invoiceMatch[1] ?? '')
    const invoice = mockInvoices.find(item => item.id === invoiceId)
    if (!invoice) return null
    return {
      ...invoice,
      tenantId: TENANT_ID() || invoice.tenantId,
      lineItems: invoice.lineItems.map(item => ({ ...item })),
    }
  }

  return undefined
}

function resolveMutation(path: string, init?: RequestInit): MockFieldResult<Json> {
  const pathname = normalizeMockPath(pathnameOf(path))
  const method = methodOf(init)
  const body = parseBody(init) as Record<string, unknown> | undefined

  if (pathname === '/v1/course/feature-flags/evaluate' && method === 'POST') {
    // Mock mode behaves like an all-enabled flag store so gated features stay
    // reachable in fixture-driven development.
    const keys = Array.isArray(body?.keys) ? (body.keys as unknown[]) : []
    return hit({
      values: keys
        .filter((key): key is string => typeof key === 'string')
        .map(key => ({ key, enabled: true })),
    })
  }

  if (pathname === '/v1/course/customers/reception-draft' && method === 'POST') {
    if (typeof FormData === 'undefined' || !(init?.body instanceof FormData)) {
      return error(400, "multipart field 'file' is required")
    }
    // A read good enough to be worth checking, and wrong in the ways a real one
    // is: a kana nobody wrote down, a row whose name the scan lost. The screen
    // exists for exactly these rows, so the fixture has to contain them.
    return hit({
      visitors: [
        {
          name: '本田 康彦',
          nameKana: 'ホンダ ヤスヒコ',
          phone: '090-1234-5678',
          email: 'honda@example.com',
        },
        { name: '増田 公陽', nameKana: 'マスダ キミハル', phone: '090-2222-3333' },
        { name: '辻 俊行' },
        { phone: '080-4444-5555' },
      ],
      warnings: ['読み取れない項目があります。原本を見ながらすべての項目を確認してください。'],
    })
  }

  if (pathname === '/v1/course/customers' && method === 'POST') {
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return error(400, 'customer name is required')
    const created = {
      id: `cus_mock_${mockCustomers.length + 1}`,
      name,
      ...(typeof body?.nameKana === 'string' && body.nameKana.trim()
        ? { nameKana: body.nameKana.trim() }
        : {}),
      ...(typeof body?.phone === 'string' && body.phone.trim()
        ? { phone: body.phone.trim() }
        : {}),
      ...(typeof body?.email === 'string' && body.email.trim()
        ? { email: body.email.trim() }
        : {}),
    }
    mockCustomers.push(created)
    return hit(created)
  }

  if (pathname === '/v1/course/membership-plans' && method === 'POST') {
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return error(400, 'plan name is required')
    const created = {
      id: `plan_mock_${mockMembershipPlans.length + 1}`,
      name,
      description: body?.description ?? null,
      feeJpy: body?.feeJpy ?? null,
      validDays: body?.validDays ?? null,
      active: true,
      sortOrder: typeof body?.sortOrder === 'number' ? body.sortOrder : mockMembershipPlans.length,
    }
    mockMembershipPlans.push(created)
    return hit(created)
  }

  const planWriteMatch = pathname.match(/^\/v1\/course\/membership-plans\/([^/]+)$/)
  if (planWriteMatch && method === 'PATCH') {
    const planId = decodeURIComponent(planWriteMatch[1] ?? '')
    const plan = mockMembershipPlans.find(candidate => candidate.id === planId)
    if (!plan) return error(404, 'membership plan not found')
    if (typeof body?.name === 'string') plan.name = body.name.trim()
    // Explicit null clears the value, which is how the editor empties a fee.
    if ('description' in (body ?? {})) plan.description = body?.description ?? null
    if ('feeJpy' in (body ?? {})) plan.feeJpy = body?.feeJpy ?? null
    if ('validDays' in (body ?? {})) plan.validDays = body?.validDays ?? null
    if (typeof body?.active === 'boolean') plan.active = body.active
    if (typeof body?.sortOrder === 'number') plan.sortOrder = body.sortOrder
    return hit(plan)
  }

  const membershipGrantMatch = pathname.match(/^\/v1\/course\/customers\/([^/]+)\/membership$/)
  if (membershipGrantMatch && method === 'POST') {
    const customerId = decodeURIComponent(membershipGrantMatch[1] ?? '')
    const planId = typeof body?.planId === 'string' ? body.planId : ''
    if (!mockMembershipPlans.some(plan => plan.id === planId)) {
      return error(404, 'membership plan not found')
    }
    mockMembershipAssignments.set(customerId, planId)
    return hit(mockMembershipOf(customerId))
  }

  if (
    pathname === '/v1/course/reservation-report-imports/preview'
    && method === 'POST'
  ) {
    const year = Number(multipartText(init, 'year') ?? '2026')
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      return error(400, 'year must be a valid calendar year')
    }
    const headers = ['施設', '日付', '時間帯', '組数', 'キャ付']
    const defaultColumnMappings: Record<string, string> = {
      facilityName: '施設',
      date: '日付',
      dayPart: '時間帯',
      groupCount: '組数',
      caddieAttachedGroupCount: 'キャ付',
    }
    const rawColumnMappings = multipartText(init, 'columnMappings')
    let columnMappings = defaultColumnMappings
    if (rawColumnMappings) {
      try {
        const parsed = JSON.parse(rawColumnMappings) as Record<string, unknown>
        columnMappings = Object.fromEntries(
          Object.entries(parsed).map(([target, source]) => [target, String(source)]),
        )
      } catch {
        return error(400, 'columnMappings must be valid JSON')
      }
      const selected = Object.values(columnMappings)
      if (
        Object.keys(columnMappings).length !== Object.keys(defaultColumnMappings).length
        || Object.keys(defaultColumnMappings).some(target => !columnMappings[target])
        || selected.some(source => !headers.includes(source))
        || new Set(selected).size !== selected.length
      ) {
        return error(400, 'every CourseBoard field must have one distinct source column')
      }
    }
    const rows = mockReservationReportRows(year)
    return hit({
      sourceSystem: MOCK_RESERVATION_REPORT_SOURCE,
      sourceFileSha256: 'mock-report-sha256',
      normalizedFingerprint: rawColumnMappings
        ? 'mock-user-normalized-fingerprint'
        : 'mock-normalized-fingerprint',
      facilities: MOCK_RESERVATION_REPORT_FACILITIES.map(facility => ({ ...facility })),
      rows,
      analysis: {
        sourceType: 'xlsx',
        sheetNames: ['日別予約状況'],
        selectedSheet: '日別予約状況',
        headerRow: 1,
        headers,
        mapping: {
          mode: rawColumnMappings ? 'user' : 'alias',
          fields: Object.entries(defaultColumnMappings).map(([target, defaultSource]) => ({
            source: columnMappings[target] ?? defaultSource,
            target,
            required: true,
            confidence: 1,
            explanation: rawColumnMappings ? 'CourseBoardで利用者が確認' : '既知の列名から判定',
            samples: target === 'facilityName' ? ['真駒内'] : [],
          })),
          notes: rawColumnMappings ? '利用者が列対応を確認しました。' : null,
        },
        warnings: [],
      },
      totals: {
        facilityCount: MOCK_RESERVATION_REPORT_FACILITIES.length,
        rowCount: rows.length,
        groupCount: rows.reduce((sum, row) => sum + row.groupCount, 0),
        caddieAttachedGroupCount: rows.reduce(
          (sum, row) => sum + row.caddieAttachedGroupCount,
          0,
        ),
      },
      // The fixture report is internally consistent, so it has nothing for the
      // desk to compare against the original.
      review: [],
    })
  }

  if (pathname === '/v1/course/reservation-report-imports' && method === 'POST') {
    const year = Number(multipartText(init, 'year') ?? '2026')
    const rawMappings = multipartText(init, 'courseMappings')
    const rawColumnMappings = multipartText(init, 'columnMappings')
    const normalizedFingerprint = multipartText(init, 'normalizedFingerprint')
    if (!rawColumnMappings) {
      return error(400, 'columnMappings is required for analyzed table imports')
    }
    if (normalizedFingerprint !== 'mock-user-normalized-fingerprint') {
      return error(409, 'the report changed while it was being analyzed; preview it again')
    }
    let mappings: Record<string, string> = {}
    try {
      const parsed = rawMappings ? JSON.parse(rawMappings) as unknown : null
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        mappings = Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [key, String(value)]),
        )
      }
    } catch {
      return error(400, 'courseMappings must be valid JSON')
    }
    const rows = mockReservationReportRows(year)
    const selectedCourses = new Set<string>()
    for (const facility of MOCK_RESERVATION_REPORT_FACILITIES) {
      const golfCourseId = mappings[facility.sourceCourseKey]
      if (!golfCourseId) return error(400, 'every source facility must be mapped')
      if (selectedCourses.has(golfCourseId)) return error(400, 'course mappings must be unique')
      selectedCourses.add(golfCourseId)
    }
    let createdCount = 0
    let updatedCount = 0
    let unchangedCount = 0
    for (const row of rows) {
      const golfCourseId = mappings[row.sourceCourseKey]!
      const key = `${row.sourceCourseKey}:${row.date}:${row.dayPart}`
      const index = mockReservationReportEntries.findIndex(entry => (
        `${entry.sourceCourseKey}:${entry.date}:${entry.dayPart}` === key
      ))
      const existing = index >= 0 ? mockReservationReportEntries[index] : undefined
      const next: MockReservationReportEntry = {
        ...row,
        id: existing?.id ?? `report_${key}`,
        golfCourseId,
        sourceFileSha256: 'mock-report-sha256',
        updatedAt: NOW,
      }
      if (!existing) createdCount += 1
      else if (
        existing.golfCourseId !== next.golfCourseId
        || existing.groupCount !== next.groupCount
        || existing.caddieAttachedGroupCount !== next.caddieAttachedGroupCount
        || existing.sourceFileSha256 !== next.sourceFileSha256
      ) updatedCount += 1
      else unchangedCount += 1
      if (index >= 0) mockReservationReportEntries[index] = next
      else mockReservationReportEntries.push(next)
    }
    saveMockWrites('reservationReportEntries', mockReservationReportEntries)
    return hit({
      createdCount,
      updatedCount,
      unchangedCount,
      totals: {
        facilityCount: MOCK_RESERVATION_REPORT_FACILITIES.length,
        rowCount: rows.length,
        groupCount: rows.reduce((sum, row) => sum + row.groupCount, 0),
        caddieAttachedGroupCount: rows.reduce(
          (sum, row) => sum + row.caddieAttachedGroupCount,
          0,
        ),
      },
      items: mockReservationReportEntries.map(entry => ({ ...entry })),
    })
  }

  // Desk marks and group detail are CourseBoard's own writes, so they never
  // reach a Field path; keeping them in the fixture store lets the ledger's
  // whole edit loop be walked through without a backend.
  if (pathname === '/v1/course/reservations' && method === 'POST') {
    const golfCourseId = typeof body?.golfCourseId === 'string' ? body.golfCourseId.trim() : ''
    const resourceId = typeof body?.resourceId === 'string' ? body.resourceId.trim() : ''
    const date = typeof body?.date === 'string' ? body.date : ''
    const teeTime = typeof body?.teeTime === 'string' ? body.teeTime : ''
    const customerName = typeof body?.customerName === 'string' ? body.customerName.trim() : ''
    const durationMinutes = body?.durationMinutes
    const quantity = body?.quantity

    if (!golfCourseId) return error(400, 'golfCourseId is required')
    if (!resourceId) return error(400, 'resourceId is required')
    if (!customerName) return error(400, 'customerName is required')
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
      return error(400, 'quantity must be positive')
    }
    if (
      typeof durationMinutes !== 'number'
      || !Number.isInteger(durationMinutes)
      || durationMinutes <= 0
      || durationMinutes > 24 * 60
    ) {
      return error(400, 'durationMinutes must be between 1 minute and 24 hours')
    }
    if (!isMockDate(date) || !isMockTeeTime(teeTime)) {
      return error(400, 'date and teeTime are required')
    }
    if (body?.reservationServiceId != null && typeof body.reservationServiceId !== 'string') {
      return error(400, 'reservationServiceId must be a string')
    }

    const course = mockCourses.find(item => item.id === golfCourseId && item.isActive)
    if (!course || resourceId !== mockReservationResourceId(course.id)) {
      return error(400, '選択したコースと予約枠が一致しません。台帳を読み込み直してください')
    }

    // Match CreateReservationUseCase: a missing/inactive generated row and a
    // row with no groups left are both the public 409 stale-ledger contract.
    const generatedSlotExists = mockSlotTimes(course).includes(teeTime)
    const bookedGroups = mockTeeReservations.filter(
      reservation =>
        reservation.golfCourseId === golfCourseId
        && reservation.teeTime.startsWith(`${date}T${teeTime}:`),
    ).length
    if (!generatedSlotExists || bookedGroups >= MOCK_SLOT_CAPACITY) {
      return error(409, 'この枠はちょうど埋まりました')
    }

    const reservationServiceId = typeof body?.reservationServiceId === 'string'
      ? body.reservationServiceId
      : null
    const product = mockProducts.find(item => item.reservationServiceId === reservationServiceId)
    const sequence = `${Date.now()}_${mockTeeReservations.length + 1}`
    // The booking sheet asks for the group detail while the caller is on the
    // phone, and the real use case stores it with the booking. Dropping it here
    // made a freshly booked row read back empty on the fixtures.
    const party = {
      ...(body?.competitionName ? { competitionName: String(body.competitionName) } : {}),
      ...(body?.organizer ? { organizer: String(body.organizer) } : {}),
      ...(typeof body?.groupNumber === 'number' ? { groupNumber: body.groupNumber } : {}),
      players: Array.isArray(body?.players) ? body.players : [],
    }
    const created: MockTeeReservation = {
      id: `res_mock_${sequence}`,
      reservationNumber: `R-MOCK-${sequence}`,
      reservationServiceId,
      displayName: product?.displayName ?? null,
      golfCourseId,
      courseName: course.name,
      teeTime: `${date}T${teeTime}:00+09:00`,
      durationMinutes,
      playType: product?.playType === 'self' ? 'self' : 'caddie',
      partySize: quantity,
      partyName: customerName,
      status: 'confirmed',
      holes: product?.holeCount ?? 18,
      party,
      // This is added by the real CourseBoard use case on its outbound Field
      // request, rather than posted by NewReservationEditor.
      prepaymentPolicy: 'none',
    }
    mockTeeReservations.push(created)
    saveMockWrites('teeReservations', mockTeeReservations)
    mockParties[created.id] = party
    saveMockWrites('parties', mockParties)
    return hit({ id: created.id })
  }

  const cancelMatch = /^\/v1\/course\/reservations\/([^/]+)\/cancel$/.exec(pathname)
  if (cancelMatch && method === 'POST') {
    const reservationId = decodeURIComponent(cancelMatch[1] ?? '')
    const reason = body?.reason
    if (reason != null && typeof reason !== 'string') {
      return error(400, 'reason must be a string')
    }
    if (typeof reason === 'string' && [...reason.trim()].length > 500) {
      return error(400, 'the cancellation reason is too long')
    }
    const index = mockTeeReservations.findIndex(item => item.id === reservationId)
    if (index < 0) return error(404, 'Mock Field API has no such reservation')
    mockTeeReservations.splice(index, 1)
    delete mockParties[reservationId]
    // The API takes the caddies off a group it cancels; a mock that left them
    // assigned would show a caddie booked for a round that no longer exists.
    for (const assignment of mockAssignments) {
      if (assignment.reservationId === reservationId && assignment.status !== 'cancelled') {
        assignment.status = 'cancelled'
      }
    }
    saveMockWrites('teeReservations', mockTeeReservations)
    saveMockWrites('parties', mockParties)
    return hit(null)
  }

  if (pathname === '/v1/course/course-order' && method === 'PUT') {
    const ids = Array.isArray(body?.golfCourseIds) ? (body.golfCourseIds as string[]) : []
    const known = mockCourses.map(course => course.id)
    mockCourseOrder.splice(0, mockCourseOrder.length, ...ids.filter(id => known.includes(id)))
    saveMockWrites('courseOrder', mockCourseOrder)
    return hit({ golfCourseIds: [...mockCourseOrder] })
  }

  if (pathname === '/v1/course/caddie-rank-fees' && method === 'PUT') {
    const ranks = ['a', 'b', 'c', 'd'] as const
    for (const rank of ranks) {
      const amount = Number(body?.[rank])
      // The API refuses these rather than clamping, so the mock does too.
      if (!Number.isInteger(amount) || amount < 0 || amount > 1_000_000) {
        return error(400, 'a round fee cannot be negative')
      }
      mockRankFees[rank] = amount
    }
    const currency = String(body?.currency ?? '').trim().toUpperCase()
    if (currency) mockRankFees.currency = currency
    saveMockWrites('caddieRankFees', mockRankFees)
    return hit({ ...mockRankFees })
  }

  if (pathname === '/v1/course/caddie-shift-rules' && method === 'PUT') {
    const weekdays = Array.isArray(body?.avoidedRestWeekdays)
      ? body.avoidedRestWeekdays.map(String).filter(day => MOCK_WEEK.includes(day as never))
      : []
    const consecutive = Number(body?.maxConsecutiveWorkDays ?? mockShiftRules.maxConsecutiveWorkDays)
    const rounds = Number(body?.maxRoundsPerDay ?? mockShiftRules.maxRoundsPerDay)
    const minRest = Number(body?.minRestDaysPerMonth ?? mockShiftRules.minRestDaysPerMonth)
    // The API refuses these rather than clamping, so the mock does too.
    if (consecutive < 1 || consecutive > MOCK_STATUTORY_MAX_CONSECUTIVE_WORK_DAYS) {
      return error(400, '連続勤務の上限は1日以上6日以下です')
    }
    if (rounds < 1 || rounds > MOCK_MAX_ROUNDS_CEILING) {
      return error(400, '1日の最大ラウンド数は1組または2組です')
    }
    if (minRest < 0 || minRest > 31) {
      return error(400, '月の最低休日数は0日以上31日以下です')
    }
    mockShiftRules.avoidedRestWeekdays = weekdays
    mockShiftRules.maxConsecutiveWorkDays = consecutive
    mockShiftRules.maxRoundsPerDay = rounds
    mockShiftRules.minRestDaysPerMonth = minRest
    mockShiftRules.unfiledRequest = body?.unfiledRequest === 'off' ? 'off' : 'working'
    saveMockWrites('shiftRules', mockShiftRules)
    return hit(mockShiftRulesDto())
  }

  const shiftPlanPreviewMatch = pathname.match(
    /^\/v1\/course\/caddie-shift-plans\/([^/]+)\/preview$/,
  )
  if (shiftPlanPreviewMatch && method === 'POST') {
    const yearMonth = decodeURIComponent(shiftPlanPreviewMatch[1] ?? '')
    const run = planMockMonth(yearMonth, false)
    return hit({
      summary: {
        yearMonth,
        daysWritten: run.daysWritten,
        pinnedKept: run.pinnedKept,
        unplaced: run.unplaced,
        statutoryRestDays: run.statutoryRestDays,
        overworked: run.overworked,
        deadlineWarning: null,
      },
      shifts: run.shifts,
    })
  }

  const shiftPlanMatch = pathname.match(/^\/v1\/course\/caddie-shift-plans\/([^/]+)$/)
  if (shiftPlanMatch && method === 'POST') {
    const yearMonth = decodeURIComponent(shiftPlanMatch[1] ?? '')
    const run = planMockMonth(yearMonth)
    return hit({
      yearMonth,
      daysWritten: run.daysWritten,
      pinnedKept: run.pinnedKept,
      unplaced: run.unplaced,
      statutoryRestDays: run.statutoryRestDays,
      overworked: run.overworked,
      deadlineWarning: null,
    })
  }

  const shiftDayMatch = pathname.match(/^\/v1\/course\/caddie-shifts\/([^/]+)\/([^/]+)$/)
  if (shiftDayMatch && method === 'PUT') {
    const caddieProfileId = decodeURIComponent(shiftDayMatch[1] ?? '')
    const date = decodeURIComponent(shiftDayMatch[2] ?? '')
    const isWorking = body?.isWorking !== false
    const golfCourseId = body?.golfCourseId == null ? null : String(body.golfCourseId)
    // The API refuses a course the caddie has no membership for; the mock
    // refuses it too, so the message can be seen without a backend.
    if (
      isWorking
      && golfCourseId
      && !mockMemberships(caddieProfileId).some(entry => entry.golfCourseId === golfCourseId)
    ) {
      return error(400, 'the caddie has no membership for that course')
    }
    const stored: MockShift = {
      caddieProfileId,
      date,
      golfCourseId: isWorking ? golfCourseId : null,
      isWorking,
      span: isWorking ? String(body?.span ?? 'full_day') : 'full_day',
      roundsCapacity: isWorking ? Number(body?.roundsCapacity ?? 1) : 0,
      origin: body?.pinned === true ? 'pinned' : 'edited',
      note: body?.note == null ? null : String(body.note),
      updatedBy: body?.updatedBy == null ? null : String(body.updatedBy),
      updatedAt: NOW,
    }
    storeShift(stored)
    return hit(stored)
  }

  if (pathname === '/v1/course/slot-overrides' && method === 'PUT') {
    const golfCourseId = String(body?.golfCourseId ?? '')
    const date = String(body?.date ?? TODAY)
    const teeTimes = Array.isArray(body?.teeTimes) ? (body.teeTimes as string[]) : []
    const written = teeTimes.map(teeTime => {
      const mark = {
        golfCourseId,
        date,
        teeTime,
        kind: (body?.kind === 'closed' ? 'closed' : 'special_rate') as 'closed' | 'special_rate',
        ...(body?.label ? { label: String(body.label) } : {}),
      }
      const at = mockSlotMarks.findIndex(
        entry =>
          entry.golfCourseId === golfCourseId && entry.date === date && entry.teeTime === teeTime,
      )
      if (at === -1) mockSlotMarks.push(mark)
      else mockSlotMarks[at] = mark
      return mark
    })
    saveMockWrites('slotMarks', mockSlotMarks)
    return hit(items(written.map(mark => ({ ...mark }))))
  }

  const deadlinePutMatch = pathname.match(
    /^\/v1\/course\/caddie-availability-deadlines\/([^/]+)$/,
  )
  if (deadlinePutMatch && method === 'PUT') {
    const yearMonth = deadlinePutMatch[1]
    const deadlineDate = String(body?.deadlineDate ?? '')
    mockAvailabilityDeadlines[yearMonth] = deadlineDate
    saveMockWrites('availabilityDeadlines', mockAvailabilityDeadlines)
    return hit({ yearMonth, deadlineDate })
  }

  if (pathname === '/v1/course/slot-overrides' && method === 'DELETE') {
    const golfCourseId = String(body?.golfCourseId ?? '')
    const date = String(body?.date ?? TODAY)
    const teeTimes = Array.isArray(body?.teeTimes) ? (body.teeTimes as string[]) : []
    let deleted = 0
    for (const teeTime of teeTimes) {
      const at = mockSlotMarks.findIndex(
        entry =>
          entry.golfCourseId === golfCourseId && entry.date === date && entry.teeTime === teeTime,
      )
      if (at !== -1) {
        mockSlotMarks.splice(at, 1)
        deleted += 1
      }
    }
    saveMockWrites('slotMarks', mockSlotMarks)
    return hit({ deleted })
  }

  const bookingMatch = /^\/v1\/course\/reservations\/([^/]+)$/.exec(pathname)
  if (bookingMatch && method === 'PATCH') {
    const reservation = mockTeeReservations.find(item => item.id === bookingMatch[1])
    if (!reservation) return error(404, 'Mock Field API has no such reservation')
    const customerName = String(body?.customerName ?? '').trim()
    const quantity = Number(body?.quantity)
    if (!customerName) return error(400, 'customer name is required')
    if (!Number.isInteger(quantity) || quantity <= 0) return error(400, 'quantity must be positive')
    reservation.partyName = customerName
    reservation.partySize = quantity
    mockBookings[reservation.id] = { partyName: customerName, partySize: quantity }
    saveMockWrites('bookings', mockBookings)
    return hit(null)
  }

  const planMatch = /^\/v1\/course\/reservations\/([^/]+)\/plan$/.exec(pathname)
  if (planMatch && method === 'PATCH') {
    const reservation = mockTeeReservations.find(item => item.id === planMatch[1])
    if (!reservation) return error(404, 'Mock Field API has no such reservation')
    const serviceId = String(body?.reservationServiceId ?? '')
    const product = mockProducts.find(item => item.reservationServiceId === serviceId)
    if (!product) return error(404, 'Mock Field API sells no such plan')
    if (product.golfCourseId && product.golfCourseId !== reservation.golfCourseId) {
      return error(400, 'the plan is not sold on this booking’s course')
    }
    reservation.reservationServiceId = serviceId
    reservation.durationMinutes = product.expectedDurationMinutes
    reservation.playType = product.playType === 'caddie' ? 'caddie' : 'self'
    mockPlans[reservation.id] = serviceId
    saveMockWrites('plans', mockPlans)
    return hit(null)
  }

  const partyMatch = /^\/v1\/course\/reservations\/([^/]+)\/party$/.exec(pathname)
  if (partyMatch && method === 'PATCH') {
    const reservation = mockTeeReservations.find(item => item.id === partyMatch[1])
    if (!reservation) return error(404, 'Mock Field API has no such reservation')
    const party = {
      ...(body?.competitionName ? { competitionName: String(body.competitionName) } : {}),
      ...(body?.organizer ? { organizer: String(body.organizer) } : {}),
      ...(typeof body?.groupNumber === 'number' ? { groupNumber: body.groupNumber } : {}),
      players: Array.isArray(body?.players) ? body.players : [],
    }
    ;(reservation as Record<string, unknown>).party = party
    mockParties[reservation.id] = party
    saveMockWrites('parties', mockParties)
    return hit(party as Json)
  }

  if (pathname === '/v1/erp/staff' && method === 'POST') {
    const status = mockEmploymentStatus(body?.employmentStatus, body?.active)
    const registered = {
      id: `staff_${Date.now()}`,
      name: String(body?.name ?? 'New staff'),
      employmentStatus: status,
      active: status === 'active',
      employmentType: String(body?.employmentType ?? 'part_time'),
      hiredAt: body?.hiredAt == null ? null : String(body.hiredAt),
      contractEndDate: body?.contractEndDate == null ? null : String(body.contractEndDate),
      phone: body?.phone == null ? null : String(body.phone),
      email: body?.email == null ? null : String(body.email),
      attributesJson: body?.attributesJson ?? null,
    }
    mockStaff.push(registered)
    return hit({ ...registered })
  }

  const staffWriteMatch = pathname.match(/^\/v1\/erp\/staff\/([^/]+)$/)
  if (staffWriteMatch && method === 'PATCH') {
    const staffId = decodeURIComponent(staffWriteMatch[1] ?? '')
    const index = mockStaff.findIndex(item => item.id === staffId)
    if (index < 0) return error(404, `Mock staff ${staffId} was not found`)
    const current = mockStaff[index]!
    // Field merges a patch: a key left out keeps its stored value, and an
    // explicit null clears the ones that are nullable. Mirroring that here is
    // what keeps a partial request from looking destructive when it is not.
    const updated: MockStaffMember = { ...current }
    if (body?.name !== undefined) updated.name = String(body.name)
    if (body?.employmentType !== undefined) {
      updated.employmentType = String(body.employmentType)
    }
    if (body?.employmentStatus !== undefined || body?.active !== undefined) {
      updated.employmentStatus = mockEmploymentStatus(body?.employmentStatus, body?.active)
      updated.active = updated.employmentStatus === 'active'
    }
    for (const key of ['hiredAt', 'contractEndDate', 'phone', 'email'] as const) {
      if (body?.[key] !== undefined) {
        updated[key] = body[key] == null ? null : String(body[key])
      }
    }
    if (body?.attributesJson !== undefined) {
      updated.attributesJson = body.attributesJson ?? null
    }
    mockStaff[index] = updated
    return hit({ ...updated })
  }

  if (staffWriteMatch && method === 'DELETE') {
    const staffId = decodeURIComponent(staffWriteMatch[1] ?? '')
    const index = mockStaff.findIndex(item => item.id === staffId)
    // Field hides the record rather than dropping it, but from every read this
    // app makes the two are the same thing — and a second delete is a 404.
    if (index < 0) return error(404, `Mock staff ${staffId} was not found`)
    mockStaff.splice(index, 1)
    return hit(null)
  }

  if (pathname === '/v1/field/iam/users/invite' && method === 'POST') {
    const email = body?.email == null ? '' : String(body.email).trim().toLowerCase()
    if (!email) return error(400, 'email is required')
    let role: string | null
    let customPolicyIds: string[]
    if (Array.isArray(body?.policyIds)) {
      const split = splitMockPolicyIds(body.policyIds.map(String))
      if ('error' in split) return error(400, split.error)
      role = split.role
      customPolicyIds = split.customPolicyIds
    } else {
      role = IAM_ROLE_BY_REQUEST[String(body?.role ?? '')] ?? null
      if (!role) return error(400, 'either role or policyIds is required')
      customPolicyIds = Array.isArray(body?.customPolicyIds)
        ? body.customPolicyIds.map(String)
        : []
    }
    const existing = mockIamMembers.find(member => member.email === email)
    if (existing) {
      existing.role = existing.isOwner ? null : role
      if (!existing.isOwner) existing.customPolicyIds = customPolicyIds
      return hit({
        invitationSent: false,
        email,
        user: { ...existing },
        customPolicyIds,
      })
    }
    // New addresses only receive an invitation email; policies are assigned
    // after the invitee accepts, so the roster does not change yet.
    return hit({
      invitationSent: true,
      email,
      user: null,
      customPolicyIds,
    })
  }

  const iamPoliciesMatch = pathname.match(/^\/v1\/field\/iam\/users\/([^/]+)\/policies$/)
  if (iamPoliciesMatch && method === 'PUT') {
    const userId = decodeURIComponent(iamPoliciesMatch[1] ?? '')
    const member = mockIamMembers.find(entry => entry.id === userId)
    if (!member) return error(404, `Mock IAM user ${userId} was not found`)
    if (member.isOwner) {
      return error(400, 'Tenant owner access is managed by AdministratorAccess')
    }
    if (!Array.isArray(body?.policyIds)) return error(400, 'policyIds is required')
    const split = splitMockPolicyIds(body.policyIds.map(String))
    if ('error' in split) return error(400, split.error)
    member.role = split.role
    member.customPolicyIds = split.customPolicyIds
    return hit({ ...member })
  }

  const iamUserMatch = pathname.match(/^\/v1\/field\/iam\/users\/([^/]+)$/)
  if (iamUserMatch && method === 'DELETE') {
    const userId = decodeURIComponent(iamUserMatch[1] ?? '')
    const index = mockIamMembers.findIndex(entry => entry.id === userId)
    if (index < 0) return error(404, `Mock IAM user ${userId} was not found`)
    if (mockIamMembers[index]!.isOwner) {
      return error(400, 'Tenant owner access is managed by AdministratorAccess')
    }
    mockIamMembers.splice(index, 1)
    return hit(null)
  }

  if (pathname === '/v1/erp/extensions/golf-course/courses' && method === 'POST') {
    const created = {
      id: `course_${Date.now()}`,
      name: String(body?.name ?? 'New course'),
      shortName: body?.shortName == null ? '' : String(body.shortName),
      holeCount: Number(body?.holeCount ?? 18),
      timezone: String(body?.timezone ?? 'Asia/Tokyo'),
      businessHoursJson: (body?.businessHoursJson as { open: string; close: string } | undefined)
        ?? { open: '07:00', close: '17:00' },
      startIntervalMinutes: Number(body?.startIntervalMinutes ?? 8),
      isActive: body?.isActive !== false,
      createdAt: NOW,
      updatedAt: NOW,
    }
    mockCourses.push(created)
    return hit(created)
  }

  const courseMatch = pathname.match(/^\/v1\/erp\/extensions\/golf-course\/courses\/([^/]+)$/)
  if (courseMatch) {
    const courseId = decodeURIComponent(courseMatch[1] ?? '')
    const index = mockCourses.findIndex(course => course.id === courseId)
    if (index < 0) return error(404, `Mock course ${courseId} was not found`)
    if (method === 'DELETE') {
      mockCourses.splice(index, 1)
      return hit(null)
    }
    if (method === 'PUT' || method === 'PATCH') {
      const current = mockCourses[index]!
      const updated = {
        ...current,
        ...body,
        id: current.id,
        updatedAt: NOW,
      }
      mockCourses[index] = updated as typeof current
      return hit(updated)
    }
  }

  const scheduleWriteMatch = pathname.match(
    /^\/v1\/erp\/extensions\/golf-course\/courses\/([^/]+)\/schedule$/,
  )
  if (scheduleWriteMatch && method === 'PUT') {
    // The real endpoint replaces the whole week, which is what the editor warns
    // about — so the fixture has to replace it too.
    const courseId = decodeURIComponent(scheduleWriteMatch[1] ?? '')
    const incoming = Array.isArray(body?.rules) ? body.rules as Array<Record<string, unknown>> : []
    mockSchedulesByCourse[courseId] = incoming.map((rule, index) => ({
      id: `rule_${courseId}_${index}`,
      weekday: Number(rule.weekday ?? 0),
      startTime: String(rule.startTime ?? '07:00'),
      endTime: String(rule.endTime ?? '12:00'),
      capacity: Number(rule.capacity ?? 1),
      slotIntervalMinutes: Number(rule.slotIntervalMinutes ?? 8),
    }))
    // The API builds the tee times as part of the save, and answers with how
    // far the book now reaches. The fixture has to say the same, or the screen
    // cannot show what saving actually did.
    const bookableThrough = mockBookableThrough()
    return hit({
      items: mockSchedulesByCourse[courseId],
      bookableThrough,
      built: {
        created: mockGeneratedStarts(courseId, TODAY, bookableThrough),
        updated: 0,
        deactivated: 0,
        unchanged: 0,
      },
    })
  }

  if (pathname === '/v1/course/booking-horizon' && method === 'PUT') {
    const through = body?.through
    if (body?.days != null && through != null) {
      return error(400, 'send either days or through, not both')
    }
    if (typeof through === 'string') {
      const furthest = new Date(`${TODAY}T00:00:00Z`)
      furthest.setUTCDate(furthest.getUTCDate() + 399)
      if (through < TODAY || through > furthest.toISOString().slice(0, 10)) {
        return error(400, 'the last bookable date must be between today and 399 days ahead')
      }
      mockBookingHorizon = { mode: 'through', through }
      return hit(mockHorizonResponse())
    }
    const days = Number(body?.days)
    if (!Number.isInteger(days) || days < 1 || days > 399) {
      return error(400, 'booking horizon must be between 1 and 399 days')
    }
    mockBookingHorizon = { mode: 'days', days }
    return hit(mockHorizonResponse())
  }

  const generateMatch = pathname.match(
    /^\/v1\/erp\/extensions\/golf-course\/courses\/([^/]+)\/time-slots\/generate$/,
  )
  if (generateMatch && method === 'POST') {
    const courseId = decodeURIComponent(generateMatch[1] ?? '')
    return hit({
      created: mockGeneratedStarts(courseId, String(body?.from ?? TODAY), String(body?.to ?? TODAY)),
      updated: 0,
      deactivated: 0,
      unchanged: 0,
    })
  }

  const productWriteMatch = pathname.match(
    /^\/v1\/erp\/extensions\/golf-course\/reservation-products\/([^/]+)$/,
  )
  if (productWriteMatch && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    const serviceId = decodeURIComponent(productWriteMatch[1] ?? '')
    const index = mockProducts.findIndex(item => item.reservationServiceId === serviceId)
    const current = index < 0 ? null : mockProducts[index]!
    const golfCourseIds = Array.isArray(body?.golfCourseIds)
      ? (body.golfCourseIds as unknown[]).map(String)
      : body?.golfCourseId == null
        ? []
        : [String(body.golfCourseId)]
    const saved = {
      id: current?.id ?? `product_${serviceId.replace(/[^A-Za-z0-9]+/g, '_')}`,
      tenantId: TENANT_ID() || 'courseboard_id',
      extensionKey: 'golf_course',
      reservationServiceId: serviceId,
      displayName: body?.displayName == null ? null : String(body.displayName),
      golfCourseIds,
      golfCourseId: golfCourseIds.length === 1 ? golfCourseIds[0]! : null,
      playType: String(body?.playType ?? current?.playType ?? 'caddie'),
      holeCount: Number(body?.holeCount ?? current?.holeCount ?? 18),
      expectedDurationMinutes: Number(
        body?.expectedDurationMinutes ?? current?.expectedDurationMinutes ?? 240,
      ),
      createdAt: current?.createdAt ?? NOW,
      updatedAt: NOW,
    }
    if (index < 0) mockProducts.push(saved)
    else mockProducts[index] = saved
    return hit(saved)
  }

  const slotsWriteMatch = pathname.match(
    /^\/v1\/erp\/extensions\/golf-course\/reservation-products\/([^/]+)\/slots$/,
  )
  if (slotsWriteMatch && (method === 'PUT' || method === 'POST')) {
    // The real endpoint replaces the whole week, which is exactly the behaviour
    // the editor warns about — so the fixture has to replace it too.
    const serviceId = decodeURIComponent(slotsWriteMatch[1] ?? '')
    const product = mockProducts.find(item => item.reservationServiceId === serviceId)
    const incoming = Array.isArray(body?.slots) ? body.slots as Array<Record<string, unknown>> : []
    mockSlotsByService[serviceId] = incoming.map((slot, index) => ({
      id: `slot_${serviceId}_${index}`,
      golfReservationProductId: product?.id ?? `product_${serviceId}`,
      weekday: Number(slot.weekday ?? 0),
      startTime: String(slot.startTime ?? '07:00'),
      endTime: String(slot.endTime ?? '12:00'),
      maxGroups: Number(slot.maxGroups ?? 0),
      maxPlayers: Number(slot.maxPlayers ?? 0),
    }))
    return hit(items(mockSlotsByService[serviceId]))
  }

  if (pathname === '/v1/erp/extensions/golf-course/reservation-policy'
    && (method === 'PUT' || method === 'PATCH' || method === 'POST')) {
    mockReservationPolicy = {
      ...mockReservationPolicy,
      ...(body && typeof body === 'object' ? body as typeof mockReservationPolicy : {}),
      tenantId: TENANT_ID() || 'courseboard_id',
      updatedAt: NOW,
    }
    return hit({ ...mockReservationPolicy })
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-profiles' && method === 'POST') {
    const displayName = String(body?.displayName ?? 'New caddie')
    let staffId = body?.staffId == null ? '' : String(body.staffId).trim()
    let staffReferenceId = body?.staffReferenceId == null ? '' : String(body.staffReferenceId).trim()
    if (!staffId && !staffReferenceId) {
      // Being a caddie is one staff role, so course-api registers the staff
      // member a body without a link names, then links it.
      const registered: MockStaffMember = {
        id: `staff_${Date.now()}`,
        name: displayName,
        active: true,
        employmentStatus: 'active',
        employmentType: 'part_time',
        hiredAt: null,
        contractEndDate: null,
        phone: null,
        email: null,
        attributesJson: null,
      }
      mockStaff.push(registered)
      staffId = registered.id
      staffReferenceId = registered.id
    }
    const created: (typeof mockCaddies)[number] = {
      id: `caddie_${Date.now()}`,
      displayName,
      skillLevel: String(body?.skillLevel ?? 'regular'),
      rank: String(body?.rank ?? 'D'),
      baseFeeAmount: Number(body?.baseFeeAmount ?? 0),
      currency: String(body?.currency ?? 'JPY'),
      staffId: staffId || staffReferenceId,
      staffReferenceType: 'erp_staff',
      staffReferenceId: staffReferenceId || staffId,
      active: body?.active !== false,
      employmentStatus: String(body?.employmentStatus ?? 'active'),
      maxRoundsPerDay: Number(body?.maxRoundsPerDay ?? 2),
      ratingCount: 0,
      ratingAverage: 0,
      canTwoRounds: Boolean(body?.canTwoRounds),
      monthlyContractRounds: Number(body?.monthlyContractRounds ?? 14),
      desiredIncome: Number(body?.desiredIncome ?? 0),
    }
    mockCaddies.push(created)
    return hit(created)
  }

  const caddieMatch = pathname.match(
    /^\/v1\/erp\/extensions\/golf-course\/caddie-profiles\/([^/]+)$/,
  )
  if (caddieMatch && (method === 'PATCH' || method === 'PUT')) {
    const caddieId = decodeURIComponent(caddieMatch[1] ?? '')
    const index = mockCaddies.findIndex(item => item.id === caddieId)
    if (index < 0) return error(404, `Mock caddie ${caddieId} was not found`)
    const current = mockCaddies[index]!
    // Field resolves the profile's staff link on every write, so a profile
    // whose staff member has been deleted can no longer be edited at all.
    // Reproduced here because the screens that delete staff have to suspend
    // the caddie first, and a mock that quietly allowed this let that ship.
    const linkedStaffId = (current as { staffId?: string | null }).staffId
    if (linkedStaffId && !mockStaff.some(member => member.id === linkedStaffId)) {
      return error(404, 'NotFoundError: staff member not found')
    }
    const updated = { ...current, ...body, id: current.id }
    mockCaddies[index] = updated as typeof current
    return hit(updated)
  }

  if (caddieMatch && method === 'DELETE') {
    const caddieId = decodeURIComponent(caddieMatch[1] ?? '')
    const index = mockCaddies.findIndex(item => item.id === caddieId)
    // Field keeps the row and hides it, but every read this app makes treats
    // hidden as gone — and deleting a caddie twice is a 404.
    if (index < 0) return error(404, `Mock caddie ${caddieId} was not found`)
    mockCaddies.splice(index, 1)
    return hit(null)
  }

  const assignmentMatch = pathname.match(
    /^\/v1\/erp\/extensions\/golf-course\/caddie-assignments\/([^/]+)$/,
  )
  if (assignmentMatch && (method === 'PATCH' || method === 'PUT')) {
    const assignmentId = decodeURIComponent(assignmentMatch[1] ?? '')
    const index = mockAssignments.findIndex(item => item.id === assignmentId)
    if (index < 0) return error(404, `Mock assignment ${assignmentId} was not found`)
    const current = mockAssignments[index]!
    const updated = { ...current, ...body, id: current.id }
    mockAssignments[index] = updated as typeof current
    return hit(updated)
  }

  const membershipMatch = pathname.match(
    /^\/v1\/erp\/extensions\/golf-course\/caddie-profiles\/([^/]+)\/courses$/,
  )
  if (membershipMatch && method === 'PUT') {
    const profileId = decodeURIComponent(membershipMatch[1] ?? '')
    const courseIds = Array.isArray(body?.courseIds) ? body.courseIds.map(String) : []
    const primary = body?.primaryCourseId == null ? courseIds[0] : String(body.primaryCourseId)
    return hit(items(courseIds.map((courseId, index) => ({
      id: `membership_${profileId}_${courseId}`,
      caddieProfileId: profileId,
      golfCourseId: courseId,
      isPrimary: courseId === primary || (index === 0 && !primary),
    }))))
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-availabilities'
    && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    return hit({
      id: `avail_${String(body?.caddieProfileId ?? 'caddie')}_${String(body?.date ?? TODAY)}`,
      caddieProfileId: String(body?.caddieProfileId ?? ''),
      date: String(body?.date ?? TODAY),
      status: String(body?.status ?? 'available'),
      twoRoundRequest: Boolean(body?.twoRoundRequest),
      healthNote: body?.healthNote ?? null,
      updatedAt: NOW,
    })
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-auto-assignments' && method === 'POST') {
    return hit({
      dryRun: Boolean(body?.dryRun),
      assigned: [],
      skipped: [{ reservationId: 'res_mock', reason: 'Mock mode does not auto-assign' }],
    })
  }

  if (pathname === '/v1/erp/extensions/golf-course/daily-budgets' && method === 'POST') {
    return hit({
      id: `budget_${Date.now()}`,
      golfCourseId: String(body?.golfCourseId ?? 'course_east'),
      date: String(body?.date ?? TODAY),
      targetRevenue: Number(body?.targetRevenue ?? 0),
      targetAverageSpend: Number(body?.targetAverageSpend ?? 0),
      targetCaddyAttachedRatio: Number(body?.targetCaddyAttachedRatio ?? 0),
      updatedAt: NOW,
    })
  }

  if (pathname === '/v1/erp/extensions/golf-course/daily-budgets/import' && method === 'POST') {
    return hit(items([]))
  }

  if (
    (pathname === '/v1/course/config'
      || pathname === '/v1/erp/extensions/golf_course/config'
      || pathname === '/v1/erp/extensions/golf-course/config')
    && (method === 'PATCH' || method === 'PUT' || method === 'POST')
  ) {
    return hit(null)
  }

  // Mutations beyond browse fixtures stay explicit so developers know to opt out.
  if (method !== 'GET' && method !== 'HEAD') {
    return notSupported(`${method} ${pathname}`)
  }

  return error(
    404,
    `Mock Field API has no fixture for ${method} ${pathname}. Set VITE_COURSEBOARD_MOCK_DATA=false to use a real API.`,
  )
}

export function resolveMockFieldApiJson(path: string, init?: RequestInit): MockFieldResult<Json> {
  if (!isMockFieldDataEnabled()) return { kind: 'disabled' }
  const method = methodOf(init)
  if (method === 'GET' || method === 'HEAD') {
    const result = resolveGet(path)
    if (result === undefined) {
      return error(
        404,
        `Mock Field API has no fixture for GET ${pathnameOf(path)}. Set VITE_COURSEBOARD_MOCK_DATA=false to use a real API.`,
      )
    }
    if (result === null) {
      return error(404, `Mock Field API resource was not found: ${pathnameOf(path)}`)
    }
    return hit(result)
  }
  return resolveMutation(path, init)
}

export function resolveMockFieldApiText(path: string, init?: RequestInit): MockFieldResult<string> {
  if (!isMockFieldDataEnabled()) return { kind: 'disabled' }
  const pathname = pathnameOf(path)
  const method = methodOf(init)

  const normalized = normalizeMockPath(pathname)

  if (
    (pathname === '/v1/course/config'
      || normalized === '/v1/erp/extensions/golf_course/config'
      || normalized === '/v1/erp/extensions/golf-course/config'
      || pathname === '/v1/erp/extensions/golf_course/config')
    && (method === 'PATCH' || method === 'PUT' || method === 'POST')
  ) {
    return hit('')
  }

  if (
    (normalized === '/v1/erp/extensions/golf-course/caddie-availabilities'
      || pathname === '/v1/erp/extensions/golf-course/caddie-availabilities')
    && (method === 'POST' || method === 'PUT' || method === 'PATCH')
  ) {
    return hit('')
  }

  const availabilityMatch = normalized.match(
    /^\/v1\/erp\/extensions\/golf-course\/caddie-availabilities\/([^/]+)\/([^/]+)$/,
  )
  if (availabilityMatch && (method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
    return hit('')
  }

  if (
    normalized === '/v1/erp/extensions/golf-course/daily-budgets/import'
    && method === 'POST'
  ) {
    return hit('{"items":[]}')
  }

  if (method !== 'GET') return notSupported(`${method} ${pathname}`)

  if (
    normalized === '/v1/erp/extensions/golf-course/caddie-payroll-summary/export.csv'
    || pathname === '/v1/erp/extensions/golf-course/caddie-payroll-summary/export.csv'
  ) {
    // Built from the same rows the screen shows, exactly as the API does — a
    // file that disagreed with the screen would be the bug this export exists
    // to avoid.
    const yearMonth = new URL(path, 'http://mock.local').searchParams.get('yearMonth')
      ?? TODAY.slice(0, 7)
    const header = 'yearMonth,caddieProfileId,displayName,staffId,rank,roundFee,feeOverridden,'
      + 'assignedRounds,feeTotal,currency,workedMinutes,shiftedMinutes,openClockIn,'
      + 'roundsWithoutClockIn'
    return hit([
      header,
      ...mockCaddies.map(profile => {
        const row = payrollRow(profile)
        return [
          yearMonth,
          row.caddieProfileId,
          row.displayName,
          row.staffId ?? '',
          row.rank,
          row.roundFee,
          row.feeOverridden,
          row.assignedRounds,
          row.feeTotal,
          row.currency,
          row.workedMinutes,
          row.shiftedMinutes,
          row.openClockIn,
          row.roundsWithoutClockIn,
        ].join(',')
      }),
    ].join('\n') + '\n')
  }

  if (
    normalized === '/v1/erp/extensions/golf-course/monthly-settlement/export.csv'
    || pathname === '/v1/erp/extensions/golf-course/monthly-settlement/export.csv'
  ) {
    return hit([
      'metric,value',
      'gross_amount,1280000',
      'collected_amount,1150000',
      'caddie_fees,420000',
      'outstanding_cancellation_fees,11000',
    ].join('\n'))
  }

  if (pathname.endsWith('.csv')) {
    return hit('id,name\nmock,Mock CSV\n')
  }

  return error(
    404,
    `Mock Field API has no text fixture for GET ${pathname}. Set VITE_COURSEBOARD_MOCK_DATA=false to use a real API.`,
  )
}

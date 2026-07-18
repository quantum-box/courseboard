/**
 * Development auth (`VITE_COURSEBOARD_AUTH_MODE=development`) only stubs the
 * session. Feature screens still call Field API through the Vite proxy, which
 * fails or returns an empty DB unless a local Rust API is running with seed.
 *
 * When mock data is enabled, `fieldApiJson` / `fieldApiText` short-circuit to
 * in-memory fixtures so the UI stays browsable with the mock user.
 *
 * Enable: default ON while AUTH_MODE=development
 * Disable for a real local API: VITE_COURSEBOARD_MOCK_DATA=false
 */
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
  ?? (import.meta.env.DEV ? 'scc' : '')

const NOW = '2026-07-18T09:00:00+09:00'
const TODAY = '2026-07-18'

let mockReservationPolicy: Record<string, unknown> = {
  tenantId: 'scc',
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
    name: 'East Course',
    shortName: 'East',
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
    name: 'West Course',
    shortName: 'West',
    holeCount: 18,
    timezone: 'Asia/Tokyo',
    businessHoursJson: { open: '07:00', close: '17:00' },
    startIntervalMinutes: 10,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  },
]

const mockProducts = [
  {
    id: 'product_caddie_18',
    tenantId: 'scc',
    extensionKey: 'golf_course',
    reservationServiceId: 'svc:caddie-18',
    playType: 'caddie',
    holeCount: 18,
    expectedDurationMinutes: 270,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'product_self_18',
    tenantId: 'scc',
    extensionKey: 'golf_course',
    reservationServiceId: 'svc:self-18',
    playType: 'self',
    holeCount: 18,
    expectedDurationMinutes: 240,
    createdAt: NOW,
    updatedAt: NOW,
  },
]

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
    displayName: 'Aya Sato',
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
    baseFeeAmount: 12000,
    currency: 'JPY',
    maxRoundsPerDay: 2,
    ratingAverage: 4.8,
    ratingCount: 42,
  },
  {
    id: 'caddie_ken',
    displayName: 'Ken Watanabe',
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
    baseFeeAmount: 10000,
    currency: 'JPY',
    maxRoundsPerDay: 1,
    ratingAverage: 4.4,
    ratingCount: 18,
  },
]

const mockStaff = [
  { id: 'staff_aya', name: 'Aya Sato', active: true },
  { id: 'staff_ken', name: 'Ken Watanabe', active: true },
]

const mockInvoices = [
  {
    id: 'inv_mock_001',
    tenantId: 'scc',
    invoiceNumber: 'CF-2026-0001',
    clientId: 'client_mock_1',
    clientName: 'Taro Yamada',
    clientEmail: 'taro@example.com',
    clientPhone: '09012345678',
    lineItems: [
      {
        description: 'キャンセル料 (East Course / 2026-07-10)',
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
      reservationIds: ['res_mock_1', 'res_mock_2'],
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

function resolveGet(path: string): Json | null | undefined {
  const pathname = pathnameOf(path)
  const url = new URL(path, 'http://mock.local')

  if (pathname === '/v1/erp/extensions/status') return extensionStatus()

  if (pathname === `/v1/erp/extensions/golf_course/config`
    || pathname === '/v1/erp/extensions/golf-course/config') {
    return {
      extensionKey: 'golf_course',
      configVersion: 1,
      configJson: { defaultCurrency: 'JPY', timezone: 'Asia/Tokyo' },
      validation: { valid: true, errors: [] },
      updatedAt: NOW,
    }
  }

  if (pathname === '/v1/erp/extensions/golf-course/courses') {
    return items(mockCourses.map(course => ({ ...course })))
  }

  if (pathname === '/v1/erp/extensions/golf-course/reservation-products') {
    return items(mockProducts.map(product => ({
      ...product,
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

  if (pathname === '/v1/erp/extensions/golf-course/caddie-profiles') {
    return items(mockCaddies.map(profile => ({ ...profile })))
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-assignments') {
    return items([
      {
        id: 'assign_mock_1',
        caddieProfileId: 'caddie_aya',
        reservationId: 'res_mock_1',
        roundReference: 'R-2026-0100',
        scheduledAt: `${TODAY}T08:00:00+09:00`,
        status: 'assigned',
        assignmentRole: 'primary',
        feeAmount: 12000,
        feeCurrency: 'JPY',
        recommendationScore: 0.92,
        nominatedBy: 'mock',
        notes: 'Mock assignment',
      },
    ])
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-recommendations') {
    return items([
      {
        caddieProfileId: 'caddie_aya',
        displayName: 'Aya Sato',
        skillLevel: 'veteran',
        ratingAverage: 4.8,
        ratingCount: 42,
        roundsAssigned: 1,
        recommendationScore: 0.94,
        recommendedRole: 'primary',
        pairingDisplayName: null,
        rationale: ['High rating', 'Available for morning'],
      },
    ])
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-availabilities') {
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
    return {
      date,
      items: mockCaddies.map(profile => ({
        caddieProfileId: profile.id,
        displayName: profile.displayName,
        staffId: profile.staffId,
        attendanceStatus: profile.id === 'caddie_aya' ? 'working' : 'not_clocked',
        todayAssignments: profile.id === 'caddie_aya' ? 1 : 0,
        roundsWithoutClockInToday: 0,
      })),
    }
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-supply') {
    const date = url.searchParams.get('date') ?? TODAY
    const safetyBuffer = Number(url.searchParams.get('safetyBuffer') ?? 1)
    return {
      date,
      availableCaddies: 2,
      twoRoundCapable: 1,
      caddieSupply: 3,
      morningCapacity: 8,
      afternoonCapacity: 6,
      safetyBuffer,
      caddieAttachedCap: 12,
      currentCaddieAttached: 4,
      remaining: 8,
    }
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-payroll-summary') {
    const yearMonth = url.searchParams.get('yearMonth') ?? TODAY.slice(0, 7)
    const [year, month] = yearMonth.split('-').map(Number)
    return {
      period: {
        yearMonth,
        startDate: `${yearMonth}-01`,
        endDate: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
      },
      items: mockCaddies.map(profile => ({
        caddieProfileId: profile.id,
        displayName: profile.displayName,
        staffId: profile.staffId,
        workedMinutes: profile.id === 'caddie_aya' ? 2_400 : 1_600,
        shiftedMinutes: profile.id === 'caddie_aya' ? 2_520 : 1_680,
        assignedRounds: profile.id === 'caddie_aya' ? 12 : 8,
        confirmedFeeTotal: profile.id === 'caddie_aya' ? 144_000 : 80_000,
        roundsWithoutClockIn: 0,
        openClockIn: false,
        currency: 'JPY',
      })),
    }
  }

  const membershipMatch = pathname.match(
    /^\/v1\/erp\/extensions\/golf-course\/caddie-profiles\/([^/]+)\/courses$/,
  )
  if (membershipMatch) {
    const profileId = decodeURIComponent(membershipMatch[1] ?? '')
    return items([
      {
        id: `membership_${profileId}_east`,
        caddieProfileId: profileId,
        golfCourseId: 'course_east',
        isPrimary: true,
      },
    ])
  }

  if (pathname === '/v1/erp/extensions/golf-course/caddie-ratings') {
    const profileId = url.searchParams.get('caddieProfileId')
    return items(profileId
      ? [{
          id: `rating_${profileId}_1`,
          caddieProfileId: profileId,
          score: 5,
          comment: 'Mock rating',
          createdAt: NOW,
        }]
      : [])
  }

  if (pathname === '/v1/erp/staff') return items(mockStaff.map(member => ({ ...member })))

  if (pathname === '/v1/erp/extensions/golf-course/reservation-policy') {
    return { ...mockReservationPolicy, tenantId: TENANT_ID() || 'scc' }
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
  const pathname = pathnameOf(path)
  const method = methodOf(init)
  const body = parseBody(init) as Record<string, unknown> | undefined

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

  if (pathname === '/v1/erp/extensions/golf-course/reservation-policy'
    && (method === 'PUT' || method === 'PATCH' || method === 'POST')) {
    mockReservationPolicy = {
      ...mockReservationPolicy,
      ...(body && typeof body === 'object' ? body as typeof mockReservationPolicy : {}),
      tenantId: TENANT_ID() || 'scc',
      updatedAt: NOW,
    }
    return hit({ ...mockReservationPolicy })
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

  if (
    pathname === '/v1/erp/extensions/golf_course/config'
    && (method === 'PATCH' || method === 'PUT' || method === 'POST')
  ) {
    return hit('')
  }

  if (
    pathname === '/v1/erp/extensions/golf-course/caddie-availabilities'
    && (method === 'POST' || method === 'PUT' || method === 'PATCH')
  ) {
    return hit('')
  }

  const availabilityMatch = pathname.match(
    /^\/v1\/erp\/extensions\/golf-course\/caddie-availabilities\/([^/]+)\/([^/]+)$/,
  )
  if (availabilityMatch && (method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
    return hit('')
  }

  if (method !== 'GET') return notSupported(`${method} ${pathname}`)

  if (
    pathname === '/v1/erp/extensions/golf-course/monthly-settlement/export.csv'
    || pathname === '/v1/erp/extensions/golf-course/caddie-payroll-summary/export.csv'
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

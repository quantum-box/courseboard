/**
 * A club-sized set of fixtures, generated rather than written out.
 *
 * The hand-written fixtures in `mockFieldApi.ts` each stand for a situation
 * worth looking at — a cancelled booking, a group with no players typed in, a
 * caddie with no staff link. They are few on purpose. But a screen that reads
 * fine with five caddies and a dozen groups can still be unusable with forty
 * and sixty, and nothing here showed that until now.
 *
 * So this module generates the bulk: a full roster, a month of tee sheets
 * around the fixture day, and the assignments a club would have made by now.
 * Everything is derived from a fixed seed, so a reload shows the same club.
 */

/** Deterministic PRNG (mulberry32). Same seed, same club, every reload. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const FAMILY_NAMES = [
  '青木', '石川', '上田', '遠藤', '大野', '川村', '木下', '楠本', '小峰', '斎藤',
  '塩見', '菅原', '瀬川', '曽根', '高瀬', '千葉', '角田', '寺西', '土井', '中原',
  '西村', '沼田', '野口', '橋本', '平井', '福田', '堀内', '槙原', '溝口', '宮下',
  '村瀬', '森下', '安田', '柳原', '山下', '横川', '吉川', '和田',
]

const GIVEN_NAMES = [
  '明', '郁子', '英樹', '和也', '香織', '清美', '健太', '幸子', '悟', '早苗',
  '茂', '大地', '拓也', '千夏', '剛', '奈々', '春樹', '洋子', '真央', '実',
  '結衣', '雄一', '陽子', '涼', '玲奈', '亮太', '梨花', '直樹', '典子', '登',
]

const PARTY_PREFIX = [
  '田村', '小田', '三浦', '藤井', '岡本', '佐々木', '長谷川', '内田', '早川', '大塚',
  '南', '北村', '東', '西田', '篠原', '荒井', '池上', '牧野', '志村', '関口',
]

const PARTY_SUFFIX = ['組', '会', '様ご一行', 'コンペ', '会員']

/** Ranks in the order the fee table lists them, commonest first. */
const RANKS = ['B', 'A', 'C', 'B', 'D', 'B', 'A', 'C'] as const
const SKILLS = ['regular', 'veteran', 'regular', 'rookie', 'regular', 'veteran'] as const

export type GeneratedCaddie = {
  id: string
  displayName: string
  staffId: string
  staffReferenceType: string
  staffReferenceId: string
  active: boolean
  skillLevel: string
  rank: string
  monthlyContractRounds: number
  canTwoRounds: boolean
  desiredIncome: number
  employmentStatus: string
  baseFeeAmount: number
  currency: string
  maxRoundsPerDay: number
  ratingAverage: number | null
  ratingCount: number
}

export type GeneratedStaff = {
  id: string
  name: string
  active: boolean
  employmentType: string
}

export type GeneratedReservation = {
  id: string
  reservationNumber: string
  golfCourseId: string
  courseName: string
  teeTime: string
  durationMinutes: number
  playType: 'caddie' | 'self'
  partySize: number
  partyName: string
  status: string
  holes: number
}

export type GeneratedAssignment = {
  id: string
  caddieProfileId: string
  reservationId: string
  roundReference: string
  scheduledAt: string
  durationMinutes: number
  status: string
  assignmentRole: string
  feeAmount: number
  feeCurrency: string
  recommendationScore: number | null
  nominatedBy: string | null
  notes: string | null
  metadataJson: unknown | null
}

/** How big the generated club is. */
export const VOLUME = {
  /** Caddies on top of the hand-written five. */
  caddies: 35,
  /** Days of tee sheet before the fixture day. */
  daysBefore: 7,
  /** Days of tee sheet after it. Covers the fortnight the panel can look ahead. */
  daysAfter: 20,
}

const RANK_ROUNDS: Record<string, number> = { A: 20, B: 16, C: 12, D: 8 }
const RANK_INCOME: Record<string, number> = { A: 280_000, B: 220_000, C: 180_000, D: 140_000 }

/** The club's caddies, beyond the few written by hand. */
export function generateCaddies(): { caddies: GeneratedCaddie[]; staff: GeneratedStaff[] } {
  const random = seeded(20260718)
  const caddies: GeneratedCaddie[] = []
  const staff: GeneratedStaff[] = []
  const used = new Set<string>()

  for (let index = 0; index < VOLUME.caddies; index += 1) {
    let displayName = ''
    // Two caddies with the same name would make the board unreadable, and the
    // screens key on the id anyway — so keep drawing until the name is new.
    do {
      const family = FAMILY_NAMES[Math.floor(random() * FAMILY_NAMES.length)]!
      const given = GIVEN_NAMES[Math.floor(random() * GIVEN_NAMES.length)]!
      displayName = `${family} ${given}`
    } while (used.has(displayName))
    used.add(displayName)

    const id = `caddie_gen_${index + 1}`
    const staffId = `staff_gen_${index + 1}`
    const rank = RANKS[index % RANKS.length]!
    const skillLevel = SKILLS[index % SKILLS.length]!
    // A handful are on leave or suspended: the roster filters and the "cannot
    // clock in" path have nothing to show on an all-active club.
    const employmentStatus = index % 17 === 0 ? 'inactive' : index % 23 === 0 ? 'suspended' : 'active'
    const rated = index % 9 !== 0

    caddies.push({
      id,
      displayName,
      staffId,
      staffReferenceType: 'erp_staff',
      staffReferenceId: staffId,
      active: employmentStatus === 'active',
      skillLevel,
      rank,
      monthlyContractRounds: RANK_ROUNDS[rank]!,
      canTwoRounds: skillLevel !== 'rookie' && index % 3 !== 0,
      desiredIncome: RANK_INCOME[rank]!,
      employmentStatus,
      baseFeeAmount: 0,
      currency: 'JPY',
      maxRoundsPerDay: skillLevel !== 'rookie' && index % 3 !== 0 ? 2 : 1,
      ratingAverage: rated ? Math.round((3.4 + random() * 1.6) * 10) / 10 : null,
      ratingCount: rated ? 4 + Math.floor(random() * 60) : 0,
    })
    staff.push({
      id: staffId,
      name: displayName,
      active: employmentStatus === 'active',
      employmentType: 'part_time',
    })
  }

  return { caddies, staff }
}

/** `YYYY-MM-DD`, `days` from `from` (negative counts back). */
export function shiftDate(from: string, days: number): string {
  const day = new Date(`${from}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

/** Every day the generated board covers, in order. */
export function generatedDates(fixtureDate: string): string[] {
  const dates: string[] = []
  for (let offset = -VOLUME.daysBefore; offset <= VOLUME.daysAfter; offset += 1) {
    dates.push(shiftDate(fixtureDate, offset))
  }
  return dates
}

/** `07:00` + n intervals, as `HH:MM`. */
function slotTime(index: number, intervalMinutes: number): string {
  const minutes = 7 * 60 + index * intervalMinutes
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * A month of tee sheets around the fixture day.
 *
 * Weekends fill up and weekdays do not, which is what makes the supply figures
 * and the unassigned list say something different from one day to the next.
 */
export function generateReservations(
  fixtureDate: string,
  courses: Array<{ id: string; name: string; startIntervalMinutes: number }>,
): GeneratedReservation[] {
  const random = seeded(90210)
  const reservations: GeneratedReservation[] = []
  let sequence = 0

  for (const date of generatedDates(fixtureDate)) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
    const busy = weekday === 0 || weekday === 6
    // Morning is what sells; the afternoon thins out. Occupancy is per day so
    // that a quiet Tuesday reads differently from a full Sunday.
    const occupancy = busy ? 0.82 : 0.46

    for (const course of courses) {
      const slots = Math.floor((7 * 60) / course.startIntervalMinutes)
      for (let slot = 0; slot < slots; slot += 1) {
        // Later starts are less likely to be taken, whatever the day.
        const lateness = slot / slots
        if (random() > occupancy * (1 - lateness * 0.55)) continue

        sequence += 1
        const caddieAttached = random() < (busy ? 0.78 : 0.62)
        const partySize = 1 + Math.floor(random() * 4)
        const prefix = PARTY_PREFIX[Math.floor(random() * PARTY_PREFIX.length)]!
        const suffix = PARTY_SUFFIX[Math.floor(random() * PARTY_SUFFIX.length)]!

        reservations.push({
          id: `res_gen_${sequence}`,
          reservationNumber: `R-${date.replace(/-/g, '')}-${String(sequence).padStart(4, '0')}`,
          golfCourseId: course.id,
          courseName: course.name,
          teeTime: `${date}T${slotTime(slot, course.startIntervalMinutes)}:00+09:00`,
          durationMinutes: caddieAttached ? 270 : 240,
          playType: caddieAttached ? 'caddie' : 'self',
          partySize,
          partyName: `${prefix}${suffix}`,
          status: 'confirmed',
          holes: 18,
        })
      }
    }
  }

  return reservations
}

const ROLE_FEE = 12_000

/**
 * The assignments a club would already have made.
 *
 * Days up to and including the fixture day are staffed; the days after it are
 * staffed thinning out with distance, which is the state the desk actually
 * works in — the near days settled, the far ones still to do.
 */
export function generateAssignments(
  fixtureDate: string,
  reservations: GeneratedReservation[],
  caddieIds: string[],
): GeneratedAssignment[] {
  if (caddieIds.length === 0) return []
  const random = seeded(31337)
  const assignments: GeneratedAssignment[] = []
  const roundsByCaddieDay = new Map<string, number>()
  let sequence = 0

  const caddieRounds = reservations
    .filter(reservation => reservation.playType === 'caddie')
    .sort((left, right) => left.teeTime.localeCompare(right.teeTime))

  for (const round of caddieRounds) {
    const date = round.teeTime.slice(0, 10)
    const daysAhead = Math.round(
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${fixtureDate}T00:00:00Z`)) / 86_400_000,
    )
    // Settled through tomorrow, then thinning out: by a fortnight ahead only
    // about a third of the groups have somebody on them.
    const staffed = daysAhead <= 1 ? 0.97 : Math.max(0.25, 0.9 - daysAhead * 0.05)
    if (random() > staffed) continue

    // Somebody who is not already full for that day.
    let caddieId: string | null = null
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = caddieIds[Math.floor(random() * caddieIds.length)]!
      const key = `${candidate}:${date}`
      if ((roundsByCaddieDay.get(key) ?? 0) < 2) {
        caddieId = candidate
        roundsByCaddieDay.set(key, (roundsByCaddieDay.get(key) ?? 0) + 1)
        break
      }
    }
    if (!caddieId) continue

    sequence += 1
    assignments.push({
      id: `assign_gen_${sequence}`,
      caddieProfileId: caddieId,
      reservationId: round.id,
      roundReference: round.reservationNumber,
      scheduledAt: round.teeTime,
      durationMinutes: round.durationMinutes,
      // Yesterday's rounds were walked; today's morning is under way.
      status: daysAhead < 0 ? 'completed' : 'assigned',
      assignmentRole: 'primary',
      feeAmount: ROLE_FEE,
      feeCurrency: 'JPY',
      recommendationScore: null,
      nominatedBy: null,
      notes: null,
      metadataJson: null,
    })
  }

  return assignments
}

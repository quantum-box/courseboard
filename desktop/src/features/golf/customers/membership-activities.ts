/**
 * The append-only membership activity feed is owned by Field.  Keep the
 * CourseBoard shape deliberately open: a newer Field event must remain
 * readable by an older desktop build, even when its kind or snapshot fields
 * are not known here yet.
 */

export type MembershipActivityActor = Readonly<{
  type: string
  id: string
}>

export type MembershipActivitySource = Readonly<{
  channel?: string | null
  application?: string | null
}>

export type MembershipActivityTarget = Readonly<{
  type: string
  /** Consent batch events may have a target type but no entity id. */
  id: string | null
}>

export type MembershipActivity = Readonly<{
  id: string
  kind: string
  occurredAt: string
  actor: MembershipActivityActor
  source: MembershipActivitySource | null
  target: MembershipActivityTarget | null
  before: unknown | null
  after: unknown | null
  schemaVersion: number
}>

export type MembershipActivityPage = Readonly<{
  items: readonly MembershipActivity[]
  nextCursor: string | null
}>

export const MEMBERSHIP_ACTIVITY_PAGE_SIZE = 5

/**
 * Build the CourseBoard proxy path.  `cursor` is opaque and must be encoded as
 * a query value rather than interpolated into the URL path.
 */
export function membershipActivitiesPath(
  customerId: string,
  limit = MEMBERSHIP_ACTIVITY_PAGE_SIZE,
  cursor?: string | null,
): string {
  const params = new URLSearchParams({ limit: String(limit) })
  // Cursor values are opaque. Keep an explicitly supplied empty value in the
  // request so Field can reject it as an invalid cursor instead of silently
  // restarting at the first page.
  if (cursor !== undefined && cursor !== null) params.set('cursor', cursor)
  return `/v1/course/customers/${encodeURIComponent(customerId)}/membership-activities?${params.toString()}`
}

// Singular alias keeps call sites readable and makes the path helper tolerant
// of the two names used by the Field and CourseBoard feature discussions.
export const membershipActivityPath = membershipActivitiesPath

type SnapshotRecord = Readonly<Record<string, unknown>>

/** The small translation boundary keeps pure formatter tests independent of React. */
export type MembershipActivityTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string

const KIND_KEYS: Readonly<Record<string, string>> = {
  'membership.consents_recorded': 'kind.consentsRecorded',
  'membership.credential_archived': 'kind.credentialArchived',
  'membership.credential_created': 'kind.credentialCreated',
  'membership.credential_updated': 'kind.credentialUpdated',
  'membership.plan_assigned': 'kind.planAssigned',
  'membership.plan_assignment_truncated': 'kind.planAssignmentTruncated',
  'membership.registered': 'kind.registered',
  'membership.registration_submitted': 'kind.registrationSubmitted',
  'membership.subject_archived': 'kind.subjectArchived',
  'membership.subject_created': 'kind.subjectCreated',
  'membership.subject_updated': 'kind.subjectUpdated',
}

const DEFAULT_KIND_LABELS: Readonly<Record<string, string>> = {
  'membership.consents_recorded': '同意を記録',
  'membership.credential_archived': '会員証をアーカイブ',
  'membership.credential_created': '会員証を登録',
  'membership.credential_updated': '会員証を更新',
  'membership.plan_assigned': 'プランを割り当て',
  'membership.plan_assignment_truncated': 'プランの終了日を短縮',
  'membership.registered': '会員登録',
  'membership.registration_submitted': '会員登録申請',
  'membership.subject_archived': '対象をアーカイブ',
  'membership.subject_created': '対象を登録',
  'membership.subject_updated': '対象を更新',
}

function translated(
  translate: MembershipActivityTranslate | undefined,
  key: string,
  fallback: string,
  options?: Record<string, unknown>,
) {
  const fallbackText = fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(options?.[name] ?? `{{${name}}}`),
  )
  if (!translate) return fallbackText
  const value = translate(key, options)
  return value && value !== key ? value : fallbackText
}

function asRecord(value: unknown): SnapshotRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as SnapshotRecord)
    : null
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function firstString(snapshot: SnapshotRecord, ...keys: readonly string[]) {
  for (const key of keys) {
    const value = asString(snapshot[key])
    if (value) return value
  }
  return null
}

function nestedRecord(snapshot: SnapshotRecord, key: string) {
  return asRecord(snapshot[key])
}

function nestedString(
  snapshot: SnapshotRecord,
  objectKey: string,
  ...keys: readonly string[]
) {
  const nested = nestedRecord(snapshot, objectKey)
  return nested ? firstString(nested, ...keys) : null
}

function formatSnapshotDate(value: unknown) {
  const string = asString(value)
  if (!string) return null
  const date = new Date(string)
  if (Number.isNaN(date.getTime())) return string
  return new Intl.DateTimeFormat('ja-JP', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function formatSnapshotDateTime(value: unknown) {
  const string = asString(value)
  if (!string) return null
  return formatMembershipActivityDateTime(string)
}

function formatPlanSnapshot(
  snapshot: SnapshotRecord,
  translate?: MembershipActivityTranslate,
) {
  const plan =
    firstString(snapshot, 'planName', 'name') ??
    nestedString(snapshot, 'plan', 'planName', 'name')
  const planId = firstString(snapshot, 'planId') ?? nestedString(snapshot, 'plan', 'id')
  const startedOn = formatSnapshotDate(
    firstString(snapshot, 'startedOn') ??
      nestedString(snapshot, 'assignment', 'startedOn') ??
      nestedString(snapshot, 'plan', 'startedOn'),
  )
  const endedOn = formatSnapshotDate(
    firstString(snapshot, 'endedOn') ??
      nestedString(snapshot, 'assignment', 'endedOn') ??
      nestedString(snapshot, 'plan', 'endedOn'),
  )
  const oldEndedOn = formatSnapshotDate(firstString(snapshot, 'previousEndedOn', 'oldEndedOn'))
  const newEndedOn = formatSnapshotDate(firstString(snapshot, 'newEndedOn', 'endedOn'))
  const status = formatStatus(
    snapshot.status ??
      nestedString(snapshot, 'assignment', 'status') ??
      nestedString(snapshot, 'plan', 'status'),
    translate,
  )
  const validDays =
    typeof snapshot.validDays === 'number' && Number.isInteger(snapshot.validDays)
      ? translated(translate, 'snapshot.validDays', '有効期間: {{value}}日間', {
          value: snapshot.validDays,
        })
      : null
  const note = firstString(snapshot, 'note')
  const assignmentId = firstString(snapshot, 'assignmentId')
  const entitlementId = firstString(snapshot, 'entitlementId')
  const productId = firstString(snapshot, 'productId')
  const parts = [
    plan
      ? translated(translate, 'snapshot.plan', 'プラン: {{value}}', { value: plan })
      : planId
        ? translated(translate, 'snapshot.planId', 'プランID: {{value}}', { value: planId })
        : null,
    startedOn
      ? translated(translate, 'snapshot.startedOn', '開始日: {{value}}', { value: startedOn })
      : null,
    status,
    validDays,
    assignmentId
      ? translated(translate, 'snapshot.assignmentId', '割当ID: {{value}}', {
          value: assignmentId,
        })
      : null,
    entitlementId
      ? translated(translate, 'snapshot.entitlementId', '権利ID: {{value}}', {
          value: entitlementId,
        })
      : null,
    productId
      ? translated(translate, 'snapshot.productId', '商品ID: {{value}}', {
          value: productId,
        })
      : null,
    note ? translated(translate, 'snapshot.note', '備考: {{value}}', { value: note }) : null,
    oldEndedOn && newEndedOn
      ? translated(translate, 'snapshot.endedRange', '終了日: {{old}} → {{new}}', {
          old: oldEndedOn,
          new: newEndedOn,
        })
      : newEndedOn
        ? translated(translate, 'snapshot.endedOn', '終了日: {{value}}', { value: newEndedOn })
        : oldEndedOn
          ? translated(translate, 'snapshot.oldEndedOn', '旧終了日: {{value}}', { value: oldEndedOn })
          : endedOn
            ? translated(translate, 'snapshot.endedOn', '終了日: {{value}}', { value: endedOn })
            : null,
  ].filter((part): part is string => part !== null)
  return parts.join(' / ')
}

function formatSubjectSnapshot(
  snapshot: SnapshotRecord,
  translate?: MembershipActivityTranslate,
) {
  const name = firstString(snapshot, 'name')
  const subjectType = firstString(snapshot, 'subjectType', 'type')
  const birthDate = formatSnapshotDate(snapshot.birthDate)
  const sex = firstString(snapshot, 'sex')
  const note = firstString(snapshot, 'note')
  const archived = snapshot.archived === true
  return [
    name,
    subjectType
      ? translated(translate, 'snapshot.subjectType', '種別: {{value}}', { value: subjectType })
      : null,
    birthDate
      ? translated(translate, 'snapshot.birthDate', '生年月日: {{value}}', { value: birthDate })
      : null,
    sex ? translated(translate, 'snapshot.sex', '区分: {{value}}', { value: sex }) : null,
    note ? translated(translate, 'snapshot.note', '備考: {{value}}', { value: note }) : null,
    archived ? translated(translate, 'snapshot.archived', '状態: アーカイブ済み') : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' / ')
}

function formatCredentialSnapshot(
  snapshot: SnapshotRecord,
  translate?: MembershipActivityTranslate,
) {
  const subjectId = firstString(snapshot, 'subjectId')
  const label = firstString(snapshot, 'label', 'name')
  const kind = firstString(snapshot, 'kind')
  const issuedOn = formatSnapshotDate(snapshot.issuedOn)
  const expiresOn = formatSnapshotDate(snapshot.expiresOn)
  const verifiedAt = formatSnapshotDateTime(snapshot.verifiedAt)
  const verifiedBy = firstString(snapshot, 'verifiedBy')
  const note = firstString(snapshot, 'note')
  const archived = snapshot.archived === true
  return [
    subjectId
      ? translated(translate, 'snapshot.subjectId', '対象ID: {{value}}', { value: subjectId })
      : null,
    label,
    kind
      ? translated(translate, 'snapshot.credentialType', '種別: {{value}}', { value: kind })
      : null,
    issuedOn
      ? translated(translate, 'snapshot.issuedOn', '発行日: {{value}}', { value: issuedOn })
      : null,
    expiresOn
      ? translated(translate, 'snapshot.expiresOn', '有効期限: {{value}}', { value: expiresOn })
      : null,
    verifiedAt
      ? translated(translate, 'snapshot.verifiedAt', '確認日時: {{value}}', { value: verifiedAt })
      : null,
    verifiedBy
      ? translated(translate, 'snapshot.verifiedBy', '確認者: {{value}}', { value: verifiedBy })
      : null,
    note ? translated(translate, 'snapshot.note', '備考: {{value}}', { value: note }) : null,
    archived ? translated(translate, 'snapshot.archived', '状態: アーカイブ済み') : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' / ')
}

function formatStatus(status: unknown, translate?: MembershipActivityTranslate) {
  const value = asString(status)
  if (!value) return null
  if (value === 'active') return translated(translate, 'snapshot.statusActive', '状態: 有効')
  if (value === 'ended') return translated(translate, 'snapshot.statusEnded', '状態: 終了')
  return translated(translate, 'snapshot.status', '状態: {{value}}', { value })
}

function formatConsentItem(
  item: unknown,
  translate?: MembershipActivityTranslate,
) {
  const record = asRecord(item)
  if (!record) return null
  const key = firstString(record, 'consentKey', 'key')
  const termsVersion = firstString(record, 'termsVersion')
  const accepted = record.accepted
  const channel = firstString(record, 'channel')
  const acceptedLabel =
    typeof accepted === 'boolean'
      ? translated(
          translate,
          accepted ? 'snapshot.accepted' : 'snapshot.notAccepted',
          accepted ? '同意' : '未同意',
        )
      : null
  const channelLabel = channel
    ? translated(translate, `channel.${channel}`, CHANNEL_LABELS[channel] ?? channel)
    : null
  return [
    key,
    termsVersion
      ? translated(translate, 'snapshot.termsVersion', '規約: {{value}}', {
          value: termsVersion,
        })
      : null,
    acceptedLabel,
    channelLabel
      ? translated(translate, 'snapshot.channel', '経路: {{value}}', {
          value: channelLabel,
        })
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' / ')
}

function formatConsentSnapshot(
  snapshot: SnapshotRecord,
  translate?: MembershipActivityTranslate,
) {
  const items = snapshot.consents
  if (Array.isArray(items)) {
    const summaries = items
      .map(item => formatConsentItem(item, translate))
      .filter((item): item is string => item !== null && item.length > 0)
    if (summaries.length > 0) {
      return translated(translate, 'snapshot.consentsWithDetails', '{{count}}件（{{details}}）', {
        count: items.length,
        details: summaries.join('、'),
      })
    }
    return translated(translate, 'snapshot.consentsCount', '{{count}}件', {
      count: items.length,
    })
  }
  const key = firstString(snapshot, 'consentKey', 'key')
  const termsVersion = firstString(snapshot, 'termsVersion')
  const accepted = snapshot.accepted
  const channel = firstString(snapshot, 'channel')
  const acceptedLabel =
    typeof accepted === 'boolean'
      ? translated(translate, accepted ? 'snapshot.accepted' : 'snapshot.notAccepted', accepted ? '同意' : '未同意')
      : null
  const channelLabel = channel
    ? translated(translate, `channel.${channel}`, CHANNEL_LABELS[channel] ?? channel)
    : null
  return [
    key,
    termsVersion
      ? translated(translate, 'snapshot.termsVersion', '規約: {{value}}', {
          value: termsVersion,
        })
      : null,
    acceptedLabel,
    channelLabel
      ? translated(translate, 'snapshot.channel', '経路: {{value}}', {
          value: channelLabel,
        })
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' / ')
}

function formatRegisteredSnapshot(
  snapshot: SnapshotRecord,
  translate?: MembershipActivityTranslate,
) {
  const customerId = firstString(snapshot, 'customerId')
  const status = firstString(snapshot, 'status')
  const plan = formatPlanSnapshot(nestedRecord(snapshot, 'plan') ?? snapshot, translate)
  const subjects = Array.isArray(snapshot.subjects) ? snapshot.subjects.length : null
  const credentials = Array.isArray(snapshot.credentials) ? snapshot.credentials.length : null
  const consents = Array.isArray(snapshot.consents) ? snapshot.consents.length : null
  return [
    customerId
      ? translated(translate, 'snapshot.customerId', '顧客ID: {{value}}', { value: customerId })
      : null,
    status === 'pending'
      ? translated(translate, 'snapshot.pending', '状態: 受付中')
      : status
        ? translated(translate, 'snapshot.status', '状態: {{value}}', { value: status })
        : null,
    plan || null,
    subjects !== null
      ? translated(translate, 'snapshot.subjects', '対象: {{count}}件', { count: subjects })
      : null,
    credentials !== null
      ? translated(translate, 'snapshot.credentials', '会員証: {{count}}件', { count: credentials })
      : null,
    consents !== null
      ? translated(translate, 'snapshot.consents', '同意: {{count}}件', { count: consents })
      : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' / ')
}

/** Return a localized known label while leaving future kind strings visible. */
export function membershipActivityKindLabel(
  kind: string,
  translate?: MembershipActivityTranslate,
) {
  const key = KIND_KEYS[kind]
  if (!key) {
    return translated(
      translate,
      'kind.unknown',
      `会員変更（${kind}）`,
      { kind },
    )
  }
  return translated(translate, key, DEFAULT_KIND_LABELS[kind] ?? kind)
}

/**
 * Format only the snapshot fields the membership activity contract allows the
 * UI to understand. Unknown kinds stay available through their kind label,
 * without dumping arbitrary future fields into the normal desk view.
 */
export function formatMembershipActivitySnapshot(
  kind: string,
  snapshot: unknown,
  translate?: MembershipActivityTranslate,
) {
  const record = asRecord(snapshot)
  if (!record) return ''
  if (kind === 'membership.plan_assigned' || kind === 'membership.plan_assignment_truncated') {
    return formatPlanSnapshot(record, translate)
  }
  if (kind.startsWith('membership.subject_')) return formatSubjectSnapshot(record, translate)
  if (kind.startsWith('membership.credential_')) return formatCredentialSnapshot(record, translate)
  if (kind === 'membership.consents_recorded') return formatConsentSnapshot(record, translate)
  if (kind === 'membership.registered' || kind === 'membership.registration_submitted') {
    return formatRegisteredSnapshot(record, translate)
  }
  return ''
}

export type MembershipActivityPresentation = Readonly<{
  kindLabel: string
  summary: string
}>

/** Format one activity's kind and the most useful known snapshot. */
export function formatMembershipActivity(
  activity: MembershipActivity,
  translate?: MembershipActivityTranslate,
): MembershipActivityPresentation {
  const kindLabel = membershipActivityKindLabel(activity.kind, translate)
  const summary =
    formatMembershipActivitySnapshot(activity.kind, activity.after, translate) ||
    formatMembershipActivitySnapshot(activity.kind, activity.before, translate) ||
    translated(translate, 'snapshot.unavailable', '変更内容を表示できません。')
  return { kindLabel, summary }
}

export function formatMembershipActivityActor(
  actor: MembershipActivity['actor'],
) {
  return [actor.type, actor.id].filter(value => value.trim()).join(' / ')
}

export function formatMembershipActivityTarget(
  target: MembershipActivity['target'],
) {
  if (!target) return null
  return [target.type, target.id].filter(value => typeof value === 'string' && value.trim()).join(' / ')
}

const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  kiosk: 'キオスク',
  store: '店頭',
  web: 'Web',
}

/** Null/blank source application is intentionally not displayed. */
export function formatMembershipActivitySource(
  source: MembershipActivitySource | null,
  translate?: MembershipActivityTranslate,
) {
  if (!source) return null
  const application = typeof source.application === 'string' ? source.application.trim() : ''
  const channel = typeof source.channel === 'string' ? source.channel.trim() : ''
  const channelLabel = channel
    ? translated(translate, `channel.${channel}`, CHANNEL_LABELS[channel] ?? channel)
    : null
  const parts = [
    application
      ? translated(translate, 'sourceLabel.application', 'アプリ: {{value}}', { value: application })
      : null,
    channelLabel
      ? translated(translate, 'sourceLabel.channel', '経路: {{value}}', { value: channelLabel })
      : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' / ') : null
}

/** Date/time is rendered in the tenant's timezone, not the device timezone. */
export function formatMembershipActivityDateTime(
  value: string,
  timezone = 'Asia/Tokyo',
  locale = 'ja-JP',
) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const intlLocale = locale.toLowerCase().startsWith('en') ? 'en-US' : 'ja-JP'
  return new Intl.DateTimeFormat(intlLocale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(date)
}

import { ApiError, courseboardApiJson } from '../../api'
import { i18next } from '../../i18n'
import { useRegisterPageReload } from '../../lib/pageReload'
import {
  Field,
  FormGrid,
  LoadingState,
  NativeSelect,
  Notice,
  PageHeader,
  PageRefreshButton,
  Panel,
  ResourceError,
} from '../../components/Page'
import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import {
  ArrowLeft,
  Clock3,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  WalletCards,
} from 'lucide-react'
import {
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { navigate } from '../../lib/router'

type SelfLockWindow = {
  weekdays: string[]
  start: string
  end: string
}

type GolfPolicyHooks = {
  [key: string]: unknown
  selfLock?: {
    enabled: boolean
    windows: SelfLockWindow[]
  }
  spendJudgment?: {
    enabled: boolean
    minPerPlayer?: number | null
    action?: 'reject' | 'review'
  }
}

type GolfReservationPolicy = {
  tenantId: string
  reservationTypeId: string
  defaultHoles: number
  maxPlayersPerTeeTime: number
  cartPolicy: string
  memberDepositBps: number
  guestDepositBps: number
  cutoffHours: number
  policyHooksJson: GolfPolicyHooks | null
  metadataJson: unknown
}

type PolicyDraft = {
  reservationTypeId: string
  defaultHoles: string
  maxPlayersPerTeeTime: string
  cartPolicy: string
  memberDepositPercent: string
  guestDepositPercent: string
  cutoffHours: string
  selfLockEnabled: boolean
  windows: SelfLockWindow[]
  spendJudgmentEnabled: boolean
  minPerPlayer: string
  spendAction: 'reject' | 'review'
}

const WEEKDAYS = [
  { key: 'mon' },
  { key: 'tue' },
  { key: 'wed' },
  { key: 'thu' },
  { key: 'fri' },
  { key: 'sat' },
  { key: 'sun' },
] as const

/** Weekday captions come from the active locale, not the constant table. */
function weekdayLabel(key: string) {
  return i18next.t(`common:weekday.${key}` as 'common:weekday.mon')
}

const WEEKDAY_ORDER = new Map<string, number>(
  WEEKDAYS.map((day, index) => [day.key, index] as const),
)

function emptyDraft(): PolicyDraft {
  return {
    reservationTypeId: '',
    defaultHoles: '18',
    maxPlayersPerTeeTime: '4',
    cartPolicy: 'optional',
    memberDepositPercent: '20',
    guestDepositPercent: '30',
    cutoffHours: '24',
    selfLockEnabled: false,
    windows: [{ weekdays: ['sat', 'sun'], start: '07:00', end: '10:00' }],
    spendJudgmentEnabled: false,
    minPerPlayer: '',
    spendAction: 'review',
  }
}

function policyToDraft(policy: GolfReservationPolicy | null): PolicyDraft {
  if (!policy) return emptyDraft()
  return {
    reservationTypeId: policy.reservationTypeId ?? '',
    defaultHoles: String(policy.defaultHoles ?? 18),
    maxPlayersPerTeeTime: String(policy.maxPlayersPerTeeTime ?? 4),
    cartPolicy: policy.cartPolicy || 'optional',
    memberDepositPercent: String((policy.memberDepositBps ?? 2000) / 100),
    guestDepositPercent: String((policy.guestDepositBps ?? 3000) / 100),
    cutoffHours: String(policy.cutoffHours ?? 24),
    selfLockEnabled: policy.policyHooksJson?.selfLock?.enabled ?? false,
    windows: policy.policyHooksJson?.selfLock?.windows
      ?? [{ weekdays: ['sat', 'sun'], start: '07:00', end: '10:00' }],
    spendJudgmentEnabled:
      policy.policyHooksJson?.spendJudgment?.enabled ?? false,
    minPerPlayer:
      policy.policyHooksJson?.spendJudgment?.minPerPlayer == null
        ? ''
        : String(policy.policyHooksJson.spendJudgment.minPerPlayer),
    spendAction:
      policy.policyHooksJson?.spendJudgment?.action === 'reject'
        ? 'reject'
        : 'review',
  }
}

function timeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

function validateWindows(windows: SelfLockWindow[]) {
  const errors: string[] = []
  const normalized = windows.map((window, index) => {
    const start = timeToMinutes(window.start)
    const end = timeToMinutes(window.end)
    if (start === null || end === null) {
      errors.push(i18next.t('policy:validation.slotTimes', { n: String(index + 1) }))
    } else if (start >= end) {
      errors.push(i18next.t('policy:validation.slotOrder', { n: String(index + 1) }))
    }
    return { window, start, end, index }
  })

  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      const a = normalized[left]
      const b = normalized[right]
      if (!a || !b || a.start === null || a.end === null || b.start === null || b.end === null) {
        continue
      }
      const sharedDay = a.window.weekdays.length === 0
        ? (b.window.weekdays[0] ?? 'all')
        : b.window.weekdays.length === 0
          ? (a.window.weekdays[0] ?? 'all')
          : a.window.weekdays.find(day => b.window.weekdays.includes(day))
      if (sharedDay && a.start < b.end && b.start < a.end) {
        const positions = { a: String(a.index + 1), b: String(b.index + 1) }
        errors.push(sharedDay === 'all'
          ? i18next.t('policy:validation.overlapAllDays', positions)
          : i18next.t('policy:validation.overlapOnDay', {
              ...positions,
              day: weekdayLabel(sharedDay),
            }))
      }
    }
  }
  return errors
}

function policyValidation(draft: PolicyDraft) {
  const errors: string[] = []
  const defaultHoles = Number(draft.defaultHoles)
  const maxPlayers = Number(draft.maxPlayersPerTeeTime)
  const memberDeposit = Number(draft.memberDepositPercent)
  const guestDeposit = Number(draft.guestDepositPercent)
  const cutoffHours = Number(draft.cutoffHours)
  const minPerPlayer = draft.minPerPlayer === '' ? null : Number(draft.minPerPlayer)

  if (![9, 18].includes(defaultHoles)) errors.push(i18next.t('policy:validation.holes'))
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 4) {
    errors.push(i18next.t('policy:validation.maxPlayers'))
  }
  if (
    draft.memberDepositPercent.trim() === ''
    || !Number.isFinite(memberDeposit)
    || memberDeposit < 0
    || memberDeposit > 100
  ) {
    errors.push(i18next.t('policy:validation.memberDeposit'))
  }
  if (
    draft.guestDepositPercent.trim() === ''
    || !Number.isFinite(guestDeposit)
    || guestDeposit < 0
    || guestDeposit > 100
  ) {
    errors.push(i18next.t('policy:validation.guestDeposit'))
  }
  if (
    draft.cutoffHours.trim() === ''
    || !Number.isInteger(cutoffHours)
    || cutoffHours < 0
    || cutoffHours > 2_147_483_647
  ) {
    errors.push(i18next.t('policy:validation.cutoff'))
  }
  if (
    draft.spendJudgmentEnabled
    && minPerPlayer !== null
    && (!Number.isSafeInteger(minPerPlayer) || minPerPlayer < 0)
  ) {
    errors.push(i18next.t('policy:validation.spendThreshold'))
  }
  if (draft.selfLockEnabled) errors.push(...validateWindows(draft.windows))

  return { errors }
}

export function PolicyPage() {
  const { t } = useTranslation(['policy', 'common', 'nav', 'courses'])
  const [draft, setDraft] = useState<PolicyDraft>(emptyDraft)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string[] | null>(null)
  const [saved, setSaved] = useState(false)
  const [exists, setExists] = useState(false)
  const [preservedHooks, setPreservedHooks] = useState<GolfPolicyHooks>({})
  const [preservedMetadata, setPreservedMetadata] = useState<unknown>({})

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const policy = await courseboardApiJson<GolfReservationPolicy>(
        '/v1/course/reservation-policy',
      )
      setDraft(policyToDraft(policy))
      setPreservedHooks(policy.policyHooksJson ?? {})
      setPreservedMetadata(policy.metadataJson ?? {})
      setExists(true)
      setSaved(false)
      setSaveError(null)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setDraft(emptyDraft())
        setPreservedHooks({})
        setPreservedMetadata({})
        setExists(false)
        setSaved(false)
        setSaveError(null)
      } else {
        setLoadError(error)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useRegisterPageReload(load)

  function changeDraft(patch: Partial<PolicyDraft>) {
    setDraft(previous => ({ ...previous, ...patch }))
    setSaved(false)
    setSaveError(null)
  }

  function updateWindow(index: number, patch: Partial<SelfLockWindow>) {
    changeDraft({
      windows: draft.windows.map((window, windowIndex) => (
        windowIndex === index ? { ...window, ...patch } : window
      )),
    })
  }

  function toggleWeekday(index: number, weekday: string) {
    const window = draft.windows[index]
    if (!window) return
    const weekdays = window.weekdays.includes(weekday)
      ? window.weekdays.filter(value => value !== weekday)
      : [...window.weekdays, weekday].sort(
          (left, right) => (WEEKDAY_ORDER.get(left) ?? 99) - (WEEKDAY_ORDER.get(right) ?? 99),
        )
    updateWindow(index, { weekdays })
  }

  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(false)
    const validation = policyValidation(draft)
    if (validation.errors.length > 0) {
      setSaveError(validation.errors)
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      await courseboardApiJson<unknown>(
        '/v1/course/reservation-policy',
        {
          method: 'PATCH',
          body: JSON.stringify({
            reservationTypeId: draft.reservationTypeId.trim() || undefined,
            defaultHoles: Number(draft.defaultHoles),
            maxPlayersPerTeeTime: Number(draft.maxPlayersPerTeeTime),
            cartPolicy: draft.cartPolicy,
            memberDepositBps: Math.round(Number(draft.memberDepositPercent) * 100),
            guestDepositBps: Math.round(Number(draft.guestDepositPercent) * 100),
            cutoffHours: Number(draft.cutoffHours),
            policyHooksJson: {
              ...preservedHooks,
              selfLock: {
                enabled: draft.selfLockEnabled,
                windows: draft.windows,
              },
              spendJudgment: {
                enabled: draft.spendJudgmentEnabled,
                minPerPlayer:
                  draft.minPerPlayer === '' ? null : Number(draft.minPerPlayer),
                action: draft.spendAction,
              },
            } satisfies GolfPolicyHooks,
            // Advanced integration JSON is edited under Settings, not here.
            metadataJson: preservedMetadata ?? {},
          }),
        },
      )
      setSaved(true)
      setExists(true)
    } catch (error) {
      setSaveError([
        error instanceof Error ? error.message : t('policy:saveFailed'),
      ])
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState label={t('policy:loading')} />
  if (loadError) return <ResourceError error={loadError} onRetry={() => void load()} />

  return (
    <form className="page-stack" onSubmit={savePolicy}>
      <PageHeader
        eyebrow={t('nav:sections.tenantMaster')}
        title={t('policy:title')}
        description={t('policy:description')}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => navigate('settings')}>
              <ArrowLeft /> {t('common:action.backToSettings')}
            </Button>
            <Badge variant={exists ? 'success' : 'warning'}>
              {exists ? t('policy:status.configured') : t('policy:status.missing')}
            </Badge>
            <PageRefreshButton onClick={() => void load()} />
            <Button type="submit" variant="primary" disabled={saving}>
              <Save /> {saving ? t('common:action.saving') : t('common:action.save')}
            </Button>
          </div>
        )}
      />

      <Panel
        title={t('policy:basics.title')}
        description={t('policy:basics.description')}
        actions={<ShieldCheck className="size-4 text-subtle-foreground" />}
      >
        <FormGrid columns={3}>
          <Field
            label={t('policy:basics.reservationTypeId')}
            hint={t('policy:basics.reservationTypeIdHint')}
          >
            <Input
              value={draft.reservationTypeId}
              onChange={event => changeDraft({ reservationTypeId: event.target.value })}
              placeholder="golf_standard"
            />
          </Field>
          <Field label={t('policy:basics.defaultHoles')} required>
            <NativeSelect
              required
              value={draft.defaultHoles}
              onChange={event => changeDraft({ defaultHoles: event.target.value })}
            >
              <option value="9">{t('courses:option.holes9')}</option>
              <option value="18">{t('courses:option.holes18')}</option>
            </NativeSelect>
          </Field>
          <Field label={t('policy:basics.maxPlayers')} required>
            <Input
              required
              type="number"
              min="1"
              max="4"
              step="1"
              value={draft.maxPlayersPerTeeTime}
              onChange={event => changeDraft({ maxPlayersPerTeeTime: event.target.value })}
            />
          </Field>
          <Field label={t('policy:basics.cart')} required>
            <NativeSelect
              required
              value={draft.cartPolicy}
              onChange={event => changeDraft({ cartPolicy: event.target.value })}
            >
              <option value="optional">{t('policy:cartOption.optional')}</option>
              <option value="required">{t('policy:cartOption.required')}</option>
              <option value="unavailable">{t('policy:cartOption.unavailable')}</option>
            </NativeSelect>
          </Field>
          <Field label={t('policy:basics.cutoff')} required hint={t('policy:basics.cutoffHint')}>
            <Input
              required
              type="number"
              min="0"
              step="1"
              value={draft.cutoffHours}
              onChange={event => changeDraft({ cutoffHours: event.target.value })}
            />
          </Field>
        </FormGrid>
      </Panel>

      <Panel
        title={t('policy:deposit.title')}
        description={t('policy:deposit.description')}
        actions={<WalletCards className="size-4 text-subtle-foreground" />}
      >
        <FormGrid columns={2}>
          <Field label={t('policy:deposit.member')} required hint={t('policy:deposit.hint')}>
            <Input
              required
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={draft.memberDepositPercent}
              onChange={event => changeDraft({ memberDepositPercent: event.target.value })}
            />
          </Field>
          <Field label={t('policy:deposit.guest')} required hint={t('policy:deposit.hint')}>
            <Input
              required
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={draft.guestDepositPercent}
              onChange={event => changeDraft({ guestDepositPercent: event.target.value })}
            />
          </Field>
        </FormGrid>
      </Panel>

      <Panel
        title={t('policy:selfLock.title')}
        description={t('policy:selfLock.description')}
        actions={(
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={draft.selfLockEnabled}
              onChange={event => changeDraft({ selfLockEnabled: event.target.checked })}
            />
            {t('policy:selfLock.enabled')}
          </label>
        )}
      >
        <div className={`grid gap-3 ${draft.selfLockEnabled ? '' : 'opacity-60'}`}>
          {draft.windows.map((window, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-md border border-border bg-surface p-3 lg:grid-cols-[minmax(280px,1fr)_120px_16px_120px_auto] lg:items-end"
            >
              <div className="field">
                <span className="field-label">
                  {t('policy:selfLock.slotWeekdays', { n: String(index + 1) })}
                  <Badge variant="neutral">{t('policy:selfLock.allDays')}</Badge>
                </span>
                <div className="flex flex-wrap gap-1">
                  {WEEKDAYS.map(day => {
                    const active = window.weekdays.includes(day.key)
                    return (
                      <Button
                        key={day.key}
                        type="button"
                        size="sm"
                        variant={active ? 'primary' : 'secondary'}
                        aria-pressed={active}
                        aria-label={active
                          ? t('policy:selfLock.unselectDay', { day: weekdayLabel(day.key) })
                          : t('policy:selfLock.selectDay', { day: weekdayLabel(day.key) })}
                        onClick={() => toggleWeekday(index, day.key)}
                        disabled={!draft.selfLockEnabled}
                      >
                        {weekdayLabel(day.key)}
                      </Button>
                    )
                  })}
                </div>
              </div>
              <Field label={t('policy:selfLock.start')} required>
                <Input
                  type="time"
                  value={window.start}
                  onChange={event => updateWindow(index, { start: event.target.value })}
                  disabled={!draft.selfLockEnabled}
                />
              </Field>
              <span className="hidden pb-2 text-center text-subtle-foreground lg:block">–</span>
              <Field label={t('policy:selfLock.end')} required>
                <Input
                  type="time"
                  value={window.end}
                  onChange={event => updateWindow(index, { end: event.target.value })}
                  disabled={!draft.selfLockEnabled}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                onClick={() => changeDraft({
                  windows: draft.windows.filter((_, windowIndex) => windowIndex !== index),
                })}
                disabled={!draft.selfLockEnabled}
              >
                <Trash2 /> {t('common:action.delete')}
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              onClick={() => changeDraft({
                windows: [
                  ...draft.windows,
                  { weekdays: [], start: '07:00', end: '10:00' },
                ],
              })}
              disabled={!draft.selfLockEnabled}
            >
              <Plus /> {t('policy:selfLock.addSlot')}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel
        title={t('policy:spend.title')}
        description={t('policy:spend.description')}
        actions={(
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={draft.spendJudgmentEnabled}
              onChange={event => changeDraft({ spendJudgmentEnabled: event.target.checked })}
            />
            {t('policy:spend.enabled')}
          </label>
        )}
      >
        <div className={draft.spendJudgmentEnabled ? '' : 'opacity-60'}>
          <FormGrid columns={2}>
            <Field
              label={t('policy:spend.threshold')}
              hint={t('policy:spend.thresholdHint')}
            >
              <Input
                type="number"
                min="0"
                step="1"
                value={draft.minPerPlayer}
                onChange={event => changeDraft({ minPerPlayer: event.target.value })}
                placeholder={t('policy:spend.thresholdPlaceholder')}
                disabled={!draft.spendJudgmentEnabled}
              />
            </Field>
            <Field label={t('policy:spend.belowAction')} required>
              <NativeSelect
                value={draft.spendAction}
                onChange={event => changeDraft({
                  spendAction: event.target.value === 'reject' ? 'reject' : 'review',
                })}
                disabled={!draft.spendJudgmentEnabled}
              >
                <option value="review">{t('policy:spend.review')}</option>
                <option value="reject">{t('policy:spend.reject')}</option>
              </NativeSelect>
            </Field>
          </FormGrid>
        </div>
      </Panel>

      {saveError ? (
        <Notice tone="danger" title={t('policy:invalid.title')}>
          <ul className="list-disc space-y-1 pl-4">
            {saveError.map(error => <li key={error}>{error}</li>)}
          </ul>
        </Notice>
      ) : null}
      {saved ? (
        <Notice tone="success" title={t('policy:saved.title')}>
          {t('policy:saved.description')}
        </Notice>
      ) : null}

      <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-lg border border-border bg-background/95 p-3 shadow-overlay backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" />
            {t('policy:summary.maxPlayers', { n: draft.maxPlayersPerTeeTime || '—' })}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-3.5" />
            {t('policy:summary.cutoff', { n: draft.cutoffHours || '—' })}
          </span>
        </div>
        <Button type="submit" variant="primary" size="lg" disabled={saving}>
          <Save /> {saving ? t('common:action.saving') : t('policy:save')}
        </Button>
      </div>
    </form>
  )
}

export default PolicyPage

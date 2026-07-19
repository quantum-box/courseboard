import { ApiError, courseboardApiJson, fieldTenant } from '../../api'
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
  useMemo,
  useState,
} from 'react'
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
  { key: 'mon', label: '月' },
  { key: 'tue', label: '火' },
  { key: 'wed', label: '水' },
  { key: 'thu', label: '木' },
  { key: 'fri', label: '金' },
  { key: 'sat', label: '土' },
  { key: 'sun', label: '日' },
] as const

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
      errors.push(`時間帯 ${index + 1}: 開始と終了を入力してください。`)
    } else if (start >= end) {
      errors.push(`時間帯 ${index + 1}: 終了時刻は開始時刻より後にしてください。`)
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
        const overlapLabel = sharedDay === 'all'
          ? '全曜日で'
          : `${WEEKDAYS.find(day => day.key === sharedDay)?.label ?? sharedDay}曜日に`
        errors.push(
          `時間帯 ${a.index + 1} と ${b.index + 1} が${overlapLabel}重複しています。`,
        )
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

  if (![9, 18].includes(defaultHoles)) errors.push('既定ホール数は9または18にしてください。')
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 4) {
    errors.push('1枠の最大人数は1〜4人で入力してください。')
  }
  if (
    draft.memberDepositPercent.trim() === ''
    || !Number.isFinite(memberDeposit)
    || memberDeposit < 0
    || memberDeposit > 100
  ) {
    errors.push('会員デポジット率は0〜100%で入力してください。')
  }
  if (
    draft.guestDepositPercent.trim() === ''
    || !Number.isFinite(guestDeposit)
    || guestDeposit < 0
    || guestDeposit > 100
  ) {
    errors.push('ゲストデポジット率は0〜100%で入力してください。')
  }
  if (
    draft.cutoffHours.trim() === ''
    || !Number.isInteger(cutoffHours)
    || cutoffHours < 0
    || cutoffHours > 2_147_483_647
  ) {
    errors.push('予約締切は0以上の整数で入力してください。')
  }
  if (
    draft.spendJudgmentEnabled
    && minPerPlayer !== null
    && (!Number.isSafeInteger(minPerPlayer) || minPerPlayer < 0)
  ) {
    errors.push('客単価の基準額は0円以上の整数で入力してください。')
  }
  if (draft.selfLockEnabled) errors.push(...validateWindows(draft.windows))

  return { errors }
}

export function PolicyPage() {
  const tenant = useMemo(() => fieldTenant(), [])
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
        error instanceof Error ? error.message : '予約ポリシーを保存できませんでした。',
      ])
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState label="予約ポリシーを読み込んでいます" />
  if (loadError) return <ResourceError error={loadError} onRetry={() => void load()} />

  return (
    <form className="page-stack" onSubmit={savePolicy}>
      <PageHeader
        eyebrow={`Settings · ${tenant}`}
        title="予約ポリシー"
        description="テナント導入時に整える受付ルールです。日常運用ではあまり開きません。予約枠の基本条件、デポジット、セルフロック、客単価判定をひとつのポリシーとして管理します。"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => navigate('settings')}>
              <ArrowLeft /> 設定へ戻る
            </Button>
            <Badge variant={exists ? 'success' : 'warning'}>
              {exists ? '設定済み' : '未作成'}
            </Badge>
            <PageRefreshButton onClick={() => void load()} />
            <Button type="submit" variant="primary" disabled={saving}>
              <Save /> {saving ? '保存中…' : '変更を保存'}
            </Button>
          </div>
        )}
      />

      <Panel
        title="予約枠の基本条件"
        description="新しいティータイムと予約商品に共通で使う既定値です。"
        actions={<ShieldCheck className="size-4 text-subtle-foreground" />}
      >
        <FormGrid columns={3}>
          <Field
            label="予約種別ID"
            hint="空欄の場合は既存設定またはバックエンド既定値を使用"
          >
            <Input
              value={draft.reservationTypeId}
              onChange={event => changeDraft({ reservationTypeId: event.target.value })}
              placeholder="golf_standard"
            />
          </Field>
          <Field label="既定ホール数" required>
            <NativeSelect
              required
              value={draft.defaultHoles}
              onChange={event => changeDraft({ defaultHoles: event.target.value })}
            >
              <option value="9">9ホール</option>
              <option value="18">18ホール</option>
            </NativeSelect>
          </Field>
          <Field label="1枠の最大人数" required>
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
          <Field label="カート利用" required>
            <NativeSelect
              required
              value={draft.cartPolicy}
              onChange={event => changeDraft({ cartPolicy: event.target.value })}
            >
              <option value="optional">任意</option>
              <option value="required">必須</option>
              <option value="unavailable">利用不可</option>
            </NativeSelect>
          </Field>
          <Field label="予約締切" required hint="ティータイム開始の何時間前まで受け付けるか">
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
        title="デポジット"
        description="予約時に事前決済する割合を会員・ゲスト別に設定します。"
        actions={<WalletCards className="size-4 text-subtle-foreground" />}
      >
        <FormGrid columns={2}>
          <Field label="会員デポジット率" required hint="0〜100%">
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
          <Field label="ゲストデポジット率" required hint="0〜100%">
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
        title="セルフロック"
        description="需要の高い時間帯をキャディ付き優先枠にし、セルフプレー予約を止めます。"
        actions={(
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={draft.selfLockEnabled}
              onChange={event => changeDraft({ selfLockEnabled: event.target.checked })}
            />
            有効
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
                  時間帯 {index + 1} の曜日
                  <Badge variant="neutral">未選択 = 全曜日</Badge>
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
                        aria-label={`${day.label}曜日${active ? 'を解除' : 'を選択'}`}
                        onClick={() => toggleWeekday(index, day.key)}
                        disabled={!draft.selfLockEnabled}
                      >
                        {day.label}
                      </Button>
                    )
                  })}
                </div>
              </div>
              <Field label="開始" required>
                <Input
                  type="time"
                  value={window.start}
                  onChange={event => updateWindow(index, { start: event.target.value })}
                  disabled={!draft.selfLockEnabled}
                />
              </Field>
              <span className="hidden pb-2 text-center text-subtle-foreground lg:block">–</span>
              <Field label="終了" required>
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
                <Trash2 /> 削除
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
              <Plus /> 時間帯を追加
            </Button>
          </div>
        </div>
      </Panel>

      <Panel
        title="客単価判定"
        description="基準額を下回る予約を確認待ち、または受付不可にします。"
        actions={(
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={draft.spendJudgmentEnabled}
              onChange={event => changeDraft({ spendJudgmentEnabled: event.target.checked })}
            />
            有効
          </label>
        )}
      >
        <div className={draft.spendJudgmentEnabled ? '' : 'opacity-60'}>
          <FormGrid columns={2}>
            <Field
              label="1人あたり基準額"
              hint="空欄なら当日予算の目標客単価に連動"
            >
              <Input
                type="number"
                min="0"
                step="1"
                value={draft.minPerPlayer}
                onChange={event => changeDraft({ minPerPlayer: event.target.value })}
                placeholder="予算マスタと連動"
                disabled={!draft.spendJudgmentEnabled}
              />
            </Field>
            <Field label="基準未満の扱い" required>
              <NativeSelect
                value={draft.spendAction}
                onChange={event => changeDraft({
                  spendAction: event.target.value === 'reject' ? 'reject' : 'review',
                })}
                disabled={!draft.spendJudgmentEnabled}
              >
                <option value="review">管理者確認待ち</option>
                <option value="reject">予約を拒否</option>
              </NativeSelect>
            </Field>
          </FormGrid>
        </div>
      </Panel>

      {saveError ? (
        <Notice tone="danger" title="保存前に設定を確認してください">
          <ul className="list-disc space-y-1 pl-4">
            {saveError.map(error => <li key={error}>{error}</li>)}
          </ul>
        </Notice>
      ) : null}
      {saved ? (
        <Notice tone="success" title="予約ポリシーを保存しました">
          新しい予約判定には保存した設定が使用されます。
        </Notice>
      ) : null}

      <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-lg border border-border bg-background/95 p-3 shadow-overlay backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Users className="size-3.5" /> 最大 {draft.maxPlayersPerTeeTime || '—'} 人</span>
          <span className="inline-flex items-center gap-1"><Clock3 className="size-3.5" /> 締切 {draft.cutoffHours || '—'} 時間前</span>
        </div>
        <Button type="submit" variant="primary" size="lg" disabled={saving}>
          <Save /> {saving ? '保存中…' : '予約ポリシーを保存'}
        </Button>
      </div>
    </form>
  )
}

export default PolicyPage

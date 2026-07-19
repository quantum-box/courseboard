import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { RefreshCw, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { courseboardApiJson, courseboardApiText } from '../../api'
import {
  Field,
  FormGrid,
  LoadingState,
  NativeSelect,
  Notice,
  Panel,
  ResourceError,
} from '../../components/Page'
import { useRegisterPageReload } from '../../lib/pageReload'

const extensionStatusPath = '/v1/course/extension-status'
const extensionConfigPath = '/v1/course/config'
const currencyOptions = ['JPY', 'USD', 'EUR'] as const

type ExtensionConfigDraft = {
  defaultCurrency: string
  timezone: string
}

type ExtensionStatus = {
  extensionKey: string
  tenantStatus?: 'enabled' | 'disabled' | null
  configVersion?: number | null
  configJson?: Record<string, unknown> | null
  validation: { valid: boolean; errors: string[] }
  updatedAt?: string | null
}

const defaultExtensionConfig: ExtensionConfigDraft = {
  defaultCurrency: 'JPY',
  timezone: 'Asia/Tokyo',
}

function configDraftFromJson(configJson?: Record<string, unknown> | null): ExtensionConfigDraft {
  const defaultCurrency = typeof configJson?.defaultCurrency === 'string'
    ? configJson.defaultCurrency.trim()
    : ''
  const timezone = typeof configJson?.timezone === 'string'
    ? configJson.timezone.trim()
    : ''
  return {
    defaultCurrency: defaultCurrency || defaultExtensionConfig.defaultCurrency,
    timezone: timezone || defaultExtensionConfig.timezone,
  }
}

function validateExtensionConfig(draft: ExtensionConfigDraft) {
  if (!draft.defaultCurrency.trim()) return '通貨を選択してください。'
  if (!/^[A-Z]{3}$/.test(draft.defaultCurrency.trim())) {
    return '通貨は ISO 4217 の3文字コードで入力してください。'
  }
  if (!draft.timezone.trim()) return 'タイムゾーンを入力してください。'
  return null
}

function buildConfigJson(
  draft: ExtensionConfigDraft,
  previous?: Record<string, unknown> | null,
): Record<string, unknown> {
  const previousConfig = previous && typeof previous === 'object' && !Array.isArray(previous)
    ? { ...previous }
    : {}
  delete previousConfig.defaultCurrency
  delete previousConfig.timezone
  return {
    ...previousConfig,
    defaultCurrency: draft.defaultCurrency.trim(),
    timezone: draft.timezone.trim(),
  }
}

function formatUpdatedAt(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作を完了できませんでした。'
}

export function ExtensionConfigPanel() {
  const [extension, setExtension] = useState<ExtensionStatus | null>(null)
  const [draft, setDraft] = useState<ExtensionConfigDraft>(defaultExtensionConfig)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setSaved(false)
    try {
      const next = await courseboardApiJson<ExtensionStatus | null>(extensionStatusPath)
      setExtension(next)
      setDraft(configDraftFromJson(next?.configJson))
    } catch (error) {
      setLoadError(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useRegisterPageReload(load)

  const persisted = useMemo(
    () => configDraftFromJson(extension?.configJson),
    [extension?.configJson],
  )
  const dirty = draft.defaultCurrency !== persisted.defaultCurrency
    || draft.timezone !== persisted.timezone
  const knownCurrency = currencyOptions.includes(
    draft.defaultCurrency as (typeof currencyOptions)[number],
  )

  async function save() {
    const validationError = validateExtensionConfig(draft)
    if (validationError) {
      setSaveError(validationError)
      return
    }
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const configJson = buildConfigJson(draft, extension?.configJson)
      await courseboardApiText(extensionConfigPath, {
        method: 'PATCH',
        body: JSON.stringify({ scopeType: 'tenant', configJson }),
      })
      setExtension(current => current ? { ...current, configJson } : current)
      setDraft(configDraftFromJson(configJson))
      setSaved(true)
    } catch (error) {
      setSaveError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel
      title="ゴルフ拡張設定"
      description="tenant scope の既定通貨とタイムゾーンです。導入時に一度決めれば、日常運用ではほとんど変えません。"
      actions={(
        <div className="flex items-center gap-2">
          <Badge variant={extension?.tenantStatus === 'enabled' ? 'success' : 'warning'}>
            {extension?.tenantStatus === 'enabled' ? '有効' : '無効'}
          </Badge>
          <Badge variant={extension?.validation?.valid === false ? 'destructive' : 'outline'}>
            {extension?.validation?.valid === false ? '検証エラー' : '検証済み'}
          </Badge>
          {dirty ? <Badge variant="warning">未保存</Badge> : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => void load()} disabled={loading || saving} title="⌘R">
            <RefreshCw /> 再読み込み
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={loading || saving || !dirty}
            onClick={() => void save()}
          >
            <Save /> {saving ? '保存中…' : '設定を保存'}
          </Button>
        </div>
      )}
    >
      {loading ? <LoadingState label="ゴルフ拡張設定を読み込んでいます" /> : null}
      {loadError ? <ResourceError error={loadError} onRetry={() => void load()} /> : null}

      {!loading && !loadError ? (
        <div className="grid gap-3">
          {!extension ? (
            <Notice tone="warning" title="拡張状態を取得できません">
              extension key「golf_course」が status 応答にありません。保存前に有効化状態を確認してください。
            </Notice>
          ) : null}
          {extension?.validation?.errors?.length ? (
            <Notice tone="danger" title="現在の設定に検証エラーがあります">
              <ul className="grid gap-1 pl-4">
                {extension.validation.errors.map(validationError => (
                  <li key={validationError}>{validationError}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <FormGrid columns={2}>
            <Field
              label="既定通貨"
              hint={`最終更新 ${formatUpdatedAt(extension?.updatedAt)} · ISO 4217`}
              required
            >
              {knownCurrency ? (
                <NativeSelect
                  value={draft.defaultCurrency}
                  onChange={event => {
                    setDraft(current => ({ ...current, defaultCurrency: event.target.value }))
                    setSaveError(null)
                    setSaved(false)
                  }}
                >
                  {currencyOptions.map(code => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  value={draft.defaultCurrency}
                  onChange={event => {
                    setDraft(current => ({
                      ...current,
                      defaultCurrency: event.target.value.toUpperCase(),
                    }))
                    setSaveError(null)
                    setSaved(false)
                  }}
                  placeholder="JPY"
                  maxLength={3}
                  required
                />
              )}
            </Field>
            <Field label="タイムゾーン" hint="IANA timezone（例: Asia/Tokyo）" required>
              <Input
                value={draft.timezone}
                onChange={event => {
                  setDraft(current => ({ ...current, timezone: event.target.value }))
                  setSaveError(null)
                  setSaved(false)
                }}
                placeholder="Asia/Tokyo"
                required
              />
            </Field>
          </FormGrid>

          {saveError ? (
            <Notice tone="danger" title="設定を保存できません">{saveError}</Notice>
          ) : null}
          {saved ? (
            <Notice tone="success" title="ゴルフ拡張設定を保存しました">
              既定通貨とタイムゾーンを config API へ反映しました。
            </Notice>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}

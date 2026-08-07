import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { RefreshCw, Save } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { i18next } from '../../i18n'
import { courseboardApiJson, courseboardApiText } from '../../api'
import { COURSE_TIME_ZONE } from '../../lib/clock'
import {
  Field,
  FormGrid,
  LoadingState,
  NativeSelect,
  Notice,
  Panel,
  ResourceError,
  resourceErrorText,
} from '../../components/Page'
import { useRegisterPageReload } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'

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
  timezone: COURSE_TIME_ZONE,
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
  if (!draft.defaultCurrency.trim()) return i18next.t('settings:extension.validation.currencyRequired')
  if (!/^[A-Z]{3}$/.test(draft.defaultCurrency.trim())) {
    return i18next.t('settings:extension.validation.currencyFormat')
  }
  if (!draft.timezone.trim()) return i18next.t('settings:extension.validation.timezoneRequired')
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

/**
 * The save notice has no room for a detail block and used to print the server's
 * own English. Route the failure through the shared mapping so the sentence the
 * operator reads first follows the active locale.
 */
function errorMessage(error: unknown) {
  return error instanceof Error
    ? resourceErrorText(error)
    : i18next.t('settings:extension.error.generic')
}

export function ExtensionConfigPanel() {
  const { t } = useTranslation(['settings', 'common'])
  const [extension, setExtension] = useState<ExtensionStatus | null>(null)
  const [draft, setDraft] = useState<ExtensionConfigDraft>(defaultExtensionConfig)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
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
    try {
      const configJson = buildConfigJson(draft, extension?.configJson)
      await courseboardApiText(extensionConfigPath, {
        method: 'PATCH',
        body: JSON.stringify({ scopeType: 'tenant', configJson }),
      })
      setExtension(current => current ? { ...current, configJson } : current)
      setDraft(configDraftFromJson(configJson))
      showToast({
        tone: 'success',
        title: t('settings:extension.saved.title'),
        message: t('settings:extension.saved.description'),
      })
    } catch (error) {
      setSaveError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel
      title={t('settings:extension.title')}
      description={t('settings:extension.description')}
      actions={(
        <div className="flex items-center gap-2">
          <Badge variant={extension?.tenantStatus === 'enabled' ? 'success' : 'warning'}>
            {extension?.tenantStatus === 'enabled'
              ? t('settings:extension.enabled')
              : t('settings:extension.disabled')}
          </Badge>
          <Badge variant={extension?.validation?.valid === false ? 'destructive' : 'outline'}>
            {extension?.validation?.valid === false
              ? t('settings:extension.invalid')
              : t('settings:extension.valid')}
          </Badge>
          {dirty ? <Badge variant="warning">{t('settings:extension.unsaved')}</Badge> : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => void load()} disabled={loading || saving} title="⌘R">
            <RefreshCw /> {t('settings:extension.reload')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={loading || saving || !dirty}
            onClick={() => void save()}
          >
            <Save /> {saving ? t('common:action.saving') : t('settings:extension.save')}
          </Button>
        </div>
      )}
    >
      {loading ? <LoadingState label={t('settings:extension.loadingConfig')} /> : null}
      {loadError ? <ResourceError error={loadError} onRetry={() => void load()} /> : null}

      {!loading && !loadError ? (
        <div className="grid gap-3">
          {!extension ? (
            <Notice tone="warning" title={t('settings:extension.statusUnavailable.title')}>
              {t('settings:extension.statusUnavailable.description')}
            </Notice>
          ) : null}
          {extension?.validation?.errors?.length ? (
            <Notice tone="danger" title={t('settings:extension.invalidConfig.title')}>
              <ul className="grid gap-1 pl-4">
                {extension.validation.errors.map(validationError => (
                  <li key={validationError}>{validationError}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <FormGrid columns={2}>
            <Field
              label={t('settings:extension.currency')}
              hint={t('settings:extension.currencyHint', {
                updated: formatUpdatedAt(extension?.updatedAt),
              })}
              required
            >
              {knownCurrency ? (
                <NativeSelect
                  value={draft.defaultCurrency}
                  onChange={event => {
                    setDraft(current => ({ ...current, defaultCurrency: event.target.value }))
                    setSaveError(null)
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
                  }}
                  placeholder="JPY"
                  maxLength={3}
                  required
                />
              )}
            </Field>
            <Field
              label={t('settings:extension.timezone')}
              hint={t('settings:extension.timezoneHint')}
              required
            >
              <Input
                value={draft.timezone}
                onChange={event => {
                  setDraft(current => ({ ...current, timezone: event.target.value }))
                  setSaveError(null)
                }}
                placeholder="Asia/Tokyo"
                required
              />
            </Field>
          </FormGrid>

          {saveError ? (
            <Notice tone="danger" title={t('settings:extension.saveFailed')}>{saveError}</Notice>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}

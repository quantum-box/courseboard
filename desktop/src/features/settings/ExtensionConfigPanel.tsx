import { Badge, Button, Input } from '@tachyon-sdk/native-ui'
import { Plus, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { i18next } from '../../i18n'
import { courseboardApiJson, courseboardApiText } from '../../api'
import { COURSE_TIME_ZONE } from '../../lib/clock'
import { isSupportedTimezone } from '../../lib/timezone'
import {
  Field,
  FormGrid,
  LoadingState,
  Notice,
  Panel,
  ResourceError,
  resourceErrorText,
} from '../../components/Page'
import { useRegisterPageReload } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'
import { clearResourceCache } from '../../hooks/useResource'
import { notifyTenantTimezoneChanged } from '../../context/TenantTimezoneProvider'
import {
  MAX_PLAYER_TAG_LENGTH,
  MAX_PLAYER_TAG_OPTIONS,
  normalizedPlayerTagOptions,
  validatePlayerTagOptions,
} from '../golf/playerTagOptions'

const extensionStatusPath = '/v1/course/extension-status'
const extensionConfigPath = '/v1/course/config'
const playerTagOptionsPath = '/v1/course/player-tag-options'

type ExtensionConfigDraft = {
  timezone: string
  playerTagOptions: string[]
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
  timezone: COURSE_TIME_ZONE,
  playerTagOptions: [],
}

export function configDraftFromJson(
  configJson?: Record<string, unknown> | null,
  playerTagOptions: string[] = [],
): ExtensionConfigDraft {
  const timezone = typeof configJson?.timezone === 'string'
    ? configJson.timezone.trim()
    : ''
  return {
    timezone: timezone || defaultExtensionConfig.timezone,
    playerTagOptions,
  }
}

export function validateExtensionConfig(draft: ExtensionConfigDraft) {
  if (!draft.timezone.trim()) return i18next.t('settings:extension.validation.timezoneRequired')
  if (!isSupportedTimezone(draft.timezone.trim())) {
    return i18next.t('settings:extension.validation.timezoneFormat')
  }
  const playerTagError = validatePlayerTagOptions(draft.playerTagOptions)
  if (playerTagError === 'tooMany') {
    return i18next.t('settings:extension.validation.playerTagsTooMany', {
      max: String(MAX_PLAYER_TAG_OPTIONS),
    })
  }
  if (playerTagError === 'tooLong') {
    return i18next.t('settings:extension.validation.playerTagTooLong', {
      max: String(MAX_PLAYER_TAG_LENGTH),
    })
  }
  if (playerTagError === 'duplicate') {
    return i18next.t('settings:extension.validation.playerTagsDuplicate')
  }
  return null
}

/**
 * The config with only the timezone replaced.
 *
 * The visitor categories moved to CourseBoard's own table and the currency was
 * retired, but their stale copies in the config are deliberately left alone:
 * the categories' migration fallback still reads them on tenants that have
 * not saved locally yet, and nothing reads the currency at all.
 */
export function buildConfigJson(
  draft: ExtensionConfigDraft,
  previous?: Record<string, unknown> | null,
): Record<string, unknown> {
  const previousConfig = previous && typeof previous === 'object' && !Array.isArray(previous)
    ? { ...previous }
    : {}
  return {
    ...previousConfig,
    timezone: draft.timezone.trim(),
  }
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
  const [tags, setTags] = useState<string[]>([])
  const [draft, setDraft] = useState<ExtensionConfigDraft>(defaultExtensionConfig)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [next, tagOptions] = await Promise.all([
        courseboardApiJson<ExtensionStatus | null>(extensionStatusPath),
        courseboardApiJson<{ items: string[] }>(playerTagOptionsPath),
      ])
      setExtension(next)
      setTags(tagOptions.items)
      setDraft(configDraftFromJson(next?.configJson, tagOptions.items))
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
    () => configDraftFromJson(extension?.configJson, tags),
    [extension?.configJson, tags],
  )
  const dirty = draft.timezone !== persisted.timezone
    || JSON.stringify(draft.playerTagOptions) !== JSON.stringify(persisted.playerTagOptions)

  async function save() {
    const validationError = validateExtensionConfig(draft)
    if (validationError) {
      setSaveError(validationError)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      // Two stores now: the categories are CourseBoard's own rows, the
      // timezone still rides the extension config until Field grows a generic
      // tenant attribute for it. Each is written only when it changed, so a
      // category edit no longer round-trips the whole config object.
      const nextTags = normalizedPlayerTagOptions(draft.playerTagOptions)
      let storedTags = tags
      if (JSON.stringify(nextTags) !== JSON.stringify(tags)) {
        const stored = await courseboardApiJson<{ items: string[] }>(playerTagOptionsPath, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items: nextTags }),
        })
        storedTags = stored.items
        setTags(stored.items)
        clearResourceCache('course:player-tag-options')
      }
      let configJson = extension?.configJson ?? null
      if (draft.timezone.trim() !== persisted.timezone) {
        configJson = buildConfigJson(draft, extension?.configJson)
        await courseboardApiText(extensionConfigPath, {
          method: 'PATCH',
          body: JSON.stringify({ scopeType: 'tenant', configJson }),
        })
        const next = configJson
        setExtension(current => current ? { ...current, configJson: next } : current)
        clearResourceCache('course:extension-status')
        notifyTenantTimezoneChanged(draft.timezone.trim())
      }
      setDraft(configDraftFromJson(configJson, storedTags))
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

          <fieldset className="settings-option-field">
            <legend>{t('settings:extension.playerTags')}</legend>
            <p>{t('settings:extension.playerTagsHint')}</p>
            <div className="settings-option-list">
              {draft.playerTagOptions.map((option, index) => (
                <div className="settings-option-row" key={index}>
                  <Input
                    value={option}
                    maxLength={MAX_PLAYER_TAG_LENGTH + 1}
                    aria-label={t('settings:extension.playerTagLabel', { n: String(index + 1) })}
                    placeholder={t('settings:extension.playerTagPlaceholder')}
                    onChange={event => {
                      setDraft(current => ({
                        ...current,
                        playerTagOptions: current.playerTagOptions.map((value, at) =>
                          at === index ? event.target.value : value,
                        ),
                      }))
                      setSaveError(null)
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t('settings:extension.removePlayerTag', { n: String(index + 1) })}
                    onClick={() => {
                      setDraft(current => ({
                        ...current,
                        playerTagOptions: current.playerTagOptions.filter((_, at) => at !== index),
                      }))
                      setSaveError(null)
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={draft.playerTagOptions.length >= MAX_PLAYER_TAG_OPTIONS}
              onClick={() => {
                setDraft(current => ({
                  ...current,
                  playerTagOptions: [...current.playerTagOptions, ''],
                }))
                setSaveError(null)
              }}
            >
              <Plus />
              {t('settings:extension.addPlayerTag')}
            </Button>
          </fieldset>

          {saveError ? (
            <Notice tone="danger" title={t('settings:extension.saveFailed')}>{saveError}</Notice>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}

import { Badge, Button } from '@tachyon-sdk/native-ui'
import { RefreshCw, Save } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { i18next } from '../../i18n'
import { ApiError, courseboardApiJson } from '../../api'
import {
  Field,
  LoadingState,
  NativeTextarea,
  Notice,
  Panel,
  ResourceError,
} from '../../components/Page'
import { useRegisterPageReload } from '../../lib/pageReload'
import { showToast } from '../../lib/toast'

type ReservationPolicy = {
  metadataJson?: unknown
}

const METADATA_PLACEHOLDER = `{
  "externalSystem": "pms",
  "partnerFacilityCode": "SCC-SORA",
  "syncReservationCode": true,
  "channelCodes": ["web", "rakuten", "jalan"]
}`

function parseMetadata(value: string) {
  try {
    const parsed: unknown = value.trim() ? JSON.parse(value) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: null, error: i18next.t('settings:metadata.validation.object') }
    }
    return { value: parsed as Record<string, unknown>, error: null }
  } catch {
    return { value: null, error: i18next.t('settings:metadata.validation.syntax') }
  }
}

function formatMetadata(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

export function IntegrationMetadataPanel() {
  const { t } = useTranslation(['settings', 'common'])
  const [draft, setDraft] = useState('{}')
  const [baseline, setBaseline] = useState('{}')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [policyMissing, setPolicyMissing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setSaveError(null)
    try {
      const policy = await courseboardApiJson<ReservationPolicy>(
        '/v1/course/reservation-policy',
      )
      const next = formatMetadata(policy.metadataJson)
      setDraft(next)
      setBaseline(next)
      setPolicyMissing(false)
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setDraft('{}')
        setBaseline('{}')
        setPolicyMissing(true)
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

  const dirty = draft !== baseline
  const parsed = parseMetadata(draft)

  async function save() {
    if (parsed.error) {
      setSaveError(parsed.error)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await courseboardApiJson<unknown>(
        '/v1/course/reservation-policy',
        {
          method: 'PATCH',
          body: JSON.stringify({ metadataJson: parsed.value }),
        },
      )
      const next = formatMetadata(parsed.value)
      setDraft(next)
      setBaseline(next)
      setPolicyMissing(false)
      showToast({
        tone: 'success',
        title: t('settings:metadata.saved.title'),
        message: t('settings:metadata.saved.description'),
      })
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : t('settings:metadata.validation.failed'),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel
      title={t('settings:metadata.title')}
      description={t('settings:metadata.description')}
      actions={(
        <div className="flex items-center gap-2">
          {dirty ? <Badge variant="outline">{t('settings:metadata.unsaved')}</Badge> : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => void load()} disabled={loading || saving} title="⌘R">
            <RefreshCw /> {t('settings:metadata.reload')}
          </Button>
          <Button type="button" size="sm" variant="primary" onClick={() => void save()} disabled={loading || saving || !dirty}>
            <Save /> {saving ? t('common:action.saving') : t('settings:metadata.save')}
          </Button>
        </div>
      )}
    >
      {loading ? <LoadingState label={t('settings:metadata.loading')} /> : null}
      {loadError ? <ResourceError error={loadError} onRetry={() => void load()} /> : null}

      {!loading && !loadError ? (
        <div className="grid gap-3">
          {policyMissing ? (
            <Notice tone="warning" title={t('settings:metadata.policyMissing.title')}>
              {t('settings:metadata.policyMissing.description')}
            </Notice>
          ) : null}

          <Notice tone="info" title={t('settings:metadata.when.title')}>
            {t('settings:metadata.when.description')}
          </Notice>

          <Field
            label={t('settings:metadata.fieldLabel')}
            hint={t('settings:metadata.fieldHint')}
          >
            <NativeTextarea
              rows={12}
              className="font-mono text-xs"
              value={draft}
              onChange={event => {
                setDraft(event.target.value)
                setSaveError(null)
              }}
              placeholder={METADATA_PLACEHOLDER}
              spellCheck={false}
            />
          </Field>

          <div className="rounded-md bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">{t('settings:metadata.examplesTitle')}</p>
            <ul className="list-disc space-y-1 pl-4">
              <li><code>partnerFacilityCode</code> … {t('settings:metadata.example1')}</li>
              <li><code>channelCodes</code> … {t('settings:metadata.example2')}</li>
              <li><code>syncReservationCode</code> … {t('settings:metadata.example3')}</li>
            </ul>
          </div>

          {parsed.error ? (
            <Notice tone="danger" title={t('settings:metadata.invalidJson')}>{parsed.error}</Notice>
          ) : null}
          {saveError ? (
            <Notice tone="danger" title={t('settings:metadata.saveFailed')}>{saveError}</Notice>
          ) : null}
        </div>
      ) : null}
    </Panel>
  )
}

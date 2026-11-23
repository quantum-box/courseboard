import { Badge, Button } from '@tachyon-sdk/native-ui'
import { Copy, Download, ExternalLink, QrCode, RefreshCw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson, downloadText } from '../../api'
import {
  EmptyState,
  LoadingState,
  Notice,
  Panel,
  ResourceError,
  resourceErrorText,
} from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { useRegisterPageReload } from '../../lib/pageReload'
import { openExternal } from '../../lib/platform'
import { showToast } from '../../lib/toast'

const SURVEY_API = '/v1/course/caddie-survey'
export const CADDIE_SURVEY_CACHE_KEY = 'caddie-survey'

export type CaddieSurveyState = 'formsUnavailable' | 'noCaddies' | 'notCreated' | 'ready'

export type CaddieSurvey = {
  state: CaddieSurveyState
  caddieCount: number
  form?: {
    id: string
    publicId: string
    status: string
    hasUnpublishedChanges: boolean
    publicUrl: string
    publishedCaddieCount: number
    caddiesChanged: boolean
  } | null
}

/**
 * The roster's survey tab: one QR the club puts out after the round. The guest
 * picks the caddie who walked with them and rates them; each answer becomes
 * that caddie's rating, read by the roster and the caddie's 評価 tab.
 */
export function CaddieSurveyPanel() {
  const { t } = useTranslation(['caddies', 'common'])
  const resource = useResource(
    () => courseboardApiJson<CaddieSurvey>(SURVEY_API),
    [],
    { cacheKey: CADDIE_SURVEY_CACHE_KEY },
  )
  const [busy, setBusy] = useState(false)
  const qrRef = useRef<HTMLDivElement>(null)
  useRegisterPageReload(resource.refresh)

  async function run(path: string, successKey: 'created' | 'refreshed') {
    setBusy(true)
    try {
      await courseboardApiJson<CaddieSurvey>(path, { method: 'POST' })
      showToast({ tone: 'success', message: t(`caddies:survey.toast.${successKey}`) })
    } catch (error) {
      showToast({
        tone: 'danger',
        title: t('caddies:survey.toast.failed'),
        message: resourceErrorText(error),
      })
    } finally {
      setBusy(false)
      resource.refresh()
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      showToast({ tone: 'success', message: t('caddies:survey.toast.copied') })
    } catch {
      showToast({ tone: 'warning', message: t('caddies:survey.toast.copyFailed') })
    }
  }

  function saveQr() {
    const svg = qrRef.current?.querySelector('svg')
    if (!svg) return
    downloadText('caddie-survey-qr.svg', new XMLSerializer().serializeToString(svg), 'image/svg+xml')
  }

  const survey = resource.data
  const form = survey?.form ?? null

  return (
    <div className="page-stack">
      {resource.loading && !survey ? <LoadingState label={t('caddies:survey.loading')} /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}

      {survey?.state === 'formsUnavailable' ? (
        <Notice tone="warning" title={t('caddies:survey.unavailable.title')}>
          {t('caddies:survey.unavailable.description')}
        </Notice>
      ) : null}

      {survey?.state === 'noCaddies' ? (
        <EmptyState
          title={t('caddies:survey.noCaddies.title')}
          description={t('caddies:survey.noCaddies.description')}
        />
      ) : null}

      {survey?.state === 'notCreated' ? (
        <Panel
          title={t('caddies:survey.create.title')}
          description={t('caddies:survey.create.description', { n: String(survey.caddieCount) })}
          actions={(
            <Button
              type="button"
              variant="primary"
              disabled={busy}
              onClick={() => void run(SURVEY_API, 'created')}
            >
              <QrCode /> {busy ? t('caddies:survey.create.busy') : t('caddies:survey.create.action')}
            </Button>
          )}
        >
          <SurveyExplanation />
        </Panel>
      ) : null}

      {survey?.state === 'ready' && form ? (
        <>
          {form.caddiesChanged ? (
            <Notice
              tone="warning"
              title={t('caddies:survey.changed.title')}
              actions={(
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(`${SURVEY_API}/refresh`, 'refreshed')}
                >
                  <RefreshCw /> {t('caddies:survey.refresh')}
                </Button>
              )}
            >
              {t('caddies:survey.changed.description', {
                published: String(form.publishedCaddieCount),
                current: String(survey.caddieCount),
              })}
            </Notice>
          ) : null}
          {form.status !== 'published' && !form.caddiesChanged ? (
            <Notice tone="warning" title={t('caddies:survey.notAccepting.title')}>
              {t('caddies:survey.notAccepting.description')}
            </Notice>
          ) : null}
          <Panel
            title={t('caddies:survey.ready.title')}
            description={t('caddies:survey.ready.description')}
            actions={(
              <Badge variant={form.status === 'published' ? 'success' : 'neutral'}>
                {form.status === 'published'
                  ? t('caddies:survey.status.accepting')
                  : t('caddies:survey.status.notAccepting')}
              </Badge>
            )}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div
                ref={qrRef}
                className="w-fit rounded-lg border border-border bg-white p-3"
                data-testid="caddie-survey-qr"
              >
                <QRCodeSVG value={form.publicUrl} size={176} marginSize={2} title={t('caddies:survey.ready.qrLabel')} />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <div className="text-sm text-muted-foreground">{t('caddies:survey.ready.url')}</div>
                  <div className="break-all font-mono text-sm">{form.publicUrl}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => void copyUrl(form.publicUrl)}>
                    <Copy /> {t('caddies:survey.ready.copy')}
                  </Button>
                  <Button type="button" size="sm" onClick={() => void openExternal(form.publicUrl)}>
                    <ExternalLink /> {t('caddies:survey.ready.open')}
                  </Button>
                  <Button type="button" size="sm" onClick={saveQr}>
                    <Download /> {t('caddies:survey.ready.saveQr')}
                  </Button>
                  {!form.caddiesChanged ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void run(`${SURVEY_API}/refresh`, 'refreshed')}
                    >
                      <RefreshCw /> {t('caddies:survey.refresh')}
                    </Button>
                  ) : null}
                </div>
                <div className="text-sm text-muted-foreground">
                  {t('caddies:survey.ready.caddieCount', { n: String(form.publishedCaddieCount) })}
                </div>
              </div>
            </div>
          </Panel>
          <Panel title={t('caddies:survey.about.title')}>
            <SurveyExplanation />
          </Panel>
        </>
      ) : null}
    </div>
  )
}

function SurveyExplanation() {
  const { t } = useTranslation('caddies')
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      <li>{t('survey.about.flow')}</li>
      <li>{t('survey.about.ratings')}</li>
      <li>{t('survey.about.privacy')}</li>
      <li>{t('survey.about.roster')}</li>
    </ul>
  )
}

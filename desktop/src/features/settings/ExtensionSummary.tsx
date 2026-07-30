import { Badge, Button } from '@tachyon-sdk/native-ui'
import { CheckCircle2, CircleOff, RefreshCw, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Metric, MetricGrid, Notice, Panel } from '../../components/Page'

/** Placeholder for registry fields the extension-status API may omit. */
const NO_VALUE = '—'

/**
 * Mirrors the extension-status payload, which omits every optional registry
 * field rather than sending null. `name` is one of those and is not rendered
 * here, so it is left out instead of being declared as an always-present string.
 */
export type ExtensionStatus = {
  extensionKey: string
  version?: string | null
  registryStatus?: string | null
  tenantStatus?: 'enabled' | 'disabled' | null
  configVersion?: number | null
  validation: { valid: boolean; errors: string[] }
  updatedAt?: string | null
}

export function ExtensionSummary({ extension, onRefresh }: { extension: ExtensionStatus; onRefresh: () => void }) {
  const { t } = useTranslation(['settings', 'common'])
  const enabled = extension.tenantStatus === 'enabled'
  return (
    <Panel
      className="extension-summary"
      title={t('settings:summary.title')}
      description={t('settings:summary.description')}
      actions={(
        <Button type="button" size="sm" onClick={onRefresh} title="⌘R">
          <RefreshCw /> {t('common:action.refresh')}
        </Button>
      )}
    >
      <MetricGrid>
        <Metric
          label={t('settings:summary.tenantStatus')}
          value={(
            <span className="metric-with-icon">
              {enabled ? <CheckCircle2 /> : <CircleOff />}
              {enabled ? t('settings:extension.enabled') : t('settings:extension.disabled')}
            </span>
          )}
          tone={enabled ? 'success' : 'warning'}
        />
        <Metric
          label={t('settings:summary.registry')}
          value={extension.registryStatus || NO_VALUE}
          detail={extension.version ? `v${extension.version}` : undefined}
        />
        <Metric
          label={t('settings:summary.configVersion')}
          value={extension.configVersion ?? t('settings:summary.defaultVersion')}
        />
        <Metric
          label={t('settings:summary.validation')}
          value={extension.validation.valid
            ? t('settings:extension.valid')
            : t('common:unit.count', { n: String(extension.validation.errors.length) })}
          tone={extension.validation.valid ? 'success' : 'danger'}
        />
      </MetricGrid>
      {!extension.validation.valid ? (
        <Notice tone="danger" title={t('settings:summary.invalid.title')}>
          <ul className="compact-list">
            {extension.validation.errors.map(error => <li key={error}>{error}</li>)}
          </ul>
        </Notice>
      ) : (
        <div className="inline-status">
          <ShieldAlert />
          <span>{t('settings:summary.valid')}</span>
          <Badge variant="success">{t('settings:summary.ready')}</Badge>
        </div>
      )}
    </Panel>
  )
}

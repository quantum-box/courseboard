import { Badge, Button } from '@tachyon-sdk/native-ui'
import { CheckCircle2, CircleOff, RefreshCw, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Metric, MetricGrid, Notice, Panel } from '../../components/Page'

export type ExtensionStatus = {
  extensionKey: string
  name: string
  version: string
  registryStatus: string
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
        <Metric label="Registry" value={extension.registryStatus} detail={`v${extension.version}`} />
        <Metric
          label={t('settings:summary.configVersion')}
          value={extension.configVersion ?? t('settings:summary.defaultVersion')}
        />
        <Metric
          label="Validation"
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
          <Badge variant="success">Ready</Badge>
        </div>
      )}
    </Panel>
  )
}

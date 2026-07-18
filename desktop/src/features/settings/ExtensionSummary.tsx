import { Badge, Button } from '@tachyon-sdk/native-ui'
import { CheckCircle2, CircleOff, RefreshCw, ShieldAlert } from 'lucide-react'
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
  const enabled = extension.tenantStatus === 'enabled'
  return (
    <Panel
      className="extension-summary"
      title="Extension runtime"
      description="Field API registry とテナント設定の現在値"
      actions={(
        <Button type="button" size="sm" onClick={onRefresh}>
          <RefreshCw /> 更新
        </Button>
      )}
    >
      <MetricGrid>
        <Metric
          label="テナント状態"
          value={<span className="metric-with-icon">{enabled ? <CheckCircle2 /> : <CircleOff />}{enabled ? '有効' : '無効'}</span>}
          tone={enabled ? 'success' : 'warning'}
        />
        <Metric label="Registry" value={extension.registryStatus} detail={`v${extension.version}`} />
        <Metric label="設定バージョン" value={extension.configVersion ?? '既定'} />
        <Metric
          label="Validation"
          value={extension.validation.valid ? '正常' : `${extension.validation.errors.length} 件`}
          tone={extension.validation.valid ? 'success' : 'danger'}
        />
      </MetricGrid>
      {!extension.validation.valid ? (
        <Notice tone="danger" title="設定を修正してください">
          <ul className="compact-list">
            {extension.validation.errors.map(error => <li key={error}>{error}</li>)}
          </ul>
        </Notice>
      ) : (
        <div className="inline-status">
          <ShieldAlert />
          <span>設定検証を通過しています。</span>
          <Badge variant="success">Ready</Badge>
        </div>
      )}
    </Panel>
  )
}

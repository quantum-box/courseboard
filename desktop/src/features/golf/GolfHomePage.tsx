import { Badge, Button } from '@tachyon-sdk/native-ui'
import { ArrowRight, CheckCircle2, CircleOff, RefreshCw, ShieldAlert } from 'lucide-react'
import { useCallback } from 'react'
import { fieldApiJson } from '../../api'
import { golfNavigation } from '../../components/AppShell'
import { Metric, MetricGrid, Notice, PageHeader, Panel, ResourceError, LoadingState } from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { navigate } from '../../lib/router'

type ExtensionStatus = {
  extensionKey: string
  name: string
  version: string
  registryStatus: string
  tenantStatus?: 'enabled' | 'disabled' | null
  configVersion?: number | null
  validation: { valid: boolean; errors: string[] }
  updatedAt?: string | null
}

export function GolfHomePage() {
  const loader = useCallback(async () => {
    const response = await fieldApiJson<{ items: ExtensionStatus[] }>('/v1/erp/extensions/status')
    return response.items.find(item => item.extensionKey === 'golf_course') ?? null
  }, [])
  const resource = useResource(loader)

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Golf operations"
        title="ゴルフアプリ"
        description="公開予約、コース、キャディ、予算、請求を同じ運用面から管理します。"
        actions={(
          <Button type="button" variant="primary" onClick={() => navigate('golf/products')}>
            予約商品を開く <ArrowRight />
          </Button>
        )}
      />

      {resource.loading ? <LoadingState label="ゴルフ機能の状態を確認中" /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {!resource.loading && !resource.error && !resource.data ? (
        <Notice tone="warning" title="golf_course extension が見つかりません">
          Field API の extension registry とテナント設定を確認してください。
        </Notice>
      ) : null}
      {resource.data ? <ExtensionSummary extension={resource.data} onRefresh={resource.refresh} /> : null}

      <section className="feature-grid" aria-label="ゴルフ運用機能">
        {golfNavigation.slice(1).map((item, index) => {
          const Icon = item.icon
          return (
            <button key={item.route} type="button" className="feature-tile" onClick={() => navigate(item.route)}>
              <span className="feature-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="feature-icon"><Icon /></span>
              <span className="feature-copy">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
              <ArrowRight className="feature-arrow" />
            </button>
          )
        })}
      </section>

      <Panel title="今日の運用順序" description="マスタ更新から締め処理まで、同じデータを順に引き継ぎます。">
        <div className="operations-track">
          {[
            ['01', '商品と枠', '公開前にコース・商品・受付枠を確認'],
            ['02', 'キャディ配置', '希望休と供給量から担当を確定'],
            ['03', '売上と請求', '予算進捗、キャンセル料、未収を確認'],
            ['04', '月次精算', '予約・費用・Square明細を締める'],
          ].map(([step, label, detail]) => (
            <div key={step} className="operations-step">
              <span>{step}</span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function ExtensionSummary({ extension, onRefresh }: { extension: ExtensionStatus; onRefresh: () => void }) {
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

import { useCallback } from 'react'
import { fieldApiJson } from '../../api'
import { LoadingState, Notice, PageHeader, ResourceError } from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { ExtensionSummary, type ExtensionStatus } from './ExtensionSummary'

export function SettingsPage() {
  const loader = useCallback(async () => {
    const response = await fieldApiJson<{ items: ExtensionStatus[] }>('/v1/erp/extensions/status')
    return response.items.find(item => item.extensionKey === 'golf_course') ?? null
  }, [])
  const resource = useResource(loader)

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Course Board"
        title="設定"
        description="Extension runtime とテナント連携の状態を確認します。"
      />

      {resource.loading ? <LoadingState label="Extension runtime を確認中" /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {!resource.loading && !resource.error && !resource.data ? (
        <Notice tone="warning" title="golf_course extension が見つかりません">
          Field API の extension registry とテナント設定を確認してください。
        </Notice>
      ) : null}
      {resource.data ? <ExtensionSummary extension={resource.data} onRefresh={resource.refresh} /> : null}
    </div>
  )
}

import { ChevronRight, FolderTree, Settings2 } from 'lucide-react'
import { useCallback } from 'react'
import { courseboardApiJson } from '../../api'
import { LoadingState, Notice, PageHeader, Panel, ResourceError } from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { useRegisterPageReload } from '../../lib/pageReload'
import { navigate } from '../../lib/router'
import { ExtensionConfigPanel } from './ExtensionConfigPanel'
import { ExtensionSummary, type ExtensionStatus } from './ExtensionSummary'
import { IntegrationMetadataPanel } from './IntegrationMetadataPanel'

export function SettingsPage() {
  const loader = useCallback(async () => {
    return courseboardApiJson<ExtensionStatus | null>('/v1/course/extension-status')
  }, [])
  const resource = useResource(loader)
  useRegisterPageReload(resource.refresh)

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Course Board"
        title="設定"
        description="初期設定や普段ほぼ触らないテナントマスタ、連携設定をまとめています。"
      />

      <Panel
        title="テナントマスタ"
        description="テナント導入時に一度整えれば、日常運用ではほとんど開きません。"
      >
        <button
          type="button"
          className="settings-master-link"
          onClick={() => navigate('golf/courses')}
        >
          <span className="settings-master-icon"><FolderTree /></span>
          <span className="settings-master-copy">
            <strong>コース管理</strong>
            <small>コース名・ホール数・スタート間隔・タイムゾーン。予約商品やキャディ対応コースの前提です。</small>
          </span>
          <ChevronRight className="settings-master-arrow" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="settings-master-link"
          onClick={() => navigate('golf/policy')}
        >
          <span className="settings-master-icon"><Settings2 /></span>
          <span className="settings-master-copy">
            <strong>予約ポリシー</strong>
            <small>既定ホール・人数・カート・締切・デポジット・セルフロック・客単価判定。導入時に一度整えます。</small>
          </span>
          <ChevronRight className="settings-master-arrow" aria-hidden="true" />
        </button>
      </Panel>

      {resource.loading ? <LoadingState label="Extension runtime を確認中" /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {!resource.loading && !resource.error && !resource.data ? (
        <Notice tone="warning" title="golf_course extension が見つかりません">
          CourseBoard course-api（/v1/course/extension-status）経由で Field の拡張状態を確認できませんでした。テナント設定を確認してください。
        </Notice>
      ) : null}
      {resource.data ? <ExtensionSummary extension={resource.data} onRefresh={resource.refresh} /> : null}

      <ExtensionConfigPanel />
      <IntegrationMetadataPanel />
    </div>
  )
}

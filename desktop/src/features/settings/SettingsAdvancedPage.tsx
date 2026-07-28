import { Button } from '@tachyon-sdk/native-ui'
import { ArrowLeft } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { courseboardApiJson } from '../../api'
import { LoadingState, Notice, PageHeader, ResourceError } from '../../components/Page'
import { useResource } from '../../hooks/useResource'
import { useRegisterPageReload } from '../../lib/pageReload'
import { navigate } from '../../lib/router'
import { ExtensionSummary, type ExtensionStatus } from './ExtensionSummary'
import { IntegrationMetadataPanel } from './IntegrationMetadataPanel'

/**
 * Runtime status and integration plumbing, split off the settings hub so the
 * hub stays a short list of things an operator actually configures.
 */
export function SettingsAdvancedPage() {
  const { t } = useTranslation(['settings', 'common'])
  const loader = useCallback(async () => {
    return courseboardApiJson<ExtensionStatus | null>('/v1/course/extension-status')
  }, [])
  const resource = useResource(loader)
  useRegisterPageReload(resource.refresh)

  return (
    <div className="page-stack">
      <PageHeader
        title={t('settings:advanced.title')}
        description={t('settings:advanced.description')}
        actions={(
          <Button type="button" variant="ghost" onClick={() => navigate('settings')}>
            <ArrowLeft /> {t('common:action.backToSettings')}
          </Button>
        )}
      />

      {resource.loading ? <LoadingState label={t('settings:extension.loading')} /> : null}
      {resource.error ? <ResourceError error={resource.error} onRetry={resource.refresh} /> : null}
      {!resource.loading && !resource.error && !resource.data ? (
        <Notice tone="warning" title={t('settings:extension.missing.title')}>
          {t('settings:extension.missing.description')}
        </Notice>
      ) : null}
      {resource.data ? <ExtensionSummary extension={resource.data} onRefresh={resource.refresh} /> : null}

      <IntegrationMetadataPanel />
    </div>
  )
}

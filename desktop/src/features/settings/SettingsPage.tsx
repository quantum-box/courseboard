import { ChevronRight, Plug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Panel } from '../../components/Page'
import { navDescription, navLabel, settingsNavigation } from '../../components/AppShell'
import { navigateFromClick } from '../../lib/router'
import { ExtensionConfigPanel } from './ExtensionConfigPanel'
import { MembershipPlansPanel } from './MembershipPlansPanel'

export function SettingsPage() {
  const { t } = useTranslation(['settings', 'nav'])

  return (
    <div className="page-stack">
      <Panel
        title={t('settings:tenantMaster.title')}
        description={t('settings:tenantMaster.description')}
      >
        {settingsNavigation.map(item => {
          const Icon = item.icon
          return (
            <button
              key={item.route}
              type="button"
              className="settings-master-link"
              onClick={event => navigateFromClick(event, item.route)}
            >
              <span className="settings-master-icon"><Icon /></span>
              <span className="settings-master-copy">
                <strong>{navLabel(item.route)}</strong>
                <small>{navDescription(item.route)}</small>
              </span>
              <ChevronRight className="settings-master-arrow" aria-hidden="true" />
            </button>
          )
        })}
        <button
          type="button"
          className="settings-master-link"
          onClick={event => navigateFromClick(event, 'settings/advanced')}
        >
          <span className="settings-master-icon"><Plug /></span>
          <span className="settings-master-copy">
            <strong>{t('settings:advanced.linkLabel')}</strong>
            <small>{t('settings:advanced.linkDescription')}</small>
          </span>
          <ChevronRight className="settings-master-arrow" aria-hidden="true" />
        </button>
      </Panel>

      <MembershipPlansPanel />

      <ExtensionConfigPanel />
    </div>
  )
}

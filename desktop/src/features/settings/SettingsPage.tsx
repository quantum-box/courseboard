import {
  Award,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Download,
  IdCard,
  Percent,
  Plug,
  ScanLine,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useEffectiveCapabilities } from '../../auth/EffectiveCapabilitiesProvider'
import { capabilityRouteAllowed } from '../../auth/capabilityRoutes'
import { Panel } from '../../components/Page'
import { navDescription, navLabel, settingsNavigation } from '../../components/AppShell'
import { navigateFromClick } from '../../lib/router'
import { SETTINGS_MASTERS } from './masters'

/**
 * The masters a club fills in once, each on its own screen.
 *
 * Kept as a list of links rather than the editors themselves: six open forms
 * stacked on one page buried whichever one the operator came for, and made the
 * whole screen look like it was waiting to be saved. The routes and copy come
 * from `masters.ts`, which the title bar reads too; only the glyphs are the
 * hub's own.
 */
const MASTER_ICONS: Record<string, LucideIcon> = {
  membership: IdCard,
  discounts: Percent,
  playWindows: CalendarClock,
  grades: Award,
  caddieDuties: ClipboardList,
  receptionFields: ScanLine,
  dataExports: Download,
}

function MasterLink({
  icon: Icon,
  route,
  title,
  description,
}: {
  icon: LucideIcon
  route: string
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      className="settings-master-link"
      onClick={event => navigateFromClick(event, route)}
    >
      <span className="settings-master-icon"><Icon /></span>
      <span className="settings-master-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <ChevronRight className="settings-master-arrow" aria-hidden="true" />
    </button>
  )
}

export function SettingsPage() {
  const { t } = useTranslation(['settings', 'nav', 'dataExports'])
  const { capabilities } = useEffectiveCapabilities()
  const canOpen = (route: string) => capabilityRouteAllowed(route, capabilities)

  return (
    <div className="page-stack">
      <Panel
        title={t('settings:tenantMaster.title')}
        description={t('settings:tenantMaster.description')}
      >
        {settingsNavigation.filter(item => canOpen(item.route)).map(item => (
          <MasterLink
            key={item.route}
            route={item.route}
            icon={item.icon}
            title={navLabel(item.route)}
            description={navDescription(item.route)}
          />
        ))}
        {canOpen('settings/advanced') ? <MasterLink
          route="settings/advanced"
          icon={Plug}
          title={t('settings:advanced.linkLabel')}
          description={t('settings:advanced.linkDescription')}
        /> : null}
      </Panel>

      <Panel title={t('settings:masters.title')} description={t('settings:masters.description')}>
        {SETTINGS_MASTERS.filter(item => canOpen(item.route)).map(item => (
          <MasterLink
            key={item.route}
            route={item.route}
            icon={MASTER_ICONS[item.key] ?? IdCard}
            title={t(item.titleKey)}
            description={t(item.descriptionKey)}
          />
        ))}
      </Panel>
    </div>
  )
}

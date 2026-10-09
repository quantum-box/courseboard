import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Notice } from '../components/Page'
import { capabilityRouteAllowed } from './capabilityRoutes'
import { useEffectiveCapabilities } from './EffectiveCapabilitiesProvider'

/** Keep protected page effects from running when its Field action is absent. */
export function CapabilityGate({ route, children }: { route: string; children: ReactNode }) {
  const { capabilities } = useEffectiveCapabilities()
  const { t } = useTranslation('common')
  return capabilityRouteAllowed(route, capabilities)
    ? children
    : <Notice tone="danger">{t('error.forbidden')}</Notice>
}

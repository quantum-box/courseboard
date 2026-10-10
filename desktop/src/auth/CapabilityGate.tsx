import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Notice } from '../components/Page'
import { routeCapabilityDecision } from './capabilityRoutes'
import { useEffectiveCapabilities } from './EffectiveCapabilitiesProvider'

/** Keep protected page effects from running when its Field action is absent. */
export function CapabilityGate({ route, children }: { route: string; children: ReactNode }) {
  const { capabilities } = useEffectiveCapabilities()
  const { t } = useTranslation('common')
  const decision = routeCapabilityDecision(route, capabilities)
  // An unrecognised route is handled by RouteContent's NotFound branch. Treat
  // it as outside the capability gate so it is not mistaken for a known
  // protected route with a denied action. The navigation/sidebar helper still
  // deliberately denies unknown routes when deciding which links to show.
  return (decision === true || decision === undefined)
    ? children
    : <Notice tone="danger">{t('error.forbidden')}</Notice>
}

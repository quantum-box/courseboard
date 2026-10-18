import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@tachyon-sdk/native-ui'
import { LoadingState, Notice } from '../components/Page'
import { useRouteDelivery } from '../feature-delivery/FeatureDelivery'
import { routeCapabilityDecision } from './capabilityRoutes'
import { useEffectiveCapabilities } from './EffectiveCapabilitiesProvider'

/**
 * Keep protected page effects from running when its Field action is absent,
 * or when the tenant's plan does not provide the route's feature.
 */
export function CapabilityGate({ route, children }: { route: string; children: ReactNode }) {
  const { capabilities } = useEffectiveCapabilities()
  const delivery = useRouteDelivery(route)
  const { t } = useTranslation('common')
  const decision = routeCapabilityDecision(route, capabilities)
  // An unrecognised route is handled by RouteContent's NotFound branch. Treat
  // it as outside the capability gate so it is not mistaken for a known
  // protected route with a denied action. The navigation/sidebar helper still
  // deliberately denies unknown routes when deciding which links to show.
  if (decision !== true && decision !== undefined) {
    return <Notice tone="danger">{t('error.forbidden')}</Notice>
  }
  // The plan is checked after IAM, and an unknown answer is not a yes: the
  // page and its loaders wait until the feature is confirmed.
  if (delivery.decision === false) {
    return <Notice tone="danger">{t('error.featureNotProvided')}</Notice>
  }
  if (delivery.decision === null) {
    return delivery.error
      ? (
          <Notice
            tone="danger"
            actions={(
              <Button type="button" size="sm" onClick={delivery.refresh}>
                {t('action.retry')}
              </Button>
            )}
          >
            {t('error.featureDeliveryUnavailable')}
          </Notice>
        )
      : <LoadingState />
  }
  return children
}

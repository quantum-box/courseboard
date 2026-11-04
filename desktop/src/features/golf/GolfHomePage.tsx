import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { golfNavigation, navDescription, navLabel } from '../../components/AppShell'
import { useHiddenRoutes } from '../../feature-flags/gated-routes'
import { Panel } from '../../components/Page'
import { capabilityRouteAllowed } from '../../auth/capabilityRoutes'
import { useEffectiveCapabilities } from '../../auth/EffectiveCapabilitiesProvider'
import { navigateFromClick } from '../../lib/router'

// Each step names the screen it happens on, so a step whose screen the
// tenant does not have leaves the walkthrough with that screen's tile.
const FLOW_STEPS = [
  { step: 'ledger', route: 'golf/ledger' },
  { step: 'dispatch', route: 'golf/caddies/dispatch' },
  { step: 'revenue', route: 'golf/budgets' },
  { step: 'settlement', route: 'golf/settlement' },
] as const
const FEATURED_ROUTES = new Set(['golf/ledger', 'golf/caddies/dispatch'])
const homeNavigation = golfNavigation.filter(item => item.route !== 'golf/timeline')

type HomeNavigationItem = (typeof golfNavigation)[number]

function FeatureTile({
  item,
  featured = false,
}: {
  item: HomeNavigationItem
  featured?: boolean
}) {
  const Icon = item.icon
  return (
    <button
      type="button"
      className={`feature-tile${featured ? ' feature-tile--featured' : ''}`}
      onClick={event => navigateFromClick(event, item.route)}
    >
      <span className="feature-icon"><Icon /></span>
      <span className="feature-copy">
        <strong>{navLabel(item.route)}</strong>
        <small>{navDescription(item.route)}</small>
      </span>
      <ChevronRight className="feature-arrow" aria-hidden="true" />
    </button>
  )
}

export function GolfHomePage() {
  const { t } = useTranslation(['home', 'common'])
  // The tiles are a way into a screen, so a route the tenant's flag has not
  // turned on has to leave here too. Filtering only the sidebar leaves a tile
  // that walks straight into a 404.
  const hiddenRoutes = useHiddenRoutes()
  const { capabilities } = useEffectiveCapabilities()
  const visible = homeNavigation.filter(item => !hiddenRoutes.has(item.route) && capabilityRouteAllowed(item.route, capabilities))
  const featured = visible.filter(item => FEATURED_ROUTES.has(item.route))
  const otherFeatures = visible.filter(item => !FEATURED_ROUTES.has(item.route))
  const visibleRoutes = new Set(visible.map(item => item.route))
  const flowSteps = FLOW_STEPS.filter(({ route }) => visibleRoutes.has(route))
  // The usual line walks through bookings, caddies, and settlement; a tenant
  // without those screens gets the line that names none of them.
  const launcherDescription = featured.length === FEATURED_ROUTES.size
    ? t('home:launcher.description')
    : t('home:launcher.descriptionGeneric')

  return (
    <div className="page-stack home-page">
      <header className="home-launcher-intro">
        <span>{t('home:launcher.eyebrow')}</span>
        <h1>{t('home:launcher.title')}</h1>
        <p>{launcherDescription}</p>
      </header>

      {featured.length > 0 && (
        <div className="home-featured-grid" aria-label={t('home:launcher.featured')}>
          {featured.map(item => <FeatureTile key={item.route} item={item} featured />)}
        </div>
      )}

      <section className="app-section">
        <h2 className="section-title">{t('home:features.title')}</h2>
        <div className="feature-grid" aria-label={t('home:features.title')}>
          {otherFeatures.map(item => <FeatureTile key={item.route} item={item} />)}
        </div>
      </section>

      {flowSteps.length > 1 && (
        <Panel title={t('home:flow.title')} description={t('home:flow.description')}>
          <div className="operations-track">
            {flowSteps.map(({ step }, index) => (
              <div key={step} className="operations-step">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{t(`home:flow.steps.${step}.label`)}</strong>
                <small>{t(`home:flow.steps.${step}.detail`)}</small>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

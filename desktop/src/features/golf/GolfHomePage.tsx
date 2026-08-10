import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { golfNavigation, navDescription, navLabel } from '../../components/AppShell'
import { Panel } from '../../components/Page'
import { navigateFromClick } from '../../lib/router'

const FLOW_STEPS = ['ledger', 'dispatch', 'revenue', 'settlement'] as const
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
  const featured = homeNavigation.filter(item => FEATURED_ROUTES.has(item.route))
  const otherFeatures = homeNavigation.filter(item => !FEATURED_ROUTES.has(item.route))

  return (
    <div className="page-stack home-page">
      <header className="home-launcher-intro">
        <span>{t('home:launcher.eyebrow')}</span>
        <h1>{t('home:launcher.title')}</h1>
        <p>{t('home:launcher.description')}</p>
      </header>

      <div className="home-featured-grid" aria-label={t('home:launcher.featured')}>
        {featured.map(item => <FeatureTile key={item.route} item={item} featured />)}
      </div>

      <section className="app-section">
        <h2 className="section-title">{t('home:features.title')}</h2>
        <div className="feature-grid" aria-label={t('home:features.title')}>
          {otherFeatures.map(item => <FeatureTile key={item.route} item={item} />)}
        </div>
      </section>

      <Panel title={t('home:flow.title')} description={t('home:flow.description')}>
        <div className="operations-track">
          {FLOW_STEPS.map((step, index) => (
            <div key={step} className="operations-step">
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{t(`home:flow.steps.${step}.label`)}</strong>
              <small>{t(`home:flow.steps.${step}.detail`)}</small>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

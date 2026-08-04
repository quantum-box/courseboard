import { Button } from '@tachyon-sdk/native-ui'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { golfNavigation, navDescription, navLabel } from '../../components/AppShell'
import { Panel } from '../../components/Page'
import { navigate, navigateFromClick } from '../../lib/router'

const FLOW_STEPS = ['timeline', 'dispatch', 'revenue', 'settlement'] as const

export function GolfHomePage() {
  const { t } = useTranslation(['home', 'common'])

  return (
    <div className="page-stack">
      <div className="page-toolbar">
        <Button type="button" variant="primary" onClick={() => navigate('golf/timeline')}>
          {t('home:openTimeline')}
        </Button>
      </div>

      <section className="app-section">
        <h2 className="section-title">{t('home:features.title')}</h2>
        <div className="feature-grid" aria-label={t('home:features.title')}>
          {golfNavigation.map(item => {
            const Icon = item.icon
            return (
              <button
                key={item.route}
                type="button"
                className="feature-tile"
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
          })}
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

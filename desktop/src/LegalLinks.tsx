import { useTranslation } from 'react-i18next'
import { routeHref } from './lib/router'

export function LegalLinks({ className }: { className?: string }) {
  const { t } = useTranslation('payment')

  return (
    <nav className={className} aria-label={t('legalLinksLabel')}>
      <a
        href="https://quantum-box.com/legal"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('commercialDisclosure')}
      </a>
      <a href={routeHref('privacy')}>{t('privacyPolicy')}</a>
      <a href={routeHref('terms')}>{t('termsOfService')}</a>
    </nav>
  )
}

import { RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNewVersionAvailable } from '../lib/newVersion'

/**
 * A non-modal heads-up that a newer deploy exists. Reception desks keep the
 * ledger open for hours, so a stale tab can silently keep running JS a fix
 * (e.g. SCC-27) already removed from the deployed bundle.
 */
export function NewVersionBanner() {
  const available = useNewVersionAvailable()
  const [dismissed, setDismissed] = useState(false)
  const { t } = useTranslation('common')

  if (!available || dismissed) return null

  return (
    <div className="new-version-banner" role="status" aria-live="polite">
      <span className="new-version-banner-message">{t('newVersion.message')}</span>
      <div className="new-version-banner-actions">
        <button
          type="button"
          className="new-version-banner-reload"
          onClick={() => window.location.reload()}
        >
          <RefreshCw aria-hidden="true" />
          {t('newVersion.reload')}
        </button>
        <button
          type="button"
          className="new-version-banner-dismiss"
          aria-label={t('newVersion.dismiss')}
          onClick={() => setDismissed(true)}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

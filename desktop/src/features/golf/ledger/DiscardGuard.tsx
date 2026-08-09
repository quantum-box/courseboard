import { Button } from '@tachyon-sdk/native-ui'
import { useTranslation } from 'react-i18next'

/**
 * Confirm before throwing away a half-typed form.
 *
 * The desk types these while a caller is on the phone, and the sheet closes on
 * a stray click outside or an Escape meant for something else. Losing the
 * booking that was half entered costs the call.
 */
export function DiscardGuard({
  open,
  onKeepEditing,
  onDiscard,
}: {
  open: boolean
  onKeepEditing: () => void
  onDiscard: () => void
}) {
  const { t } = useTranslation(['ledger'])
  if (!open) return null

  return (
    <div className="ledger-discard-guard" role="alertdialog" aria-modal="true">
      <div className="ledger-discard-guard-box">
        <h2>{t('ledger:discard.title')}</h2>
        <p>{t('ledger:discard.body')}</p>
        <div className="ledger-discard-guard-actions">
          <Button type="button" variant="primary" onClick={onKeepEditing}>
            {t('ledger:discard.keepEditing')}
          </Button>
          <Button type="button" variant="ghost" onClick={onDiscard}>
            {t('ledger:discard.discard')}
          </Button>
        </div>
      </div>
    </div>
  )
}

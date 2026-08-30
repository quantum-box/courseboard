import { Button } from '@tachyon-sdk/native-ui'
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { navigate } from '../../lib/router'

/**
 * The frame each settings master shares: its own route, and one way back.
 *
 * A master is a screen rather than a panel on one scrolling page. These are
 * set up once and then left alone, so stacking six editors on each other only
 * buried whichever one the operator came for — and every one of them was an
 * open form, which made the page look like it wanted saving all over.
 */
export function SettingsSubPage({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common')
  return (
    <div className="page-stack">
      <Button type="button" variant="ghost" onClick={() => navigate('settings')}>
        <ChevronLeft /> {t('action.backToSettings')}
      </Button>
      {children}
    </div>
  )
}

import { useTranslation } from 'react-i18next'

import { courseboardApiJson } from '../../../api'
import { useTenantTimezone } from '../../../context/TenantTimezoneProvider'
import { useResource } from '../../../hooks/useResource'
import { customerRegistrationPath, type CustomerRegistration } from './registration'
import { visitDate } from './visits'

/**
 * How this entry got into the ledger.
 *
 * The reception sheet keeps same-name rows rather than dropping them, because a
 * group really can contain two 山田 太郎. That makes duplicates a normal
 * outcome, and a week later the only way to tell which sheet a given entry came
 * off is this line.
 *
 * Silent while loading and silent on failure. This is a footnote on somebody's
 * page: a spinner or an error banner here would be louder than the fact it
 * reports, and neither stops the desk from working.
 */
export function CustomerRegistrationNote({ customerId }: { customerId: string }) {
  const { t } = useTranslation(['customers', 'common'])
  const timezone = useTenantTimezone()

  const resource = useResource(
    () =>
      courseboardApiJson<CustomerRegistration | null>(customerRegistrationPath(customerId)),
    [customerId],
    { cacheKey: `customer:registration:${customerId}` },
  )

  if (resource.loading || resource.error) return null

  const registration = resource.data ?? null
  // Most of the ledger predates this being kept. Saying so beats a blank,
  // which reads as a field somebody forgot to fill in.
  if (!registration) {
    return <p className="muted">{t('customers:registration.unrecorded')}</p>
  }

  const on = visitDate(registration.createdAt, timezone)
  const source = t(`customers:registration.source.${registration.source}`)

  return (
    <p className="muted">
      {registration.source === 'reception_sheet' && registration.sourceRowIndex != null
        ? t('customers:registration.fromSheetRow', {
            date: on,
            // Shown one-based: the desk counts lines on paper from one.
            row: String(registration.sourceRowIndex + 1),
          })
        : t('customers:registration.from', { date: on, source })}
      {registration.registeredBy
        ? ` ${t('customers:registration.by', { operator: registration.registeredBy })}`
        : ''}
    </p>
  )
}

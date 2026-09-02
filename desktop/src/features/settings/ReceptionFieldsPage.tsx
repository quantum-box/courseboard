import { useResource } from '../../hooks/useResource'
import { useRegisterPageReload } from '../../lib/pageReload'
import {
  listReceptionConsentItems,
  listReceptionFields,
} from '../golf/customers/reception/api'
import {
  DEFAULT_RECEPTION_FIELDS,
  type ReceptionConsentItem,
} from '../golf/customers/reception/models'
import { ReceptionFieldSettingsPanel } from '../golf/customers/reception/ReceptionPage'
import { SettingsSubPage } from './SettingsSubPage'

/**
 * The shape of a club's reception sheet is tenant master data, not part of
 * reading today's paper. Keeping the editor here leaves the reception screen
 * with one job: compare a document, correct its rows, and register them.
 */
export function ReceptionFieldsPage() {
  const resource = useResource(
    () => listReceptionFields(),
    [],
    { cacheKey: 'course:customer-reception-fields' },
  )
  const consentResource = useResource(
    () => listReceptionConsentItems({ includeInactive: true }),
    [],
    { cacheKey: 'course:customer-consent-items' },
  )
  useRegisterPageReload(resource.refresh)
  useRegisterPageReload(consentResource.refresh)

  function onConsentItemsCreated(created: readonly ReceptionConsentItem[]) {
    consentResource.setData(current => {
      const byKey = new Map(
        (current ?? []).map(item => [item.consentKey, item]),
      )
      for (const item of created) byKey.set(item.consentKey, item)
      return [...byKey.values()].sort((left, right) =>
        left.sortOrder - right.sortOrder || left.consentKey.localeCompare(right.consentKey),
      )
    })
  }

  return (
    <SettingsSubPage>
      <ReceptionFieldSettingsPanel
        fields={resource.data ?? DEFAULT_RECEPTION_FIELDS}
        loading={resource.loading}
        error={resource.error}
        onRetry={() => void resource.refresh()}
        onSaved={resource.setData}
        consentItems={consentResource.data ?? []}
        consentItemsLoading={consentResource.loading}
        consentItemsError={consentResource.error}
        onRetryConsentItems={() => void consentResource.refresh()}
        onConsentItemsCreated={onConsentItemsCreated}
      />
    </SettingsSubPage>
  )
}

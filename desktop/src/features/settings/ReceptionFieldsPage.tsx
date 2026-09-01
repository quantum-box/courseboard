import { useResource } from '../../hooks/useResource'
import { useRegisterPageReload } from '../../lib/pageReload'
import { listReceptionFields } from '../golf/customers/reception/api'
import { DEFAULT_RECEPTION_FIELDS } from '../golf/customers/reception/models'
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
  useRegisterPageReload(resource.refresh)

  return (
    <SettingsSubPage>
      <ReceptionFieldSettingsPanel
        fields={resource.data ?? DEFAULT_RECEPTION_FIELDS}
        loading={resource.loading}
        error={resource.error}
        onRetry={() => void resource.refresh()}
        onSaved={resource.setData}
      />
    </SettingsSubPage>
  )
}

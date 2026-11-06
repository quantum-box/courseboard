import { Input } from '@tachyon-sdk/native-ui'
import { useTranslation } from 'react-i18next'

import { Field, FormGrid, NativeSelect } from '../../../components/Page'
import type { RemarksDraft } from './partyRemarks'

/**
 * The `【食】/【集計】/【精算】` lines of a start ledger. Shared by the new-booking
 * and edit sheets so the two never ask for them differently.
 */
export function PartyRemarksFields({
  value,
  onChange,
}: {
  value: RemarksDraft
  onChange: (next: RemarksDraft) => void
}) {
  const { t } = useTranslation(['ledger'])
  return (
    <FormGrid columns={3}>
      <Field label={t('ledger:remarks.meal')}>
        <Input
          value={value.meal}
          placeholder={t('ledger:remarks.mealPlaceholder')}
          onChange={event => onChange({ ...value, meal: event.target.value })}
        />
      </Field>
      <Field label={t('ledger:remarks.scoreTally')}>
        <NativeSelect
          value={value.scoreTally}
          onChange={event =>
            onChange({ ...value, scoreTally: event.target.value as RemarksDraft['scoreTally'] })
          }
        >
          <option value="">{t('ledger:remarks.unset')}</option>
          <option value="yes">{t('ledger:remarks.scoreTallyYes')}</option>
          <option value="no">{t('ledger:remarks.scoreTallyNo')}</option>
        </NativeSelect>
      </Field>
      <Field label={t('ledger:remarks.settlement')}>
        <NativeSelect
          value={value.settlement}
          onChange={event =>
            onChange({ ...value, settlement: event.target.value as RemarksDraft['settlement'] })
          }
        >
          <option value="">{t('ledger:remarks.unset')}</option>
          <option value="individual">{t('ledger:remarks.settlementIndividual')}</option>
          <option value="together">{t('ledger:remarks.settlementTogether')}</option>
        </NativeSelect>
      </Field>
    </FormGrid>
  )
}

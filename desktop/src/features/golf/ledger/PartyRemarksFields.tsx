import { Input } from '@tachyon-sdk/native-ui'
import { useTranslation } from 'react-i18next'

import { Field, FormGrid, NativeSelect, NativeTextarea } from '../../../components/Page'
import { MAX_REMARKS_NOTE_LENGTH, type RemarksDraft } from './partyRemarks'

/**
 * The `【食】/【集計】/【精算】` lines of a start ledger, plus a free note. Shared by the new-booking
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
    <>
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
      <FormGrid columns={1}>
        <Field
          label={t('ledger:remarks.note')}
          hint={t('ledger:remarks.noteHint', {
            typed: String(value.note.length),
            max: String(MAX_REMARKS_NOTE_LENGTH),
          })}
        >
          <NativeTextarea
            value={value.note}
            rows={3}
            maxLength={MAX_REMARKS_NOTE_LENGTH}
            placeholder={t('ledger:remarks.notePlaceholder')}
            onChange={event => onChange({ ...value, note: event.target.value })}
          />
        </Field>
      </FormGrid>
    </>
  )
}

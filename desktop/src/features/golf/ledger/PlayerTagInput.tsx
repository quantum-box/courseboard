import { Input } from '@tachyon-sdk/native-ui'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { NativeSelect } from '../../../components/Page'

const OTHER_VALUE = '__courseboard_other_player_tag__'

/** Configured choices first, while unknown historical values remain editable. */
export function PlayerTagInput({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('ledger')
  const trimmedValue = value.trim()
  const known = options.includes(trimmedValue)
  const [custom, setCustom] = useState(Boolean(trimmedValue && !known))

  useEffect(() => {
    if (trimmedValue && !known) setCustom(true)
    if (known) setCustom(false)
  }, [known, trimmedValue])

  return (
    <div className="ledger-player-tag-input">
      <NativeSelect
        value={custom ? OTHER_VALUE : (known ? trimmedValue : '')}
        onChange={event => {
          if (event.target.value === OTHER_VALUE) {
            setCustom(true)
            onChange('')
            return
          }
          setCustom(false)
          onChange(event.target.value)
        }}
      >
        <option value="">{t('party.playerTagSelect')}</option>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
        <option value={OTHER_VALUE}>{t('party.playerTagOther')}</option>
      </NativeSelect>
      {custom ? (
        <Input
          value={value}
          placeholder={t('party.playerTagCustomPlaceholder')}
          onChange={event => onChange(event.target.value)}
        />
      ) : null}
    </div>
  )
}

import { useId, useMemo, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import { currentYearMonth } from '../lib/clock'
import {
  initialYearMonthState,
  normalizeYearMonth,
  yearMonthReducer,
  type YearMonthError,
} from '../lib/yearMonth'
import { Field, NativeSelect } from './Page'

const FIRST_YEAR = 2000
const FUTURE_YEAR_WINDOW = 10

export function useYearMonthValue(initialValue: string) {
  const [state, setCandidate] = useReducer(
    yearMonthReducer,
    initialValue,
    candidate => initialYearMonthState(candidate, currentYearMonth()),
  )
  return { ...state, setCandidate }
}

export function YearMonthPicker({
  label,
  value,
  error,
  onChange,
  className = '',
}: {
  label: string
  value: string
  error: YearMonthError | null
  onChange: (candidate: string) => void
  className?: string
}) {
  const { t } = useTranslation('common')
  const errorId = useId()
  const safeValue = normalizeYearMonth(value) ?? currentYearMonth()
  const [year, month] = safeValue.split('-')
  const selectedYear = Number(year)
  const currentYear = Number(currentYearMonth().slice(0, 4))
  const years = useMemo(() => {
    const first = Math.min(FIRST_YEAR, selectedYear)
    const last = Math.max(currentYear + FUTURE_YEAR_WINDOW, selectedYear)
    return Array.from({ length: last - first + 1 }, (_, index) => first + index)
  }, [currentYear, selectedYear])

  return (
    <Field requirement="none" label={label} className={className}>
      <div
        className="flex items-center gap-2"
        role="group"
        aria-label={label}
        aria-describedby={error ? errorId : undefined}
      >
        <NativeSelect
          value={year}
          aria-label={`${label}・${t('time.year')}`}
          onChange={event => onChange(`${event.target.value}-${month}`)}
        >
          {years.map(option => <option key={option} value={option}>{option}</option>)}
        </NativeSelect>
        <span className="text-sm text-muted-foreground">{t('time.year')}</span>
        <NativeSelect
          value={month}
          aria-label={`${label}・${t('time.month')}`}
          onChange={event => onChange(`${year}-${event.target.value}`)}
        >
          {Array.from({ length: 12 }, (_, index) => {
            const option = String(index + 1).padStart(2, '0')
            return <option key={option} value={option}>{index + 1}</option>
          })}
        </NativeSelect>
        <span className="text-sm text-muted-foreground">{t('time.month')}</span>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
          {t('error.yearMonthInvalid')}
        </p>
      ) : null}
    </Field>
  )
}

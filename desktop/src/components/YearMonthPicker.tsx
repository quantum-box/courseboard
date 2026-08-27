import { Button, Popover, PopoverContent, PopoverTrigger } from '@tachyon-sdk/native-ui'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  initialYearMonthState,
  normalizeYearMonth,
  shiftYearMonth,
  yearMonthReducer,
  type YearMonthError,
} from '../lib/yearMonth'
import { useRouteParamState } from '../lib/router'
import { Field, NativeSelect } from './Page'

const FIRST_YEAR = 2000
const FUTURE_YEAR_WINDOW = 10

/**
 * The month a screen is showing, kept in the URL.
 *
 * Same reading as the ledger's date: what these screens are about is one month,
 * so a link that does not name it reopens on the current month for whoever it
 * was sent to, and a reload throws away the month somebody had paged back to.
 *
 * A month arriving from the URL is never an error the operator has to answer
 * for — nobody typed it — so an unreadable one falls back quietly. The error
 * state is for what the picker sends back.
 */
export function useRouteYearMonthValue(key: string, fallback: string) {
  const [routeValue, setRouteValue] = useRouteParamState(key, {
    fallback,
    normalize: normalizeYearMonth,
  })
  const [state, dispatch] = useReducer(
    yearMonthReducer,
    routeValue,
    candidate => initialYearMonthState(candidate, fallback),
  )

  // The URL moves without the picker too: back, forward, a pasted link.
  useEffect(() => {
    dispatch(routeValue)
  }, [routeValue])

  const setCandidate = useCallback((candidate: string) => {
    dispatch(candidate)
    // Only a readable month reaches the URL; the reducer keeps the last good
    // one on screen and says why the rest was refused.
    const next = normalizeYearMonth(candidate)
    if (next) setRouteValue(next)
  }, [setRouteValue])

  return { ...state, setCandidate }
}

export function YearMonthPicker({
  label,
  value,
  error,
  onChange,
  className = '',
  hideLabel = false,
}: {
  label: string
  value: string
  error: YearMonthError | null
  onChange: (candidate: string) => void
  className?: string
  /** Screens that already name the month in their panel header. */
  hideLabel?: boolean
}) {
  const { t } = useTranslation('common')
  const errorId = useId()
  const [open, setOpen] = useState(false)
  const safeValue = normalizeYearMonth(value) ?? '1970-01'
  const [year, month] = safeValue.split('-')
  const selectedYear = Number(year)
  const years = useMemo(() => {
    const first = Math.min(FIRST_YEAR, selectedYear)
    const last = selectedYear + FUTURE_YEAR_WINDOW
    return Array.from({ length: last - first + 1 }, (_, index) => first + index)
  }, [selectedYear])

  // One control everywhere. The arrows are what the desk reaches for — next
  // month, last month — and they used to exist on only one of the five screens.
  // The dropdowns are for the jump nobody wants to click twelve times, so they
  // sit behind the label rather than beside it.
  const control = (
    <div
      className={`flex items-center gap-1 rounded-md border border-border bg-background p-1 ${className}`}
      role="group"
      aria-label={label}
      aria-describedby={error ? errorId : undefined}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="min-h-9 min-w-9"
        aria-label={t('time.prevMonth')}
        onClick={() => onChange(shiftYearMonth(safeValue, -1))}
      >
        <ChevronLeft />
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="min-h-9 min-w-24 text-sm font-medium"
            aria-label={`${label}・${t('time.pickMonth')}`}
          >
            {t('time.yearMonth', { year, month: String(Number(month)) })}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="center" className="w-auto">
          {/* `.native-select` is `width: 100%`, so the size has to come from
              the box around it — a utility class on the select itself loses.
              Without this the year read `202`. */}
          <div className="flex items-center gap-2">
            <span className="block w-24">
              <NativeSelect
                value={year}
                aria-label={`${label}・${t('time.year')}`}
                onChange={event => onChange(`${event.target.value}-${month}`)}
              >
                {years.map(option => <option key={option} value={option}>{option}</option>)}
              </NativeSelect>
            </span>
            <span className="text-sm text-muted-foreground">{t('time.year')}</span>
            <span className="block w-20">
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
            </span>
            <span className="text-sm text-muted-foreground">{t('time.month')}</span>
          </div>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="min-h-9 min-w-9"
        aria-label={t('time.nextMonth')}
        onClick={() => onChange(shiftYearMonth(safeValue, 1))}
      >
        <ChevronRight />
      </Button>
    </div>
  )

  const message = error ? (
    <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
      {t('error.yearMonthInvalid')}
    </p>
  ) : null

  if (hideLabel) {
    return <>{control}{message}</>
  }

  return (
    <Field requirement="none" label={label}>
      {control}
      {message}
    </Field>
  )
}

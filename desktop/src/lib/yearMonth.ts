export type YearMonthError = 'required' | 'invalid'

export type YearMonthState = {
  value: string
  error: YearMonthError | null
}

/**
 * Normalize what a human reads as a year/month at the input boundary.
 * NFKC makes full-width digits and the full-width hyphen behave like their
 * ASCII equivalents; one-digit months are zero-padded for API/rendering code.
 */
export function normalizeYearMonth(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null
  const normalized = candidate.trim().normalize('NFKC')
  const match = /^(\d{4})-(\d{1,2})$/.exec(normalized)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

export function initialYearMonthState(candidate: string, fallback: string): YearMonthState {
  const value = normalizeYearMonth(candidate)
  if (value) return { value, error: null }
  return {
    value: normalizeYearMonth(fallback) ?? '1970-01',
    error: candidate.trim() ? 'invalid' : 'required',
  }
}

/** Invalid candidates never replace the last value known to be safe to render. */
export function yearMonthReducer(state: YearMonthState, candidate: string): YearMonthState {
  const value = normalizeYearMonth(candidate)
  if (value) return { value, error: null }
  return {
    value: state.value,
    error: candidate.trim() ? 'invalid' : 'required',
  }
}

export function yearMonthRange(candidate: unknown): {
  value: string
  from: string
  to: string
} | null {
  const value = normalizeYearMonth(candidate)
  if (!value) return null
  const [year, month] = value.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate()
  return {
    value,
    from: `${value}-01`,
    to: `${value}-${String(lastDay).padStart(2, '0')}`,
  }
}

export function yearMonthDates(candidate: unknown): string[] {
  const range = yearMonthRange(candidate)
  if (!range) return []
  const lastDay = Number(range.to.slice(8, 10))
  return Array.from({ length: lastDay }, (_, index) => (
    `${range.value}-${String(index + 1).padStart(2, '0')}`
  ))
}

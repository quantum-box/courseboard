/**
 * Which hole counts a dropdown should offer.
 *
 * The dropdowns used to list 18 and 9 and nothing else. A course or product
 * recorded as 27 holes therefore opened with its value missing from the list,
 * so the browser showed the first option instead — "18" — and saving the form
 * wrote 18 back. The number changed without anyone touching that field, and the
 * list view kept showing 27 until the save landed.
 *
 * Whatever the record already says is offered alongside the usual two, so the
 * form opens on the value it was given.
 */
import { i18next } from '../../i18n'

export const COMMON_HOLE_COUNTS = [18, 9] as const

/**
 * The options to render, current value included, largest first.
 *
 * A missing or nonsensical count (0, negative, fractional) is left out rather
 * than offered: it is not a hole count anyone should be able to save back.
 */
/**
 * The label for one option. 18 and 9 read as they always have.
 *
 * Translated through the shared instance rather than a caller's `t`: the three
 * screens that show this dropdown each load a different set of namespaces, and
 * only `courses` is common to all of them.
 */
export function holeCountLabel(holes: number): string {
  if (holes === 18) return i18next.t('courses:option.holes18')
  if (holes === 9) return i18next.t('courses:option.holes9')
  return i18next.t('courses:option.holesOther', { n: String(holes) })
}

export function holeCountOptions(current: number | null | undefined): number[] {
  const options = [...COMMON_HOLE_COUNTS] as number[]
  if (
    typeof current === 'number'
    && Number.isInteger(current)
    && current > 0
    && !options.includes(current)
  ) {
    options.push(current)
  }
  return options.sort((left, right) => right - left)
}

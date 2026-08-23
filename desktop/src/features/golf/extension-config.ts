import { i18next } from '../../i18n'

/**
 * The prefectures whose golf course tax schedules we hold. Each sets its own
 * rates by ordinance, so a course can only be priced once it says which one it
 * is under — there is no sensible default to fall back on.
 */
export const PREFECTURES: readonly string[] = ['hokkaido']

/**
 * The two keys the pricing screen owns in the extension config.
 *
 * This form used to carry seven more — holes, party size, cart policy,
 * deposits, a public product name — and wrote defaults for all of them on
 * every save, even for a club that had never set any. Nothing read those
 * copies: the real values live in Field's reservation policy, edited on the
 * policy screen. Writing a second, unread copy of a booking rule is exactly
 * what ADR-0009 retires, so the form now touches only what it shows.
 */
export type GolfExtensionConfigDraft = {
  /** Which prefecture's golf course tax schedule applies. */
  prefecture: string
  /** The grade the prefecture assigned this course. */
  taxGrade: string
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

export function golfExtensionConfigToDraft(
  config: Record<string, unknown>,
): GolfExtensionConfigDraft {
  return {
    prefecture: stringValue(config.prefecture),
    taxGrade: stringValue(config.taxGrade),
  }
}

export function buildGolfExtensionConfig(
  draft: GolfExtensionConfigDraft,
  original: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = []
  // The prefecture decides the tax schedule, so a typo here is a wrong tax
  // rather than a failed lookup. Only known keys are accepted.
  const prefecture = draft.prefecture.trim()
  if (prefecture !== '' && !PREFECTURES.includes(prefecture)) {
    errors.push(i18next.t('settings:validation.prefecture'))
  }
  const taxGrade = draft.taxGrade.trim()
  if (taxGrade !== '' && !/^[A-Za-z0-9-]{1,32}$/.test(taxGrade)) {
    errors.push(i18next.t('settings:validation.taxGrade'))
  }
  if (taxGrade !== '' && prefecture === '') {
    errors.push(i18next.t('settings:validation.gradeNeedsPrefecture'))
  }
  if (errors.length > 0) throw new Error(errors.join(' / '))

  return { ...original, prefecture, taxGrade }
}

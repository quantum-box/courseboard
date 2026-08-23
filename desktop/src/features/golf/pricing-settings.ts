import { i18next } from '../../i18n'

/**
 * The prefectures whose golf course tax schedules we hold. Each sets its own
 * rates by ordinance, so a course can only be priced once it says which one it
 * is under — there is no sensible default to fall back on.
 */
export const PREFECTURES: readonly string[] = ['hokkaido']

/**
 * The simulator's pricing inputs, as `/v1/course/pricing-settings` serves
 * them. The panel edits two fields; the rest ride along so a cost assumption
 * somebody set by hand survives the save instead of reverting to defaults.
 */
export type PricingSettings = {
  prefecture: string | null
  taxGrade: string | null
  taxableRatio: number
  priceElasticity: number
  fixedCostPerDay: number
  variableCostPerVisitor: number
}

export type PricingSettingsDraft = {
  /** Which prefecture's golf course tax schedule applies. */
  prefecture: string
  /** The grade the prefecture assigned this course. */
  taxGrade: string
}

export function pricingSettingsToDraft(settings: PricingSettings): PricingSettingsDraft {
  return {
    prefecture: settings.prefecture ?? '',
    taxGrade: settings.taxGrade ?? '',
  }
}

/** Validate the edited fields and rebuild the whole object the API expects. */
export function buildPricingSettings(
  draft: PricingSettingsDraft,
  settings: PricingSettings,
): PricingSettings {
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

  return {
    ...settings,
    prefecture: prefecture === '' ? null : prefecture,
    taxGrade: taxGrade === '' ? null : taxGrade,
  }
}

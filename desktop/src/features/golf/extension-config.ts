import { i18next } from '../../i18n'

/**
 * The prefectures whose golf course tax schedules we hold. Each sets its own
 * rates by ordinance, so a course can only be priced once it says which one it
 * is under — there is no sensible default to fall back on.
 */
export const PREFECTURES: readonly string[] = ['hokkaido']

export type GolfExtensionConfigDraft = {
  cartPolicy: 'optional' | 'required' | 'unavailable'
  defaultDurationMinutes: string
  defaultHoles: string
  maxPlayersPerTeeTime: string
  memberDepositPercent: string
  guestDepositPercent: string
  publicProductName: string
  publicProductDescription: string
  /** Which prefecture's golf course tax schedule applies. */
  prefecture: string
  /** The grade the prefecture assigned this course. */
  taxGrade: string
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function golfExtensionConfigToDraft(
  config: Record<string, unknown>,
): GolfExtensionConfigDraft {
  const pricing = objectValue(config.memberGuestPricing)
  const rawCartPolicy = stringValue(config.cartPolicy, 'optional')
  const cartPolicy = ['optional', 'required', 'unavailable'].includes(rawCartPolicy)
    ? rawCartPolicy as GolfExtensionConfigDraft['cartPolicy']
    : 'optional'

  return {
    cartPolicy,
    defaultDurationMinutes: String(numberValue(config.defaultDurationMinutes, 60)),
    defaultHoles: String(numberValue(config.defaultHoles, 18)),
    maxPlayersPerTeeTime: String(numberValue(config.maxPlayersPerTeeTime, 4)),
    memberDepositPercent: String(numberValue(pricing.memberDepositRatio, 0.3) * 100),
    guestDepositPercent: String(numberValue(pricing.guestDepositRatio, 0.3) * 100),
    publicProductName: stringValue(config.publicProductName),
    publicProductDescription: stringValue(config.publicProductDescription),
    prefecture: stringValue(config.prefecture),
    taxGrade: stringValue(config.taxGrade),
  }
}

export function buildGolfExtensionConfig(
  draft: GolfExtensionConfigDraft,
  original: Record<string, unknown>,
): Record<string, unknown> {
  const defaultDurationMinutes = Number(draft.defaultDurationMinutes)
  const defaultHoles = Number(draft.defaultHoles)
  const maxPlayersPerTeeTime = Number(draft.maxPlayersPerTeeTime)
  const memberDepositPercent = Number(draft.memberDepositPercent)
  const guestDepositPercent = Number(draft.guestDepositPercent)
  const errors: string[] = []

  if (!Number.isInteger(defaultDurationMinutes) || defaultDurationMinutes < 30 || defaultDurationMinutes > 720) {
    errors.push(i18next.t('settings:validation.duration'))
  }
  if (![9, 18].includes(defaultHoles)) {
    errors.push(i18next.t('settings:validation.holes'))
  }
  if (!Number.isInteger(maxPlayersPerTeeTime) || maxPlayersPerTeeTime < 1 || maxPlayersPerTeeTime > 4) {
    errors.push(i18next.t('settings:validation.maxPlayers'))
  }
  if (
    draft.memberDepositPercent.trim() === ''
    || !Number.isFinite(memberDepositPercent)
    || memberDepositPercent < 0
    || memberDepositPercent > 100
  ) {
    errors.push(i18next.t('settings:validation.memberDeposit'))
  }
  if (
    draft.guestDepositPercent.trim() === ''
    || !Number.isFinite(guestDepositPercent)
    || guestDepositPercent < 0
    || guestDepositPercent > 100
  ) {
    errors.push(i18next.t('settings:validation.guestDeposit'))
  }
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
    ...original,
    cartPolicy: draft.cartPolicy,
    defaultDurationMinutes,
    defaultHoles,
    maxPlayersPerTeeTime,
    memberGuestPricing: {
      ...objectValue(original.memberGuestPricing),
      guestDepositRatio: guestDepositPercent / 100,
      memberDepositRatio: memberDepositPercent / 100,
    },
    prefecture,
    publicProductDescription: draft.publicProductDescription.trim(),
    publicProductName: draft.publicProductName.trim(),
    taxGrade,
  }
}

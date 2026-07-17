export type GolfExtensionConfigDraft = {
  cartPolicy: 'optional' | 'required' | 'unavailable'
  defaultDurationMinutes: string
  defaultHoles: string
  maxPlayersPerTeeTime: string
  memberDepositPercent: string
  guestDepositPercent: string
  publicProductName: string
  publicProductDescription: string
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
    errors.push('既定の所要時間は30〜720分の整数で入力してください。')
  }
  if (![9, 18].includes(defaultHoles)) {
    errors.push('既定ホール数は9または18を選択してください。')
  }
  if (!Number.isInteger(maxPlayersPerTeeTime) || maxPlayersPerTeeTime < 1 || maxPlayersPerTeeTime > 4) {
    errors.push('1枠の最大人数は1〜4人で入力してください。')
  }
  if (
    draft.memberDepositPercent.trim() === ''
    || !Number.isFinite(memberDepositPercent)
    || memberDepositPercent < 0
    || memberDepositPercent > 100
  ) {
    errors.push('会員デポジット率は0〜100%で入力してください。')
  }
  if (
    draft.guestDepositPercent.trim() === ''
    || !Number.isFinite(guestDepositPercent)
    || guestDepositPercent < 0
    || guestDepositPercent > 100
  ) {
    errors.push('ゲストデポジット率は0〜100%で入力してください。')
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
    publicProductDescription: draft.publicProductDescription.trim(),
    publicProductName: draft.publicProductName.trim(),
  }
}

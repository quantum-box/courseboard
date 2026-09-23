export const MAX_PLAYER_TAG_OPTIONS = 20
export const MAX_PLAYER_TAG_LENGTH = 40

export type PlayerTagOptionsError = 'tooMany' | 'tooLong' | 'duplicate'

export function validatePlayerTagOptions(values: string[]): PlayerTagOptionsError | null {
  const options = values.map(value => value.trim()).filter(Boolean)
  if (options.length > MAX_PLAYER_TAG_OPTIONS) return 'tooMany'
  if (options.some(value => value.length > MAX_PLAYER_TAG_LENGTH)) return 'tooLong'
  if (new Set(options).size !== options.length) return 'duplicate'
  return null
}

export function normalizedPlayerTagOptions(values: string[]): string[] {
  return values.map(value => value.trim()).filter(Boolean)
}

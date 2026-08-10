export const MAX_PLAYER_TAG_OPTIONS = 20
export const MAX_PLAYER_TAG_LENGTH = 40

export type PlayerTagOptionsError = 'tooMany' | 'tooLong' | 'duplicate'

/** Raw values for the settings form, including mistakes the operator must fix. */
export function playerTagOptionDraftFromConfig(
  config?: Record<string, unknown> | null,
): string[] {
  if (!Array.isArray(config?.playerTagOptions)) return []
  return config.playerTagOptions
    .filter((value): value is string => typeof value === 'string')
    .slice(0, 100)
}

/** Safe, ordered choices for daily entry. Invalid config never breaks booking. */
export function playerTagOptionsFromConfig(
  config?: Record<string, unknown> | null,
): string[] {
  const seen = new Set<string>()
  const options: string[] = []
  for (const value of playerTagOptionDraftFromConfig(config)) {
    const option = value.trim()
    if (!option || option.length > MAX_PLAYER_TAG_LENGTH || seen.has(option)) continue
    seen.add(option)
    options.push(option)
    if (options.length >= MAX_PLAYER_TAG_OPTIONS) break
  }
  return options
}

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

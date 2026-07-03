export function normalizeProductTags(
	values: readonly string[] | null | undefined,
): string[] {
	const seen = new Set<string>()
	const tags: string[] = []
	for (const value of values ?? []) {
		const tag = value.trim()
		if (!tag || seen.has(tag)) continue
		seen.add(tag)
		tags.push(tag)
	}
	return tags
}

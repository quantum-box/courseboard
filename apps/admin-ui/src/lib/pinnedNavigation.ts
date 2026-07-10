const PINNED_NAVIGATION_STORAGE_KEY_PREFIX =
	'courseboard-admin-pinned-nav-items'

export function getPinnedNavigationStorageKey(
	modePrefix: string,
	tenantId: string,
) {
	const mode = modePrefix === '/sandbox' ? 'sandbox' : 'production'
	return `${PINNED_NAVIGATION_STORAGE_KEY_PREFIX}:${mode}:${tenantId}`
}

export function normalizePinnedNavigationPaths(value: unknown) {
	if (!Array.isArray(value)) {
		return []
	}

	const seen = new Set<string>()
	const paths: string[] = []
	for (const item of value) {
		if (typeof item !== 'string' || !item.startsWith('/')) {
			continue
		}
		if (seen.has(item)) {
			continue
		}
		seen.add(item)
		paths.push(item)
	}
	return paths
}

export function togglePinnedNavigationPath(paths: string[], path: string) {
	if (paths.includes(path)) {
		return paths.filter(item => item !== path)
	}
	return [...paths, path]
}

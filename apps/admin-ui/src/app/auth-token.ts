export function resolveAccountExpiresAt(account: {
	expires_at?: unknown
	expires_in?: unknown
}) {
	if (typeof account.expires_at === 'number') {
		return account.expires_at
	}
	if (typeof account.expires_in === 'number') {
		return Math.floor(Date.now() / 1000 + account.expires_in)
	}
	return Math.floor(Date.now() / 1000 + 60 * 60)
}

type TokenLike = {
	email?: string | null
	user?: unknown
}

type VerifiedUserLike = {
	id: string
	role: string
	tenants?: string[]
}

function profileValue(
	profile: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = profile?.[key]
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function resolveJwtUser(input: {
	token: TokenLike
	profile?: Record<string, unknown>
	verifiedUser?: VerifiedUserLike
}) {
	const existingUser =
		typeof input.token.user === 'object' && input.token.user
			? (input.token.user as { tenants?: unknown })
			: {}
	const existingTenants = Array.isArray(existingUser.tenants)
		? existingUser.tenants.filter(
				(tenant): tenant is string => typeof tenant === 'string',
			)
		: undefined
	const email =
		input.token.email ??
		profileValue(input.profile, 'email') ??
		profileValue(input.profile, 'username') ??
		''
	const fallbackUserId =
		profileValue(input.profile, 'sub') ??
		profileValue(input.profile, 'cognito:username') ??
		email
	const username =
		profileValue(input.profile, 'cognito:username') ??
		profileValue(input.profile, 'username') ??
		email

	return {
		...existingUser,
		email,
		id: input.verifiedUser?.id ?? fallbackUserId,
		role: input.verifiedUser?.role ?? 'GENERAL',
		tenants: input.verifiedUser?.tenants ?? existingTenants,
		username,
	}
}

export function isAdminRole(role?: string | null) {
	const normalizedRole = role?.trim().toUpperCase() ?? ''
	return (
		normalizedRole === 'OWNER' ||
		normalizedRole === 'FIELD:ADMIN' ||
		normalizedRole === 'ERP:ADMIN'
	)
}

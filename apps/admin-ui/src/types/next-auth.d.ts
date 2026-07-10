import type { DefaultSession } from '@auth'

interface User extends DefaultSession.user {
	id: string
	email: string
	username: string
	role: string
	tenants?: string[]
}

declare module 'next-auth/jwt' {
	interface JWT {
		idToken?: string
		accessToken: string
		accessTokenExpires?: number
		refreshToken?: string
		error?: string
		expires_at: number
		user: User
	}
}

declare module 'next-auth' {
	interface Session {
		accessToken: string
		user: User
		error?: string
	}

	interface Account {
		expires_at: number
	}
}

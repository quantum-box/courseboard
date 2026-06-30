'use server'

import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { authWithCheck } from 'app/auth'
import { revalidatePath } from 'next/cache'

type ActionResult<T = undefined> = {
	success: boolean
	message?: string
	data?: T
}

export type ErpRole = 'field:admin' | 'field:staff' | 'field:viewer'

export type ErpUser = {
	id: string
	email: string | null
	name: string | null
	role: ErpRole | null
	tenants: string[]
}

export type InviteErpUserResult =
	| {
			status: 'active'
			user: ErpUser
	  }
	| {
			status: 'pending'
			email: string
			role: ErpRole
	  }

function roleToRequest(role: ErpRole) {
	return role.replace('field:', '')
}

async function authedFetch(tenantId: string, path: string, init?: RequestInit) {
	const session = await authWithCheck()
	return fetch(joinServerBackendPath(path), {
		...init,
		headers: {
			'x-operator-id': tenantId,
			Authorization: `Bearer ${session.accessToken}`,
			'Content-Type': 'application/json',
			...(init?.headers ?? {}),
		},
	})
}

export async function fetchErpUsersAction(
	tenantId: string,
): Promise<ActionResult<ErpUser[]>> {
	try {
		const res = await authedFetch(tenantId, '/v1/field/iam/users')
		if (!res.ok) {
			console.error('Failed to fetch ERP users:', await res.text())
			return { success: false, message: 'ユーザー一覧の取得に失敗しました' }
		}

		const data = (await res.json()) as { users: ErpUser[] }
		return { success: true, data: data.users }
	} catch (err) {
		const message =
			err instanceof Error ? err.message : 'Failed to fetch ERP users'
		console.error('Failed to fetch ERP users:', message)
		return { success: false, message }
	}
}

export async function updateErpUserRoleAction(
	tenantId: string,
	userId: string,
	role: ErpRole,
): Promise<ActionResult<ErpUser>> {
	try {
		const res = await authedFetch(
			tenantId,
			`/v1/field/iam/users/${userId}/role`,
			{
				method: 'PUT',
				body: JSON.stringify({ role: roleToRequest(role) }),
			},
		)
		if (!res.ok) {
			console.error('Failed to update ERP user role:', await res.text())
			return { success: false, message: 'ロール更新に失敗しました' }
		}

		const data = (await res.json()) as ErpUser
		revalidatePath(`/${tenantId}/settings/users`)
		return { success: true, data }
	} catch (err) {
		const message =
			err instanceof Error ? err.message : 'Failed to update ERP user role'
		console.error('Failed to update ERP user role:', message)
		return { success: false, message }
	}
}

export async function deleteErpUserRoleAction(
	tenantId: string,
	userId: string,
): Promise<ActionResult> {
	try {
		const res = await authedFetch(tenantId, `/v1/field/iam/users/${userId}`, {
			method: 'DELETE',
		})
		if (!res.ok) {
			console.error('Failed to delete ERP user role:', await res.text())
			return { success: false, message: 'メンバー削除に失敗しました' }
		}

		revalidatePath(`/${tenantId}/settings/users`)
		return { success: true }
	} catch (err) {
		const message =
			err instanceof Error ? err.message : 'Failed to delete ERP user role'
		console.error('Failed to delete ERP user role:', message)
		return { success: false, message }
	}
}

export async function inviteErpUserAction(
	tenantId: string,
	email: string,
	role: ErpRole,
): Promise<ActionResult<InviteErpUserResult>> {
	try {
		const normalizedEmail = email.trim().toLowerCase()
		if (!normalizedEmail) {
			return { success: false, message: 'メールアドレスを入力してください' }
		}

		const invite = await authedFetch(tenantId, '/v1/field/iam/users/invite', {
			method: 'POST',
			body: JSON.stringify({
				email: normalizedEmail,
				role: roleToRequest(role),
				notifyUser: true,
			}),
		})
		if (!invite.ok) {
			console.error('Failed to invite ERP user:', await invite.text())
			return { success: false, message: '招待に失敗しました' }
		}

		const inviteData = (await invite.json()) as {
			user?: ErpUser | null
			invitationSent?: boolean
			email?: string | null
		}
		if (inviteData.user?.id) {
			revalidatePath(`/${tenantId}/settings/users`)
			return {
				success: true,
				data: {
					status: 'active',
					user: inviteData.user,
				},
			}
		}

		revalidatePath(`/${tenantId}/settings/users`)
		return {
			success: true,
			data: {
				status: 'pending',
				email: inviteData.email ?? normalizedEmail,
				role,
			},
		}
	} catch (err) {
		const message =
			err instanceof Error ? err.message : 'Failed to invite ERP user'
		console.error('Failed to invite ERP user:', message)
		return { success: false, message }
	}
}

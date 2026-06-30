import type { Session } from 'next-auth'
import fetchTenants, {
	getPartialTenantFetchTenants,
	isTenantFetchUnauthorized,
} from './tenantFetcher'

type TenantAccessOptions = {
	refreshSession?: () => Promise<Session | null>
}

export type TenantAccessResult =
	| { status: 'allowed' }
	| { status: 'forbidden' }
	| { status: 'expired' }
	| { status: 'unavailable'; message: string }

/**
 * authZ guard の決定契約 (PLT-2253)。
 * SSoT: docs/adr/plt-2253-authn-authz-layer-separation.md §D2 (401/403 契約)。
 *
 * - `allow`       : identity 確定 + テナント所属あり → 保護リソースを描画する。
 * - `deny`        : identity は確定だがテナント不許可 (**authZ failed = HTTP 403**)。
 *                   保護ページ内で Forbidden を表示し、**ログインへ redirect しない**。
 * - `reauth`      : session 失効など本人確認が成立しない (**authN failed = 401 相当**)。
 *                   サインアウト導線へ redirect する。
 * - `unavailable` : 認可可否を判定できない上流障害。失敗を成功に見せず明示する。
 *
 * authZ の失敗 (`deny`) を authN の失敗 (`reauth`) に寄せないことが本契約の不変条件。
 */
export type TenantAccessOutcome =
	| { kind: 'allow' }
	| { kind: 'deny'; httpStatus: 403 }
	| {
			kind: 'reauth'
			httpStatus: 401
			redirectTo: 'sign_out'
			reason: 'expired'
	  }
	| { kind: 'unavailable'; message: string }

/**
 * `resolveTenantAccess` の結果を 401/403 契約 (上記 TenantAccessOutcome) へ写像する純粋関数。
 * 認可判定とその表現 (redirect/403) の対応を一箇所に固定し、回帰テストで lock する。
 * runtime 挙動は変えない (既存 layout ガードの分岐と 1:1)。
 */
export function decideTenantAccessOutcome(
	result: TenantAccessResult,
): TenantAccessOutcome {
	switch (result.status) {
		case 'allowed':
			return { kind: 'allow' }
		case 'forbidden':
			return { kind: 'deny', httpStatus: 403 }
		case 'expired':
			return {
				kind: 'reauth',
				httpStatus: 401,
				redirectTo: 'sign_out',
				reason: 'expired',
			}
		case 'unavailable':
			return { kind: 'unavailable', message: result.message }
	}
}

function getSessionTenantIds(session: Session): string[] | undefined {
	const tenants = session.user?.tenants
	if (!Array.isArray(tenants)) return undefined
	const ids = tenants.filter(
		(tenant): tenant is string => typeof tenant === 'string',
	)
	return ids.length > 0 ? ids : undefined
}

export async function resolveTenantAccess(
	session: Session,
	tenantId: string,
	options: TenantAccessOptions = {},
): Promise<TenantAccessResult> {
	const tenantIds = getSessionTenantIds(session)
	if (tenantIds) {
		return tenantIds.includes(tenantId)
			? { status: 'allowed' }
			: { status: 'forbidden' }
	}

	try {
		const tenants = await fetchTenants(session, options)
		return tenants.some(tenant => tenant.id === tenantId)
			? { status: 'allowed' }
			: { status: 'forbidden' }
	} catch (error) {
		const partialTenants = getPartialTenantFetchTenants(error)
		if (partialTenants) {
			if (partialTenants.some(tenant => tenant.id === tenantId)) {
				return { status: 'allowed' }
			}
			return {
				status: 'unavailable',
				message:
					error instanceof Error
						? error.message
						: 'テナントアクセスを確認できませんでした',
			}
		}

		if (isTenantFetchUnauthorized(error)) {
			return { status: 'expired' }
		}

		return {
			status: 'unavailable',
			message:
				error instanceof Error
					? error.message
					: 'テナントアクセスを確認できませんでした',
		}
	}
}

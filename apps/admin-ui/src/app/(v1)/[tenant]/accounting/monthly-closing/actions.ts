'use server'

import {
	closeMonthlyClosing,
	reopenMonthlyClosing,
} from 'app/(v1)/[tenant]/procurement/_lib/erp-api'
import { getServerModePrefix } from 'lib/mode'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

export async function closeMonthlyClosingAction(
	tenant: string,
	formData: FormData,
) {
	const companyId = String(formData.get('companyId') ?? '')
	const yearMonth = String(formData.get('yearMonth') ?? '')
	const note = String(formData.get('note') ?? '')
	const result = await closeMonthlyClosing(tenant, {
		companyId,
		yearMonth,
		note: note || undefined,
	})
	const prefix = getServerModePrefix(tenant)
	revalidatePath(`${prefix}/${tenant}/accounting/monthly-closing`)
	redirect(
		`${prefix}/${tenant}/accounting/monthly-closing?companyId=${encodeURIComponent(
			companyId,
		)}&yearMonth=${encodeURIComponent(yearMonth)}&flash=closed&source=${
			result.source
		}`,
	)
}

export async function reopenMonthlyClosingAction(
	tenant: string,
	formData: FormData,
) {
	const companyId = String(formData.get('companyId') ?? '')
	const yearMonth = String(formData.get('yearMonth') ?? '')
	const note = String(formData.get('note') ?? '')
	const result = await reopenMonthlyClosing(tenant, {
		companyId,
		yearMonth,
		note: note || undefined,
	})
	const prefix = getServerModePrefix(tenant)
	revalidatePath(`${prefix}/${tenant}/accounting/monthly-closing`)
	redirect(
		`${prefix}/${tenant}/accounting/monthly-closing?companyId=${encodeURIComponent(
			companyId,
		)}&yearMonth=${encodeURIComponent(yearMonth)}&flash=reopened&source=${
			result.source
		}`,
	)
}

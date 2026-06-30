'use server'

import { authWithCheck } from 'app/auth'
import { joinServerBackendPath } from 'lib/serverBackendUrl'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const PLATFORM_ID =
	process.env.NEXT_PUBLIC_PLATFORM_ID || 'tn_01hjjn348rn3t49zz6hvmfq67p'

export type BridgeMappingField = {
	source: string
	target: string
	required: boolean
	approved: boolean
	transform?: string | null
	confidence?: number | null
	explanation?: string | null
}

export type BridgeDefinitionData = {
	id: string
	name: string
	description?: string | null
	sourceType: string
	targetObject: string
	status: string
	createdAt: string
}

export type BridgeRunData = {
	id: string
	tenantId: string
	definitionId: string
	idempotencyKey: string
	sourceFileName?: string | null
	sourceFileHash: string
	status: string
	normalized: {
		bridgeOntologyObject?: string
		objects?: unknown[]
		errors?: unknown[]
		warnings?: unknown[]
		createdTargets?: unknown[]
	}
	createdCount: number
	errorCount: number
	createdAt: string
	executedAt?: string | null
}

export type BridgeDefinitionListResponse = {
	items: BridgeDefinitionData[]
}

export type ActionResult<T> = {
	success: boolean
	message?: string
	data?: T
}

function apiHeaders(accessToken: string, tenantId: string) {
	return {
		Authorization: `Bearer ${accessToken}`,
		'x-platform-id': PLATFORM_ID,
		'x-operator-id': tenantId,
		'content-type': 'application/json',
	}
}

function fieldApiUrl(path: string) {
	return joinServerBackendPath(path)
}

async function readError(response: Response) {
	try {
		const body = (await response.json()) as { message?: string; error?: string }
		return body.message ?? body.error ?? `Bridge API failed: ${response.status}`
	} catch {
		return `Bridge API failed: ${response.status}`
	}
}

export async function fetchBridgeDefinitionsAction(
	tenantId: string,
): Promise<ActionResult<BridgeDefinitionListResponse>> {
	const session = await authWithCheck()
	const response = await fetch(fieldApiUrl('/v1/bridge/definitions'), {
		headers: apiHeaders(session.accessToken, tenantId),
		cache: 'no-store',
	})
	if (!response.ok) {
		return { success: false, message: await readError(response) }
	}
	return {
		success: true,
		data: (await response.json()) as BridgeDefinitionListResponse,
	}
}

export async function createBridgeDefinitionAction(
	tenantId: string,
	formData: FormData,
) {
	const session = await authWithCheck()
	const targetObject = String(
		formData.get('targetObject') ?? 'salesLedgerDraft',
	).trim()
	const name = String(formData.get('name') ?? '').trim()
	const description = String(formData.get('description') ?? '').trim()
	const mapping = defaultMappingForTarget(targetObject)
	const response = await fetch(fieldApiUrl('/v1/bridge/definitions'), {
		method: 'POST',
		headers: apiHeaders(session.accessToken, tenantId),
		body: JSON.stringify({
			name,
			description: description || undefined,
			sourceType: 'csv',
			targetObject,
			mapping: { fields: mapping },
		}),
	})
	if (!response.ok) {
		throw new Error(await readError(response))
	}
	revalidatePath(`/${tenantId}/imports`)
	redirect(`/${tenantId}/imports`)
}

export async function previewBridgeRunAction(
	tenantId: string,
	definitionId: string,
	formData: FormData,
): Promise<ActionResult<BridgeRunData>> {
	const session = await authWithCheck()
	const rawCsv = await readCsvInput(formData)
	if (!rawCsv.trim()) {
		return {
			success: false,
			message: 'CSVファイルまたはCSVテキストを入力してください。',
		}
	}

	const response = await fetch(
		fieldApiUrl(`/v1/bridge/definitions/${definitionId}/runs/preview`),
		{
			method: 'POST',
			headers: apiHeaders(session.accessToken, tenantId),
			body: JSON.stringify({
				idempotencyKey:
					String(formData.get('idempotencyKey') ?? '').trim() || undefined,
				sourceFileName: sourceFileName(formData),
				rawCsv,
			}),
		},
	)
	if (!response.ok) {
		return { success: false, message: await readError(response) }
	}
	const data = (await response.json()) as BridgeRunData
	revalidatePath(`/${tenantId}/imports`)
	return { success: true, data }
}

export async function executeBridgeRunAction(
	tenantId: string,
	runId: string,
): Promise<ActionResult<BridgeRunData>> {
	const session = await authWithCheck()
	const response = await fetch(
		fieldApiUrl(`/v1/bridge/runs/${runId}/execute`),
		{
			method: 'POST',
			headers: apiHeaders(session.accessToken, tenantId),
		},
	)
	if (!response.ok) {
		return { success: false, message: await readError(response) }
	}
	const data = (await response.json()) as BridgeRunData
	revalidatePath(`/${tenantId}/imports`)
	return { success: true, data }
}

async function readCsvInput(formData: FormData) {
	const file = formData.get('sourceFile')
	if (file && typeof file === 'object' && 'size' in file && 'text' in file) {
		const sourceFile = file as File
		if (sourceFile.size > 0) {
			return sourceFile.text()
		}
	}
	return String(formData.get('rawCsv') ?? '')
}

function sourceFileName(formData: FormData) {
	const file = formData.get('sourceFile')
	if (file && typeof file === 'object' && 'name' in file) {
		const name = String((file as File).name).trim()
		return name || undefined
	}
	return undefined
}

function defaultMappingForTarget(targetObject: string): BridgeMappingField[] {
	switch (targetObject) {
		case 'purchaseLedgerDraft':
			return [
				requiredField('日付', 'date'),
				requiredField('仕入先', 'supplierName'),
				requiredField('品目', 'itemName'),
				requiredField('金額', 'totalCost'),
				optionalField('数量', 'quantity'),
				optionalField('単価', 'unitCost'),
				optionalField('カテゴリ', 'category'),
			]
		case 'bankTransaction':
			return [
				requiredField('日付', 'date'),
				requiredField('摘要', 'description'),
				requiredField('金額', 'amount'),
				optionalField('入出金区分', 'direction'),
				optionalField('残高', 'balance'),
			]
		default:
			return [
				requiredField('日付', 'date'),
				requiredField('商品名', 'productName'),
				requiredField('金額', 'totalAmount'),
				optionalField('数量', 'quantity'),
				optionalField('単価', 'unitPrice'),
				optionalField('支払方法', 'paymentMethod'),
				optionalField('レシートID', 'receiptId'),
			]
	}
}

function requiredField(source: string, target: string): BridgeMappingField {
	return {
		source,
		target,
		required: true,
		approved: true,
		confidence: 1,
		explanation: 'Initial provider template mapping approved by human setup.',
	}
}

function optionalField(source: string, target: string): BridgeMappingField {
	return {
		source,
		target,
		required: false,
		approved: true,
		confidence: 1,
		explanation: 'Initial provider template mapping approved by human setup.',
	}
}

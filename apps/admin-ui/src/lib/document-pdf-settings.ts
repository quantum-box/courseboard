import { getRuntimeEnv } from './runtime-env'
import { joinServerBackendPath } from './serverBackendUrl'

const DEFAULT_PLATFORM_ID = 'tn_01hjjn348rn3t49zz6hvmfq67p'

export const documentPdfTemplates = ['simple', 'detailed', 'japanese'] as const

export type DocumentPdfTemplate = (typeof documentPdfTemplates)[number]

export type DocumentPdfImage = {
	filename: string
	contentType: 'image/png' | 'image/jpeg' | 'image/svg+xml'
	dataBase64: string
	updatedAt: string
}

export type DocumentPdfSettings = {
	defaultTemplate: DocumentPdfTemplate
	includeSealByDefault: boolean
	logoImage?: DocumentPdfImage
	sealImage?: DocumentPdfImage
	updatedAt?: string
}

export const defaultDocumentPdfSettings: DocumentPdfSettings = {
	defaultTemplate: 'simple',
	includeSealByDefault: true,
}

export function isDocumentPdfTemplate(
	value: string | null | undefined,
): value is DocumentPdfTemplate {
	return documentPdfTemplates.includes(value as DocumentPdfTemplate)
}

export function resolveDocumentPdfTemplate(
	value: string | null | undefined,
	fallback: DocumentPdfTemplate,
): DocumentPdfTemplate {
	return isDocumentPdfTemplate(value) ? value : fallback
}

export async function getDocumentPdfSettings(
	tenantId: string,
	accessToken: string,
): Promise<DocumentPdfSettings> {
	const res = await documentPdfSettingsFetch(tenantId, accessToken)
	if (res.status === 404) return defaultDocumentPdfSettings
	if (!res.ok) {
		console.error('Failed to fetch document PDF settings:', await res.text())
		return defaultDocumentPdfSettings
	}
	return normalizeDocumentPdfSettings(
		(await res.json()) as Partial<DocumentPdfSettings>,
	)
}

export async function saveDocumentPdfSettings(
	tenantId: string,
	accessToken: string,
	settings: DocumentPdfSettings,
): Promise<void> {
	const res = await documentPdfSettingsFetch(tenantId, accessToken, {
		method: 'PUT',
		body: JSON.stringify(normalizeDocumentPdfSettings(settings)),
	})
	if (!res.ok) {
		throw new Error(await res.text())
	}
}

function documentPdfSettingsFetch(
	tenantId: string,
	accessToken: string,
	init?: RequestInit,
) {
	return fetch(joinServerBackendPath('/v1/field/document-pdf-settings'), {
		...init,
		headers: {
			'Content-Type': 'application/json',
			'x-platform-id':
				getRuntimeEnv('NEXT_PUBLIC_PLATFORM_ID') ?? DEFAULT_PLATFORM_ID,
			'x-operator-id': tenantId,
			Authorization: `Bearer ${accessToken}`,
			...(init?.headers ?? {}),
		},
		cache: 'no-store',
	})
}

function normalizeDocumentPdfSettings(
	value: Partial<DocumentPdfSettings>,
): DocumentPdfSettings {
	return {
		defaultTemplate: isDocumentPdfTemplate(value.defaultTemplate)
			? value.defaultTemplate
			: defaultDocumentPdfSettings.defaultTemplate,
		includeSealByDefault:
			value.includeSealByDefault ??
			defaultDocumentPdfSettings.includeSealByDefault,
		logoImage: normalizeImage(value.logoImage),
		sealImage: normalizeImage(value.sealImage),
		updatedAt:
			typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
	}
}

function normalizeImage(
	value: DocumentPdfImage | undefined,
): DocumentPdfImage | undefined {
	if (
		!value ||
		typeof value.filename !== 'string' ||
		typeof value.dataBase64 !== 'string' ||
		typeof value.updatedAt !== 'string'
	) {
		return undefined
	}
	if (
		value.contentType !== 'image/png' &&
		value.contentType !== 'image/jpeg' &&
		value.contentType !== 'image/svg+xml'
	) {
		return undefined
	}
	return value
}

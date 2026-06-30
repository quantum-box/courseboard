'use server'

import { authWithCheck } from 'app/auth'
import {
	type DocumentPdfImage,
	type DocumentPdfSettings,
	getDocumentPdfSettings,
	isDocumentPdfTemplate,
	saveDocumentPdfSettings,
} from 'lib/document-pdf-settings'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

const MAX_IMAGE_BYTES = 512 * 1024
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const
const SEAL_TYPES = ['image/png', 'image/jpeg'] as const

export async function saveDocumentPdfSettingsAction(
	tenant: string,
	formData: FormData,
) {
	const session = await authWithCheck()

	try {
		const current = await getDocumentPdfSettings(tenant, session.accessToken)
		const defaultTemplate = String(formData.get('defaultTemplate') ?? '')
		if (!isDocumentPdfTemplate(defaultTemplate)) {
			throw new Error('テンプレートを選択してください')
		}

		const settings: DocumentPdfSettings = {
			...current,
			defaultTemplate,
			includeSealByDefault: formData.get('includeSealByDefault') === 'on',
			logoImage:
				formData.get('removeLogo') === 'on'
					? undefined
					: await resolveUploadedImage(
							'logoImage',
							formData,
							current.logoImage,
							[...LOGO_TYPES],
						),
			sealImage:
				formData.get('removeSeal') === 'on'
					? undefined
					: await resolveUploadedImage(
							'sealImage',
							formData,
							current.sealImage,
							[...SEAL_TYPES],
						),
			updatedAt: new Date().toISOString(),
		}

		await saveDocumentPdfSettings(tenant, session.accessToken, settings)
		revalidatePath(`/${tenant}/settings/document-pdf`)
		revalidatePath(`/${tenant}/settings`)
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: 'PDFテンプレート設定の保存に失敗しました'
		redirect(
			`/${tenant}/settings/document-pdf?documentPdfError=${encodeURIComponent(message)}`,
		)
	}

	redirect(`/${tenant}/settings/document-pdf?documentPdf=updated`)
}

async function resolveUploadedImage(
	field: string,
	formData: FormData,
	current: DocumentPdfImage | undefined,
	allowedTypes: string[],
): Promise<DocumentPdfImage | undefined> {
	const file = formData.get(field)
	if (!(file instanceof File) || file.size === 0) return current
	if (!allowedTypes.includes(file.type)) {
		throw new Error('アップロードできる画像形式ではありません')
	}
	if (file.size > MAX_IMAGE_BYTES) {
		throw new Error('画像は512KB以下にしてください')
	}

	return {
		filename: file.name,
		contentType: file.type as DocumentPdfImage['contentType'],
		dataBase64: arrayBufferToBase64(await file.arrayBuffer()),
		updatedAt: new Date().toISOString(),
	}
}

function arrayBufferToBase64(value: ArrayBuffer): string {
	const bytes = new Uint8Array(value)
	let binary = ''
	for (let i = 0; i < bytes.length; i += 1) {
		binary += String.fromCharCode(bytes[i])
	}
	return btoa(binary)
}

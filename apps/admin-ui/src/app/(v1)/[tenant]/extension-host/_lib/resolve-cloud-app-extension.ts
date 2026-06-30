import {
	cloudAppExtensionSurfaceUrl,
	fetchCloudAppExtensions,
	findCloudAppExtension,
	type CloudAppExtension,
} from 'lib/cloud-app-extensions'
import type { FieldExtensionHostSurface } from 'lib/field-extension-host-contract'
import { notFound } from 'next/navigation'

export type ResolvedCloudAppExtensionHost = {
	extension: CloudAppExtension
	iframeUrl: string
	surface: FieldExtensionHostSurface
}

export async function resolveCloudAppExtensionHost(
	tenant: string,
	appName: string,
	surface: FieldExtensionHostSurface,
): Promise<ResolvedCloudAppExtensionHost> {
	const result = await fetchCloudAppExtensions(tenant)
	if (!result.ok) {
		throw new ExtensionRegistryUnavailableError(result.message)
	}

	const extension = findCloudAppExtension(result.extensions, appName)
	if (!extension) {
		notFound()
	}
	if (extension.ui.mode !== 'iframe') {
		throw new ExtensionSurfaceUnavailableError(
			'Schema-driven extension UI is not supported by the extension host yet.',
		)
	}

	const iframeUrl = cloudAppExtensionSurfaceUrl(extension, surface, tenant)
	if (!iframeUrl) {
		throw new ExtensionSurfaceUnavailableError(
			surface === 'kiosk'
				? 'This Cloud App does not expose a kiosk surface.'
				: 'This Cloud App does not expose a UI surface.',
		)
	}

	return {
		extension,
		iframeUrl,
		surface,
	}
}

export class ExtensionRegistryUnavailableError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ExtensionRegistryUnavailableError'
	}
}

export class ExtensionSurfaceUnavailableError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ExtensionSurfaceUnavailableError'
	}
}

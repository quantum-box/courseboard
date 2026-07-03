import {
	appendFieldExtensionHostContext,
	buildFieldExtensionHostContext,
	type FieldExtensionHostSurface,
} from './field-extension-host-contract'

export type CloudAppExtensionUiMode = 'iframe' | 'schema'

export type CloudAppExtension = {
	appName: string
	label: string
	icon?: string | null
	navSection?: string | null
	target: 'tachyonfield'
	ui: {
		mode: CloudAppExtensionUiMode
		url?: string | null
		path?: string | null
		kioskUrl?: string | null
		kioskPath?: string | null
	}
	apiBaseUrl: string
}

export type CloudAppExtensionsResponse = {
	extensions: CloudAppExtension[]
}

export function normalizeCloudAppExtensions(
	response: CloudAppExtensionsResponse,
): CloudAppExtension[] {
	return response.extensions
		.filter(extension => extension.target === 'tachyonfield')
		.map(extension => {
			const apiBaseUrl = extension.apiBaseUrl.replace(/\/+$/, '')
			return {
				...extension,
				apiBaseUrl,
				ui: {
					mode: extension.ui.mode,
					path: extension.ui.path ?? '/ui',
					url:
						extension.ui.url ??
						(extension.ui.mode === 'iframe'
							? `${apiBaseUrl}${extension.ui.path ?? '/ui'}`
							: null),
					kioskPath: extension.ui.kioskPath ?? null,
					kioskUrl:
						extension.ui.kioskUrl ??
						(extension.ui.kioskPath
							? `${apiBaseUrl}${extension.ui.kioskPath}`
							: null),
				},
			}
		})
}

export function findCloudAppExtension(
	extensions: CloudAppExtension[],
	appName: string,
) {
	return extensions.find(extension => extension.appName === appName)
}

export function cloudAppExtensionSurfaceUrl(
	extension: CloudAppExtension,
	surface: FieldExtensionHostSurface,
	tenant: string,
) {
	const sourceUrl =
		surface === 'kiosk' ? extension.ui.kioskUrl : extension.ui.url
	if (!sourceUrl) {
		return null
	}

	return appendFieldExtensionHostContext(
		sourceUrl,
		buildFieldExtensionHostContext(extension.appName, tenant, surface),
	)
}

declare module 'heic2any' {
	type Heic2AnyOptions = {
		blob: Blob
		quality?: number
		toType?: string
	}

	export default function heic2any(
		options: Heic2AnyOptions,
	): Promise<Blob | Blob[]>
}

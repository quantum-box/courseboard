export default function tachyonImageLoader({
	src,
	width,
	quality,
}: {
	src: string
	width: number
	quality?: number
}): string {
	const params = new URLSearchParams({
		w: String(width),
		q: String(quality ?? 80),
	})
	const separator = src.includes('?') ? '&' : '?'
	return `${src}${separator}${params.toString()}`
}

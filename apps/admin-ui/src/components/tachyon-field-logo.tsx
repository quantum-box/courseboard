import { cn } from 'lib/utils'

type TachyonFieldLogoProps = {
	className?: string
	markClassName?: string
	tone?: 'light' | 'dark'
}

export function TachyonFieldLogo({
	className,
	markClassName,
	tone = 'light',
}: TachyonFieldLogoProps) {
	const src =
		tone === 'dark'
			? '/brand/tachyon-field-logo-cropped-dark-transparent.png'
			: '/brand/tachyon-field-logo-cropped-transparent.png'

	return (
		<div className={cn('inline-flex items-center', className)}>
			<img
				src={src}
				alt='TACHYON Field'
				className={cn('h-6 w-auto shrink-0 object-contain', markClassName)}
			/>
		</div>
	)
}

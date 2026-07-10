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
			? '/brand/courseboard-logo-dark.png'
			: '/brand/courseboard-logo.png'

	return (
		<div className={cn('inline-flex items-center', className)}>
			<img
				src={src}
				alt='Course Board'
				className={cn('h-6 w-auto shrink-0 object-contain', markClassName)}
			/>
		</div>
	)
}

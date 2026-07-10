'use client'
import { useModePath } from 'hooks/useMode'
import Link, { type LinkProps } from 'next/link'

type ModeLinkProps = Omit<LinkProps, 'href'> & {
	href: string
	children: React.ReactNode
	className?: string
	'aria-label'?: string
	onClick?: () => void
}

export function ModeLink({ href, children, ...props }: ModeLinkProps) {
	const modePath = useModePath(href)
	return (
		<Link href={modePath as never} {...props}>
			{children}
		</Link>
	)
}

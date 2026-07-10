import { Button } from 'components/ui/button'
import { cn } from 'lib/utils'
import type { Route } from 'next'
import Link from 'next/link'
import React, { type ReactNode } from 'react'

type PageHeaderProps = {
	title: string
	description?: ReactNode
	actions?: ReactNode
	className?: string
}

export function PageHeader({
	title,
	description,
	actions,
	className,
}: PageHeaderProps) {
	return (
		<div
			className={cn(
				'flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
				className,
			)}
		>
			<div className='min-w-0 space-y-1'>
				<h1 className='text-2xl font-semibold tracking-normal'>{title}</h1>
				{description ? (
					<p className='max-w-3xl text-sm text-muted-foreground'>
						{description}
					</p>
				) : null}
			</div>
			{actions ? (
				<div className='flex shrink-0 flex-wrap items-center gap-2'>
					{actions}
				</div>
			) : null}
		</div>
	)
}

export function PageToolbar({
	children,
	className,
}: {
	children: ReactNode
	className?: string
}) {
	return (
		<div
			className={cn(
				'flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between',
				className,
			)}
		>
			{children}
		</div>
	)
}

type EmptyStateProps = {
	icon?: ReactNode
	title: string
	description?: ReactNode
	action?: ReactNode
	className?: string
}

export function EmptyState({
	icon,
	title,
	description,
	action,
	className,
}: EmptyStateProps) {
	return (
		<div
			className={cn(
				'flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center',
				className,
			)}
		>
			{icon ? (
				<div className='mb-4 text-muted-foreground/60 [&_svg]:h-10 [&_svg]:w-10'>
					{icon}
				</div>
			) : null}
			<h3 className='text-base font-semibold'>{title}</h3>
			{description ? (
				<p className='mt-2 max-w-md text-sm text-muted-foreground'>
					{description}
				</p>
			) : null}
			{action ? <div className='mt-4'>{action}</div> : null}
		</div>
	)
}

type DataStateMessageProps = {
	title: string
	description?: ReactNode
	variant?: 'muted' | 'destructive'
	retryHref?: string
	className?: string
}

export function DataStateMessage({
	title,
	description,
	variant = 'muted',
	retryHref,
	className,
}: DataStateMessageProps) {
	return (
		<div
			className={cn(
				'rounded-lg border p-4',
				variant === 'destructive'
					? 'border-destructive/30 bg-destructive/5'
					: 'border-dashed bg-muted/20',
				className,
			)}
		>
			<p
				className={cn(
					'text-sm font-medium',
					variant === 'destructive' ? 'text-destructive' : 'text-foreground',
				)}
			>
				{title}
			</p>
			{description ? (
				<p className='mt-1 text-sm text-muted-foreground'>{description}</p>
			) : null}
			{retryHref ? (
				<div className='mt-3'>
					<Button asChild variant='outline' size='sm'>
						<Link href={retryHref as Route}>再読み込み</Link>
					</Button>
				</div>
			) : null}
		</div>
	)
}

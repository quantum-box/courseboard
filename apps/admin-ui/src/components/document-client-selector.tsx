'use client'

import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { cn } from 'lib/utils'
import { useEffect, useMemo, useState } from 'react'

export type DocumentClientOption = {
	id: string
	name: string
	email?: string | null
}

export function DocumentClientSelector({
	clients,
	label = '取引先',
	className,
	compact = false,
}: {
	clients: DocumentClientOption[]
	label?: string
	className?: string
	compact?: boolean
}) {
	const [clientId, setClientId] = useState(clients[0]?.id ?? '')
	const selectedClient = useMemo(
		() => clients.find(client => client.id === clientId),
		[clientId, clients],
	)
	const [clientEmail, setClientEmail] = useState(selectedClient?.email ?? '')

	useEffect(() => {
		if (clients.length > 0 && !selectedClient) {
			setClientId(clients[0].id)
		}
	}, [clients, selectedClient])

	useEffect(() => {
		setClientEmail(selectedClient?.email ?? '')
	}, [selectedClient])

	return (
		<div className={cn('space-y-2', className)}>
			<div
				className={cn(
					compact
						? 'grid gap-2 md:grid-cols-[minmax(180px,1fr)_150px_220px]'
						: 'space-y-3',
				)}
			>
				<div className='min-w-0'>
					<Label htmlFor='clientId'>{label}</Label>
					<select
						id='clientId'
						name='clientId'
						required
						disabled={clients.length === 0}
						value={clientId}
						onChange={event => setClientId(event.currentTarget.value)}
						className={cn(
							'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
							compact ? 'h-9' : 'h-10',
						)}
					>
						{clients.length === 0 ? (
							<option value=''>取引先がありません</option>
						) : null}
						{clients.map(client => (
							<option key={client.id} value={client.id}>
								{client.name}
							</option>
						))}
					</select>
					<input
						name='clientName'
						type='hidden'
						value={selectedClient?.name ?? ''}
					/>
				</div>
				<div className='min-w-0'>
					<Label>取引先ID</Label>
					<Input
						readOnly
						value={selectedClient?.id ?? ''}
						className={compact ? 'h-9' : undefined}
					/>
				</div>
				<div className='min-w-0'>
					<Label>送付先メール</Label>
					<Input
						name='clientEmail'
						type='email'
						value={clientEmail}
						onChange={event => setClientEmail(event.currentTarget.value)}
						placeholder='billing@example.com'
						className={compact ? 'h-9' : undefined}
					/>
				</div>
			</div>
		</div>
	)
}

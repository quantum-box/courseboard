'use client'

import { Button } from 'components/ui/button'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import type { TenantListItemFragment } from 'gen/graphql'
import { useModePrefix } from 'hooks/useMode'
import { ExternalLink, Trash2 } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useState } from 'react'

type TenantTableProps = {
	data: TenantListItemFragment[]
	onDelete?: (id: string) => Promise<void>
}

export function TenantTable({ data, onDelete }: TenantTableProps) {
	const [deletingId, setDeletingId] = useState<string | null>(null)
	const modePrefix = useModePrefix()

	const handleDelete = async (id: string) => {
		if (!onDelete) return
		if (!confirm('このテナントを削除しますか？')) return
		setDeletingId(id)
		try {
			await onDelete(id)
		} finally {
			setDeletingId(null)
		}
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>組織名</TableHead>
					<TableHead className='hidden sm:table-cell'>エイリアス</TableHead>
					<TableHead className='hidden md:table-cell'>ID</TableHead>
					<TableHead className='hidden sm:table-cell'>作成日</TableHead>
					<TableHead className='w-[80px]' />
				</TableRow>
			</TableHeader>
			<TableBody>
				{data.length === 0 ? (
					<TableRow>
						<TableCell
							colSpan={5}
							className='text-center text-muted-foreground'
						>
							テナントがありません
						</TableCell>
					</TableRow>
				) : (
					data.map(tenant => (
						<TableRow key={tenant.id}>
							<TableCell className='font-medium'>
								<Link
									href={`${modePrefix}/${tenant.id}/home` as Route}
									className='hover:underline'
								>
									{tenant.operatorName}
								</Link>
								<p className='text-xs text-muted-foreground sm:hidden'>
									{tenant.name}
								</p>
							</TableCell>
							<TableCell className='hidden sm:table-cell'>
								{tenant.name}
							</TableCell>
							<TableCell className='hidden md:table-cell font-mono text-xs'>
								{tenant.id}
							</TableCell>
							<TableCell className='hidden sm:table-cell'>
								{new Date(tenant.createdAt).toLocaleDateString('ja-JP')}
							</TableCell>
							<TableCell className='flex items-center gap-1'>
								<Button variant='ghost' size='icon' asChild>
									<Link
										href={`${modePrefix}/${tenant.id}/home` as Route}
										title='テナントを開く'
									>
										<ExternalLink className='h-4 w-4 text-muted-foreground' />
									</Link>
								</Button>
								{onDelete && (
									<Button
										variant='ghost'
										size='icon'
										disabled={deletingId === tenant.id}
										onClick={() => handleDelete(tenant.id)}
									>
										<Trash2 className='h-4 w-4 text-muted-foreground' />
									</Button>
								)}
							</TableCell>
						</TableRow>
					))
				)}
			</TableBody>
		</Table>
	)
}

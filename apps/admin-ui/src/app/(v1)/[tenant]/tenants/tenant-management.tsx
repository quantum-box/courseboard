'use client'

import { Dialog, DialogTrigger } from 'components/ui/dialog'
import { Button } from 'components/ui/button'
import type { CreateOperatorInput, TenantListItemFragment } from 'gen/graphql'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createOperatorAction, deleteOperatorAction } from './action'
import { CreateTenantForm } from './create-tenant-form'
import { TenantTable } from './tenant-table'

type TenantManagementProps = {
	data: TenantListItemFragment[]
	platformId: string
}

export function TenantManagement({ data, platformId }: TenantManagementProps) {
	const [open, setOpen] = useState(false)
	const router = useRouter()

	const handleCreate = async (input: CreateOperatorInput) => {
		const result = await createOperatorAction(input)
		if (!result.success) {
			throw new Error(result.message ?? 'Failed to create operator')
		}
		setOpen(false)
		router.refresh()
	}

	const handleDelete = async (id: string) => {
		const result = await deleteOperatorAction(id)
		if (!result.success) {
			throw new Error(result.message ?? 'Failed to delete operator')
		}
		router.refresh()
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<div className='flex items-center justify-between mb-4 gap-2'>
				<p className='text-sm text-muted-foreground'>
					{data.length} 件のテナント
				</p>
				<DialogTrigger asChild>
					<Button size='sm' className='sm:h-10 sm:px-4 sm:py-2'>
						<Plus className='mr-1.5 h-4 w-4' />
						<span className='hidden sm:inline'>テナント作成</span>
						<span className='sm:hidden'>作成</span>
					</Button>
				</DialogTrigger>
			</div>
			<TenantTable data={data} onDelete={handleDelete} />
			<CreateTenantForm
				platformId={platformId}
				onSubmit={handleCreate}
				onClose={() => setOpen(false)}
			/>
		</Dialog>
	)
}

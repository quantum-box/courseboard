'use client'

import { Button } from 'components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from 'components/ui/dialog'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { useModePrefix } from 'hooks/useMode'
import { useTenantId } from 'hooks/useTenantId'
import { ExternalLinkIcon, PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { type BillingAccountData, createBillingAccountAction } from './action'

function formatDate(dateStr: string) {
	return new Date(dateStr).toLocaleDateString('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	})
}

type Props = {
	billingAccounts: BillingAccountData[]
	tenantId: string
}

export function BillingAccountList({ billingAccounts, tenantId }: Props) {
	const [createOpen, setCreateOpen] = useState(false)
	const [name, setName] = useState('')
	const [isSubmitting, setIsSubmitting] = useState(false)
	const router = useRouter()
	const modePrefix = useModePrefix()
	const tenant = useTenantId()

	const handleCreate = async () => {
		if (!name.trim()) return
		setIsSubmitting(true)
		try {
			const result = await createBillingAccountAction(name.trim())
			if (!result.success) {
				console.error(result.message ?? 'Failed to create')
				return
			}
			setCreateOpen(false)
			setName('')
			router.refresh()
		} finally {
			setIsSubmitting(false)
		}
	}

	return (
		<>
			<div className='flex items-center justify-between mb-4 gap-2'>
				<p className='text-sm text-muted-foreground'>
					{billingAccounts.length} 件の請求アカウント
				</p>
				<Dialog open={createOpen} onOpenChange={setCreateOpen}>
					<DialogTrigger asChild>
						<Button size='sm' className='sm:h-10 sm:px-4 sm:py-2'>
							<PlusIcon className='mr-1.5 h-4 w-4' />
							<span className='hidden sm:inline'>新規作成</span>
							<span className='sm:hidden'>追加</span>
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>請求アカウントを作成</DialogTitle>
						</DialogHeader>
						<div className='grid gap-4 py-4'>
							<div className='grid gap-2'>
								<Label htmlFor='ba-name'>名前</Label>
								<Input
									id='ba-name'
									placeholder='請求アカウント名を入力'
									value={name}
									onChange={e => setName(e.target.value)}
									onKeyDown={e => {
										if (e.key === 'Enter') handleCreate()
									}}
								/>
							</div>
						</div>
						<DialogFooter>
							<Button
								variant='outline'
								onClick={() => setCreateOpen(false)}
								disabled={isSubmitting}
							>
								キャンセル
							</Button>
							<Button
								onClick={handleCreate}
								disabled={isSubmitting || !name.trim()}
							>
								作成
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>

			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>名前</TableHead>
						<TableHead className='hidden sm:table-cell'>ID</TableHead>
						<TableHead className='hidden md:table-cell'>作成日</TableHead>
						<TableHead className='hidden lg:table-cell'>更新日</TableHead>
						<TableHead className='w-[50px]' />
					</TableRow>
				</TableHeader>
				<TableBody>
					{billingAccounts.length === 0 ? (
						<TableRow>
							<TableCell
								colSpan={5}
								className='text-center text-muted-foreground py-8'
							>
								請求アカウントがありません
							</TableCell>
						</TableRow>
					) : (
						billingAccounts.map(account => (
							<TableRow key={account.id}>
								<TableCell className='font-medium'>
									{account.name}
									<p className='text-xs text-muted-foreground font-mono sm:hidden'>
										{account.id}
									</p>
								</TableCell>
								<TableCell className='hidden sm:table-cell font-mono text-sm text-muted-foreground'>
									{account.id}
								</TableCell>
								<TableCell className='hidden md:table-cell text-sm'>
									{formatDate(account.created_at)}
								</TableCell>
								<TableCell className='hidden lg:table-cell text-sm'>
									{formatDate(account.updated_at)}
								</TableCell>
								<TableCell>
									<Link
										href={`${modePrefix}/${tenant}/billing-accounts/${account.id}`}
									>
										<Button variant='ghost' size='icon' className='h-8 w-8'>
											<ExternalLinkIcon className='h-4 w-4' />
											<span className='sr-only'>詳細</span>
										</Button>
									</Link>
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</>
	)
}

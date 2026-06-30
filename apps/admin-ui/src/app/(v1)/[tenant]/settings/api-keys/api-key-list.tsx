'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { Dialog, DialogTrigger } from 'components/ui/dialog'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from 'components/ui/dropdown-menu'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { BanIcon, MoreHorizontalIcon, PlusIcon, TrashIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
	type ApiKeyData,
	createApiKeyAction,
	deleteApiKeyAction,
	revokeApiKeyAction,
} from './action'
import { CreateApiKeyDialog } from './create-api-key-dialog'
import { ShowKeyDialog } from './show-key-dialog'

type ApiKeyListProps = {
	apiKeys: ApiKeyData[]
	tenantId: string
}

function useCaseLabel(useCase: string) {
	switch (useCase) {
		case 'field_public_payment':
			return '公開決済'
		default:
			return useCase
	}
}

function useCaseVariant(useCase: string) {
	switch (useCase) {
		case 'field_public_payment':
			return 'default'
		default:
			return 'outline'
	}
}

function formatDate(dateStr: string | null) {
	if (!dateStr) return '-'
	return new Date(dateStr).toLocaleDateString('ja-JP', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	})
}

export function ApiKeyList({ apiKeys, tenantId }: ApiKeyListProps) {
	const [createOpen, setCreateOpen] = useState(false)
	const [showKeyOpen, setShowKeyOpen] = useState(false)
	const [newKey, setNewKey] = useState('')
	const [confirmAction, setConfirmAction] = useState<{
		type: 'revoke' | 'delete'
		id: string
		name: string
	} | null>(null)
	const router = useRouter()

	const handleCreate = async (name: string, useCases: string[]) => {
		const result = await createApiKeyAction(tenantId, name, useCases)
		if (!result.success) {
			throw new Error(result.message ?? 'Failed to create API key')
		}
		setCreateOpen(false)
		setNewKey(result.data?.key ?? '')
		setShowKeyOpen(true)
		router.refresh()
	}

	const handleRevoke = async (keyId: string) => {
		const result = await revokeApiKeyAction(tenantId, keyId)
		if (!result.success) {
			throw new Error(result.message ?? 'Failed to revoke API key')
		}
		setConfirmAction(null)
		router.refresh()
	}

	const handleDelete = async (keyId: string) => {
		const result = await deleteApiKeyAction(tenantId, keyId)
		if (!result.success) {
			throw new Error(result.message ?? 'Failed to delete API key')
		}
		setConfirmAction(null)
		router.refresh()
	}

	return (
		<>
			<div className='flex items-center justify-between mb-4 gap-2'>
				<p className='text-sm text-muted-foreground'>
					{apiKeys.length} 件のAPIキー
				</p>
				<Dialog open={createOpen} onOpenChange={setCreateOpen}>
					<DialogTrigger asChild>
						<Button size='sm' className='sm:h-10 sm:px-4 sm:py-2'>
							<PlusIcon className='mr-1.5 h-4 w-4' />
							<span className='hidden sm:inline'>新しいAPIキー</span>
							<span className='sm:hidden'>追加</span>
						</Button>
					</DialogTrigger>
					<CreateApiKeyDialog
						onSubmit={handleCreate}
						onClose={() => setCreateOpen(false)}
					/>
				</Dialog>
			</div>

			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>名前</TableHead>
						<TableHead className='hidden sm:table-cell'>キー</TableHead>
						<TableHead className='hidden md:table-cell'>ユースケース</TableHead>
						<TableHead className='hidden lg:table-cell'>作成日</TableHead>
						<TableHead className='hidden lg:table-cell'>最終使用日</TableHead>
						<TableHead>ステータス</TableHead>
						<TableHead className='w-[50px]' />
					</TableRow>
				</TableHeader>
				<TableBody>
					{apiKeys.length === 0 ? (
						<TableRow>
							<TableCell
								colSpan={7}
								className='text-center text-muted-foreground py-8'
							>
								APIキーがありません
							</TableCell>
						</TableRow>
					) : (
						apiKeys.map(apiKey => (
							<TableRow key={apiKey.id}>
								<TableCell className='font-medium'>
									{apiKey.name}
									<p className='text-xs text-muted-foreground font-mono sm:hidden'>
										{apiKey.key_prefix}...
									</p>
								</TableCell>
								<TableCell className='hidden sm:table-cell font-mono text-sm text-muted-foreground'>
									{apiKey.key_prefix}...
								</TableCell>
								<TableCell className='hidden md:table-cell'>
									<div className='flex gap-1 flex-wrap'>
										{apiKey.use_cases.map(useCase => (
											<Badge
												key={useCase}
												variant={useCaseVariant(useCase)}
												className='whitespace-nowrap text-xs'
											>
												{useCaseLabel(useCase)}
											</Badge>
										))}
									</div>
								</TableCell>
								<TableCell className='hidden lg:table-cell text-sm'>
									{formatDate(apiKey.created_at)}
								</TableCell>
								<TableCell className='hidden lg:table-cell text-sm'>
									{formatDate(apiKey.last_used_at)}
								</TableCell>
								<TableCell>
									{apiKey.status === 'active' ? (
										<Badge
											variant='outline'
											className='border-green-500 text-green-700 bg-green-50'
										>
											Active
										</Badge>
									) : (
										<Badge variant='destructive'>Revoked</Badge>
									)}
								</TableCell>
								<TableCell>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button variant='ghost' size='icon' className='h-8 w-8'>
												<MoreHorizontalIcon className='h-4 w-4' />
												<span className='sr-only'>アクション</span>
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align='end'>
											{apiKey.status === 'active' && (
												<DropdownMenuItem
													onClick={() =>
														setConfirmAction({
															type: 'revoke',
															id: apiKey.id,
															name: apiKey.name,
														})
													}
													className='text-orange-600'
												>
													<BanIcon className='mr-2 h-4 w-4' />
													無効化
												</DropdownMenuItem>
											)}
											<DropdownMenuItem
												onClick={() =>
													setConfirmAction({
														type: 'delete',
														id: apiKey.id,
														name: apiKey.name,
													})
												}
												className='text-destructive'
											>
												<TrashIcon className='mr-2 h-4 w-4' />
												削除
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>

			{/* Show Key Dialog */}
			<Dialog open={showKeyOpen} onOpenChange={setShowKeyOpen}>
				{showKeyOpen && (
					<ShowKeyDialog
						apiKey={newKey}
						onClose={() => setShowKeyOpen(false)}
					/>
				)}
			</Dialog>

			{/* Confirm Action Dialog */}
			<Dialog
				open={confirmAction !== null}
				onOpenChange={open => {
					if (!open) setConfirmAction(null)
				}}
			>
				{confirmAction && (
					<ConfirmDialog
						action={confirmAction}
						onConfirm={() => {
							if (confirmAction.type === 'revoke') {
								handleRevoke(confirmAction.id)
							} else {
								handleDelete(confirmAction.id)
							}
						}}
						onCancel={() => setConfirmAction(null)}
					/>
				)}
			</Dialog>
		</>
	)
}

function ConfirmDialog({
	action,
	onConfirm,
	onCancel,
}: {
	action: { type: 'revoke' | 'delete'; id: string; name: string }
	onConfirm: () => void
	onCancel: () => void
}) {
	const [isSubmitting, setIsSubmitting] = useState(false)
	const isRevoke = action.type === 'revoke'

	const handleConfirm = async () => {
		setIsSubmitting(true)
		try {
			await onConfirm()
		} finally {
			setIsSubmitting(false)
		}
	}

	return (
		<div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
			<div className='bg-background rounded-lg p-6 max-w-sm w-full mx-4 shadow-lg'>
				<h3 className='text-lg font-semibold mb-2'>
					{isRevoke ? 'APIキーを無効化' : 'APIキーを削除'}
				</h3>
				<p className='text-sm text-muted-foreground mb-4'>
					{isRevoke
						? `「${action.name}」を無効化しますか？このキーを使用したAPIアクセスはできなくなります。`
						: `「${action.name}」を完全に削除しますか？この操作は取り消せません。`}
				</p>
				<div className='flex justify-end gap-2'>
					<Button variant='outline' onClick={onCancel} disabled={isSubmitting}>
						キャンセル
					</Button>
					<Button
						variant='destructive'
						onClick={handleConfirm}
						disabled={isSubmitting}
					>
						{isRevoke ? '無効化' : '削除'}
					</Button>
				</div>
			</div>
		</div>
	)
}

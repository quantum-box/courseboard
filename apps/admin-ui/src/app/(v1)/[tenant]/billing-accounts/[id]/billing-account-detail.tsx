'use client'

import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
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
import { Separator } from 'components/ui/separator'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { PlusIcon, SaveIcon, TrashIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
	type BillingAccountData,
	type OperatorAssociation,
	addOperatorAction,
	removeOperatorAction,
	updateBillingAccountAction,
} from '../action'

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
	account: BillingAccountData
	operators: OperatorAssociation[]
}

export function BillingAccountDetail({ account, operators }: Props) {
	const [name, setName] = useState(account.name)
	const [isSaving, setIsSaving] = useState(false)
	const [saveMessage, setSaveMessage] = useState('')
	const router = useRouter()

	const handleSave = async () => {
		if (!name.trim()) return
		setIsSaving(true)
		setSaveMessage('')
		try {
			const result = await updateBillingAccountAction(account.id, name.trim())
			if (result.success) {
				setSaveMessage('保存しました')
				router.refresh()
			} else {
				setSaveMessage(result.message ?? '保存に失敗しました')
			}
		} finally {
			setIsSaving(false)
		}
	}

	return (
		<div className='space-y-6'>
			{/* Edit form */}
			<div className='grid gap-4'>
				<div className='grid gap-2'>
					<Label htmlFor='ba-id'>ID</Label>
					<Input id='ba-id' value={account.id} disabled className='font-mono' />
				</div>
				<div className='grid gap-2'>
					<Label htmlFor='ba-name'>名前</Label>
					<Input
						id='ba-name'
						value={name}
						onChange={e => setName(e.target.value)}
						onKeyDown={e => {
							if (e.key === 'Enter') handleSave()
						}}
					/>
				</div>
				<div className='grid grid-cols-2 gap-4'>
					<div className='grid gap-2'>
						<Label>作成日</Label>
						<p className='text-sm text-muted-foreground'>
							{formatDate(account.created_at)}
						</p>
					</div>
					<div className='grid gap-2'>
						<Label>更新日</Label>
						<p className='text-sm text-muted-foreground'>
							{formatDate(account.updated_at)}
						</p>
					</div>
				</div>
				<div className='flex items-center gap-3'>
					<Button
						onClick={handleSave}
						disabled={isSaving || !name.trim() || name === account.name}
					>
						<SaveIcon className='mr-1.5 h-4 w-4' />
						保存
					</Button>
					{saveMessage && (
						<p className='text-sm text-muted-foreground'>{saveMessage}</p>
					)}
				</div>
			</div>

			<Separator />

			{/* Operator associations */}
			<Card>
				<CardHeader>
					<CardTitle className='text-base'>紐付きオペレーター</CardTitle>
					<CardDescription>
						この請求アカウントに紐付くオペレーターを管理します
					</CardDescription>
				</CardHeader>
				<CardContent>
					<OperatorSection
						billingAccountId={account.id}
						operators={operators}
					/>
				</CardContent>
			</Card>
		</div>
	)
}

function OperatorSection({
	billingAccountId,
	operators,
}: {
	billingAccountId: string
	operators: OperatorAssociation[]
}) {
	const [addOpen, setAddOpen] = useState(false)
	const [operatorId, setOperatorId] = useState('')
	const [isAdding, setIsAdding] = useState(false)
	const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
	const [isRemoving, setIsRemoving] = useState(false)
	const router = useRouter()

	const handleAdd = async () => {
		if (!operatorId.trim()) return
		setIsAdding(true)
		try {
			const result = await addOperatorAction(
				billingAccountId,
				operatorId.trim(),
			)
			if (result.success) {
				setAddOpen(false)
				setOperatorId('')
				router.refresh()
			}
		} finally {
			setIsAdding(false)
		}
	}

	const handleRemove = async (opId: string) => {
		setIsRemoving(true)
		try {
			const result = await removeOperatorAction(billingAccountId, opId)
			if (result.success) {
				setConfirmRemove(null)
				router.refresh()
			}
		} finally {
			setIsRemoving(false)
		}
	}

	return (
		<>
			<div className='flex items-center justify-between mb-4 gap-2'>
				<p className='text-sm text-muted-foreground'>
					{operators.length} 件のオペレーター
				</p>
				<Dialog open={addOpen} onOpenChange={setAddOpen}>
					<DialogTrigger asChild>
						<Button size='sm' variant='outline'>
							<PlusIcon className='mr-1.5 h-4 w-4' />
							追加
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>オペレーターを追加</DialogTitle>
						</DialogHeader>
						<div className='grid gap-4 py-4'>
							<div className='grid gap-2'>
								<Label htmlFor='op-id'>オペレーターID</Label>
								<Input
									id='op-id'
									placeholder='tn_...'
									value={operatorId}
									onChange={e => setOperatorId(e.target.value)}
									onKeyDown={e => {
										if (e.key === 'Enter') handleAdd()
									}}
									className='font-mono'
								/>
							</div>
						</div>
						<DialogFooter>
							<Button
								variant='outline'
								onClick={() => setAddOpen(false)}
								disabled={isAdding}
							>
								キャンセル
							</Button>
							<Button
								onClick={handleAdd}
								disabled={isAdding || !operatorId.trim()}
							>
								追加
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>

			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>オペレーターID</TableHead>
						<TableHead className='hidden sm:table-cell'>紐付け日</TableHead>
						<TableHead className='w-[50px]' />
					</TableRow>
				</TableHeader>
				<TableBody>
					{operators.length === 0 ? (
						<TableRow>
							<TableCell
								colSpan={3}
								className='text-center text-muted-foreground py-8'
							>
								オペレーターが紐付けられていません
							</TableCell>
						</TableRow>
					) : (
						operators.map(op => (
							<TableRow key={op.operator_id}>
								<TableCell className='font-mono text-sm'>
									{op.operator_id}
								</TableCell>
								<TableCell className='hidden sm:table-cell text-sm'>
									{formatDate(op.created_at)}
								</TableCell>
								<TableCell>
									<Button
										variant='ghost'
										size='icon'
										className='h-8 w-8 text-destructive'
										onClick={() => setConfirmRemove(op.operator_id)}
									>
										<TrashIcon className='h-4 w-4' />
										<span className='sr-only'>削除</span>
									</Button>
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>

			{/* Confirm remove dialog */}
			<Dialog
				open={confirmRemove !== null}
				onOpenChange={open => {
					if (!open) setConfirmRemove(null)
				}}
			>
				{confirmRemove && (
					<DialogContent>
						<DialogHeader>
							<DialogTitle>オペレーターの紐付けを解除</DialogTitle>
						</DialogHeader>
						<p className='text-sm text-muted-foreground'>
							オペレーター「{confirmRemove}
							」をこの請求アカウントから解除しますか？
						</p>
						<DialogFooter>
							<Button
								variant='outline'
								onClick={() => setConfirmRemove(null)}
								disabled={isRemoving}
							>
								キャンセル
							</Button>
							<Button
								variant='destructive'
								onClick={() => handleRemove(confirmRemove)}
								disabled={isRemoving}
							>
								解除
							</Button>
						</DialogFooter>
					</DialogContent>
				)}
			</Dialog>
		</>
	)
}

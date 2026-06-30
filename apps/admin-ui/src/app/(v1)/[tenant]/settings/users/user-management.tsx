'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { useState, useTransition } from 'react'
import {
	type ErpRole,
	type ErpUser,
	deleteErpUserRoleAction,
	inviteErpUserAction,
	updateErpUserRoleAction,
} from './actions'
import {
	mergeInviteResult,
	roleLabels,
	roles,
	statusLabels,
	toMemberOnboardingRows,
} from './user-management-view-model'

export function UserManagement({
	tenantId,
	initialUsers,
}: {
	tenantId: string
	initialUsers: ErpUser[]
}) {
	const [users, setUsers] = useState(() => toMemberOnboardingRows(initialUsers))
	const [email, setEmail] = useState('')
	const [role, setRole] = useState<ErpRole>('field:staff')
	const [message, setMessage] = useState<string | null>(null)
	const [isPending, startTransition] = useTransition()

	const onInvite = () => {
		setMessage(null)
		startTransition(async () => {
			const result = await inviteErpUserAction(tenantId, email, role)
			if (result.success) {
				if (result.data) {
					setUsers(current => mergeInviteResult(current, result.data!))
				}
				setEmail('')
				setMessage(
					result.data?.status === 'pending'
						? '招待メールを送信しました。初回サインイン後に参加済みになります'
						: 'メンバー追加とロール付与を完了しました',
				)
			} else {
				setMessage(result.message ?? '招待に失敗しました')
			}
		})
	}

	const onRoleChange = (userId: string, nextRole: ErpRole) => {
		if (userId.startsWith('pending:')) {
			setUsers(current =>
				current.map(user =>
					user.id === userId ? { ...user, role: nextRole } : user,
				),
			)
			setMessage('招待中メンバーの表示ロールを更新しました')
			return
		}

		setMessage(null)
		startTransition(async () => {
			const result = await updateErpUserRoleAction(tenantId, userId, nextRole)
			if (result.success && result.data) {
				setUsers(current =>
					current.map(user =>
						user.id === userId ? { ...result.data!, status: 'active' } : user,
					),
				)
				setMessage('ロールを更新しました')
			} else {
				setMessage(result.message ?? 'ロール更新に失敗しました')
			}
		})
	}

	const onDelete = (userId: string) => {
		if (userId.startsWith('pending:')) {
			setUsers(current => current.filter(user => user.id !== userId))
			setMessage('招待中メンバーを一覧から削除しました')
			return
		}

		setMessage(null)
		startTransition(async () => {
			const result = await deleteErpUserRoleAction(tenantId, userId)
			if (result.success) {
				setUsers(current => current.filter(user => user.id !== userId))
				setMessage('メンバーを削除しました')
			} else {
				setMessage(result.message ?? 'メンバー削除に失敗しました')
			}
		})
	}

	return (
		<div className='space-y-6'>
			<div className='rounded-lg border bg-muted/20 p-4'>
				<div className='mb-3 space-y-1'>
					<h2 className='text-sm font-medium'>新しいメンバーを招待</h2>
					<p className='text-sm text-muted-foreground'>
						メールアドレスと初期ロールを指定して、fieldadmin
						への参加導線を送信します。
					</p>
				</div>
				<div className='grid gap-3 md:grid-cols-[1fr_180px_auto]'>
					<Input
						type='email'
						value={email}
						onChange={event => setEmail(event.target.value)}
						placeholder='staff@example.com'
						disabled={isPending}
					/>
					<Select
						value={role}
						onValueChange={value => setRole(value as ErpRole)}
						disabled={isPending}
					>
						<SelectTrigger aria-label='初期ロール'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{roles.map(item => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button onClick={onInvite} disabled={!email.trim() || isPending}>
						招待を送信
					</Button>
				</div>
			</div>

			{message ? (
				<p className='text-sm text-muted-foreground'>{message}</p>
			) : null}

			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>メンバー</TableHead>
						<TableHead>メール</TableHead>
						<TableHead className='w-[120px]'>状態</TableHead>
						<TableHead className='w-[180px]'>ロール</TableHead>
						<TableHead className='w-[96px] text-right'>操作</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{users.length ? (
						users.map(user => (
							<TableRow key={user.id}>
								<TableCell>
									<div className='space-y-1'>
										<div className='font-medium'>
											{user.name ?? user.email ?? '-'}
										</div>
										<div className='font-mono text-xs text-muted-foreground'>
											{user.status === 'pending'
												? '初回サインイン待ち'
												: user.id}
										</div>
									</div>
								</TableCell>
								<TableCell>{user.email ?? '-'}</TableCell>
								<TableCell>
									<Badge
										variant={user.status === 'active' ? 'secondary' : 'outline'}
									>
										{statusLabels[user.status]}
									</Badge>
								</TableCell>
								<TableCell>
									<Select
										value={user.role ?? 'field:viewer'}
										onValueChange={value =>
											onRoleChange(user.id, value as ErpRole)
										}
										disabled={isPending}
									>
										<SelectTrigger
											aria-label={`${user.email ?? user.id} のロール`}
										>
											<SelectValue>
												{roleLabels.get(user.role ?? 'field:viewer')}
											</SelectValue>
										</SelectTrigger>
										<SelectContent>
											{roles.map(item => (
												<SelectItem key={item.value} value={item.value}>
													{item.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TableCell>
								<TableCell className='text-right'>
									<Button
										type='button'
										variant='ghost'
										size='sm'
										onClick={() => onDelete(user.id)}
										disabled={isPending}
									>
										削除
									</Button>
								</TableCell>
							</TableRow>
						))
					) : (
						<TableRow>
							<TableCell colSpan={5} className='py-8'>
								<div className='mx-auto max-w-md space-y-3 text-center text-sm text-muted-foreground'>
									<p className='font-medium text-foreground'>
										メンバーはまだ登録されていません
									</p>
									<p>
										最初の運用担当者を招待すると、ここに招待中・参加済みの状態が表示されます。
									</p>
									<Button
										type='button'
										variant='outline'
										size='sm'
										onClick={() => {
											const input = document.querySelector<HTMLInputElement>(
												'input[type="email"]',
											)
											input?.focus()
										}}
									>
										メンバーを招待
									</Button>
								</div>
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
		</div>
	)
}

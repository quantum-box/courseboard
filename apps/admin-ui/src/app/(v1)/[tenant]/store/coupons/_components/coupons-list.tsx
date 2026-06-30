import { authWithCheck } from 'app/auth'
import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from 'components/ui/dialog'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
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
import { type CouponItemForAdminFragment } from 'gen/graphql'
import { getSdkWithAuth } from 'lib/graphqlClientWithAuth'
import { CirclePlusIcon, MoreHorizontalIcon, TicketIcon } from 'lucide-react'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { CreateCouponDialog } from './create-coupon-dialog'

async function disableCoupon(formData: FormData) {
	'use server'
	const couponId = formData.get('couponId') as string
	const tenant = formData.get('tenant') as string
	const sdk = await getSdkWithAuth(tenant)
	await sdk.disableCouponForAdmin({ couponId })
	revalidatePath(`/${tenant}/store/coupons`)
}

async function createCoupon(formData: FormData) {
	'use server'
	const tenant = formData.get('tenant') as string
	const code = (formData.get('code') as string).trim().toUpperCase()
	const discountType = formData.get('discountType') as string
	const discountValue = Number.parseInt(
		formData.get('discountValue') as string,
		10,
	)
	const expiresAtRaw = formData.get('expiresAt') as string
	const expiresAt = expiresAtRaw
		? new Date(expiresAtRaw).toISOString()
		: undefined
	const usageLimitRaw = formData.get('usageLimit') as string
	const usageLimit = usageLimitRaw
		? Number.parseInt(usageLimitRaw, 10)
		: undefined
	const minimumOrderAmountJpyRaw = formData.get(
		'minimumOrderAmountJpy',
	) as string
	const minimumOrderAmount = minimumOrderAmountJpyRaw
		? Number.parseInt(minimumOrderAmountJpyRaw, 10) * 1_000_000
		: undefined
	const exclusionGroupRaw = (formData.get('exclusionGroup') as string) ?? ''
	const exclusionGroup = exclusionGroupRaw.trim() || undefined
	const sdk = await getSdkWithAuth(tenant)
	await sdk.createCouponForAdmin({
		input: {
			code,
			discountType,
			discountValue,
			expiresAt,
			usageLimit,
			minimumOrderAmount,
			exclusionGroup,
		},
	})
	revalidatePath(`/${tenant}/store/coupons`)
}

function discountLabel(coupon: CouponItemForAdminFragment): string {
	if (coupon.discountType === 'PERCENTAGE') {
		return `${coupon.discountValue}% OFF`
	}
	return `${coupon.discountValue.toLocaleString()} ${coupon.currency} OFF`
}

function exclusionGroupLabel(coupon: CouponItemForAdminFragment): string {
	return coupon.exclusionGroup || 'なし'
}

export async function CouponsList({
	searchParams: { page },
	tenant,
}: {
	searchParams: { page?: string }
	tenant: string
}) {
	const session = await authWithCheck()
	const sdk = await getSdkWithAuth(tenant)
	const pageParam = Number(page ?? '1')
	const currentPage =
		Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1
	const pageSize = 20
	const offset = (currentPage - 1) * pageSize

	let coupons: CouponItemForAdminFragment[] = []
	let hasMore = false

	try {
		const response = await sdk.getCouponsForAdmin({
			limit: pageSize,
			offset,
		})
		coupons = response.coupons?.data ?? []
		hasMore = response.coupons?.hasMore ?? false
	} catch {
		// New tenant may not have coupons yet
	}

	const prevPage = currentPage > 1 ? currentPage - 1 : null
	const nextPage = hasMore ? currentPage + 1 : null

	const buildPageUrl = (targetPage: number) => {
		const params = new URLSearchParams()
		if (targetPage > 1) params.set('page', String(targetPage))
		const search = params.toString()
		return `/${tenant}/store/coupons${search ? `?${search}` : ''}`
	}

	return (
		<Card>
			<CardHeader className='flex flex-row items-center justify-between'>
				<div>
					<CardTitle>クーポン</CardTitle>
					<CardDescription>
						クーポンコードを管理し、顧客への割引を設定します。
					</CardDescription>
				</div>
				<CreateCouponDialog tenant={tenant} action={createCoupon} />
			</CardHeader>
			<CardContent>
				{coupons.length === 0 ? (
					<EmptyCouponState tenant={tenant} />
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>コード</TableHead>
								<TableHead>割引</TableHead>
								<TableHead className='hidden lg:table-cell'>
									排他グループ
								</TableHead>
								<TableHead>ステータス</TableHead>
								<TableHead className='hidden md:table-cell'>作成日時</TableHead>
								<TableHead>
									<span className='sr-only'>アクション</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{coupons.map(coupon => (
								<TableRow key={coupon.id}>
									<TableCell className='font-mono font-medium'>
										{coupon.code}
									</TableCell>
									<TableCell>{discountLabel(coupon)}</TableCell>
									<TableCell className='hidden lg:table-cell'>
										<span className='font-mono text-xs'>
											{exclusionGroupLabel(coupon)}
										</span>
									</TableCell>
									<TableCell>
										{coupon.isActive ? (
											<Badge variant='outline'>有効</Badge>
										) : (
											<Badge variant='secondary'>無効</Badge>
										)}
									</TableCell>
									<TableCell className='hidden md:table-cell text-sm text-muted-foreground'>
										{new Date(coupon.createdAt).toLocaleString('ja-JP', {
											year: 'numeric',
											month: '2-digit',
											day: '2-digit',
											hour: '2-digit',
											minute: '2-digit',
										})}
									</TableCell>
									<TableCell>
										{coupon.isActive && (
											<Dialog>
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															aria-haspopup='true'
															size='icon'
															variant='ghost'
														>
															<MoreHorizontalIcon className='h-4 w-4' />
															<span className='sr-only'>
																メニューを切り替える
															</span>
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align='end'>
														<DropdownMenuLabel>アクション</DropdownMenuLabel>
														<DialogTrigger asChild>
															<DropdownMenuItem>無効化</DropdownMenuItem>
														</DialogTrigger>
													</DropdownMenuContent>
												</DropdownMenu>
												<DialogContent>
													<DialogHeader>
														<DialogTitle>クーポンを無効化します</DialogTitle>
													</DialogHeader>
													<DialogDescription>
														クーポン「{coupon.code}
														」を無効化しますか？無効化後、顧客はこのコードを使用できなくなります。
													</DialogDescription>
													<DialogFooter>
														<form action={disableCoupon} className='flex gap-2'>
															<input
																type='hidden'
																name='couponId'
																value={coupon.id}
															/>
															<input
																type='hidden'
																name='tenant'
																value={tenant}
															/>
															<DialogClose asChild>
																<Button variant='outline'>キャンセル</Button>
															</DialogClose>
															<DialogClose asChild>
																<Button type='submit' variant='destructive'>
																	無効化する
																</Button>
															</DialogClose>
														</form>
													</DialogFooter>
												</DialogContent>
											</Dialog>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
			{coupons.length > 0 && (
				<CardFooter className='flex items-center justify-end gap-2'>
					{prevPage ? (
						<Button asChild size='sm' variant='outline'>
							<Link href={buildPageUrl(prevPage)}>前へ</Link>
						</Button>
					) : (
						<Button disabled size='sm' variant='outline'>
							前へ
						</Button>
					)}
					{nextPage ? (
						<Button asChild size='sm' variant='outline'>
							<Link href={buildPageUrl(nextPage)}>次へ</Link>
						</Button>
					) : (
						<Button disabled size='sm' variant='outline'>
							次へ
						</Button>
					)}
				</CardFooter>
			)}
		</Card>
	)
}

function EmptyCouponState({ tenant }: { tenant: string }) {
	return (
		<div className='flex flex-col items-center justify-center py-12 text-center'>
			<TicketIcon className='h-12 w-12 text-muted-foreground/50 mb-4' />
			<h3 className='text-lg font-semibold mb-1'>クーポンがまだありません</h3>
			<p className='text-sm text-muted-foreground mb-4 max-w-sm'>
				クーポンを作成して、顧客への割引を設定しましょう。
			</p>
			<CreateCouponDialog tenant={tenant} action={createCoupon} />
		</div>
	)
}

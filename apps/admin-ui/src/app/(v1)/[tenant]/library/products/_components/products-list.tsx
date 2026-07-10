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
import { EmptyState } from 'components/ui/page-shell'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from 'components/ui/context-menu'
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
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'components/ui/tabs'
import { deleteProduct } from 'features/delete-product'
import { type ProductItemForProductsListFragment } from 'gen/graphql'
import { getServerGraphqlSdk } from 'lib/serverGraphqlClient'
import { getServerModePrefix } from 'lib/mode'
import { Kind, ProductStatus, PublicationStatus } from 'lib/product-constants'
import {
	CirclePlusIcon,
	FileIcon,
	ListFilterIcon,
	MoreHorizontalIcon,
	PackageIcon,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'

/** Unified product kind labels across list and detail views */
function kindLabel(kind: string): string {
	switch (kind) {
		case Kind.Plan:
			return '非在庫商品'
		case Kind.Product:
			return '在庫商品'
		case Kind.Option:
			return 'オプション'
		default:
			return String(kind)
	}
}

function KindBadge({ kind }: { kind: string }) {
	return <Badge variant='outline'>{kindLabel(kind)}</Badge>
}

export async function ProductsList({
	searchParams: { filter, query, page },
	tenant,
}: {
	// data: ProductItemForProductsListFragment[]
	searchParams: {
		filter?: string
		query?: string
		page?: string
	}
	tenant: string
}) {
	const session = await authWithCheck()
	// Server-resolved (internalService) Field API — same as reservation SSR
	// (#36). The client-facing getGraphqlSdk resolves the public URL, which is
	// not reliably reachable from worker subrequests (PLT-2501 follow-up).
	const sdk = getServerGraphqlSdk(session, tenant)
	const mp = getServerModePrefix(tenant)
	const pageParam = Number(page ?? '1')
	const currentPage =
		Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1
	const pageSize = 20
	const offset = (currentPage - 1) * pageSize
	let data: Awaited<
		ReturnType<typeof sdk.getProuctsForAdmin>
	>['products']['items'] = []
	let totalCount = 0
	let pageInfo = { offset: 0, hasNextPage: false }

	try {
		const response = await sdk.getProuctsForAdmin({
			limit: pageSize,
			offset,
		})
		const connection = response.products
		if (connection) {
			data = connection.items ?? []
			totalCount = connection.totalCount ?? 0
			pageInfo = connection.pageInfo ?? pageInfo
		}
	} catch (error) {
		// Render the empty state, but never swallow the failure silently —
		// a fetch error here is indistinguishable from "no products" for the
		// user, so at least leave a trace in the worker logs (PLT-2501).
		console.error('getProuctsForAdmin failed; rendering empty state', error)
	}

	const start = totalCount === 0 ? 0 : pageInfo.offset + 1
	const end = pageInfo.offset + data.length
	const prevPage = currentPage > 1 ? currentPage - 1 : null
	const nextPage = pageInfo.hasNextPage ? currentPage + 1 : null

	const buildPageUrl = (targetPage: number) => {
		const params = new URLSearchParams()
		if (filter) params.set('filter', filter)
		if (query) params.set('query', query)
		if (targetPage > 1) params.set('page', String(targetPage))
		const search = params.toString()
		return `${mp}/${tenant}/library/products${search ? `?${search}` : ''}`
	}

	const prevHref = prevPage ? buildPageUrl(prevPage) : undefined
	const nextHref = nextPage ? buildPageUrl(nextPage) : undefined
	return (
		<Tabs defaultValue='all'>
			<div className='flex items-center'>
				<TabsList className='hidden sm:flex' defaultValue={filter}>
					<TabsTrigger value='all'>すべて</TabsTrigger>
					<TabsTrigger value='active'>アクティブ</TabsTrigger>
					<TabsTrigger value='draft'>下書き</TabsTrigger>
					<TabsTrigger className='hidden sm:flex' value='archived'>
						アーカイブ済み
					</TabsTrigger>
				</TabsList>
				<div className='ml-auto flex items-center gap-2'>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button className='h-8 gap-1' size='sm' variant='outline'>
								<ListFilterIcon className='h-3.5 w-3.5' />
								<span className='sr-only sm:not-sr-only sm:whitespace-nowrap'>
									フィルタ
								</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align='end'>
							<DropdownMenuLabel>フィルタリング</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuCheckboxItem checked>
								アクティブ
							</DropdownMenuCheckboxItem>
							<DropdownMenuCheckboxItem>下書き</DropdownMenuCheckboxItem>
							<DropdownMenuCheckboxItem>
								アーカイブ済み
							</DropdownMenuCheckboxItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button className='h-8 gap-1' size='sm' variant='outline'>
						<FileIcon className='h-3.5 w-3.5' />
						<span className='sr-only sm:not-sr-only sm:whitespace-nowrap'>
							エクスポート
						</span>
					</Button>
					<Button className='h-8 gap-1' size='sm' asChild>
						<Link href={`${mp}/${tenant}/library/products/new`}>
							<CirclePlusIcon className='h-3.5 w-3.5' />
							<span className='sr-only sm:not-sr-only sm:whitespace-nowrap'>
								製品を追加
							</span>
						</Link>
					</Button>
				</div>
			</div>

			<TabsContent value='all'>
				<Card x-chunk='dashboard-06-chunk-0'>
					<CardOfHeader />
					<CardContent>
						{data.length === 0 ? (
							<EmptyProductState tenant={tenant} />
						) : (
							<Table>
								<TableOfHeader />
								<TableBody>
									{data.map(product => (
										<TableOfRow
											key={product.id}
											product={product}
											tenant={tenant}
										/>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
					{data.length > 0 && (
						<Footer
							start={start}
							end={end}
							total={totalCount}
							prevHref={prevHref}
							nextHref={nextHref}
						/>
					)}
				</Card>
			</TabsContent>

			<FilteredTabContent
				status={ProductStatus.Active}
				tabValue='active'
				label='アクティブな'
				data={data}
				tenant={tenant}
				start={start}
				end={end}
				total={totalCount}
				prevHref={prevHref}
				nextHref={nextHref}
			/>

			<FilteredTabContent
				status={ProductStatus.Draft}
				tabValue='draft'
				label='下書きの'
				data={data}
				tenant={tenant}
				start={start}
				end={end}
				total={totalCount}
				prevHref={prevHref}
				nextHref={nextHref}
			/>

			<FilteredTabContent
				status={ProductStatus.Archived}
				tabValue='archived'
				label='アーカイブ済みの'
				data={data}
				tenant={tenant}
				start={start}
				end={end}
				total={totalCount}
				prevHref={prevHref}
				nextHref={nextHref}
			/>
		</Tabs>
	)
}

function CardOfHeader() {
	return (
		<CardHeader>
			<CardTitle>製品</CardTitle>
			<CardDescription>
				製品を管理し、販売パフォーマンスを表示します。
			</CardDescription>
		</CardHeader>
	)
}

function Footer({
	start,
	end,
	total,
	prevHref,
	nextHref,
}: {
	start: number
	end: number
	total: number
	prevHref?: string
	nextHref?: string
}) {
	return (
		<CardFooter className='flex flex-wrap items-center justify-between gap-3'>
			<div className='text-xs text-muted-foreground'>
				<strong>
					{start || 0}-{end || 0}
				</strong>{' '}
				のうち、
				<strong>{total}</strong>
				製品を表示しています
			</div>
			<div className='flex items-center gap-2'>
				{prevHref ? (
					<Button asChild size='sm' variant='outline'>
						<Link href={prevHref}>前へ</Link>
					</Button>
				) : (
					<Button disabled size='sm' variant='outline'>
						前へ
					</Button>
				)}
				{nextHref ? (
					<Button asChild size='sm' variant='outline'>
						<Link href={nextHref}>次へ</Link>
					</Button>
				) : (
					<Button disabled size='sm' variant='outline'>
						次へ
					</Button>
				)}
			</div>
		</CardFooter>
	)
}

function TableOfHeader() {
	return (
		<TableHeader>
			<TableRow>
				<TableHead className='hidden w-[64px] sm:table-cell'>
					<span className='sr-only'>画像</span>
				</TableHead>
				<TableHead className='min-w-[160px] max-w-[240px]'>名前</TableHead>
				<TableHead className='w-[100px]'>種別</TableHead>
				<TableHead className='w-[100px]'>SKU</TableHead>
				<TableHead className='hidden lg:table-cell min-w-[180px]'>
					バリアント
				</TableHead>
				<TableHead className='w-[100px]'>ステータス</TableHead>
				<TableHead className='hidden md:table-cell w-[120px]'>
					公開ステータス
				</TableHead>
				<TableHead className='hidden md:table-cell w-[80px] text-right'>
					価格
				</TableHead>
				<TableHead className='hidden lg:table-cell w-[140px]'>
					作成日時
				</TableHead>
				<TableHead className='w-[48px]'>
					<span className='sr-only'>アクション</span>
				</TableHead>
			</TableRow>
		</TableHeader>
	)
}

function TableOfRow({
	product,
	tenant,
}: {
	product: ProductItemForProductsListFragment
	tenant: string
}) {
	const mp = getServerModePrefix(tenant)
	return (
		<Dialog>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<TableRow>
						<TableCell className='hidden sm:table-cell'>
							<Image
								alt='製品画像'
								className='aspect-square rounded-md object-cover'
								height='64'
								src={product.imageFiles[0] ?? '/placeholder.svg'}
								width='64'
							/>
						</TableCell>
						<TableCell className='font-medium max-w-[240px]'>
							<div className='truncate' title={product.name}>
								{product.name}
							</div>
							{product.publicationName && (
								<p
									className='text-xs text-gray-400 truncate'
									title={product.publicationName}
								>
									{product.publicationName}
								</p>
							)}
						</TableCell>
						<TableCell>
							<KindBadge kind={product.kind} />
						</TableCell>
						<TableCell>
							<span
								className='text-xs font-mono truncate block max-w-[100px]'
								title={product.skuCode ?? undefined}
							>
								{product.skuCode}
							</span>
						</TableCell>
						<TableCell className='hidden lg:table-cell'>
							{product.variants?.length ? (
								<div className='space-y-1.5'>
									{product.variants.slice(0, 3).map(variant => {
										const metadataRecord =
											typeof variant.metadata === 'object' &&
											variant.metadata !== null &&
											!Array.isArray(variant.metadata)
												? (variant.metadata as Record<string, unknown>)
												: undefined
										const modelFamily =
											typeof metadataRecord?.['model_family'] === 'string'
												? (metadataRecord['model_family'] as string)
												: undefined
										return (
											<div key={variant.id} className='text-xs'>
												<div className='flex items-center gap-1.5'>
													<Badge
														variant='outline'
														className='text-[10px] px-1 py-0'
													>
														{variant.status}
													</Badge>
													<span
														className='font-medium truncate max-w-[120px]'
														title={variant.name}
													>
														{variant.name}
													</span>
												</div>
												{(variant.code || modelFamily) && (
													<div className='flex gap-2 text-muted-foreground mt-0.5 truncate'>
														{variant.code && (
															<span>コード: {variant.code}</span>
														)}
														{modelFamily && <span>モデル: {modelFamily}</span>}
													</div>
												)}
											</div>
										)
									})}
									{product.variants.length > 3 && (
										<span className='text-xs text-muted-foreground'>
											他 {product.variants.length - 3} 件
										</span>
									)}
								</div>
							) : (
								<span className='text-xs text-muted-foreground'>
									バリアント未登録
								</span>
							)}
						</TableCell>
						<TableCell>
							{product.status === ProductStatus.Active && (
								<Badge variant='outline'>アクティブ</Badge>
							)}
							{product.status === ProductStatus.Draft && (
								<Badge variant='outline'>下書き</Badge>
							)}
							{product.status === ProductStatus.Archived && (
								<Badge variant='outline'>アーカイブ済み</Badge>
							)}
						</TableCell>
						<TableCell className='hidden md:table-cell'>
							{product.publicationStatus === PublicationStatus.Private && (
								<Badge variant='outline'>非公開</Badge>
							)}
							{product.publicationStatus === PublicationStatus.Public && (
								<Badge variant='outline'>公開</Badge>
							)}
							{product.publicationStatus ===
								PublicationStatus.PublicUseDefault && (
								<Badge variant='outline'>公開（デフォルト情報）</Badge>
							)}
						</TableCell>
						<TableCell className='hidden md:table-cell text-right tabular-nums'>
							¥{product.listPrice.toLocaleString()}
						</TableCell>
						<TableCell className='hidden lg:table-cell text-sm text-muted-foreground'>
							{new Date(product.createdAt).toLocaleString('ja-JP', {
								year: 'numeric',
								month: '2-digit',
								day: '2-digit',
								hour: '2-digit',
								minute: '2-digit',
								hour12: true,
							})}
						</TableCell>
						<TableCell>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button aria-haspopup='true' size='icon' variant='ghost'>
										<MoreHorizontalIcon className='h-4 w-4' />
										<span className='sr-only'>メニューを切り替える</span>
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align='end'>
									<DropdownMenuLabel>アクション</DropdownMenuLabel>
									<DropdownMenuItem asChild>
										<Link
											href={`${mp}/${tenant}/library/products/${product.id}`}
											prefetch
										>
											編集
										</Link>
									</DropdownMenuItem>
									<DialogTrigger asChild>
										<DropdownMenuItem>削除</DropdownMenuItem>
									</DialogTrigger>
								</DropdownMenuContent>
							</DropdownMenu>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>削除します</DialogTitle>
								</DialogHeader>
								<DialogDescription>
									製品を本当に削除しますか？一度削除した製品は復元できません。
								</DialogDescription>
								<DialogFooter>
									<form action={deleteProduct} className='flex gap-2'>
										<input type='hidden' name='productId' value={product.id} />
										<input type='hidden' name='tenantId' value={tenant} />
										<DialogClose asChild>
											<Button variant='outline'>キャンセル</Button>
										</DialogClose>
										<DialogClose asChild>
											<Button type='submit' variant='destructive'>
												削除する
											</Button>
										</DialogClose>
									</form>
								</DialogFooter>
							</DialogContent>
						</TableCell>
					</TableRow>
				</ContextMenuTrigger>
				<ContextMenuContent>
					<ContextMenuItem asChild>
						<Link
							href={`${mp}/${tenant}/library/products/${product.id}`}
							prefetch
						>
							編集
						</Link>
					</ContextMenuItem>
					<DialogTrigger asChild>
						<ContextMenuItem>削除</ContextMenuItem>
					</DialogTrigger>
				</ContextMenuContent>
			</ContextMenu>
		</Dialog>
	)
}

function EmptyProductState({ tenant }: { tenant: string }) {
	const mp = getServerModePrefix(tenant)
	return (
		<EmptyState
			icon={<PackageIcon />}
			title='製品がまだありません'
			description='製品を登録して、在庫・販売・公開状態を管理しましょう。種別（在庫商品 / 非在庫商品 / オプション）を選んで作成できます。'
			action={
				<Button size='sm' asChild>
					<Link href={`${mp}/${tenant}/library/products/new`}>
						<CirclePlusIcon className='h-4 w-4 mr-1.5' />
						最初の製品を追加する
					</Link>
				</Button>
			}
		/>
	)
}

function FilteredTabContent({
	status,
	tabValue,
	label,
	data,
	tenant,
	start,
	end,
	total,
	prevHref,
	nextHref,
}: {
	status: ProductStatus
	tabValue: string
	label: string
	data: ProductItemForProductsListFragment[]
	tenant: string
	start: number
	end: number
	total: number
	prevHref?: string
	nextHref?: string
}) {
	const filtered = data.filter(v => v.status === status)
	return (
		<TabsContent value={tabValue}>
			<Card x-chunk='dashboard-06-chunk-0'>
				<CardOfHeader />
				<CardContent>
					{filtered.length === 0 ? (
						<div className='flex flex-col items-center justify-center py-8 text-center'>
							<p className='text-sm text-muted-foreground'>
								{label}製品はありません
							</p>
						</div>
					) : (
						<Table>
							<TableOfHeader />
							<TableBody>
								{filtered.map(v => (
									<TableOfRow key={v.id} product={v} tenant={tenant} />
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
				{filtered.length > 0 && (
					<Footer
						start={start}
						end={end}
						total={total}
						prevHref={prevHref}
						nextHref={nextHref}
					/>
				)}
			</Card>
		</TabsContent>
	)
}

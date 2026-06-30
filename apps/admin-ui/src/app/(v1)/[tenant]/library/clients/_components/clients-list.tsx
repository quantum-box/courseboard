import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import { industryOptions } from 'constants/options'
import type { ItemOnClientFieldFragment } from 'gen/graphql'
import { Building2Icon, MoreHorizontalIcon, UsersIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { CreateClientSheet } from './create-client-sheet'

export function ClientsList({
	data,
	tenantId,
	createClientAction,
}: {
	data: ItemOnClientFieldFragment[]
	searchParams: {
		filter?: string
		query?: string
	}
	tenantId: string
	createClientAction: (formData: FormData) => void | Promise<void>
}) {
	const withAddress = data.filter(client => client.headOfficeAddress).length
	const withEmail = data.filter(client => client.email).length
	const withIndustry = data.filter(client => client.industry).length

	return (
		<section className='space-y-3'>
			<div className='grid grid-cols-2 gap-x-4 gap-y-2 border-y py-3 text-sm sm:grid-cols-4'>
				<ClientMetric
					label='表示'
					value={`${data.length.toLocaleString('ja-JP')} 件`}
					description='取引先'
				/>
				<ClientMetric
					label='連絡先'
					value={`${withEmail.toLocaleString('ja-JP')} 件`}
					description='メールあり'
				/>
				<ClientMetric
					label='所在地'
					value={`${withAddress.toLocaleString('ja-JP')} 件`}
					description='住所あり'
				/>
				<ClientMetric
					label='業種'
					value={`${withIndustry.toLocaleString('ja-JP')} 件`}
					description='分類済み'
				/>
			</div>

			<div className='flex items-center justify-between gap-3'>
				<p className='text-xs text-muted-foreground'>
					表示 {data.length.toLocaleString('ja-JP')} 件
				</p>
				<CreateClientSheet
					action={createClientAction}
					hideLabelOnMobile={false}
				/>
			</div>

			<div className='overflow-hidden rounded-md border bg-background'>
				<ClientsTable
					clients={data}
					tenantId={tenantId}
					createClientAction={createClientAction}
				/>
			</div>
		</section>
	)
}

function ClientMetric({
	label,
	value,
	description,
}: {
	label: string
	value: string
	description: string
}) {
	return (
		<div className='min-w-0'>
			<div className='text-xs text-muted-foreground'>{label}</div>
			<div className='mt-0.5 truncate font-semibold leading-tight'>{value}</div>
			<div className='mt-0.5 truncate text-xs text-muted-foreground'>
				{description}
			</div>
		</div>
	)
}

function ClientsTable({
	clients,
	tenantId,
	createClientAction,
}: {
	clients: ItemOnClientFieldFragment[]
	tenantId: string
	createClientAction: (formData: FormData) => void | Promise<void>
}) {
	if (clients.length === 0) {
		return (
			<div className='grid min-h-[220px] place-items-center px-4 py-10 text-center'>
				<div className='max-w-sm space-y-3'>
					<div className='mx-auto grid size-10 place-items-center rounded-md border bg-muted/40'>
						<UsersIcon className='size-5 text-muted-foreground' />
					</div>
					<div>
						<h2 className='font-semibold'>取引先がまだありません</h2>
						<p className='mt-1 text-sm text-muted-foreground'>
							顧客・仕入先を登録すると、見積書や請求書で選択できます。
						</p>
					</div>
					<CreateClientSheet
						action={createClientAction}
						buttonLabel='取引先を追加する'
						hideLabelOnMobile={false}
					/>
				</div>
			</div>
		)
	}

	return (
		<>
			<div className='md:hidden'>
				{clients.map(client => (
					<div key={client.id} className='border-b p-3 last:border-b-0'>
						<div className='flex items-start justify-between gap-3'>
							<div className='min-w-0'>
								<Link
									className='font-medium hover:underline'
									href={`/${tenantId}/library/clients/${client.id}` as Route}
								>
									{client.name}
								</Link>
								<div className='mt-0.5 truncate text-xs text-muted-foreground'>
									{client.email ?? client.phoneNumber ?? '連絡先未設定'}
								</div>
							</div>
							<Badge variant='outline' className='shrink-0'>
								取引先
							</Badge>
						</div>
						<div className='mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground'>
							<span>{clientIndustryLabel(client.industry)}</span>
							<span aria-hidden='true'>/</span>
							<span>{formatAddress(client)}</span>
						</div>
					</div>
				))}
			</div>
			<div className='hidden md:block'>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className='whitespace-nowrap'>取引先</TableHead>
							<TableHead className='whitespace-nowrap'>連絡先</TableHead>
							<TableHead className='whitespace-nowrap'>所在地</TableHead>
							<TableHead className='whitespace-nowrap'>業種</TableHead>
							<TableHead className='w-10'>
								<span className='sr-only'>アクション</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{clients.map(client => (
							<TableRow key={client.id}>
								<TableCell className='py-3'>
									<div className='flex min-w-0 items-center gap-2'>
										<div className='grid size-8 shrink-0 place-items-center rounded-md border bg-muted/30'>
											<Building2Icon className='size-4 text-muted-foreground' />
										</div>
										<div className='min-w-0'>
											<Link
												className='font-medium hover:underline'
												href={
													`/${tenantId}/library/clients/${client.id}` as Route
												}
											>
												{client.name}
											</Link>
											<div className='truncate text-xs text-muted-foreground'>
												{client.id}
											</div>
										</div>
									</div>
								</TableCell>
								<TableCell className='max-w-[220px]'>
									<div className='truncate'>
										{client.email ?? client.phoneNumber ?? '未設定'}
									</div>
								</TableCell>
								<TableCell className='max-w-[260px] truncate'>
									{formatAddress(client)}
								</TableCell>
								<TableCell className='whitespace-nowrap'>
									{clientIndustryLabel(client.industry)}
								</TableCell>
								<TableCell className='text-right'>
									<Button asChild size='icon' variant='ghost'>
										<Link
											href={
												`/${tenantId}/library/clients/${client.id}` as Route
											}
											aria-label={`${client.name}を開く`}
										>
											<MoreHorizontalIcon className='size-4' />
										</Link>
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
				<div className='border-t px-3 py-2 text-xs text-muted-foreground'>
					1-{clients.length.toLocaleString('ja-JP')} のうち、
					{clients.length.toLocaleString('ja-JP')}取引先を表示しています
				</div>
			</div>
		</>
	)
}

function clientIndustryLabel(industry?: string | null) {
	if (!industry) return '未設定'
	return (
		industryOptions.find(option => option.value === industry)?.label ?? industry
	)
}

function formatAddress(client: ItemOnClientFieldFragment) {
	const address = client.headOfficeAddress
	if (!address) return '住所未設定'
	return [address.state, address.city, address.address1].filter(Boolean).join(' ')
}

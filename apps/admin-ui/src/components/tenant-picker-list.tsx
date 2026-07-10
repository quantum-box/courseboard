import { Badge } from 'components/ui/badge'
import type { Tenant } from 'lib/tenant-list'
import { ChevronRight, Plus } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'

export function TenantPickerList({ tenants }: { tenants: Tenant[] }) {
	return (
		<div className='overflow-hidden rounded-lg border border-zinc-200 bg-white'>
			{tenants.length === 0 ? (
				<div className='px-4 py-6 text-sm text-zinc-500'>
					表示できるテナントがありません
				</div>
			) : null}

			{tenants.map((tenant, i) => {
				const prefix = tenant.mode === 'sandbox' ? '/sandbox' : ''
				return (
					<Link
						key={tenant.id}
						href={`${prefix}/${tenant.id}/home` as Route}
						className={`group flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 ${
							i > 0 ? 'border-t border-zinc-100' : ''
						}`}
					>
						<div className='min-w-0 flex-1'>
							<div className='flex items-center gap-2'>
								<span className='truncate text-sm font-medium text-zinc-900'>
									{tenant.name}
								</span>
								<Badge
									variant={
										tenant.mode === 'production' ? 'default' : 'secondary'
									}
									className={`shrink-0 text-[10px] px-1.5 py-0 ${
										tenant.mode === 'production'
											? 'bg-emerald-600 text-white hover:bg-emerald-600'
											: 'bg-amber-100 text-amber-800 hover:bg-amber-100'
									}`}
								>
									{tenant.mode === 'production' ? 'Production' : 'Sandbox'}
								</Badge>
							</div>
							<p className='mt-0.5 truncate text-xs text-zinc-400'>
								{tenant.slug ?? tenant.id}
							</p>
						</div>
						<ChevronRight className='h-4 w-4 shrink-0 text-zinc-300 group-hover:text-zinc-500' />
					</Link>
				)
			})}

			<Link
				href={'/create-tenant' as Route}
				className='group flex items-center gap-3 border-t border-zinc-100 px-4 py-3 hover:bg-zinc-50'
			>
				<Plus className='h-4 w-4 shrink-0 text-zinc-400 group-hover:text-zinc-600' />
				<span className='text-sm text-zinc-500 group-hover:text-zinc-900'>
					新規テナント作成
				</span>
			</Link>
		</div>
	)
}

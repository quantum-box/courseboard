import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { Button } from 'components/ui/button'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { golfCourseAdminPaths } from 'lib/extension-admin-registry'
import { getServerModePrefix } from 'lib/mode'
import { ArrowLeftIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { fetchGolfReservationPolicyAction } from './action'
import { GolfPolicyForm } from './policy-form'

export const metadata = {
	title: '予約ポリシー | TACHYON Field',
}

export default async function GolfPolicyPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const prefix = getServerModePrefix(tenant)
	const golfAppHref = `${prefix}/${tenant}${golfCourseAdminPaths.portal}` as Route

	const policyResult = await fetchGolfReservationPolicyAction(tenant)
	const hooks = policyResult.success
		? (policyResult.data?.policyHooksJson ?? null)
		: null

	return (
		<V1Layout
			current='extensions'
			tenant={tenant}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${prefix}/${tenant}/home` as Route}>ホーム</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`${prefix}/${tenant}/extensions` as Route}>
									アプリ
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={golfAppHref}>ゴルフアプリ</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>予約ポリシー</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout className='pb-8'>
				<div className='flex items-start justify-between gap-3'>
					<div>
						<h1 className='text-2xl font-semibold'>予約ポリシー</h1>
						<p className='mt-1 text-sm text-muted-foreground'>
							セルフロック（キャディ付き優先枠）と客単価判定のルールを設定します。
						</p>
					</div>
					<Button asChild variant='outline'>
						<Link href={golfAppHref}>
							<ArrowLeftIcon className='mr-2 h-4 w-4' />
							ゴルフアプリへ戻る
						</Link>
					</Button>
				</div>

				{!policyResult.success ? (
					<p className='rounded-md border bg-background px-4 py-6 text-sm text-destructive'>
						ポリシーの取得に失敗しました: {policyResult.message}
					</p>
				) : (
					<GolfPolicyForm tenant={tenant} initialHooks={hooks} />
				)}
			</MainLayout>
		</V1Layout>
	)
}

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
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
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from 'components/ui/dialog'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
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
import { MainLayout, V1Layout } from 'components/v1-layout'
import { golfCourseAdminPaths } from 'lib/extension-admin-registry'
import { getServerModePrefix } from 'lib/mode'
import { FlagIcon, PlusIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { type GolfCourse, fetchGolfCoursesAction } from './action'
import { CourseCreateForm, CourseDeleteButton, CourseEditForm } from './course-forms'

export const metadata = {
	title: 'コース管理 | TACHYON Field',
	description: 'Golf app course master management.',
}

export default async function GolfCoursesPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const prefix = getServerModePrefix(tenant)
	const result = await fetchGolfCoursesAction(tenant)
	const courses: GolfCourse[] = result.success ? result.data : []

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
								<Link
									href={
										`${prefix}/${tenant}${golfCourseAdminPaths.portal}` as Route
									}
								>
									ゴルフアプリ
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>コース管理</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
					<div>
						<h1 className='text-2xl font-semibold'>コース管理</h1>
						<p className='text-sm text-muted-foreground'>
							ゴルフ場コースのマスタを登録・編集します。
						</p>
					</div>
					<CourseCreateForm tenant={tenant} />
				</div>

				{!result.success ? (
					<div className='rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive'>
						{result.message ?? 'コース情報の取得に失敗しました。'}
					</div>
				) : null}

				<Card>
					<CardHeader>
						<CardTitle className='flex items-center gap-2'>
							<FlagIcon className='h-4 w-4' />
							コース一覧
						</CardTitle>
						<CardDescription>{courses.length} 件</CardDescription>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>コース名</TableHead>
									<TableHead>略称</TableHead>
									<TableHead className='text-right'>ホール数</TableHead>
									<TableHead className='text-right'>スタート間隔</TableHead>
									<TableHead>タイムゾーン</TableHead>
									<TableHead>状態</TableHead>
									<TableHead className='text-right'>操作</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{courses.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={7}
											className='h-20 text-center text-muted-foreground'
										>
											コースが登録されていません。「コース追加」から登録してください。
										</TableCell>
									</TableRow>
								) : null}
								{courses.map(course => (
									<TableRow key={course.id}>
										<TableCell className='font-medium'>
											{course.name}
										</TableCell>
										<TableCell className='text-muted-foreground'>
											{course.shortName ?? '-'}
										</TableCell>
										<TableCell className='text-right'>
											{course.holeCount}H
										</TableCell>
										<TableCell className='text-right'>
											{course.startIntervalMinutes}分
										</TableCell>
										<TableCell className='text-sm text-muted-foreground'>
											{course.timezone}
										</TableCell>
										<TableCell>
											<span
												className={
													course.isActive
														? 'text-emerald-700'
														: 'text-muted-foreground'
												}
											>
												{course.isActive ? '有効' : '無効'}
											</span>
										</TableCell>
										<TableCell className='text-right'>
											<div className='flex justify-end gap-2'>
												<CourseEditForm tenant={tenant} course={course} />
												<CourseDeleteButton
													tenant={tenant}
													course={course}
												/>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			</MainLayout>
		</V1Layout>
	)
}

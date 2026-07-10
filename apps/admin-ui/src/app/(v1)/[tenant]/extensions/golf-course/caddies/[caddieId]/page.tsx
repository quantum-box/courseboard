import { Badge } from 'components/ui/badge'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'components/ui/tabs'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { golfCourseAdminPaths } from 'lib/extension-admin-registry'
import { getServerModePrefix } from 'lib/mode'
import { CheckCircleIcon, StarIcon, XCircleIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
	type CaddieAssignment,
	type CaddieProfile,
	type CaddieRating,
	fetchCaddieAssignmentsForProfileAction,
	fetchCaddieAvailabilitiesAction,
	fetchCaddieCourseMembershipsAction,
	fetchCaddieProfileAction,
	fetchCaddieRatingsAction,
	updateAssignmentStatusFromFormAction,
	updateCaddieProfileFromFormAction,
} from '../action'
import { fetchGolfCoursesAction } from '../../courses/action'
import { CaddieAvailabilityCalendar } from '../caddie-availability-calendar'
import {
	CaddieCoursesForm,
	type GolfCourseOption,
} from '../caddie-courses-form'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

const employmentLabels: Record<string, string> = {
	active: '稼働中',
	inactive: '休止',
	suspended: '停止',
}

export const metadata = {
	title: 'キャディ詳細 | TACHYON Field',
	description: 'Golf app caddie profile detail.',
}

export default async function GolfCaddieDetailPage({
	params: { caddieId, tenant },
}: {
	params: { caddieId: string; tenant: string }
}) {
	const prefix = getServerModePrefix(tenant)
	const now = new Date()
	const calYear = now.getFullYear()
	const calMonth = now.getMonth() + 1
	const fromDate = `${calYear}-${String(calMonth).padStart(2, '0')}-01`
	const lastDay = new Date(calYear, calMonth, 0).getDate()
	const toDate = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

	const [
		profileResult,
		assignmentsResult,
		ratingsResult,
		courseMembershipsResult,
		availabilitiesResult,
		coursesResult,
	] =
		await Promise.all([
			fetchCaddieProfileAction(tenant, caddieId),
			fetchCaddieAssignmentsForProfileAction(tenant, caddieId),
			fetchCaddieRatingsAction(tenant, caddieId),
			fetchCaddieCourseMembershipsAction(tenant, caddieId),
			fetchCaddieAvailabilitiesAction(tenant, caddieId, fromDate, toDate),
			fetchGolfCoursesAction(tenant),
		])
	if (!profileResult.success) {
		notFound()
	}
	const profile = profileResult.data
	const assignments = assignmentsResult.success ? assignmentsResult.data : []
	const ratings = ratingsResult.success ? ratingsResult.data : []
	const courseMemberships = courseMembershipsResult.success
		? courseMembershipsResult.data
		: []
	// Golf courses list from the courses API (T01).
	const courseOptions: GolfCourseOption[] = coursesResult.success
		? coursesResult.data.map(course => ({ id: course.id, name: course.name }))
		: []
	const availabilities = availabilitiesResult.success
		? availabilitiesResult.data
		: []
	const average =
		ratings.length > 0
			? ratings.reduce((total, rating) => total + rating.score, 0) /
				ratings.length
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
							<BreadcrumbLink asChild>
								<Link
									href={
										`${prefix}/${tenant}${golfCourseAdminPaths.caddies}` as Route
									}
								>
									キャディ管理
								</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{profile.displayName}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start'>
					<div className='min-w-0'>
						<h1 className='text-2xl font-semibold'>{profile.displayName}</h1>
						<p className='mt-1 text-sm text-muted-foreground'>
							キャディプロフィール、割当履歴、評価を確認します。
						</p>
					</div>
					<Button asChild variant='outline' className='w-full md:w-auto'>
						<Link href={`/${tenant}${golfCourseAdminPaths.caddies}` as Route}>
							キャディ管理へ戻る
						</Link>
					</Button>
				</div>

				<Tabs defaultValue='basic' className='w-full'>
					<TabsList className='grid h-auto w-full grid-cols-5 md:w-auto'>
						<TabsTrigger value='basic'>基本情報</TabsTrigger>
						<TabsTrigger value='courses'>対応コース</TabsTrigger>
						<TabsTrigger value='assignments'>割当履歴</TabsTrigger>
						<TabsTrigger value='ratings'>評価</TabsTrigger>
						<TabsTrigger value='availability'>希望休</TabsTrigger>
					</TabsList>
					<TabsContent value='basic'>
						<CaddieProfileForm tenant={tenant} profile={profile} />
					</TabsContent>
					<TabsContent value='courses'>
						<Card>
							<CardHeader>
								<CardTitle>対応可能コース</CardTitle>
								<CardDescription>
									このキャディが担当できるコースと、メイン拠点を設定します。
								</CardDescription>
							</CardHeader>
							<CardContent>
								<CaddieCoursesForm
									tenant={tenant}
									caddieProfileId={caddieId}
									courseOptions={courseOptions}
									initialMemberships={courseMemberships}
								/>
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value='assignments'>
						<Card>
							<CardHeader>
								<CardTitle>割当履歴</CardTitle>
								<CardDescription>
									日付降順でキャディ割当を表示します。
								</CardDescription>
							</CardHeader>
							<CardContent>
								{assignmentsResult.success ? (
									<AssignmentHistoryTable
										assignments={assignments}
										tenant={tenant}
									/>
								) : (
									<p className='text-sm text-destructive'>
										{assignmentsResult.message}
									</p>
								)}
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value='ratings'>
						<Card>
							<CardHeader className='gap-2'>
								<div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
									<div>
										<CardTitle>評価</CardTitle>
										<CardDescription>
											顧客評価とコメントを確認します。
										</CardDescription>
									</div>
									<div className='flex items-center gap-2 text-lg font-semibold'>
										<StarIcon
											className='h-5 w-5 fill-current text-amber-500'
											aria-hidden
										/>
										{average === null ? '-' : average.toFixed(1)} /{' '}
										{ratings.length}件
									</div>
								</div>
							</CardHeader>
							<CardContent>
								{ratingsResult.success ? (
									<RatingTable ratings={ratings} />
								) : (
									<p className='text-sm text-destructive'>
										{ratingsResult.message}
									</p>
								)}
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value='availability'>
						<Card>
							<CardHeader>
								<CardTitle>希望休・体調カレンダー</CardTitle>
								<CardDescription>
									日別の勤務希望状態と体調メモを管理します。
								</CardDescription>
							</CardHeader>
							<CardContent>
								<CaddieAvailabilityCalendar
									tenant={tenant}
									caddieProfileId={caddieId}
									initialAvailabilities={availabilities}
									initialYear={calYear}
									initialMonth={calMonth}
								/>
							</CardContent>
						</Card>
					</TabsContent>
				</Tabs>
			</MainLayout>
		</V1Layout>
	)
}

function CaddieProfileForm({
	profile,
	tenant,
}: {
	profile: CaddieProfile
	tenant: string
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>基本情報</CardTitle>
				<CardDescription>
					プロフィール、基本費用、日次上限、スタッフ紐付けを管理します。
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className='grid gap-5'
					action={updateCaddieProfileFromFormAction.bind(
						null,
						tenant,
						profile.id,
					)}
				>
					<div className='grid gap-4 md:grid-cols-3'>
						<div className='grid gap-2'>
							<Label htmlFor='displayName'>表示名</Label>
							<Input
								id='displayName'
								name='displayName'
								defaultValue={profile.displayName}
							/>
						</div>
						<div className='grid gap-2'>
							<Label htmlFor='skillLevel'>スキル</Label>
							<select
								id='skillLevel'
								name='skillLevel'
								defaultValue={profile.skillLevel}
								className='h-10 rounded-md border border-input bg-background px-3 text-sm'
							>
								<option value='rookie'>Rookie</option>
								<option value='regular'>Regular</option>
								<option value='veteran'>Veteran</option>
							</select>
						</div>
						<div className='grid gap-2'>
							<Label htmlFor='employmentStatus'>雇用状態</Label>
							<select
								id='employmentStatus'
								name='employmentStatus'
								defaultValue={profile.employmentStatus}
								className='h-10 rounded-md border border-input bg-background px-3 text-sm'
							>
								<option value='active'>稼働中</option>
								<option value='inactive'>休止</option>
								<option value='suspended'>停止</option>
							</select>
						</div>
					</div>
					<div className='grid gap-4 md:grid-cols-3'>
						<div className='grid gap-2'>
							<Label htmlFor='baseFeeAmount'>基本費用</Label>
							<Input
								id='baseFeeAmount'
								name='baseFeeAmount'
								type='number'
								min='0'
								defaultValue={profile.baseFeeAmount}
							/>
						</div>
						<div className='grid gap-2'>
							<Label htmlFor='currency'>通貨</Label>
							<Input
								id='currency'
								name='currency'
								maxLength={3}
								defaultValue={profile.currency}
							/>
						</div>
						<div className='grid gap-2'>
							<Label htmlFor='maxRoundsPerDay'>日次上限</Label>
							<Input
								id='maxRoundsPerDay'
								name='maxRoundsPerDay'
								type='number'
								min='1'
								defaultValue={profile.maxRoundsPerDay}
							/>
						</div>
					</div>
					<div className='grid gap-3 rounded-md border bg-muted/30 p-3 text-sm md:grid-cols-3'>
						<ProfileMeta
							label='スタッフ種別'
							value={profile.staffReferenceType}
						/>
						<ProfileMeta
							label='スタッフID'
							value={profile.staffReferenceId ?? profile.staffId ?? '未紐付け'}
						/>
						<ProfileMeta
							label='現在状態'
							value={
								employmentLabels[profile.employmentStatus] ??
								profile.employmentStatus
							}
						/>
					</div>
					<div className='flex justify-end'>
						<Button type='submit'>保存</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	)
}

function ProfileMeta({ label, value }: { label: string; value: string }) {
	return (
		<div className='min-w-0'>
			<p className='text-xs text-muted-foreground'>{label}</p>
			<p className='mt-1 break-all font-medium'>{value}</p>
		</div>
	)
}

function AssignmentHistoryTable({
	assignments,
	tenant,
}: {
	assignments: CaddieAssignment[]
	tenant: string
}) {
	if (assignments.length === 0) {
		return (
			<p className='text-sm text-muted-foreground'>
				このキャディの割当履歴はありません。
			</p>
		)
	}
	return (
		<div className='overflow-x-auto'>
			<Table className='min-w-[760px]'>
				<TableHeader>
					<TableRow>
						<TableHead>予定</TableHead>
						<TableHead>ラウンド</TableHead>
						<TableHead>役割</TableHead>
						<TableHead className='text-right'>費用</TableHead>
						<TableHead>状態</TableHead>
						<TableHead className='text-right'>操作</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{assignments.map(assignment => (
						<TableRow key={assignment.id}>
							<TableCell>{formatSchedule(assignment.scheduledAt)}</TableCell>
							<TableCell>
								<div>
									<p>
										{assignment.roundReference ??
											assignment.reservationId ??
											assignment.id}
									</p>
									{assignment.nominatedBy ? (
										<p className='text-xs text-muted-foreground'>
											指名: {assignment.nominatedBy}
										</p>
									) : null}
								</div>
							</TableCell>
							<TableCell>{assignment.assignmentRole}</TableCell>
							<TableCell className='text-right'>
								{yen.format(assignment.feeAmount)}
							</TableCell>
							<TableCell>
								<Badge variant='outline'>{assignment.status}</Badge>
							</TableCell>
							<TableCell className='text-right'>
								<AssignmentStatusActions
									assignment={assignment}
									tenant={tenant}
								/>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	)
}

function AssignmentStatusActions({
	assignment,
	tenant,
}: {
	assignment: CaddieAssignment
	tenant: string
}) {
	if (assignment.status !== 'assigned') {
		return null
	}
	return (
		<div className='flex justify-end gap-2'>
			<form
				action={updateAssignmentStatusFromFormAction.bind(
					null,
					tenant,
					assignment.id,
					'completed',
				)}
			>
				<Button type='submit' size='sm' variant='secondary'>
					<CheckCircleIcon className='mr-2 h-4 w-4' aria-hidden />
					完了
				</Button>
			</form>
			<form
				action={updateAssignmentStatusFromFormAction.bind(
					null,
					tenant,
					assignment.id,
					'cancelled',
				)}
			>
				<Button type='submit' size='sm' variant='outline'>
					<XCircleIcon className='mr-2 h-4 w-4' aria-hidden />
					キャンセル
				</Button>
			</form>
		</div>
	)
}

function RatingTable({ ratings }: { ratings: CaddieRating[] }) {
	if (ratings.length === 0) {
		return (
			<p className='text-sm text-muted-foreground'>
				このキャディの評価はまだありません。
			</p>
		)
	}
	return (
		<div className='overflow-x-auto'>
			<Table className='min-w-[720px]'>
				<TableHeader>
					<TableRow>
						<TableHead>スコア</TableHead>
						<TableHead>コメント</TableHead>
						<TableHead>顧客</TableHead>
						<TableHead>作成日時</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{ratings.map(rating => (
						<TableRow key={rating.id}>
							<TableCell>
								<StarRating score={rating.score} />
							</TableCell>
							<TableCell>{rating.comment ?? '-'}</TableCell>
							<TableCell className='break-all'>{rating.customerId}</TableCell>
							<TableCell>{formatSchedule(rating.createdAt)}</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	)
}

function StarRating({ score }: { score: number }) {
	return (
		<div className='flex items-center gap-1 text-amber-500'>
			{Array.from({ length: 5 }, (_, index) => (
				<StarIcon
					key={index}
					className={`h-4 w-4 ${index < score ? 'fill-current' : ''}`}
					aria-hidden
				/>
			))}
			<span className='ml-1 text-sm font-medium text-foreground'>{score}</span>
		</div>
	)
}

function formatSchedule(value: string): string {
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP')
}

import { Badge } from 'components/ui/badge'
import { CaddieAutoAssign } from './caddie-auto-assign'
import { CaddieSupplyCard } from './caddie-supply-card'
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
import { HelpPanel } from 'components/ui/help-panel'
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
import { MainLayout, V1Layout } from 'components/v1-layout'
import { golfCourseAdminPaths } from 'lib/extension-admin-registry'
import { getServerModePrefix } from 'lib/mode'
import {
	CalendarCheckIcon,
	CheckCircleIcon,
	ClockIcon,
	FileTextIcon,
	StarIcon,
	UsersIcon,
	XCircleIcon,
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import {
	type CaddieAssignment,
	type CaddieProfile,
	type CaddieRecommendation,
	type StaffMemberOption,
	fetchCaddieAssignmentsAction,
	fetchCaddieAttendanceSnapshotAction,
	fetchCaddiePayrollSummaryAction,
	fetchCaddieProfilesAction,
	fetchCaddieRecommendationsAction,
	fetchStaffMemberOptionsAction,
	updateAssignmentStatusFromFormAction,
} from './action'
import { CaddieAttendanceControls } from './caddie-attendance-controls'
import { CaddieCreateForm } from './caddie-create-form'
import { buildCaddieDispatchSummary } from './caddie-dispatch-summary'
import { CaddiePayrollExportButton } from './caddie-payroll-export-button'
import {
	type CaddieAttendanceSnapshot,
	type CaddieEmploymentStatusFilter,
	type CaddieLinkFilter,
	type CaddiePayrollSummaryRow,
	type CaddieSkillFilter,
	defaultPayrollYearMonth,
	filterCaddieProfilesByLink,
	filterCaddieProfilesByStatusAndSkill,
	formatMinutes,
	isCaddieStaffLinked,
	parseCaddieEmploymentStatusFilter,
	parseCaddieLinkFilter,
	parseCaddieSkillFilter,
} from './caddie-payroll-helpers'
import { CaddieStaffLinkControls } from './caddie-staff-link-controls'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

const skillLabels: Record<string, string> = {
	rookie: 'Rookie',
	regular: 'Regular',
	veteran: 'Veteran',
}

export const metadata = {
	title: 'キャディ管理 | TACHYON Field',
	description: 'Golf app caddie management.',
}

export default async function GolfCaddiesPage({
	params: { tenant },
	searchParams,
}: {
	params: { tenant: string }
	searchParams?: {
		yearMonth?: string
		linkFilter?: string
		status?: string
		skill?: string
	}
}) {
	const yearMonth = searchParams?.yearMonth ?? defaultPayrollYearMonth()
	const prefix = getServerModePrefix(tenant)
	const linkFilter = parseCaddieLinkFilter(searchParams?.linkFilter)
	const statusFilter = parseCaddieEmploymentStatusFilter(searchParams?.status)
	const skillFilter = parseCaddieSkillFilter(searchParams?.skill)
	const [
		profilesResult,
		assignmentsResult,
		recommendationsResult,
		payrollResult,
		attendanceResult,
		staffOptionsResult,
	] = await Promise.all([
		fetchCaddieProfilesAction(tenant),
		fetchCaddieAssignmentsAction(tenant),
		fetchCaddieRecommendationsAction(tenant),
		fetchCaddiePayrollSummaryAction(tenant, yearMonth),
		fetchCaddieAttendanceSnapshotAction(tenant),
		fetchStaffMemberOptionsAction(tenant),
	])
	const allProfiles = profilesResult.success ? profilesResult.data : []
	const profiles = filterCaddieProfilesByStatusAndSkill(
		filterCaddieProfilesByLink(allProfiles, linkFilter),
		statusFilter,
		skillFilter,
	)
	const unlinkedCount = allProfiles.filter(
		profile => !isCaddieStaffLinked(profile),
	).length
	const staffOptions: StaffMemberOption[] = staffOptionsResult.success
		? staffOptionsResult.data
		: []
	const assignments = assignmentsResult.success ? assignmentsResult.data : []
	const recommendations = recommendationsResult.success
		? recommendationsResult.data
		: []
	const payrollRows = payrollResult.success ? payrollResult.data.items : []
	const payrollPeriod = payrollResult.success ? payrollResult.data.period : null
	const attendanceSnapshots = attendanceResult.success
		? attendanceResult.data
		: []
	const attendanceByProfileId = new Map(
		attendanceSnapshots.map(item => [item.caddieProfileId, item]),
	)
	const dispatchSummary = buildCaddieDispatchSummary(assignments)
	const todayAssignments = assignments.filter(
		assignment =>
			dayKey(assignment.scheduledAt) === dayKey(new Date().toISOString()) &&
			assignment.status !== 'cancelled',
	)
	const todayAssignedProfileIds = new Set(
		todayAssignments.map(assignment => assignment.caddieProfileId),
	)
	const todayAssignedProfiles = allProfiles.filter(profile =>
		todayAssignedProfileIds.has(profile.id),
	)

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
							<BreadcrumbPage>キャディ管理</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
					<div>
						<h1 className='text-2xl font-semibold'>キャディ管理</h1>
						<p className='text-sm text-muted-foreground'>
							キャディのプロフィール、ラウンド割当、勤怠、給与CSV、推奨割当を確認します。
						</p>
					</div>
					<div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
						<Badge variant='outline'>ゴルフアプリ</Badge>
						<Button asChild size='sm' variant='outline'>
							<Link href={`/${tenant}/reservations` as Route}>
								<CalendarCheckIcon className='mr-2 h-4 w-4' aria-hidden />
								予約確認
							</Link>
						</Button>
						<Button asChild size='sm' variant='outline'>
							<Link
								href={`/${tenant}${golfCourseAdminPaths.settlement}` as Route}
							>
								<FileTextIcon className='mr-2 h-4 w-4' aria-hidden />
								月次精算
							</Link>
						</Button>
						<Button asChild size='sm'>
							<Link href={`/${tenant}/reports/sales?preset=7d` as Route}>
								<FileTextIcon className='mr-2 h-4 w-4' aria-hidden />
								売上レポート
							</Link>
						</Button>
					</div>
				</div>

				<HelpPanel
					storageKey='golf-caddie-payroll'
					title='給与連携の範囲'
					summary='給与計算は対象外です。給与SaaSへ渡すCSVを出力します。'
					sections={[
						{
							title: 'この画面で行うこと',
							content:
								'TACHYON Field は給与、税、社会保険を計算しません。勤務時間とキャディ費用を月次サマリーとCSVで給与SaaSへ引き渡します。',
						},
					]}
				/>

				<Card>
					<CardHeader className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
						<div>
							<CardTitle>月次勤怠・給与CSV</CardTitle>
							<CardDescription>
								{payrollPeriod
									? `${payrollPeriod.startDate} – ${payrollPeriod.endDate}`
									: '月を選択して勤務時間と給与連携データを確認します。'}
							</CardDescription>
						</div>
						<CaddiePayrollExportButton tenant={tenant} yearMonth={yearMonth} />
					</CardHeader>
					<CardContent className='grid gap-4'>
						<form
							className='flex flex-wrap items-end gap-3'
							action={`/${tenant}${golfCourseAdminPaths.caddies}`}
						>
							<div className='grid gap-2'>
								<Label htmlFor='yearMonth'>対象月</Label>
								<Input
									id='yearMonth'
									name='yearMonth'
									type='month'
									defaultValue={yearMonth}
									className='w-[180px]'
								/>
							</div>
							<Button type='submit' size='sm' variant='secondary'>
								適用
							</Button>
						</form>
						{payrollResult.success ? (
							<PayrollSummaryTable rows={payrollRows} />
						) : (
							<p className='text-sm text-destructive'>
								{payrollResult.message ?? 'Payroll summary is unavailable.'}
							</p>
						)}
					</CardContent>
				</Card>

				<div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-6'>
					<SummaryCard title='稼働キャディ' value={profiles.length} />
					<SummaryCard
						title='割当済みラウンド'
						value={
							assignments.filter(item => item.status === 'assigned').length
						}
					/>
					<SummaryCard title='本日配車' value={dispatchSummary.today} />
					<SummaryCard title='未確認' value={dispatchSummary.unconfirmed} />
					<SummaryCard title='キャンセル' value={dispatchSummary.cancelled} />
					<SummaryCard title='推奨候補' value={recommendations.length} />
				</div>

				<CaddieSupplyCard tenant={tenant} />

				<Card>
					<CardHeader>
						<CardTitle>キャディ自動配置</CardTitle>
						<CardDescription>
							希望休・体調・2ラウンド可否・月間契約ラウンドの残数を考慮して、未割当のキャディ付き予約に自動で割り当てます。プレビューで内容を確認してから実行してください。
						</CardDescription>
					</CardHeader>
					<CardContent>
						<CaddieAutoAssign tenant={tenant} />
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>当日配車チェック</CardTitle>
						<CardDescription>
							現場担当者向けに、本日のキャディ割当、確認待ち、キャンセル、給与CSV対象金額を確認します。
						</CardDescription>
					</CardHeader>
					<CardContent className='grid gap-3 sm:grid-cols-3'>
						<DispatchMetric
							label='本日割当'
							value={dispatchSummary.todayAssigned}
							hint='本日ボードに表示されるキャディ付きラウンド'
						/>
						<DispatchMetric
							label='確認待ち'
							value={dispatchSummary.needsCheck}
							hint='未確認、欠勤、キャンセルの確認対象'
						/>
						<DispatchMetric
							label='費用合計'
							value={yen.format(dispatchSummary.todayFeeAmount)}
							hint='給与CSVに渡すキャディ費用'
						/>
					</CardContent>
				</Card>

				{unlinkedCount > 0 ? (
					<Card className='border-amber-500/40 bg-amber-500/5'>
						<CardContent className='py-4 text-sm'>
							<p className='font-medium'>
								スタッフ未紐付けのキャディプロフィールが {unlinkedCount}{' '}
								件あります。
							</p>
							<p className='mt-1 text-muted-foreground'>
								勤怠と給与CSVでスタッフを解決できるように、下の一覧から紐付けてください。
							</p>
							{linkFilter !== 'unlinked' ? (
								<Button asChild variant='link' className='mt-2 h-auto px-0'>
									<Link
										href={buildCaddiePageHref(tenant, {
											yearMonth,
											linkFilter: 'unlinked',
											statusFilter,
											skillFilter,
										})}
									>
										未紐付けのみ表示
									</Link>
								</Button>
							) : null}
						</CardContent>
					</Card>
				) : null}

				<div className='grid gap-4 xl:grid-cols-[1fr_360px]'>
					<Card>
						<CardHeader className='gap-3'>
							<div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
								<CardTitle>キャディプロフィール</CardTitle>
								<div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
									<CaddieCreateForm
										tenant={tenant}
										staffOptions={staffOptions}
									/>
								</div>
							</div>
							<CaddieProfileFilters
								tenant={tenant}
								yearMonth={yearMonth}
								linkFilter={linkFilter}
								statusFilter={statusFilter}
								skillFilter={skillFilter}
							/>
							<CardDescription>
								{profiles.length} 件表示
								{profiles.length !== allProfiles.length
									? ` / 全${allProfiles.length}件`
									: ''}
							</CardDescription>
						</CardHeader>
						<CardContent>
							{profilesResult.success ? (
								<ProfileTable
									profiles={profiles}
									tenant={tenant}
									staffOptions={staffOptions}
									staffOptionsError={
										staffOptionsResult.success
											? null
											: staffOptionsResult.message
									}
									attendanceByProfileId={attendanceByProfileId}
								/>
							) : (
								<p className='text-sm text-destructive'>
									{profilesResult.message}
								</p>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle className='flex items-center gap-2'>
								<StarIcon className='h-4 w-4' />
								推奨割当
							</CardTitle>
						</CardHeader>
						<CardContent className='grid gap-3'>
							{recommendationsResult.success ? (
								<RecommendationList recommendations={recommendations} />
							) : (
								<p className='text-sm text-destructive'>
									{recommendationsResult.message}
								</p>
							)}
						</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>本日出勤チェックリスト</CardTitle>
						<CardDescription>
							本日の割当キャディの出勤状態を確認します。
						</CardDescription>
					</CardHeader>
					<CardContent>
						<TodayAttendanceChecklist
							profiles={todayAssignedProfiles}
							attendanceByProfileId={attendanceByProfileId}
						/>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>ラウンド割当</CardTitle>
					</CardHeader>
					<CardContent>
						{assignmentsResult.success ? (
							<AssignmentTable tenant={tenant} assignments={assignments} />
						) : (
							<p className='text-sm text-destructive'>
								{assignmentsResult.message}
							</p>
						)}
					</CardContent>
				</Card>
			</MainLayout>
		</V1Layout>
	)
}

function SummaryCard({ title, value }: { title: string; value: number }) {
	return (
		<Card>
			<CardContent className='flex items-center justify-between p-4'>
				<div>
					<p className='text-sm text-muted-foreground'>{title}</p>
					<p className='text-2xl font-semibold'>{value}</p>
				</div>
				<UsersIcon className='h-5 w-5 text-muted-foreground' />
			</CardContent>
		</Card>
	)
}

function PayrollSummaryTable({ rows }: { rows: CaddiePayrollSummaryRow[] }) {
	if (rows.length === 0) {
		return (
			<p className='text-sm text-muted-foreground'>
				この期間のキャディプロフィールはありません。
			</p>
		)
	}
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>キャディ</TableHead>
					<TableHead>スタッフ</TableHead>
					<TableHead className='text-right'>勤務</TableHead>
					<TableHead className='text-right'>シフト</TableHead>
					<TableHead className='text-right'>ラウンド</TableHead>
					<TableHead className='text-right'>費用</TableHead>
					<TableHead>確認</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map(row => (
					<TableRow key={row.caddieProfileId}>
						<TableCell>
							<p className='font-medium'>{row.displayName}</p>
							<p className='text-xs text-muted-foreground'>
								{row.caddieProfileId}
							</p>
						</TableCell>
						<TableCell className='text-sm'>
							{row.staffId ?? '未紐付け'}
						</TableCell>
						<TableCell className='text-right'>
							{formatMinutes(row.workedMinutes)}
						</TableCell>
						<TableCell className='text-right'>
							{formatMinutes(row.shiftedMinutes)}
						</TableCell>
						<TableCell className='text-right'>{row.assignedRounds}</TableCell>
						<TableCell className='text-right'>
							{yen.format(row.confirmedFeeTotal)}
						</TableCell>
						<TableCell className='text-xs'>
							{row.openClockIn ? (
								<p className='text-destructive'>退勤未登録</p>
							) : null}
							{row.roundsWithoutClockIn > 0 ? (
								<p className='text-destructive'>
									打刻なしラウンド {row.roundsWithoutClockIn} 件
								</p>
							) : (
								<p className='text-muted-foreground'>OK</p>
							)}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	)
}

function buildCaddiePageHref(
	tenant: string,
	query: {
		yearMonth: string
		linkFilter?: CaddieLinkFilter
		statusFilter?: CaddieEmploymentStatusFilter
		skillFilter?: CaddieSkillFilter
	},
): Route {
	const params = new URLSearchParams()
	params.set('yearMonth', query.yearMonth)
	if (query.linkFilter && query.linkFilter !== 'all') {
		params.set('linkFilter', query.linkFilter)
	}
	if (query.statusFilter && query.statusFilter !== 'all') {
		params.set('status', query.statusFilter)
	}
	if (query.skillFilter && query.skillFilter !== 'all') {
		params.set('skill', query.skillFilter)
	}
	const suffix = params.toString()
	return `/${tenant}${golfCourseAdminPaths.caddies}${suffix ? `?${suffix}` : ''}` as Route
}

function CaddieProfileFilters({
	tenant,
	yearMonth,
	linkFilter,
	statusFilter,
	skillFilter,
}: {
	tenant: string
	yearMonth: string
	linkFilter: CaddieLinkFilter
	statusFilter: CaddieEmploymentStatusFilter
	skillFilter: CaddieSkillFilter
}) {
	const linkFilters: Array<{ value: CaddieLinkFilter; label: string }> = [
		{ value: 'all', label: 'すべて' },
		{ value: 'linked', label: '紐付け済み' },
		{ value: 'unlinked', label: '未紐付け' },
	]
	const statusFilters: Array<{
		value: CaddieEmploymentStatusFilter
		label: string
	}> = [
		{ value: 'all', label: '全員' },
		{ value: 'active', label: '稼働中' },
		{ value: 'inactive', label: '休止' },
		{ value: 'suspended', label: '停止' },
	]
	const skillFilters: Array<{ value: CaddieSkillFilter; label: string }> = [
		{ value: 'all', label: '全員' },
		{ value: 'rookie', label: 'Rookie' },
		{ value: 'regular', label: 'Regular' },
		{ value: 'veteran', label: 'Veteran' },
	]
	return (
		<div className='grid gap-3 rounded-md border bg-muted/30 p-3 lg:grid-cols-3'>
			<FilterButtonGroup label='スタッフ' className='lg:col-span-1'>
				{linkFilters.map(filter => (
					<Button
						key={filter.value}
						asChild
						size='sm'
						variant={linkFilter === filter.value ? 'default' : 'outline'}
					>
						<Link
							href={buildCaddiePageHref(tenant, {
								yearMonth,
								linkFilter: filter.value,
								statusFilter,
								skillFilter,
							})}
						>
							{filter.label}
						</Link>
					</Button>
				))}
			</FilterButtonGroup>
			<FilterButtonGroup label='雇用状態'>
				{statusFilters.map(filter => (
					<Button
						key={filter.value}
						asChild
						size='sm'
						variant={statusFilter === filter.value ? 'default' : 'outline'}
					>
						<Link
							href={buildCaddiePageHref(tenant, {
								yearMonth,
								linkFilter,
								statusFilter: filter.value,
								skillFilter,
							})}
						>
							{filter.label}
						</Link>
					</Button>
				))}
			</FilterButtonGroup>
			<FilterButtonGroup label='スキル'>
				{skillFilters.map(filter => (
					<Button
						key={filter.value}
						asChild
						size='sm'
						variant={skillFilter === filter.value ? 'default' : 'outline'}
					>
						<Link
							href={buildCaddiePageHref(tenant, {
								yearMonth,
								linkFilter,
								statusFilter,
								skillFilter: filter.value,
							})}
						>
							{filter.label}
						</Link>
					</Button>
				))}
			</FilterButtonGroup>
		</div>
	)
}

function FilterButtonGroup({
	children,
	className,
	label,
}: {
	children: ReactNode
	className?: string
	label: string
}) {
	return (
		<div className={className}>
			<p className='mb-2 text-xs font-medium text-muted-foreground'>{label}</p>
			<div className='flex flex-wrap gap-2'>{children}</div>
		</div>
	)
}

function ProfileTable({
	profiles,
	tenant,
	staffOptions,
	staffOptionsError,
	attendanceByProfileId,
}: {
	profiles: CaddieProfile[]
	tenant: string
	staffOptions: StaffMemberOption[]
	staffOptionsError: string | null
	attendanceByProfileId: Map<string, CaddieAttendanceSnapshot>
}) {
	return (
		<>
			{profiles.length === 0 ? (
				<div className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground md:hidden'>
					キャディプロフィールはまだ登録されていません。
				</div>
			) : null}
			<div className='grid gap-3 md:hidden'>
				{profiles.map(profile => (
					<div key={profile.id} className='rounded-lg border bg-background p-4'>
						<div className='flex items-start justify-between gap-3'>
							<div className='min-w-0'>
								<Link
									href={
										`/${tenant}/extensions/golf-course/caddies/${profile.id}` as Route
									}
									className='font-medium text-primary underline-offset-4 hover:underline'
								>
									{profile.displayName}
								</Link>
								<p className='break-all text-xs text-muted-foreground'>
									{profile.id}
								</p>
							</div>
							<Badge variant='outline'>
								{skillLabels[profile.skillLevel] ?? profile.skillLevel}
							</Badge>
						</div>
						<div className='mt-3 grid grid-cols-2 gap-3 text-sm'>
							<div>
								<p className='text-xs text-muted-foreground'>スタッフ</p>
								<p>{profile.staffReferenceType}</p>
								{profile.staffReferenceId ? (
									<p className='break-all text-xs text-muted-foreground'>
										{profile.staffReferenceId}
									</p>
								) : null}
							</div>
							<div>
								<p className='text-xs text-muted-foreground'>評価</p>
								<p>
									{profile.ratingAverage
										? `${profile.ratingAverage.toFixed(1)} / ${profile.ratingCount}`
										: `No ratings / ${profile.ratingCount}`}
								</p>
							</div>
							<div>
								<p className='text-xs text-muted-foreground'>基本費用</p>
								<p className='font-medium'>
									{yen.format(profile.baseFeeAmount)}
								</p>
							</div>
							<div>
								<p className='text-xs text-muted-foreground'>日次上限</p>
								<p>{profile.maxRoundsPerDay} ラウンド</p>
							</div>
						</div>
						<div className='mt-3'>
							<p className='mb-2 text-xs text-muted-foreground'>
								スタッフ紐付け
							</p>
							<CaddieStaffLinkControls
								tenant={tenant}
								profile={profile}
								staffOptions={staffOptions}
							/>
							{staffOptionsError ? (
								<p className='mt-1 text-xs text-destructive'>
									{staffOptionsError}
								</p>
							) : null}
						</div>
						<CaddieAttendanceControls
							tenant={tenant}
							snapshot={attendanceByProfileId.get(profile.id)}
						/>
					</div>
				))}
			</div>
			<Table className='hidden md:table'>
				<TableHeader>
					<TableRow>
						<TableHead>名前</TableHead>
						<TableHead>スキル</TableHead>
						<TableHead>スタッフ紐付け</TableHead>
						<TableHead>本日勤怠</TableHead>
						<TableHead>評価</TableHead>
						<TableHead className='text-right'>基本費用</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{profiles.length === 0 ? (
						<TableRow>
							<TableCell colSpan={6} className='h-20 text-center'>
								キャディプロフィールはまだ登録されていません。
							</TableCell>
						</TableRow>
					) : null}
					{profiles.map(profile => (
						<TableRow key={profile.id}>
							<TableCell>
								<Link
									href={
										`/${tenant}/extensions/golf-course/caddies/${profile.id}` as Route
									}
									className='font-medium text-primary underline-offset-4 hover:underline'
								>
									{profile.displayName}
								</Link>
								<p className='text-xs text-muted-foreground'>{profile.id}</p>
							</TableCell>
							<TableCell>
								<Badge variant='outline'>
									{skillLabels[profile.skillLevel] ?? profile.skillLevel}
								</Badge>
							</TableCell>
							<TableCell className='min-w-[200px]'>
								<CaddieStaffLinkControls
									tenant={tenant}
									profile={profile}
									staffOptions={staffOptions}
								/>
								{staffOptionsError ? (
									<p className='mt-1 text-xs text-destructive'>
										{staffOptionsError}
									</p>
								) : null}
							</TableCell>
							<TableCell>
								<CaddieAttendanceControls
									tenant={tenant}
									snapshot={attendanceByProfileId.get(profile.id)}
								/>
							</TableCell>
							<TableCell>
								{profile.ratingAverage
									? `${profile.ratingAverage.toFixed(1)} / ${profile.ratingCount}`
									: `No ratings / ${profile.ratingCount}`}
							</TableCell>
							<TableCell className='text-right'>
								{yen.format(profile.baseFeeAmount)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</>
	)
}

function RecommendationList({
	recommendations,
}: {
	recommendations: CaddieRecommendation[]
}) {
	if (recommendations.length === 0) {
		return <p className='text-sm text-muted-foreground'>候補はありません。</p>
	}
	return recommendations.map(item => (
		<div key={item.caddieProfileId} className='rounded-md border p-3'>
			<div className='flex items-start justify-between gap-3'>
				<div>
					<p className='font-medium'>{item.displayName}</p>
					<p className='text-xs text-muted-foreground'>
						{skillLabels[item.skillLevel] ?? item.skillLevel} / score{' '}
						{item.recommendationScore}
					</p>
				</div>
				<Badge>{item.recommendedRole}</Badge>
			</div>
			{item.pairingDisplayName ? (
				<p className='mt-2 text-sm'>{item.pairingDisplayName} とペア</p>
			) : null}
			<p className='mt-2 text-xs text-muted-foreground'>
				{item.rationale.slice(0, 2).join(' / ')}
			</p>
		</div>
	))
}

function AssignmentTable({
	assignments,
	tenant,
}: {
	assignments: CaddieAssignment[]
	tenant: string
}) {
	return (
		<>
			{assignments.length === 0 ? (
				<div className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground md:hidden'>
					キャディ割当はまだ登録されていません。
				</div>
			) : null}
			<div className='grid gap-3 md:hidden'>
				{assignments.map(assignment => (
					<div
						key={assignment.id}
						className='rounded-lg border bg-background p-4'
					>
						<div className='flex items-start justify-between gap-3'>
							<div className='min-w-0'>
								<p className='font-medium'>
									{assignment.roundReference ??
										assignment.reservationId ??
										assignment.id}
								</p>
								<p className='break-all text-xs text-muted-foreground'>
									{assignment.id}
								</p>
							</div>
							<Badge variant='outline'>{assignment.status}</Badge>
						</div>
						<div className='mt-3 grid grid-cols-2 gap-3 text-sm'>
							<div>
								<p className='text-xs text-muted-foreground'>キャディ</p>
								<p className='break-all'>{assignment.caddieProfileId}</p>
							</div>
							<div>
								<p className='text-xs text-muted-foreground'>予定</p>
								<p>{formatSchedule(assignment.scheduledAt)}</p>
							</div>
							<div>
								<p className='text-xs text-muted-foreground'>役割</p>
								<p>{assignment.assignmentRole}</p>
							</div>
							<div>
								<p className='text-xs text-muted-foreground'>費用</p>
								<p className='font-medium'>
									{yen.format(assignment.feeAmount)}
								</p>
							</div>
						</div>
						{assignment.nominatedBy ? (
							<p className='mt-3 text-xs text-muted-foreground'>
								指名: {assignment.nominatedBy}
							</p>
						) : null}
						<AssignmentStatusActions
							tenant={tenant}
							assignment={assignment}
							className='mt-3'
						/>
					</div>
				))}
			</div>
			<Table className='hidden md:table'>
				<TableHeader>
					<TableRow>
						<TableHead>ラウンド</TableHead>
						<TableHead>キャディ</TableHead>
						<TableHead>予定</TableHead>
						<TableHead>役割</TableHead>
						<TableHead>状態</TableHead>
						<TableHead className='text-right'>費用</TableHead>
						<TableHead className='text-right'>操作</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{assignments.length === 0 ? (
						<TableRow>
							<TableCell colSpan={7} className='h-20 text-center'>
								キャディ割当はまだ登録されていません。
							</TableCell>
						</TableRow>
					) : null}
					{assignments.map(assignment => (
						<TableRow key={assignment.id}>
							<TableCell>
								{assignment.roundReference ??
									assignment.reservationId ??
									assignment.id}
							</TableCell>
							<TableCell>{assignment.caddieProfileId}</TableCell>
							<TableCell>{formatSchedule(assignment.scheduledAt)}</TableCell>
							<TableCell>
								<div>
									<p>{assignment.assignmentRole}</p>
									{assignment.nominatedBy ? (
										<p className='text-xs text-muted-foreground'>
											指名: {assignment.nominatedBy}
										</p>
									) : null}
								</div>
							</TableCell>
							<TableCell>
								<Badge variant='outline'>{assignment.status}</Badge>
							</TableCell>
							<TableCell className='text-right'>
								{yen.format(assignment.feeAmount)}
							</TableCell>
							<TableCell className='text-right'>
								<AssignmentStatusActions
									tenant={tenant}
									assignment={assignment}
									align='end'
								/>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</>
	)
}

function AssignmentStatusActions({
	align = 'start',
	assignment,
	className,
	tenant,
}: {
	align?: 'start' | 'end'
	assignment: CaddieAssignment
	className?: string
	tenant: string
}) {
	if (assignment.status !== 'assigned') {
		return null
	}
	const justify = align === 'end' ? 'justify-end' : 'justify-start'
	return (
		<div className={`flex flex-wrap gap-2 ${justify} ${className ?? ''}`}>
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

function TodayAttendanceChecklist({
	attendanceByProfileId,
	profiles,
}: {
	attendanceByProfileId: Map<string, CaddieAttendanceSnapshot>
	profiles: CaddieProfile[]
}) {
	if (profiles.length === 0) {
		return (
			<p className='text-sm text-muted-foreground'>
				本日割当のキャディはありません。
			</p>
		)
	}
	return (
		<div className='overflow-x-auto'>
			<Table className='min-w-[640px]'>
				<TableHeader>
					<TableRow>
						<TableHead>キャディ</TableHead>
						<TableHead>スタッフ</TableHead>
						<TableHead>出勤状態</TableHead>
						<TableHead className='text-right'>本日割当</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{profiles.map(profile => {
						const snapshot = attendanceByProfileId.get(profile.id)
						const state = resolveAttendanceState(snapshot)
						const StateIcon = state.icon
						return (
							<TableRow key={profile.id}>
								<TableCell>
									<p className='font-medium'>{profile.displayName}</p>
									<p className='text-xs text-muted-foreground'>{profile.id}</p>
								</TableCell>
								<TableCell>
									{profile.staffReferenceId ?? profile.staffId ?? '未紐付け'}
								</TableCell>
								<TableCell>
									<div
										className={`inline-flex items-center gap-2 ${state.color}`}
									>
										<StateIcon className='h-4 w-4' aria-hidden />
										<span className='text-sm font-medium'>{state.label}</span>
									</div>
								</TableCell>
								<TableCell className='text-right'>
									{snapshot?.todayAssignments ?? 0}
								</TableCell>
							</TableRow>
						)
					})}
				</TableBody>
			</Table>
		</div>
	)
}

function resolveAttendanceState(snapshot?: CaddieAttendanceSnapshot) {
	if (snapshot?.attendanceStatus === 'working') {
		return {
			color: 'text-emerald-700',
			icon: CheckCircleIcon,
			label: '出勤済み',
		}
	}
	if (snapshot?.attendanceStatus === 'clocked_out') {
		return {
			color: 'text-muted-foreground',
			icon: XCircleIcon,
			label: '退勤済み',
		}
	}
	return {
		color: 'text-amber-700',
		icon: ClockIcon,
		label: '未出勤',
	}
}

function DispatchMetric({
	label,
	value,
	hint,
}: {
	label: string
	value: number | string
	hint: string
}) {
	return (
		<div className='rounded-md border bg-background p-3'>
			<p className='text-xs font-medium text-muted-foreground'>{label}</p>
			<p className='mt-1 text-2xl font-semibold'>{value}</p>
			<p className='mt-1 text-xs text-muted-foreground'>{hint}</p>
		</div>
	)
}

function formatSchedule(value: string): string {
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP')
}

function dayKey(value: string): string {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		return value.slice(0, 10)
	}
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
		2,
		'0',
	)}-${String(date.getDate()).padStart(2, '0')}`
}

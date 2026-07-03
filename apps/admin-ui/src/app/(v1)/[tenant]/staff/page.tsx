import { Badge } from 'components/ui/badge'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'components/ui/tabs'
import { Textarea } from 'components/ui/textarea'
import { MainLayout, V1Layout } from 'components/v1-layout'
import type { Route } from 'next'
import Link from 'next/link'
import {
	clockInStaffAction,
	clockOutStaffAction,
	createStaffMemberAction,
	createStaffLeaveRequestAction,
	createStaffShiftAction,
	decideStaffLeaveRequestAction,
	fetchStaffCompensationProfileAction,
	fetchStaffLeaveRequestsAction,
	fetchStaffMembersAction,
	fetchStaffPayrollEstimateAction,
	fetchStaffShiftsAction,
	fetchStaffShiftPreferenceAction,
	fetchStaffSkillProfileAction,
	fetchStaffUtilizationAction,
	type StaffCompensationProfileData,
	type StaffLeaveRequestData,
	type StaffMemberData,
	type StaffPayrollEstimateData,
	type StaffShiftData,
	type StaffShiftPreferenceData,
	type StaffSkillProfileData,
	type StaffUtilizationData,
	updateStaffCompensationProfileAction,
	updateStaffShiftPreferenceAction,
	updateStaffSkillProfileAction,
} from './action'

const employmentLabels: Record<string, string> = {
	full_time: '常勤',
	part_time: 'パート',
	contract: '外部委託',
}

const weekdayOptions = [
	{ value: 'mon', label: '月' },
	{ value: 'tue', label: '火' },
	{ value: 'wed', label: '水' },
	{ value: 'thu', label: '木' },
	{ value: 'fri', label: '金' },
	{ value: 'sat', label: '土' },
	{ value: 'sun', label: '日' },
]

const timeBandLabels: Record<string, string> = {
	any: '指定なし',
	morning: '午前中心',
	afternoon: '午後中心',
	evening: '夕方以降',
}

const leaveTypeLabels: Record<StaffLeaveRequestData['requestType'], string> = {
	day_off: '休み希望',
	paid_leave: '有休',
	unavailable: '不可日',
}

const leaveStatusLabels: Record<StaffLeaveRequestData['status'], string> = {
	requested: '申請中',
	approved: '承認',
	rejected: '却下',
	cancelled: '取消',
}

const shiftTypeStyles: Record<string, string> = {
	regular: 'border-blue-200 bg-blue-50 text-blue-700',
	special: 'border-amber-200 bg-amber-50 text-amber-700',
	off: 'border-slate-200 bg-slate-100 text-slate-600',
}

const staffStatusOptions = [
	{ value: 'all', label: 'すべて' },
	{ value: 'active', label: '稼働中' },
	{ value: 'ended', label: '契約終了' },
	{ value: 'inactive', label: '停止' },
]

function minutesLabel(minutes: number) {
	const hours = Math.floor(minutes / 60)
	const rest = minutes % 60
	return `${hours}h ${rest}m`
}

function todayIsoDate() {
	return new Date().toISOString().slice(0, 10)
}

function isContractEnded(member: StaffMemberData, today = todayIsoDate()) {
	return Boolean(member.contractEndDate && member.contractEndDate <= today)
}

function employmentPeriodLabel(member: StaffMemberData) {
	const start = member.hiredAt ?? '未設定'
	const end = member.contractEndDate ?? '継続中'
	return `${start} 〜 ${end}`
}

function normalizeMonth(value?: string) {
	const now = new Date()
	const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
	return /^\d{4}-\d{2}$/.test(value ?? '') ? value! : fallback
}

function addMonths(month: string, amount: number) {
	const [year, monthIndex] = month.split('-').map(Number)
	const date = new Date(year, monthIndex - 1 + amount, 1)
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthHref(tenant: string, month: string, staffId: string) {
	const params = new URLSearchParams({ staffId, month })
	return `/${tenant}/hrm/staff?${params.toString()}` as Route
}

export default async function StaffPage({
	params: { tenant },
	searchParams,
}: {
	params: { tenant: string }
	searchParams?: {
		staffId?: string
		q?: string
		employmentType?: string
		status?: string
		month?: string
	}
}) {
	const staffResult = await fetchStaffMembersAction(tenant)
	const staff = staffResult.success ? staffResult.data : []
	const searchQuery = (searchParams?.q ?? '').trim().toLowerCase()
	const employmentTypeFilter = searchParams?.employmentType ?? 'all'
	const statusFilter = searchParams?.status ?? 'all'
	const today = todayIsoDate()
	const filteredStaff = staff.filter(member => {
		const matchesName =
			searchQuery.length === 0 ||
			member.name.toLowerCase().includes(searchQuery) ||
			member.id.toLowerCase().includes(searchQuery)
		const matchesEmployment =
			employmentTypeFilter === 'all' ||
			member.employmentType === employmentTypeFilter
		const ended = isContractEnded(member, today)
		const matchesStatus =
			statusFilter === 'all' ||
			(statusFilter === 'active' && member.active && !ended) ||
			(statusFilter === 'ended' && ended) ||
			(statusFilter === 'inactive' && !member.active)
		return matchesName && matchesEmployment && matchesStatus
	})
	const selected =
		staff.find(member => member.id === searchParams?.staffId) ??
		filteredStaff[0] ??
		staff[0]
	const preferenceResults = await Promise.all(
		staff.map(member => fetchStaffShiftPreferenceAction(tenant, member.id)),
	)
	const preferencesByStaffId = new Map(
		staff.map((member, index) => {
			const result = preferenceResults[index]
			return [
				member.id,
				result?.success && result.data ? result.data : ({} as StaffShiftPreferenceData),
			]
		}),
	)
	const [
		shiftsResult,
		utilizationResult,
		leaveRequestsResult,
		skillProfileResult,
		compensationProfileResult,
		payrollEstimateResult,
	] = selected
		? await Promise.all([
				fetchStaffShiftsAction(tenant, selected.id),
				fetchStaffUtilizationAction(tenant, selected.id, 'week'),
				fetchStaffLeaveRequestsAction(tenant, selected.id),
				fetchStaffSkillProfileAction(tenant, selected.id),
				fetchStaffCompensationProfileAction(tenant, selected.id),
				fetchStaffPayrollEstimateAction(tenant, selected.id, 'month'),
			])
		: [null, null, null, null, null, null]
	const shifts = shiftsResult?.success ? shiftsResult.data : []
	const utilization = utilizationResult?.success ? utilizationResult.data : null
	const leaveRequests = leaveRequestsResult?.success ? leaveRequestsResult.data : []
	const skillProfile = skillProfileResult?.success ? skillProfileResult.data : null
	const compensationProfile = compensationProfileResult?.success
		? compensationProfileResult.data
		: null
	const payrollEstimate = payrollEstimateResult?.success
		? payrollEstimateResult.data
		: null

	return (
		<V1Layout current='hrm-staff' tenant={tenant}>
			<MainLayout>
				<div className='flex flex-wrap items-center justify-between gap-3'>
					<div>
						<h1 className='text-2xl font-semibold'>スタッフ管理</h1>
					</div>
				</div>

				{staffResult.success ? null : (
					<p className='text-sm text-destructive'>
						{staffResult.message ?? 'スタッフ一覧を取得できませんでした'}
					</p>
				)}

				<div className='grid gap-4 xl:grid-cols-[1fr_380px]'>
					<Card>
						<CardHeader>
							<CardTitle>スタッフ一覧</CardTitle>
							<CardDescription>
								シフト、勤務希望、出退勤を確認するスタッフを選択します。
							</CardDescription>
						</CardHeader>
						<CardContent>
							<StaffTable
								staff={filteredStaff}
								totalStaffCount={staff.length}
								tenant={tenant}
								selectedStaffId={selected?.id}
								preferencesByStaffId={preferencesByStaffId}
								searchQuery={searchParams?.q ?? ''}
								employmentTypeFilter={employmentTypeFilter}
								statusFilter={statusFilter}
							/>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>スタッフ登録</CardTitle>
						</CardHeader>
						<CardContent>
							<form
								className='grid gap-3'
								action={async formData => {
									'use server'
									await createStaffMemberAction(tenant, formData)
								}}
							>
								<div className='grid gap-2'>
									<Label htmlFor='name'>氏名</Label>
									<Input id='name' name='name' required />
								</div>
								<div className='grid gap-2'>
									<Label htmlFor='employmentType'>雇用形態</Label>
									<Select name='employmentType' defaultValue='part_time'>
										<SelectTrigger id='employmentType'>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value='full_time'>常勤</SelectItem>
											<SelectItem value='part_time'>パート</SelectItem>
											<SelectItem value='contract'>外部委託</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className='grid grid-cols-2 gap-3'>
									<div className='grid gap-2'>
										<Label htmlFor='hiredAt'>入社日</Label>
										<Input id='hiredAt' name='hiredAt' type='date' />
									</div>
									<div className='grid gap-2'>
										<Label htmlFor='contractEndDate'>契約終了日</Label>
										<Input
											id='contractEndDate'
											name='contractEndDate'
											type='date'
										/>
									</div>
								</div>
								<div className='grid gap-2'>
									<Label htmlFor='phone'>電話</Label>
									<Input id='phone' name='phone' type='tel' />
								</div>
								<div className='grid gap-2'>
									<Label htmlFor='email'>メール</Label>
									<Input id='email' name='email' type='email' />
								</div>
								<Button type='submit'>登録</Button>
							</form>
						</CardContent>
					</Card>
				</div>

				<StaffDetailTabs
					compensationProfile={compensationProfile}
					leaveRequests={leaveRequests}
					month={normalizeMonth(searchParams?.month)}
					payrollEstimate={payrollEstimate}
					preference={
						selected
							? (preferencesByStaffId.get(selected.id) ??
								({} as StaffShiftPreferenceData))
							: ({} as StaffShiftPreferenceData)
					}
					shifts={shifts}
					skillProfile={skillProfile}
					staff={selected}
					tenant={tenant}
					utilization={utilization}
				/>
			</MainLayout>
		</V1Layout>
	)
}

function StaffDetailTabs({
	compensationProfile,
	leaveRequests,
	month,
	payrollEstimate,
	preference,
	shifts,
	skillProfile,
	staff,
	tenant,
	utilization,
}: {
	compensationProfile: StaffCompensationProfileData | null
	leaveRequests: StaffLeaveRequestData[]
	month: string
	payrollEstimate: StaffPayrollEstimateData | null
	preference: StaffShiftPreferenceData
	shifts: StaffShiftData[]
	skillProfile: StaffSkillProfileData | null
	staff?: StaffMemberData
	tenant: string
	utilization: StaffUtilizationData | null
}) {
	if (!staff) {
		return (
			<Card>
				<CardContent className='py-8 text-sm text-muted-foreground'>
					スタッフを登録してください。
				</CardContent>
			</Card>
		)
	}

	return (
		<Tabs defaultValue='basic' className='grid gap-4'>
			<div className='min-w-0 overflow-x-auto'>
				<TabsList className='w-max'>
					<TabsTrigger value='basic'>基本情報</TabsTrigger>
					<TabsTrigger value='shifts'>シフト</TabsTrigger>
					<TabsTrigger value='attendance'>勤怠</TabsTrigger>
					<TabsTrigger value='leave'>休暇</TabsTrigger>
				</TabsList>
			</div>
			<TabsContent value='basic'>
				<div className='grid gap-4 xl:grid-cols-[1fr_380px]'>
					<Card>
						<CardHeader>
							<CardTitle>基本情報</CardTitle>
						</CardHeader>
						<CardContent>
							<StaffBasicInfo staff={staff} />
						</CardContent>
					</Card>
					<div className='grid content-start gap-4'>
						<Card>
							<CardHeader>
								<CardTitle>スキル・資格</CardTitle>
							</CardHeader>
							<CardContent>
								<SkillProfileForm
									profile={skillProfile}
									staff={staff}
									tenant={tenant}
								/>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle>報酬設定</CardTitle>
							</CardHeader>
							<CardContent>
								<CompensationForm
									profile={compensationProfile}
									staff={staff}
									tenant={tenant}
								/>
							</CardContent>
						</Card>
					</div>
				</div>
			</TabsContent>
			<TabsContent value='shifts'>
				<div className='grid gap-4 xl:grid-cols-[1fr_380px]'>
					<Card>
						<CardHeader>
							<CardTitle>シフトカレンダー</CardTitle>
							<CardDescription>{staff.name} の予定シフト</CardDescription>
						</CardHeader>
						<CardContent>
							<ShiftCalendar
								month={month}
								shifts={shifts}
								staff={staff}
								tenant={tenant}
							/>
						</CardContent>
					</Card>
					<Card className='content-start'>
						<CardHeader>
							<CardTitle>勤務希望</CardTitle>
							<CardDescription>
								稼働日数、収入目標、休み希望をシフト作成の判断材料として残します。
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ShiftPreferenceForm
								staff={staff}
								tenant={tenant}
								preference={preference}
							/>
						</CardContent>
					</Card>
				</div>
			</TabsContent>
			<TabsContent value='attendance'>
				<div className='grid gap-4 xl:grid-cols-[380px_1fr]'>
					<Card>
						<CardHeader>
							<CardTitle>出退勤</CardTitle>
						</CardHeader>
						<CardContent>
							<AttendancePanel staff={staff} tenant={tenant} />
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>稼働・給与見積</CardTitle>
						</CardHeader>
						<CardContent>
							{utilization ? (
								<UtilizationDashboard
									payrollEstimate={payrollEstimate}
									utilization={utilization}
								/>
							) : (
								<p className='text-sm text-muted-foreground'>
									シフトと打刻が登録されると表示されます。
								</p>
							)}
						</CardContent>
					</Card>
				</div>
			</TabsContent>
			<TabsContent value='leave'>
				<Card>
					<CardHeader>
						<CardTitle>休暇・不可日申請</CardTitle>
						<CardDescription>
							休みたい日、入れない日、有休希望を承認状態まで管理します。
						</CardDescription>
					</CardHeader>
					<CardContent>
						<LeaveRequestsPanel
							leaveRequests={leaveRequests}
							staff={staff}
							tenant={tenant}
						/>
					</CardContent>
				</Card>
			</TabsContent>
		</Tabs>
	)
}

function StaffBasicInfo({ staff }: { staff: StaffMemberData }) {
	const rows = [
		['氏名', staff.name],
		['雇用形態', employmentLabels[staff.employmentType] ?? staff.employmentType],
		['入社日', staff.hiredAt ?? '未設定'],
		['終了日', staff.contractEndDate ?? '継続中'],
		['電話', staff.phone ?? '未設定'],
		['メール', staff.email ?? '未設定'],
	]
	return (
		<div className='grid gap-3 text-sm md:grid-cols-2'>
			{rows.map(([label, value]) => (
				<div key={label} className='rounded-md border p-3'>
					<p className='text-xs text-muted-foreground'>{label}</p>
					<p className='mt-1 font-medium'>{value}</p>
				</div>
			))}
		</div>
	)
}

function StaffTable({
	staff,
	totalStaffCount,
	tenant,
	selectedStaffId,
	preferencesByStaffId,
	searchQuery,
	employmentTypeFilter,
	statusFilter,
}: {
	staff: StaffMemberData[]
	totalStaffCount: number
	tenant: string
	selectedStaffId?: string
	preferencesByStaffId: Map<string, StaffShiftPreferenceData>
	searchQuery: string
	employmentTypeFilter: string
	statusFilter: string
}) {
	return (
		<div className='grid gap-3'>
			<form className='grid gap-2 lg:grid-cols-[1fr_160px_160px_96px]' method='get'>
				<Input
					name='q'
					defaultValue={searchQuery}
					placeholder='氏名で検索'
				/>
				<Select name='employmentType' defaultValue={employmentTypeFilter}>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value='all'>雇用形態すべて</SelectItem>
						<SelectItem value='full_time'>常勤</SelectItem>
						<SelectItem value='part_time'>パート</SelectItem>
						<SelectItem value='contract'>外部委託</SelectItem>
					</SelectContent>
				</Select>
				<Select name='status' defaultValue={statusFilter}>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{staffStatusOptions.map(option => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button type='submit' variant='outline'>
					絞り込み
				</Button>
			</form>
			<p className='text-xs text-muted-foreground'>
				{totalStaffCount}名中 {staff.length}名を表示
			</p>
			<div className='min-w-0 overflow-x-auto'>
				<Table className='min-w-[940px]'>
					<TableHeader>
						<TableRow>
							<TableHead>氏名</TableHead>
							<TableHead>雇用形態</TableHead>
							<TableHead>状態</TableHead>
							<TableHead>契約期間</TableHead>
							<TableHead>勤務希望</TableHead>
							<TableHead>打刻</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{staff.length === 0 ? (
							<TableRow>
								<TableCell colSpan={6} className='h-24 text-center'>
									条件に一致するスタッフはありません。
								</TableCell>
							</TableRow>
						) : null}
						{staff.map(member => {
							const contractEnded = isContractEnded(member)
							return (
								<TableRow
									key={member.id}
									className={
										member.id === selectedStaffId ? 'bg-muted/60' : undefined
									}
								>
									<TableCell>
										<p className='font-medium'>{member.name}</p>
										<p className='text-xs text-muted-foreground'>{member.id}</p>
										<Button
											asChild
											size='sm'
											variant='ghost'
											className='mt-1 h-7 px-2'
										>
											<Link
												href={`/${tenant}/hrm/staff?staffId=${member.id}` as Route}
											>
												選択
											</Link>
										</Button>
									</TableCell>
									<TableCell>
										{employmentLabels[member.employmentType]}
									</TableCell>
									<TableCell>
										<div className='flex flex-wrap gap-1'>
											<Badge variant='outline' className='whitespace-nowrap'>
												{member.active ? '稼働中' : '停止'}
											</Badge>
											{contractEnded ? (
												<Badge
													variant='destructive'
													className='whitespace-nowrap'
												>
													契約終了
												</Badge>
											) : null}
										</div>
									</TableCell>
									<TableCell className='whitespace-nowrap'>
										{employmentPeriodLabel(member)}
									</TableCell>
									<TableCell>
										<PreferenceSummary
											preference={preferencesByStaffId.get(member.id) ?? {}}
										/>
									</TableCell>
									<TableCell>
										<form
											action={async () => {
												'use server'
												await clockInStaffAction(tenant, member.id)
											}}
										>
											<Button type='submit' size='sm' variant='outline'>
												出勤
											</Button>
										</form>
									</TableCell>
								</TableRow>
							)
						})}
					</TableBody>
				</Table>
			</div>
		</div>
	)
}

function PreferenceSummary({
	preference,
}: {
	preference: StaffShiftPreferenceData
}) {
	const chips: string[] = [
		preference.monthlyIncomeTargetYen
			? `月${Number(preference.monthlyIncomeTargetYen).toLocaleString('ja-JP')}円`
			: '',
		preference.desiredWorkDaysPerWeek
			? `週${preference.desiredWorkDaysPerWeek}日`
			: '',
		preference.preferredTimeBand
			? timeBandLabels[preference.preferredTimeBand] ?? preference.preferredTimeBand
			: '',
		(preference.unavailableDates?.length ?? 0) > 0
			? `休み希望${preference.unavailableDates!.length}件`
			: '',
	].filter(chip => chip.length > 0)
	if (chips.length === 0) {
		return <span className='text-sm text-muted-foreground'>未登録</span>
	}
	return (
		<div className='flex flex-wrap gap-1'>
			{chips.map(chip => (
				<Badge key={chip} variant='secondary' className='whitespace-nowrap'>
					{chip}
				</Badge>
			))}
		</div>
	)
}

function ShiftPreferenceForm({
	staff,
	tenant,
	preference,
}: {
	staff: StaffMemberData
	tenant: string
	preference: StaffShiftPreferenceData
}) {
	const preferredDays = new Set(preference.preferredDays ?? [])
	return (
		<form
			className='grid gap-3'
			action={async formData => {
				'use server'
				await updateStaffShiftPreferenceAction(tenant, staff.id, formData)
			}}
		>
			<div className='grid gap-2'>
				<Label htmlFor='monthlyIncomeTargetYen'>月の収入目標</Label>
				<Input
					id='monthlyIncomeTargetYen'
					name='monthlyIncomeTargetYen'
					type='number'
					inputMode='numeric'
					min={0}
					step={1000}
					defaultValue={preference.monthlyIncomeTargetYen ?? ''}
					placeholder='例: 120000'
				/>
			</div>
			<div className='grid gap-2'>
				<Label htmlFor='desiredWorkDaysPerWeek'>希望勤務日数 / 週</Label>
				<Input
					id='desiredWorkDaysPerWeek'
					name='desiredWorkDaysPerWeek'
					type='number'
					inputMode='numeric'
					min={0}
					max={7}
					defaultValue={preference.desiredWorkDaysPerWeek ?? ''}
					placeholder='例: 4'
				/>
			</div>
			<div className='grid gap-2'>
				<Label htmlFor='preferredTimeBand'>時間帯</Label>
				<Select
					name='preferredTimeBand'
					defaultValue={preference.preferredTimeBand ?? 'any'}
				>
					<SelectTrigger id='preferredTimeBand'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value='any'>指定なし</SelectItem>
						<SelectItem value='morning'>午前中心</SelectItem>
						<SelectItem value='afternoon'>午後中心</SelectItem>
						<SelectItem value='evening'>夕方以降</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<fieldset className='grid gap-2'>
				<legend className='text-sm font-medium'>入りたい曜日</legend>
				<div className='grid grid-cols-4 gap-2'>
					{weekdayOptions.map(day => (
						<label
							key={day.value}
							className='flex items-center gap-2 rounded-md border px-2 py-2 text-sm'
						>
							<input
								name='preferredDays'
								type='checkbox'
								value={day.value}
								defaultChecked={preferredDays.has(day.value)}
							/>
							{day.label}
						</label>
					))}
				</div>
			</fieldset>
			<div className='grid gap-2'>
				<Label htmlFor='unavailableDates'>休み希望日</Label>
				<Textarea
					id='unavailableDates'
					name='unavailableDates'
					rows={3}
					defaultValue={(preference.unavailableDates ?? []).join('\n')}
					placeholder={'2026-06-10\n2026-06-18'}
				/>
				<p className='text-xs text-muted-foreground'>
					1行に1日、またはカンマ区切りで入力します。
				</p>
			</div>
			<div className='grid gap-2'>
				<Label htmlFor='availableLocations'>入れる場所・コース</Label>
				<Textarea
					id='availableLocations'
					name='availableLocations'
					rows={2}
					defaultValue={(preference.availableLocations ?? []).join('\n')}
					placeholder={'OUT\nIN'}
				/>
			</div>
			<div className='grid gap-2'>
				<Label htmlFor='notes'>メモ</Label>
				<Textarea
					id='notes'
					name='notes'
					rows={3}
					defaultValue={preference.notes ?? ''}
					placeholder='学校行事、送迎都合、扶養内調整など'
				/>
			</div>
			<Button type='submit'>勤務希望を保存</Button>
		</form>
	)
}

function LeaveRequestsPanel({
	leaveRequests,
	staff,
	tenant,
}: {
	leaveRequests: StaffLeaveRequestData[]
	staff: StaffMemberData
	tenant: string
}) {
	return (
		<div className='grid gap-4'>
			<form
				className='grid gap-3 md:grid-cols-[160px_180px_1fr_120px]'
				action={async formData => {
					'use server'
					await createStaffLeaveRequestAction(tenant, staff.id, formData)
				}}
			>
				<Input name='date' type='date' required />
				<Select name='requestType' defaultValue='day_off'>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value='day_off'>休み希望</SelectItem>
						<SelectItem value='paid_leave'>有休</SelectItem>
						<SelectItem value='unavailable'>不可日</SelectItem>
					</SelectContent>
				</Select>
				<Input name='reason' placeholder='理由・事情' />
				<Button type='submit'>申請</Button>
			</form>
			<div className='min-w-0 overflow-x-auto'>
				<Table className='min-w-[720px]'>
					<TableHeader>
						<TableRow>
							<TableHead>日付</TableHead>
							<TableHead>種別</TableHead>
							<TableHead>状態</TableHead>
							<TableHead>理由</TableHead>
							<TableHead>操作</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{leaveRequests.length === 0 ? (
							<TableRow>
								<TableCell colSpan={5} className='h-20 text-center'>
									休暇・不可日申請はありません。
								</TableCell>
							</TableRow>
						) : null}
						{leaveRequests.map(request => (
							<TableRow key={request.id}>
								<TableCell className='font-medium'>{request.date}</TableCell>
								<TableCell>{leaveTypeLabels[request.requestType]}</TableCell>
								<TableCell>
									<Badge variant='outline'>
										{leaveStatusLabels[request.status]}
									</Badge>
								</TableCell>
								<TableCell className='max-w-[260px] truncate'>
									{request.reason || '-'}
								</TableCell>
								<TableCell>
									<div className='flex flex-wrap gap-2'>
										<form
											action={async () => {
												'use server'
												await decideStaffLeaveRequestAction(
													tenant,
													request.id,
													'approved',
												)
											}}
										>
											<Button
												type='submit'
												size='sm'
												variant='outline'
												disabled={request.status === 'approved'}
											>
												承認
											</Button>
										</form>
										<form
											action={async () => {
												'use server'
												await decideStaffLeaveRequestAction(
													tenant,
													request.id,
													'rejected',
												)
											}}
										>
											<Button
												type='submit'
												size='sm'
												variant='ghost'
												disabled={request.status === 'rejected'}
											>
												却下
											</Button>
										</form>
										<form
											action={async () => {
												'use server'
												await decideStaffLeaveRequestAction(
													tenant,
													request.id,
													'cancelled',
												)
											}}
										>
											<Button
												type='submit'
												size='sm'
												variant='ghost'
												disabled={request.status === 'cancelled'}
											>
												取消
											</Button>
										</form>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	)
}

function SkillProfileForm({
	profile,
	staff,
	tenant,
}: {
	profile: StaffSkillProfileData | null
	staff: StaffMemberData
	tenant: string
}) {
	return (
		<form
			className='grid gap-3'
			action={async formData => {
				'use server'
				await updateStaffSkillProfileAction(tenant, staff.id, formData)
			}}
		>
			<div className='grid gap-2'>
				<Label htmlFor='skillTags'>対応スキル</Label>
				<Textarea
					id='skillTags'
					name='skillTags'
					rows={3}
					defaultValue={(profile?.skillTags ?? []).join('\n')}
					placeholder={'キャディ\n英語接客\n新人教育'}
				/>
			</div>
			<div className='grid gap-2'>
				<Label htmlFor='certifications'>資格・認定</Label>
				<Textarea
					id='certifications'
					name='certifications'
					rows={2}
					defaultValue={(profile?.certifications ?? []).join('\n')}
					placeholder={'普通救命講習\n社内Aランク'}
				/>
			</div>
			<div className='grid gap-2'>
				<Label htmlFor='languages'>対応言語</Label>
				<Input
					id='languages'
					name='languages'
					defaultValue={(profile?.languages ?? []).join(', ')}
					placeholder='日本語, 英語'
				/>
			</div>
			<div className='grid gap-2'>
				<Label htmlFor='maxRoundsPerDay'>最大ラウンド数 / 日</Label>
				<Input
					id='maxRoundsPerDay'
					name='maxRoundsPerDay'
					type='number'
					min={0}
					defaultValue={profile?.maxRoundsPerDay ?? ''}
				/>
			</div>
			<div className='grid gap-2'>
				<Label htmlFor='skillNotes'>メモ</Label>
				<Textarea
					id='skillNotes'
					name='notes'
					rows={3}
					defaultValue={profile?.notes ?? ''}
				/>
			</div>
			<Button type='submit'>スキルを保存</Button>
		</form>
	)
}

function CompensationForm({
	profile,
	staff,
	tenant,
}: {
	profile: StaffCompensationProfileData | null
	staff: StaffMemberData
	tenant: string
}) {
	return (
		<form
			className='grid gap-3'
			action={async formData => {
				'use server'
				await updateStaffCompensationProfileAction(tenant, staff.id, formData)
			}}
		>
			<div className='grid grid-cols-2 gap-3'>
				<MoneyInput
					name='hourlyRateYen'
					label='時給'
					value={profile?.hourlyRateYen}
				/>
				<MoneyInput name='dailyRateYen' label='日当' value={profile?.dailyRateYen} />
				<MoneyInput
					name='roundRateYen'
					label='ラウンド単価'
					value={profile?.roundRateYen}
				/>
				<MoneyInput
					name='nominationFeeYen'
					label='指名料'
					value={profile?.nominationFeeYen}
				/>
				<MoneyInput
					name='transportAllowanceYen'
					label='交通費'
					value={profile?.transportAllowanceYen}
				/>
				<div className='grid gap-2'>
					<Label htmlFor='currency'>通貨</Label>
					<Input
						id='currency'
						name='currency'
						defaultValue={profile?.currency ?? 'JPY'}
					/>
				</div>
			</div>
			<div className='grid gap-2'>
				<Label htmlFor='compensationNotes'>メモ</Label>
				<Textarea
					id='compensationNotes'
					name='notes'
					rows={3}
					defaultValue={profile?.notes ?? ''}
				/>
			</div>
			<Button type='submit'>報酬を保存</Button>
		</form>
	)
}

function MoneyInput({
	label,
	name,
	value,
}: {
	label: string
	name: string
	value?: number | null
}) {
	return (
		<div className='grid gap-2'>
			<Label htmlFor={name}>{label}</Label>
			<Input
				id={name}
				name={name}
				type='number'
				inputMode='numeric'
				min={0}
				step={100}
				defaultValue={value ?? ''}
			/>
		</div>
	)
}

function ShiftCalendar({
	month,
	shifts,
	staff,
	tenant,
}: {
	month: string
	shifts: StaffShiftData[]
	staff: StaffMemberData
	tenant: string
}) {
	const [year, monthNumber] = month.split('-').map(Number)
	const firstDay = new Date(year, monthNumber - 1, 1)
	const lastDay = new Date(year, monthNumber, 0)
	const leadingDays = firstDay.getDay()
	const totalCells = Math.ceil((leadingDays + lastDay.getDate()) / 7) * 7
	const days = Array.from({ length: totalCells }, (_, index) => {
		const day = index - leadingDays + 1
		if (day < 1 || day > lastDay.getDate()) {
			return null
		}
		return `${month}-${String(day).padStart(2, '0')}`
	})
	const shiftsByDate = new Map<string, StaffShiftData[]>()
	for (const shift of shifts) {
		shiftsByDate.set(shift.date, [...(shiftsByDate.get(shift.date) ?? []), shift])
	}

	return (
		<div className='grid gap-4'>
			<form
				className='grid gap-3 md:grid-cols-5'
				action={async formData => {
					'use server'
					await createStaffShiftAction(tenant, staff.id, formData)
				}}
			>
				<Input name='date' type='date' required />
				<Input name='startTime' type='time' required />
				<Input name='endTime' type='time' required />
				<Input name='shiftType' placeholder='regular' defaultValue='regular' />
				<Button type='submit'>追加</Button>
				<Textarea
					name='notes'
					placeholder='メモ'
					className='md:col-span-5'
					rows={2}
				/>
			</form>
			<div className='grid gap-3'>
				<div className='flex items-center justify-between gap-3'>
					<Button asChild size='sm' variant='outline'>
						<Link href={monthHref(tenant, addMonths(month, -1), staff.id)}>
							前月
						</Link>
					</Button>
					<p className='text-sm font-medium'>
						{year}年 {monthNumber}月
					</p>
					<Button asChild size='sm' variant='outline'>
						<Link href={monthHref(tenant, addMonths(month, 1), staff.id)}>
							翌月
						</Link>
					</Button>
				</div>
				<div className='grid grid-cols-7 border-l border-t text-xs'>
					{['日', '月', '火', '水', '木', '金', '土'].map(day => (
						<div
							key={day}
							className='border-b border-r bg-muted px-2 py-1 text-center font-medium'
						>
							{day}
						</div>
					))}
					{days.map((date, index) => {
						const dayShifts = date ? shiftsByDate.get(date) ?? [] : []
						return (
							<div
								key={date ?? `blank-${index}`}
								className='min-h-[96px] border-b border-r p-2'
							>
								{date ? (
									<>
										<p className='font-medium'>{Number(date.slice(8, 10))}</p>
										<div className='mt-2 grid gap-1'>
											{dayShifts.map(shift => (
												<span
													key={shift.id}
													className={`truncate rounded border px-1.5 py-0.5 ${shiftTypeStyles[shift.shiftType] ?? shiftTypeStyles.regular}`}
													title={`${shift.startTime.slice(0, 5)}-${shift.endTime.slice(0, 5)} ${shift.shiftType}`}
												>
													{shift.startTime.slice(0, 5)} {shift.shiftType}
												</span>
											))}
										</div>
									</>
								) : null}
							</div>
						)
					})}
				</div>
			</div>
		</div>
	)
}

function AttendancePanel({
	staff,
	tenant,
}: {
	staff: StaffMemberData
	tenant: string
}) {
	return (
		<div className='grid gap-3'>
			<p className='text-sm text-muted-foreground'>{staff.name}</p>
			<form
				action={async () => {
					'use server'
					await clockInStaffAction(tenant, staff.id)
				}}
			>
				<Button type='submit' className='w-full'>
					出勤
				</Button>
			</form>
			<form
				className='grid gap-2'
				action={async formData => {
					'use server'
					await clockOutStaffAction(tenant, staff.id, formData)
				}}
			>
				<Label htmlFor='breakMinutes'>休憩分</Label>
				<Input
					id='breakMinutes'
					name='breakMinutes'
					type='number'
					min={0}
					defaultValue={0}
				/>
				<Button type='submit' variant='outline'>
					退勤
				</Button>
			</form>
		</div>
	)
}

function formatYen(value: number) {
	return `${value.toLocaleString('ja-JP')}円`
}

function UtilizationDashboard({
	payrollEstimate,
	utilization,
}: {
	payrollEstimate: StaffPayrollEstimateData | null
	utilization: StaffUtilizationData
}) {
	const rate = Math.round(utilization.utilizationRate * 100)
	return (
		<div className='grid gap-3 text-sm'>
			<div className='flex items-center justify-between'>
				<span className='text-muted-foreground'>週次稼働率</span>
				<span className='text-2xl font-semibold'>{rate}%</span>
			</div>
			<div className='h-2 overflow-hidden rounded bg-muted'>
				<div
					className='h-full bg-primary'
					style={{ width: `${Math.min(rate, 100)}%` }}
				/>
			</div>
			<div className='grid grid-cols-2 gap-3'>
				<div className='rounded-md border p-3'>
					<p className='text-muted-foreground'>シフト</p>
					<p className='font-medium'>
						{minutesLabel(utilization.shiftedMinutes)}
					</p>
				</div>
				<div className='rounded-md border p-3'>
					<p className='text-muted-foreground'>実働</p>
					<p className='font-medium'>
						{minutesLabel(utilization.workedMinutes)}
					</p>
				</div>
			</div>
			{payrollEstimate ? (
				<div className='grid gap-2 rounded-md border p-3'>
					<div className='flex items-center justify-between gap-3'>
						<span className='text-muted-foreground'>月次給与見積</span>
						<span className='text-lg font-semibold'>
							{formatYen(payrollEstimate.estimatedAmountYen)}
						</span>
					</div>
					<div className='grid grid-cols-3 gap-2 text-xs'>
						<div>
							<p className='text-muted-foreground'>実働日</p>
							<p className='font-medium'>{payrollEstimate.workedDays}日</p>
						</div>
						<div>
							<p className='text-muted-foreground'>シフト日</p>
							<p className='font-medium'>{payrollEstimate.shiftedDays}日</p>
						</div>
						<div>
							<p className='text-muted-foreground'>目標差分</p>
							<p className='font-medium'>
								{payrollEstimate.targetGapYen == null
									? '-'
									: formatYen(payrollEstimate.targetGapYen)}
							</p>
						</div>
					</div>
				</div>
			) : null}
		</div>
	)
}

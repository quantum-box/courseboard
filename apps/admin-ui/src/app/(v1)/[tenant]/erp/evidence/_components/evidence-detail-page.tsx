'use client'

import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from 'components/ui/card'
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
import { Textarea } from 'components/ui/textarea'
import { LinkIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
	deleteEvidenceLinkAction,
	type EvidenceDetail,
	fetchEvidenceDetailAction,
	reviewEvidenceOcrAction,
	upsertEvidenceLinkAction,
} from '../actions'

type Props = {
	tenant: string
	initialDetail: EvidenceDetail
}

type LinkForm = {
	sourceType: string
	sourceId: string
	sourceLineId: string
	linkRole: string
	requiredForClose: boolean
	confidence: string
}

type OcrReviewForm = {
	reviewStatus: string
	reviewerCorrection: string
	reviewerNote: string
	reason: string
}

const LINK_ROLES = [
	['primary_voucher', '主証憑'],
	['supporting_document', '補助資料'],
	['tax_evidence', '税務証憑'],
	['payment_proof', '支払証跡'],
	['delivery_slip', '納品書'],
	['settlement_proof', '決済証跡'],
	['reconciliation_support', '照合資料'],
	['provider_statement', 'プロバイダ明細'],
]

const REVIEW_LABELS: Record<string, string> = {
	unreviewed: '未レビュー',
	needs_review: '要レビュー',
	accepted: 'レビュー済み',
	corrected: '補正済み',
	rejected: '差し戻し',
}

function formatDateTime(value?: string | null) {
	if (!value) return '-'
	return new Intl.DateTimeFormat('ja-JP', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).format(new Date(value))
}

function formatJson(value: unknown) {
	if (value === null || value === undefined) return '-'
	if (typeof value === 'string') return value
	return JSON.stringify(value, null, 2)
}

function truncateHash(value: string) {
	return value.length > 20 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value
}

function roleLabel(value: string) {
	return LINK_ROLES.find(([role]) => role === value)?.[1] ?? value
}

export function EvidenceDetailPage({ tenant, initialDetail }: Props) {
	const [detail, setDetail] = useState(initialDetail)
	const [message, setMessage] = useState<string | null>(null)
	const [isSaving, setIsSaving] = useState(false)
	const [isReviewSaving, setIsReviewSaving] = useState(false)
	const [form, setForm] = useState<LinkForm>({
		sourceType: '',
		sourceId: '',
		sourceLineId: '',
		linkRole: 'supporting_document',
		requiredForClose: false,
		confidence: '',
	})
	const [ocrReviewForm, setOcrReviewForm] = useState<OcrReviewForm>({
		reviewStatus: 'reviewed',
		reviewerCorrection: '',
		reviewerNote: '',
		reason: '',
	})

	const latestReview = useMemo(
		() =>
			detail.ocrMetadata
				.slice()
				.reverse()
				.find(item => item.reviewStatus),
		[detail.ocrMetadata],
	)
	const rawOcr = detail.ocrMetadata.find(
		item => item.derivativeRole === 'raw_ocr_output',
	)
	const correction = detail.ocrMetadata.find(
		item => item.derivativeRole === 'reviewer_correction',
	)
	const reviewTarget = rawOcr ?? latestReview

	const reload = useCallback(async () => {
		const result = await fetchEvidenceDetailAction(tenant, detail.evidence.id)
		if (result.success && result.data) {
			setDetail(result.data)
			setMessage(null)
		} else {
			setMessage(result.message ?? '証憑詳細の再取得に失敗しました')
		}
	}, [detail.evidence.id, tenant])

	const saveLink = async () => {
		setIsSaving(true)
		setMessage(null)
		const result = await upsertEvidenceLinkAction(tenant, {
			evidenceRecordId: detail.evidence.id,
			sourceType: form.sourceType,
			sourceId: form.sourceId,
			sourceLineId: form.sourceLineId,
			linkRole: form.linkRole,
			requiredForClose: form.requiredForClose,
			confidence: form.confidence,
		})
		setIsSaving(false)
		if (!result.success) {
			setMessage(result.message ?? 'リンク更新に失敗しました')
			return
		}
		setForm(current => ({
			...current,
			sourceType: '',
			sourceId: '',
			sourceLineId: '',
			confidence: '',
		}))
		await reload()
	}

	const saveOcrReview = async () => {
		if (!reviewTarget) return
		setIsReviewSaving(true)
		setMessage(null)
		const result = await reviewEvidenceOcrAction(tenant, {
			evidenceRecordId: detail.evidence.id,
			fileVersionId:
				reviewTarget.fileObjectId ?? detail.latestFileVersion?.id ?? undefined,
			derivativeId: reviewTarget.id,
			reviewStatus: ocrReviewForm.reviewStatus,
			reviewerCorrection: ocrReviewForm.reviewerCorrection,
			reviewerNote: ocrReviewForm.reviewerNote,
			reason: ocrReviewForm.reason,
		})
		setIsReviewSaving(false)
		if (!result.success) {
			setMessage(result.message ?? 'OCRレビュー更新に失敗しました')
			return
		}
		setOcrReviewForm(current => ({
			...current,
			reviewerNote: '',
			reason: '',
		}))
		await reload()
	}

	const deleteLink = async (
		sourceType: string,
		sourceId: string,
		sourceLineId: string | null | undefined,
		linkRole: string,
	) => {
		setIsSaving(true)
		const result = await deleteEvidenceLinkAction(tenant, {
			evidenceRecordId: detail.evidence.id,
			sourceType,
			sourceId,
			sourceLineId: sourceLineId ?? undefined,
			linkRole,
		})
		setIsSaving(false)
		if (!result.success) {
			setMessage(result.message ?? 'リンク削除に失敗しました')
			return
		}
		await reload()
	}

	return (
		<div className='space-y-4'>
			<div className='flex flex-wrap items-start justify-between gap-3'>
				<div>
					<h1 className='text-xl font-semibold tracking-normal'>
						{detail.evidence.documentNumber ?? detail.evidence.id}
					</h1>
					<p className='text-sm text-muted-foreground'>
						{detail.evidence.voucherType} / {detail.evidence.transactionDate} /{' '}
						{detail.evidence.counterparty ?? '-'}
					</p>
				</div>
				<div className='flex items-center gap-2'>
					<Badge variant='secondary'>{detail.evidence.status}</Badge>
					<Badge variant='outline'>{detail.evidence.verificationStatus}</Badge>
					<Button type='button' variant='outline' size='sm' onClick={reload}>
						<RefreshCwIcon className='mr-2 h-4 w-4' />
						再読込
					</Button>
				</div>
			</div>
			{message ? <p className='text-sm text-destructive'>{message}</p> : null}

			<div className='grid gap-4 lg:grid-cols-[1.1fr_0.9fr]'>
				<Card>
					<CardHeader className='pb-3'>
						<CardTitle className='text-base'>概要</CardTitle>
					</CardHeader>
					<CardContent>
						<div className='grid gap-x-6 gap-y-3 text-sm md:grid-cols-2'>
							<div>
								<p className='text-muted-foreground'>金額</p>
								<p className='font-medium'>
									{detail.evidence.amount ?? '-'} {detail.evidence.currency}
								</p>
							</div>
							<div>
								<p className='text-muted-foreground'>税額 / 税区分</p>
								<p className='font-medium'>
									{detail.evidence.taxAmount ?? '-'} /{' '}
									{detail.evidence.taxCategory ?? '-'}
								</p>
							</div>
							<div>
								<p className='text-muted-foreground'>source</p>
								<p className='font-medium'>
									{detail.evidence.sourceModule ?? '-'}:
									{detail.evidence.sourceId ?? '-'}
								</p>
							</div>
							<div>
								<p className='text-muted-foreground'>journal_entry_id</p>
								<p className='font-medium'>
									{detail.evidence.journalEntryId ?? '-'}
								</p>
							</div>
							<div>
								<p className='text-muted-foreground'>保存期限</p>
								<p className='font-medium'>{detail.evidence.retentionUntil}</p>
							</div>
							<div>
								<p className='text-muted-foreground'>登録</p>
								<p className='font-medium'>
									{formatDateTime(detail.evidence.createdAt)}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className='pb-3'>
						<CardTitle className='text-base'>最新ファイル</CardTitle>
					</CardHeader>
					<CardContent className='space-y-3 text-sm'>
						<div className='flex items-center justify-between gap-3'>
							<span className='text-muted-foreground'>status</span>
							<span>{detail.latestFileVersion?.status ?? '-'}</span>
						</div>
						<div className='flex items-center justify-between gap-3'>
							<span className='text-muted-foreground'>file</span>
							<span>{detail.latestFileVersion?.originalFileName ?? '-'}</span>
						</div>
						<div className='flex items-center justify-between gap-3'>
							<span className='text-muted-foreground'>hash</span>
							<code className='text-xs'>
								{detail.latestFileVersion
									? truncateHash(detail.latestFileVersion.fileHash)
									: '-'}
							</code>
						</div>
						<div className='flex items-center justify-between gap-3'>
							<span className='text-muted-foreground'>timestamp</span>
							<span>
								{detail.latestFileVersion?.timestampApplied ? 'applied' : '-'}
							</span>
						</div>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader className='pb-3'>
					<CardTitle className='text-base'>OCRレビュー</CardTitle>
				</CardHeader>
				<CardContent className='space-y-4'>
					<div className='flex flex-wrap items-center gap-2'>
						<Badge variant='secondary'>
							{latestReview
								? REVIEW_LABELS[latestReview.reviewStatus] ??
									latestReview.reviewStatus
								: 'OCRなし'}
						</Badge>
						<span className='text-sm text-muted-foreground'>
							{latestReview?.reviewedAt
								? `reviewed ${formatDateTime(latestReview.reviewedAt)}`
								: '未処理'}
						</span>
					</div>
					<div className='grid gap-4 lg:grid-cols-2'>
						<div className='space-y-2'>
							<Label>raw output</Label>
							<Textarea
								readOnly
								className='min-h-[180px] font-mono text-xs'
								value={
									rawOcr?.ocrText ?? formatJson(rawOcr?.extractedFieldsJson)
								}
							/>
						</div>
						<div className='space-y-2'>
							<Label>reviewer correction</Label>
							<Textarea
								className='min-h-[180px] font-mono text-xs'
								value={
									ocrReviewForm.reviewerCorrection ||
									correction?.ocrText ||
									formatJson(correction?.extractedFieldsJson)
								}
								onChange={event =>
									setOcrReviewForm(current => ({
										...current,
										reviewerCorrection: event.target.value,
									}))
								}
							/>
						</div>
					</div>
					<div className='grid gap-3 md:grid-cols-[180px_1fr_1fr_auto]'>
						<div className='space-y-1.5'>
							<Label>status</Label>
							<Select
								value={ocrReviewForm.reviewStatus}
								onValueChange={value =>
									setOcrReviewForm(current => ({
										...current,
										reviewStatus: value,
									}))
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value='reviewed'>レビュー済み</SelectItem>
									<SelectItem value='corrected'>補正済み</SelectItem>
									<SelectItem value='rejected'>差し戻し</SelectItem>
									<SelectItem value='needs_changes'>要修正</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className='space-y-1.5'>
							<Label>note</Label>
							<Input
								value={ocrReviewForm.reviewerNote}
								onChange={event =>
									setOcrReviewForm(current => ({
										...current,
										reviewerNote: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label>reason</Label>
							<Input
								value={ocrReviewForm.reason}
								onChange={event =>
									setOcrReviewForm(current => ({
										...current,
										reason: event.target.value,
									}))
								}
							/>
						</div>
						<div className='flex items-end'>
							<Button
								type='button'
								onClick={saveOcrReview}
								disabled={isReviewSaving || !reviewTarget}
							>
								保存
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className='pb-3'>
					<CardTitle className='text-base'>リンク管理</CardTitle>
				</CardHeader>
				<CardContent className='space-y-4'>
					<div className='grid gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]'>
						<div className='space-y-1.5'>
							<Label>source_type</Label>
							<Input
								value={form.sourceType}
								onChange={event =>
									setForm(current => ({
										...current,
										sourceType: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label>source_id</Label>
							<Input
								value={form.sourceId}
								onChange={event =>
									setForm(current => ({
										...current,
										sourceId: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label>line_id</Label>
							<Input
								value={form.sourceLineId}
								onChange={event =>
									setForm(current => ({
										...current,
										sourceLineId: event.target.value,
									}))
								}
							/>
						</div>
						<div className='space-y-1.5'>
							<Label>role</Label>
							<Select
								value={form.linkRole}
								onValueChange={value =>
									setForm(current => ({ ...current, linkRole: value }))
								}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{LINK_ROLES.map(([value, label]) => (
										<SelectItem key={value} value={value}>
											{label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className='flex items-end'>
							<Button
								type='button'
								onClick={saveLink}
								disabled={isSaving || !form.sourceType || !form.sourceId}
							>
								<LinkIcon className='mr-2 h-4 w-4' />
								保存
							</Button>
						</div>
					</div>
					<label className='flex items-center gap-2 text-sm'>
						<input
							type='checkbox'
							checked={form.requiredForClose}
							onChange={event =>
								setForm(current => ({
									...current,
									requiredForClose: event.target.checked,
								}))
							}
						/>
						月次締め必須リンク
					</label>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>source</TableHead>
								<TableHead>role</TableHead>
								<TableHead>review</TableHead>
								<TableHead>created</TableHead>
								<TableHead className='w-[80px]' />
							</TableRow>
						</TableHeader>
						<TableBody>
							{detail.linkedSources.map(link => (
								<TableRow
									key={`${link.sourceType}-${link.sourceId}-${link.sourceLineId}-${link.linkRole}`}
								>
									<TableCell>
										{link.sourceType}:{link.sourceId}
										{link.sourceLineId ? `:${link.sourceLineId}` : ''}
									</TableCell>
									<TableCell>{roleLabel(link.linkRole)}</TableCell>
									<TableCell>{link.reviewStatus}</TableCell>
									<TableCell>{formatDateTime(link.createdAt)}</TableCell>
									<TableCell>
										<Button
											type='button'
											variant='ghost'
											size='sm'
											onClick={() =>
												deleteLink(
													link.sourceType,
													link.sourceId,
													link.sourceLineId,
													link.linkRole,
												)
											}
											disabled={isSaving}
										>
											<Trash2Icon className='h-4 w-4' />
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<div className='grid gap-4 lg:grid-cols-2'>
				<Card>
					<CardHeader className='pb-3'>
						<CardTitle className='text-base'>ファイルバージョン</CardTitle>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>ver</TableHead>
									<TableHead>status</TableHead>
									<TableHead>hash</TableHead>
									<TableHead>created</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{detail.fileVersions.map(file => (
									<TableRow key={file.id}>
										<TableCell>{file.versionNo}</TableCell>
										<TableCell>{file.status}</TableCell>
										<TableCell>
											<code className='text-xs'>
												{truncateHash(file.fileHash)}
											</code>
										</TableCell>
										<TableCell>{formatDateTime(file.createdAt)}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className='pb-3'>
						<CardTitle className='text-base'>監査履歴</CardTitle>
					</CardHeader>
					<CardContent>
						<div className='max-h-[420px] space-y-3 overflow-auto pr-2'>
							{detail.auditHistory.map(entry => (
								<div key={entry.id} className='border-b pb-3 text-sm last:border-0'>
									<div className='flex items-center justify-between gap-3'>
										<span className='font-medium'>{entry.eventType}</span>
										<span className='text-xs text-muted-foreground'>
											{formatDateTime(entry.createdAt)}
										</span>
									</div>
									<div className='mt-1 text-xs text-muted-foreground'>
										actor {entry.actorId ?? '-'} / channel{' '}
										{entry.sourceChannel ?? '-'}
									</div>
									{entry.reason ? (
										<p className='mt-2 text-sm'>{entry.reason}</p>
									) : null}
									{entry.metadataJson ? (
										<pre className='mt-2 max-h-28 overflow-auto rounded bg-muted p-2 text-xs'>
											{formatJson(entry.metadataJson)}
										</pre>
									) : null}
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}

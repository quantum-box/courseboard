'use client'

import {
	type BridgeRunData,
	executeBridgeRunAction,
	previewBridgeRunAction,
} from 'app/(v1)/[tenant]/imports/actions'
import { Badge } from 'components/ui/badge'
import { Button } from 'components/ui/button'
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
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { Textarea } from 'components/ui/textarea'
import {
	CheckCircle2Icon,
	FileSpreadsheetIcon,
	UploadCloudIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

export function BridgeRunDialog({
	definitionId,
	definitionName,
	tenantId,
}: {
	definitionId: string
	definitionName: string
	tenantId: string
}) {
	const router = useRouter()
	const [run, setRun] = useState<BridgeRunData | null>(null)
	const [message, setMessage] = useState<string | null>(null)
	const [isPending, startTransition] = useTransition()

	const handlePreview = (formData: FormData) => {
		setMessage(null)
		startTransition(async () => {
			const result = await previewBridgeRunAction(
				tenantId,
				definitionId,
				formData,
			)
			if (!result.success || !result.data) {
				setMessage(result.message ?? 'Bridge Previewを作成できませんでした。')
				return
			}
			setRun(result.data)
			router.refresh()
		})
	}

	const handleExecute = () => {
		if (!run) return
		setMessage(null)
		startTransition(async () => {
			const result = await executeBridgeRunAction(tenantId, run.id)
			if (!result.success || !result.data) {
				setMessage(result.message ?? 'Bridge Runを実行できませんでした。')
				return
			}
			setRun(result.data)
			router.refresh()
		})
	}

	const objectCount = run?.normalized.objects?.length ?? 0
	const errorCount = run?.errorCount ?? 0
	const createdCount = run?.createdCount ?? 0
	const canExecute = Boolean(
		run && run.status !== 'executed' && errorCount === 0,
	)

	return (
		<Dialog>
			<Button
				variant='secondary'
				className='flex items-center gap-2 hover:bg-zinc-200'
				asChild
			>
				<DialogTrigger>
					<UploadCloudIcon className='h-4 w-4 text-zinc-900' />
					<span className='text-zinc-900 text-sm font-medium leading-tight'>
						Preview
					</span>
				</DialogTrigger>
			</Button>
			<DialogContent className='sm:max-w-[720px]'>
				<DialogHeader>
					<DialogTitle>{definitionName}のBridge Preview</DialogTitle>
					<DialogDescription>
						CSVをBridge
						Mappingで正規化し、エラーがなければdraft作成を実行できます。
					</DialogDescription>
				</DialogHeader>
				<form action={handlePreview} className='grid gap-4'>
					<div className='grid gap-2'>
						<Label htmlFor={`sourceFile-${definitionId}`}>CSVファイル</Label>
						<div className='flex min-h-24 flex-col items-center justify-center gap-3 rounded-md bg-zinc-100 p-4'>
							<FileSpreadsheetIcon className='h-5 w-5 text-muted-foreground' />
							<Input
								id={`sourceFile-${definitionId}`}
								name='sourceFile'
								type='file'
								accept='.csv,text/csv'
								className='max-w-md bg-white'
							/>
						</div>
					</div>
					<div className='grid gap-2'>
						<Label htmlFor={`rawCsv-${definitionId}`}>CSVテキスト</Label>
						<Textarea
							id={`rawCsv-${definitionId}`}
							name='rawCsv'
							placeholder={'日付,商品名,金額\n2026-06-06,ランチ,1200'}
							className='min-h-28 font-mono text-xs'
						/>
					</div>
					<div className='flex justify-end'>
						<Button type='submit' disabled={isPending}>
							{isPending ? 'Preview作成中' : 'Previewを作成'}
						</Button>
					</div>
				</form>
				{message ? (
					<div className='rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm'>
						{message}
					</div>
				) : null}
				{run ? (
					<div className='grid gap-3 rounded-md border p-4'>
						<div className='flex flex-wrap items-center gap-2'>
							<Badge variant='outline'>{run.status}</Badge>
							<span className='text-muted-foreground text-sm'>
								{run.normalized.bridgeOntologyObject ?? 'Bridge Object'}
							</span>
							<span className='text-muted-foreground text-sm'>
								Run: {run.id}
							</span>
						</div>
						<div className='grid gap-2 sm:grid-cols-3'>
							<Metric label='候補object' value={objectCount} />
							<Metric label='エラー行' value={errorCount} />
							<Metric label='作成済みdraft' value={createdCount} />
						</div>
						{errorCount > 0 ? (
							<pre className='max-h-40 overflow-auto rounded-md bg-zinc-100 p-3 text-xs'>
								{JSON.stringify(run.normalized.errors ?? [], null, 2)}
							</pre>
						) : (
							<div className='flex items-center gap-2 text-muted-foreground text-sm'>
								<CheckCircle2Icon className='h-4 w-4' />
								Bridge Ontologyへの正規化が完了しました。
							</div>
						)}
					</div>
				) : null}
				<DialogFooter>
					<Button variant='secondary' asChild>
						<DialogClose>閉じる</DialogClose>
					</Button>
					<Button onClick={handleExecute} disabled={!canExecute || isPending}>
						{run?.status === 'executed' ? '実行済み' : 'Draftを作成'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

function Metric({ label, value }: { label: string; value: number }) {
	return (
		<div className='rounded-md bg-muted p-3'>
			<div className='text-muted-foreground text-xs'>{label}</div>
			<div className='font-semibold text-lg'>{value}</div>
		</div>
	)
}

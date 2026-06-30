'use client'

import { Button } from 'components/ui/button'
import { Label } from 'components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import type { DocumentPdfSettings } from 'lib/document-pdf-settings'
import { DownloadIcon, ExternalLinkIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

const templateLabels = {
	simple: 'シンプル',
	detailed: '詳細',
	japanese: '和風',
}

export function DocumentPdfDownloadForm({
	action,
	filename,
	settings,
}: {
	action: string
	filename: string
	settings: DocumentPdfSettings
}) {
	const [template, setTemplate] = useState<string>(settings.defaultTemplate)
	const [includeSeal, setIncludeSeal] = useState(settings.includeSealByDefault)
	const previewUrl = useMemo(
		() => buildPdfUrl(action, template, includeSeal, { preview: true }),
		[action, template, includeSeal],
	)
	const previewFrameRef = useRef<HTMLDivElement>(null)
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const [previewWidth, setPreviewWidth] = useState(0)
	const [isPreviewLoading, setIsPreviewLoading] = useState(true)
	const [previewError, setPreviewError] = useState<string | null>(null)
	const downloadUrl = useMemo(
		() =>
			buildPdfUrl(action, template, includeSeal, {
				download: filename,
			}),
		[action, filename, template, includeSeal],
	)

	useEffect(() => {
		const frame = previewFrameRef.current
		if (!frame) return

		const updateWidth = () => {
			setPreviewWidth(Math.round(frame.getBoundingClientRect().width))
		}
		updateWidth()

		const observer = new ResizeObserver(updateWidth)
		observer.observe(frame)
		return () => observer.disconnect()
	}, [])

	useEffect(() => {
		if (previewWidth === 0) return

		const controller = new AbortController()
		let renderTask:
			| {
					cancel: () => void
					promise: Promise<unknown>
			  }
			| null = null
		setIsPreviewLoading(true)
		setPreviewError(null)

		async function loadPreview() {
			try {
				const [response, pdfjs] = await Promise.all([
					fetch(previewUrl, {
						credentials: 'include',
						signal: controller.signal,
					}),
					import('pdfjs-dist/legacy/build/pdf.mjs'),
				])
				if (!response.ok) {
					throw new Error(`PDF preview failed: ${response.status}`)
				}
				pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`
				const pdfBytes = new Uint8Array(await response.arrayBuffer())
				const pdf = await pdfjs.getDocument({ data: pdfBytes }).promise
				const page = await pdf.getPage(1)
				const canvas = canvasRef.current
				const context = canvas?.getContext('2d')
				if (!canvas || !context) return
				const baseViewport = page.getViewport({ scale: 1 })
				const cssWidth = Math.min(
					Math.max(previewWidth - 32, 240),
					baseViewport.width * 1.55,
				)
				const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
				const scale = (cssWidth / baseViewport.width) * pixelRatio
				const viewport = page.getViewport({ scale })
				canvas.width = viewport.width
				canvas.height = viewport.height
				canvas.style.width = `${cssWidth}px`
				canvas.style.height = `${(cssWidth * baseViewport.height) / baseViewport.width}px`
				renderTask = page.render({ canvas, canvasContext: context, viewport })
				await renderTask.promise
				setIsPreviewLoading(false)
			} catch (error) {
				if (!controller.signal.aborted) {
					setPreviewError(
						error instanceof Error
							? error.message
							: 'PDFプレビューを読み込めませんでした',
					)
					setIsPreviewLoading(false)
				}
			}
		}

		void loadPreview()

		return () => {
			controller.abort()
			renderTask?.cancel()
		}
	}, [previewUrl, previewWidth])

	return (
		<div className='space-y-3'>
			<div className='rounded-md border bg-muted/20 p-3'>
				<div className='grid gap-3 xl:grid-cols-[1fr_auto]'>
					<div className='grid gap-3 sm:grid-cols-[minmax(180px,240px)_auto] sm:items-end'>
						<div className='space-y-2'>
							<Label className='text-xs'>PDFテンプレート</Label>
							<Select value={template} onValueChange={setTemplate}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{Object.entries(templateLabels).map(([value, label]) => (
										<SelectItem key={value} value={value}>
											{label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<label className='flex h-10 items-center gap-2 text-sm'>
							<input
								type='checkbox'
								checked={includeSeal}
								onChange={event => setIncludeSeal(event.currentTarget.checked)}
							/>
							社印を捺印
						</label>
					</div>
					<div className='flex flex-wrap items-end gap-2'>
						<Button asChild type='button' variant='outline'>
							<a href={previewUrl} target='_blank' rel='noreferrer'>
								<ExternalLinkIcon className='mr-2 size-4' />
								別タブで開く
							</a>
						</Button>
						<Button asChild type='button' variant='outline'>
							<a href={downloadUrl}>
								<DownloadIcon className='mr-2 size-4' />
								PDFダウンロード
							</a>
						</Button>
					</div>
				</div>
			</div>
			<div
				ref={previewFrameRef}
				className='relative max-h-[72vh] min-h-[520px] overflow-auto rounded-md border bg-slate-100 p-4 sm:min-h-[640px]'
			>
				{isPreviewLoading || previewError ? (
					<div className='absolute inset-0 flex items-center justify-center bg-white text-sm text-muted-foreground'>
						{previewError ?? 'PDFプレビューを読み込み中...'}
					</div>
				) : null}
				<canvas
					ref={canvasRef}
					className='mx-auto block bg-white shadow-sm'
				/>
			</div>
		</div>
	)
}

function buildPdfUrl(
	action: string,
	template: string,
	includeSeal: boolean,
	options: { preview?: boolean; download?: string } = {},
) {
	const params = new URLSearchParams({
		template,
		seal: includeSeal ? '1' : '0',
	})
	if (options.preview) {
		params.set('preview', '1')
	}
	if (options.download) {
		params.set('download', options.download)
	}
	return `${action}?${params.toString()}`
}

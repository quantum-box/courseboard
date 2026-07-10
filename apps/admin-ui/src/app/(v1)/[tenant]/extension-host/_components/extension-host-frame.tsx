'use client'

import { Button } from 'components/ui/button'
import {
	FIELD_EXTENSION_HOST_MESSAGE_EVENTS,
	FIELD_EXTENSION_IFRAME_SANDBOX_POLICY,
	isFieldExtensionAllowedMessageOrigin,
	parseFieldExtensionHostContext,
	parseFieldExtensionHostMessage,
} from 'lib/field-extension-host-contract'
import { Loader2Icon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

type ExtensionHostFrameProps = {
	src: string
	title: string
}

export function ExtensionHostFrame({ src, title }: ExtensionHostFrameProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const hostContext = useMemo(() => {
		try {
			return parseFieldExtensionHostContext(new URL(src).searchParams)
		} catch {
			return null
		}
	}, [src])
	const [loading, setLoading] = useState(true)
	const [height, setHeight] = useState(640)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [frameKey, setFrameKey] = useState(0)

	useEffect(() => {
		function handleMessage(event: MessageEvent) {
			const iframeWindow = iframeRef.current?.contentWindow
			if (!iframeWindow || event.source !== iframeWindow) {
				return
			}
			if (!isFieldExtensionAllowedMessageOrigin(event.origin, src)) {
				return
			}

			const message = parseFieldExtensionHostMessage(
				event.data,
				hostContext ?? undefined,
			)
			if (!message) {
				return
			}

			switch (message.event) {
				case FIELD_EXTENSION_HOST_MESSAGE_EVENTS.ready:
					setLoading(false)
					setErrorMessage(null)
					break
				case FIELD_EXTENSION_HOST_MESSAGE_EVENTS.resize:
					setHeight(message.height)
					break
				case FIELD_EXTENSION_HOST_MESSAGE_EVENTS.error:
					setLoading(false)
					setErrorMessage(message.message)
					break
				case FIELD_EXTENSION_HOST_MESSAGE_EVENTS.reload:
					reloadFrame()
					break
			}
		}

		window.addEventListener('message', handleMessage)
		return () => window.removeEventListener('message', handleMessage)
	}, [hostContext, src])

	function reloadFrame() {
		setLoading(true)
		setErrorMessage(null)
		setFrameKey(key => key + 1)
	}

	return (
		<div className='relative overflow-hidden rounded-md border bg-background'>
			{loading ? (
				<div className='absolute inset-0 z-10 flex items-center justify-center bg-background/80'>
					<Loader2Icon className='h-6 w-6 animate-spin text-muted-foreground' />
				</div>
			) : null}
			{errorMessage ? (
				<div className='absolute inset-x-4 top-4 z-20 rounded-md border border-destructive/40 bg-background p-4 shadow-sm'>
					<div className='grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start'>
						<div className='flex min-w-0 gap-3'>
							<TriangleAlertIcon className='mt-0.5 h-4 w-4 shrink-0 text-destructive' />
							<div className='min-w-0 space-y-1'>
								<p className='text-sm font-medium'>拡張 UI でエラーが発生しました</p>
								<p className='break-words text-sm text-muted-foreground'>
									{errorMessage}
								</p>
							</div>
						</div>
						<Button
							type='button'
							variant='outline'
							size='sm'
							className='w-full sm:w-auto'
							onClick={reloadFrame}
						>
							<RefreshCwIcon className='mr-2 h-4 w-4' />
							再読み込み
						</Button>
					</div>
				</div>
			) : null}
			<iframe
				key={frameKey}
				ref={iframeRef}
				src={src}
				title={title}
				className='w-full'
				sandbox={FIELD_EXTENSION_IFRAME_SANDBOX_POLICY}
				style={{ height: `max(calc(100vh - 14rem), ${height}px)` }}
				onLoad={() => setLoading(false)}
			/>
		</div>
	)
}

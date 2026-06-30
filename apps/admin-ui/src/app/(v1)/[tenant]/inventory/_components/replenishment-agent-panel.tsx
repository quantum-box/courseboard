'use client'

import { Button } from 'components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { getBackendBaseUrl } from 'lib/backendUrl'
import { getModeFromOperatorId, getPlatformIdForMode } from 'lib/mode'
import { Bot, Loader2, Sparkles } from 'lucide-react'
import { type Dispatch, type SetStateAction, useRef, useState } from 'react'

type Props = {
	tenant: string
	accessToken: string
}

type StreamState = 'idle' | 'streaming' | 'done' | 'error'

type AgentChunk = {
	type:
		| 'ask'
		| 'thinking'
		| 'tool_call'
		| 'tool_result'
		| 'say'
		| 'attempt_completion'
		| 'assistant'
		| 'completion'
		| 'usage'
		| string
	text?: string
	content?: string
	result?: string
	tool_name?: string
}

export function ReplenishmentAgentPanel({
	tenant,
	accessToken,
}: Props) {
	const [state, setState] = useState<StreamState>('idle')
	const [status, setStatus] = useState('Agent は待機中です。')
	const [output, setOutput] = useState('')
	const abortControllerRef = useRef<AbortController | null>(null)

	const runAgent = async () => {
		abortControllerRef.current?.abort()
		const abortController = new AbortController()
		abortControllerRef.current = abortController
		setState('streaming')
		setStatus('thinking... 在庫と販売履歴を確認しています。')
		setOutput('')

		try {
			const response = await fetch(
				`${getBrowserBackendBaseUrl()}/v1/field/agent/replenishment-proposals`,
				{
					method: 'POST',
					headers: buildHeaders(tenant, accessToken),
					signal: abortController.signal,
				},
			)

			if (!response.ok || !response.body) {
				const body = await response.text().catch(() => '')
				throw new Error(
					body || `補充提案 Agent の起動に失敗しました (${response.status})`,
				)
			}

			for await (const chunk of readAgentSse(response)) {
				if (abortController.signal.aborted) return
				applyChunk(chunk, setStatus, setOutput, setState)
			}

			setState(current => (current === 'streaming' ? 'done' : current))
			setStatus(current =>
				current.startsWith('thinking') ? '補充提案が完了しました。' : current,
			)
		} catch (error) {
			if (abortController.signal.aborted) return
			setState('error')
			setStatus(
				error instanceof Error
					? error.message
					: '補充提案 Agent の実行に失敗しました。',
			)
		}
	}

	const stopAgent = () => {
		abortControllerRef.current?.abort()
		setState('idle')
		setStatus('Agent を停止しました。')
	}

	const isStreaming = state === 'streaming'

	return (
		<Card>
			<CardHeader className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
				<div>
					<CardTitle className='flex items-center gap-2 text-base'>
						<Bot className='h-4 w-4' aria-hidden='true' />
						補充提案 Agent
					</CardTitle>
					<CardDescription>
						在庫と販売履歴から、リードタイム内に枯渇しそうな SKU を提案します。
					</CardDescription>
				</div>
				<div className='flex gap-2'>
					{isStreaming ? (
						<Button variant='outline' size='sm' onClick={stopAgent}>
							停止
						</Button>
					) : null}
					<Button size='sm' onClick={runAgent} disabled={isStreaming}>
						{isStreaming ? (
							<Loader2
								className='mr-2 h-4 w-4 animate-spin'
								aria-hidden='true'
							/>
						) : (
							<Sparkles className='mr-2 h-4 w-4' aria-hidden='true' />
						)}
						補充提案
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				<div className='rounded-md border bg-muted/30 p-4'>
					<p className='text-sm font-medium'>{status}</p>
					{output ? (
						<pre className='mt-4 max-h-[360px] whitespace-pre-wrap break-words text-sm leading-6 text-foreground'>
							{output}
						</pre>
					) : (
						<p className='mt-2 text-sm text-muted-foreground'>
							提案結果はここにストリーミング表示されます。
						</p>
					)}
				</div>
			</CardContent>
		</Card>
	)
}

function getBrowserBackendBaseUrl() {
	return getBackendBaseUrl().replace('http://0.0.0.0', 'http://localhost')
}

function buildHeaders(
	tenant: string,
	accessToken: string,
): Record<string, string> {
	const mode = getModeFromOperatorId(tenant)
	return {
		Authorization: `Bearer ${accessToken}`,
		'x-operator-id': tenant,
		'x-platform-id': getPlatformIdForMode(mode),
	}
}

async function* readAgentSse(response: Response): AsyncGenerator<AgentChunk> {
	const reader = response.body?.getReader()
	if (!reader) return

	const decoder = new TextDecoder()
	let buffer = ''

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })
			const frames = buffer.split('\n\n')
			buffer = frames.pop() ?? ''
			for (const frame of frames) {
				const chunk = parseSseFrame(frame)
				if (chunk) yield chunk
			}
		}
		const chunk = parseSseFrame(buffer)
		if (chunk) yield chunk
	} finally {
		reader.releaseLock()
	}
}

function parseSseFrame(frame: string): AgentChunk | null {
	const data = frame
		.split('\n')
		.filter(line => line.startsWith('data:'))
		.map(line => line.slice(5).trim())
		.join('\n')

	if (!data || data === '[DONE]') return null

	try {
		return JSON.parse(data) as AgentChunk
	} catch {
		return null
	}
}

function applyChunk(
	chunk: AgentChunk,
	setStatus: (value: string) => void,
	setOutput: Dispatch<SetStateAction<string>>,
	setState: Dispatch<SetStateAction<StreamState>>,
) {
	switch (chunk.type) {
		case 'thinking':
			setStatus('thinking... 補充候補を分析しています。')
			break
		case 'tool_call':
			setStatus(`${chunk.tool_name ?? 'tool'} を確認しています。`)
			break
		case 'tool_result':
			setStatus('tool の結果をもとに提案を更新しています。')
			break
		case 'say':
			appendText(setOutput, chunk.text ?? chunk.content)
			break
		case 'attempt_completion':
		case 'completion':
		case 'assistant':
			appendText(setOutput, chunk.result ?? chunk.text ?? chunk.content)
			if (chunk.type !== 'assistant') {
				setState('done')
				setStatus('補充提案が完了しました。')
			}
			break
		case 'usage':
			break
		default:
			if (chunk.type === 'ask') {
				setStatus('Agent が追加確認を求めています。')
			}
	}
}

function appendText(
	setOutput: Dispatch<SetStateAction<string>>,
	text?: string,
) {
	if (!text) return
	setOutput(current => `${current}${text}`)
}

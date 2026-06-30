'use client'

import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { useUrlSyncedState } from 'lib/use-url-synced-state'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import type { Route } from 'next'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent } from 'react'

export type PeriodPreset = '7d' | '30d' | '90d' | 'custom'

export function PeriodControls({
	from,
	to,
	preset,
	channel,
	sku,
	customerSegment,
}: {
	from: string
	to: string
	preset: PeriodPreset
	channel: string
	sku: string
	customerSegment: string
}) {
	const router = useRouter()
	const pathname = usePathname()
	const searchParams = useSearchParams()
	const [presetInput, setPresetInput] = useUrlSyncedState(preset)
	const [fromInput, setFromInput] = useUrlSyncedState(from)
	const [toInput, setToInput] = useUrlSyncedState(to)
	const [skuInput, setSkuInput] = useUrlSyncedState(sku)

	const buildHref = (next: Record<string, string>) => {
		const params = new URLSearchParams(searchParams?.toString())
		for (const [k, v] of Object.entries(next)) {
			if (v === '' || v === 'all') {
				params.delete(k)
			} else {
				params.set(k, v)
			}
		}
		return `${pathname}?${params.toString()}` as Route
	}
	const resetHref = pathname as Route

	const onPreset = (value: PeriodPreset) => {
		setPresetInput(value)
		router.push(buildHref({ preset: value }))
	}

	const onSubmitCustom = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		setPresetInput('custom')
		router.push(
			buildHref({
				preset: 'custom',
				from: fromInput,
				to: toInput,
				sku: skuInput,
			}),
		)
	}

	const onSubmitFilters = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		router.push(buildHref({ sku: skuInput }))
	}

	return (
		<div className='flex flex-wrap items-end gap-3'>
			<div className='flex flex-wrap gap-1'>
				<Button
					type='button'
					size='sm'
					variant={presetInput === '7d' ? 'default' : 'outline'}
					onClick={() => onPreset('7d')}
				>
					過去7日
				</Button>
				<Button
					type='button'
					size='sm'
					variant={presetInput === '30d' ? 'default' : 'outline'}
					onClick={() => onPreset('30d')}
				>
					過去30日
				</Button>
				<Button
					type='button'
					size='sm'
					variant={presetInput === '90d' ? 'default' : 'outline'}
					onClick={() => onPreset('90d')}
				>
					過去90日
				</Button>
			</div>
			<form
				className='flex flex-wrap items-end gap-2'
				onSubmit={onSubmitCustom}
			>
				<div className='flex flex-col gap-1'>
					<Label htmlFor='from' className='text-xs text-muted-foreground'>
						開始日
					</Label>
					<Input
						id='from'
						type='date'
						value={fromInput}
						onChange={e => setFromInput(e.target.value)}
						className='h-9 w-[150px]'
					/>
				</div>
				<div className='flex flex-col gap-1'>
					<Label htmlFor='to' className='text-xs text-muted-foreground'>
						終了日
					</Label>
					<Input
						id='to'
						type='date'
						value={toInput}
						onChange={e => setToInput(e.target.value)}
						className='h-9 w-[150px]'
					/>
				</div>
				<Button
					type='submit'
					size='sm'
					variant={presetInput === 'custom' ? 'default' : 'outline'}
				>
					適用
				</Button>
			</form>
			<form
				className='flex flex-wrap items-end gap-2'
				onSubmit={onSubmitFilters}
			>
				<div className='flex flex-col gap-1'>
					<Label htmlFor='channel' className='text-xs text-muted-foreground'>
						チャネル
					</Label>
					<Select
						defaultValue={channel}
						onValueChange={value => router.push(buildHref({ channel: value }))}
					>
						<SelectTrigger id='channel' className='h-9 w-[120px]'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='all'>すべて</SelectItem>
							<SelectItem value='web'>Web</SelectItem>
							<SelectItem value='store'>店舗</SelectItem>
							<SelectItem value='b2b'>B2B</SelectItem>
							<SelectItem value='wholesale'>Wholesale</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className='flex flex-col gap-1'>
					<Label
						htmlFor='customer-segment'
						className='text-xs text-muted-foreground'
					>
						顧客
					</Label>
					<Select
						defaultValue={customerSegment}
						onValueChange={value =>
							router.push(buildHref({ customerSegment: value }))
						}
					>
						<SelectTrigger id='customer-segment' className='h-9 w-[120px]'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='all'>すべて</SelectItem>
							<SelectItem value='member'>会員</SelectItem>
							<SelectItem value='guest'>ゲスト</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className='flex flex-col gap-1'>
					<Label htmlFor='sku' className='text-xs text-muted-foreground'>
						SKU
					</Label>
					<Input
						id='sku'
						value={skuInput}
						onChange={e => setSkuInput(e.target.value)}
						placeholder='product id'
						className='h-9 w-[180px]'
					/>
				</div>
				<Button type='submit' size='sm' variant='outline'>
					絞り込み
				</Button>
				<Button type='button' size='sm' variant='ghost' asChild>
					<a href={resetHref}>解除</a>
				</Button>
			</form>
		</div>
	)
}

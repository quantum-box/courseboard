'use client'

import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { Textarea } from 'components/ui/textarea'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'

type InitialLineItem = {
	name?: string | null
	quantity?: number | null
	unitPrice?: number | null
}

type LineItemRow = {
	id: number
	item?: InitialLineItem
}

const INITIAL_ROW_COUNT = 3

export function InvoiceLineItemsEditor({
	initialItems = [],
}: {
	initialItems?: InitialLineItem[]
}) {
	const initialRows = Array.from(
		{ length: Math.max(INITIAL_ROW_COUNT, initialItems.length || 0) },
		(_, index) => ({ id: index + 1, item: initialItems[index] }),
	)
	const [rows, setRows] = useState<LineItemRow[]>(initialRows)

	const addRow = () => {
		setRows(current => [
			...current,
			{ id: Math.max(...current.map(row => row.id), 0) + 1 },
		])
	}

	const removeRow = (id: number) => {
		setRows(current =>
			current.length === 1 ? current : current.filter(row => row.id !== id),
		)
	}

	return (
		<section className='min-w-0 space-y-3'>
			<div className='flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between'>
				<div>
					<h2 className='text-base font-semibold'>明細</h2>
					<p className='text-xs text-muted-foreground'>
						必要な行だけ入力します。見積から作成した場合は明細を引き継ぎます。
					</p>
				</div>
				<Button type='button' variant='outline' size='sm' onClick={addRow}>
					<PlusIcon className='mr-2 h-4 w-4' />
					明細を追加
				</Button>
			</div>
			<div className='hidden grid-cols-[36px_minmax(220px,1fr)_92px_132px_36px] gap-2 border-y bg-muted/30 px-2 py-2 text-xs font-medium text-muted-foreground md:grid'>
				<div>No.</div>
				<div>品目</div>
				<div>数量</div>
				<div>単価</div>
				<div />
			</div>
			<div className='space-y-2 md:space-y-0 md:border-b'>
				{rows.map((row, index) => (
					<div
						key={row.id}
						className='grid gap-2 border-y py-3 md:grid-cols-[36px_minmax(220px,1fr)_92px_132px_36px] md:items-end md:border-y-0 md:border-t md:px-2 md:py-2'
					>
						<div className='hidden h-9 items-center text-sm font-medium text-muted-foreground md:flex'>
							{index + 1}
						</div>
						<div>
							<Label className='md:hidden'>品目</Label>
							<Input
								name='description'
								placeholder='サービス利用料'
								defaultValue={
									row.item?.name ?? (index === 0 ? 'サービス利用料' : undefined)
								}
								required={index === 0}
								className='h-9'
							/>
						</div>
						<div className='grid grid-cols-2 gap-2 md:contents'>
							<div>
								<Label className='md:hidden'>数量</Label>
								<Input
									name='quantity'
									type='number'
									min='0'
									step='1'
									defaultValue={row.item?.quantity ?? (index === 0 ? 1 : undefined)}
									className='h-9'
								/>
							</div>
							<div>
								<Label className='md:hidden'>単価</Label>
								<Input
									name='unitPrice'
									type='number'
									min='0'
									step='1'
									defaultValue={row.item?.unitPrice ?? (index === 0 ? 0 : undefined)}
									className='h-9'
								/>
							</div>
						</div>
						<Button
							type='button'
							variant='ghost'
							size='icon'
							className='h-9 w-9 justify-self-end text-muted-foreground'
							onClick={() => removeRow(row.id)}
							disabled={rows.length === 1}
							aria-label={`${index + 1}行目を削除`}
						>
							<Trash2Icon className='h-4 w-4' />
						</Button>
					</div>
				))}
			</div>
			<div className='space-y-2 border-y py-3'>
				<Label>備考</Label>
				<Textarea
					name='notes'
					rows={3}
					placeholder='支払条件、請求補足、社内メモなど'
					className='min-h-20 resize-y'
				/>
			</div>
		</section>
	)
}

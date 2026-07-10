'use client'

import { Button } from 'components/ui/button'
import { useCreateDeliveryNotePdfMutation } from 'gen/graphql-urql'
import { useMutationError } from 'lib/utils/mutationError'
import { FileText } from 'lucide-react'
import { useState } from 'react'

export function DeliveryNoteButton({ orderId }: { orderId: string }) {
	const [{ fetching }, createDeliveryNotePdf] =
		useCreateDeliveryNotePdfMutation()
	const { toast, errorToast } = useMutationError()
	const [exporting, setExporting] = useState(false)

	const handleClick = async () => {
		setExporting(true)
		try {
			const result = await createDeliveryNotePdf({ orderId })
			if (result.error) {
				throw result.error
			}
			const signedUrl = result.data?.createDeliveryNotePdf.signedUrl
			if (!signedUrl) {
				throw new Error('PDF URL was not returned')
			}
			window.open(signedUrl, '_blank', 'noopener,noreferrer')
			toast({
				title: '納品書を発行しました',
				description: '納品書PDFを新しいタブで開きました。',
			})
		} catch (error: unknown) {
			errorToast('納品書の発行に失敗しました', error)
		} finally {
			setExporting(false)
		}
	}

	const isLoading = exporting || fetching

	return (
		<Button
			size='sm'
			variant='outline'
			className='h-8 gap-1'
			onClick={handleClick}
			disabled={isLoading}
		>
			<FileText className='h-3.5 w-3.5' />
			<span className='lg:sr-only xl:not-sr-only xl:whitespace-nowrap'>
				{isLoading ? '発行中...' : '納品書発行'}
			</span>
		</Button>
	)
}

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
import { Textarea } from 'components/ui/textarea'
import { UploadIcon } from 'lucide-react'

export function UploadDeliveryForm({
	action,
}: {
	action: (formData: FormData) => Promise<void>
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>新規納品書アップロード</CardTitle>
				<CardDescription>
					PDF または画像を登録すると、OCR 結果を確認して検収確定できます。
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form action={action} className='grid gap-4 sm:grid-cols-2'>
					<div className='grid gap-2 sm:col-span-2'>
						<Label htmlFor='document'>納品書ファイル</Label>
						<Input
							id='document'
							name='document'
							type='file'
							accept='.pdf,image/*'
							capture='environment'
							required
							className='h-11 text-base sm:text-sm'
						/>
					</div>
					<div className='grid gap-2'>
						<Label htmlFor='supplierName'>サプライヤー名</Label>
						<Input
							id='supplierName'
							name='supplierName'
							placeholder='例: 青山包装資材'
							className='h-11 text-base sm:text-sm'
						/>
					</div>
					<div className='grid gap-2'>
						<Label htmlFor='warehouseName'>入庫倉庫</Label>
						<Input
							id='warehouseName'
							name='warehouseName'
							placeholder='例: Tokyo DC'
							className='h-11 text-base sm:text-sm'
						/>
					</div>
					<div className='grid gap-2 sm:col-span-2'>
						<Label htmlFor='note'>メモ</Label>
						<Textarea
							id='note'
							name='note'
							placeholder='例: 夕方便、lane C デモ用'
							rows={3}
							className='text-base sm:text-sm'
						/>
					</div>
					<div className='flex sm:col-span-2 sm:justify-end'>
						<Button type='submit' className='h-11 w-full gap-2 sm:w-auto'>
							<UploadIcon className='h-4 w-4' />
							アップロード
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	)
}

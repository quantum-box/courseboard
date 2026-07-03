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
import { Textarea } from 'components/ui/textarea'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { createOrderAction } from '../action'

export default function NewOrderPage({ params: { tenant } }: { params: { tenant: string } }) {
	const submit = createOrderAction.bind(null, tenant)
	return (
		<V1Layout current='orders' tenant={tenant}>
			<MainLayout>
				<h1 className='text-2xl font-semibold'>受注作成</h1>
				<Card>
					<CardHeader>
						<CardTitle>受注情報</CardTitle>
					</CardHeader>
					<CardContent>
						<form action={submit} className='grid gap-5'>
							<div className='grid gap-4 sm:grid-cols-3'>
								<div>
									<Label>取引先ID</Label>
									<Input name='clientId' required />
								</div>
								<div>
									<Label>取引先名</Label>
									<Input name='clientName' />
								</div>
								<div>
									<Label>メール</Label>
									<Input name='clientEmail' type='email' />
								</div>
							</div>
							<div className='grid gap-4 sm:grid-cols-3'>
								<div>
									<Label>ステータス</Label>
									<Select name='status' defaultValue='Pending'>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value='Pending'>未確定</SelectItem>
											<SelectItem value='Confirmed'>確定</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div>
									<Label>チャネル</Label>
									<Input name='source' defaultValue='b2b' />
								</div>
								<div>
									<Label>税額</Label>
									<Input name='taxAmount' type='number' defaultValue='0' />
								</div>
							</div>
							<div className='grid gap-3'>
								<div className='grid gap-3 sm:grid-cols-[160px_1fr_120px_160px]'>
									<div>
										<Label>SKU</Label>
										<Input name='sku' />
									</div>
									<div>
										<Label>品目</Label>
										<Input name='description' required />
									</div>
									<div>
										<Label>数量</Label>
										<Input name='quantity' type='number' defaultValue='1' min='1' />
									</div>
									<div>
										<Label>単価</Label>
										<Input name='unitPrice' type='number' defaultValue='0' min='0' />
									</div>
								</div>
							</div>
							<div>
								<Label>メモ</Label>
								<Textarea name='notes' />
							</div>
							<Button type='submit' className='w-fit'>
								作成
							</Button>
						</form>
					</CardContent>
				</Card>
			</MainLayout>
		</V1Layout>
	)
}

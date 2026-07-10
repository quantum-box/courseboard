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
import { fetchVendorsAction } from '../../vendors/actions'
import { createPurchaseOrderAction } from '../actions'

export default async function NewPurchaseOrderPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const submit = createPurchaseOrderAction.bind(null, tenant)
	const vendors = (await fetchVendorsAction(tenant, 'Active')).data ?? []

	return (
		<V1Layout current='purchase-orders' tenant={tenant}>
			<MainLayout>
				<h1 className='text-2xl font-semibold'>発注書作成</h1>
				<form action={submit} className='grid gap-4 lg:grid-cols-[1fr_360px]'>
					<Card>
						<CardHeader>
							<CardTitle>明細</CardTitle>
						</CardHeader>
						<CardContent className='space-y-4'>
							{[0, 1, 2, 3, 4].map(index => (
								<div
									key={index}
									className='grid gap-2 md:grid-cols-[1fr_90px_130px_130px]'
								>
									<div>
										<Label>品目</Label>
										<Input
											name='description'
											placeholder='原材料'
											required={index === 0}
										/>
									</div>
									<div>
										<Label>数量</Label>
										<Input
											name='quantity'
											type='number'
											min='0'
											step='1'
											defaultValue={index === 0 ? 1 : undefined}
										/>
									</div>
									<div>
										<Label>単価</Label>
										<Input
											name='unitCost'
											type='number'
											min='0'
											step='1'
											defaultValue={index === 0 ? 0 : undefined}
										/>
									</div>
									<div>
										<Label>税額</Label>
										<Input
											name='taxAmount'
											type='number'
											min='0'
											step='1'
											defaultValue={0}
										/>
									</div>
								</div>
							))}
							<div>
								<Label>備考</Label>
								<Textarea name='notes' rows={4} />
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>発注先</CardTitle>
						</CardHeader>
						<CardContent className='space-y-4'>
							<div>
								<Label>仕入先</Label>
								<Select name='vendorId'>
									<SelectTrigger>
										<SelectValue placeholder='仕入先を選択' />
									</SelectTrigger>
									<SelectContent>
										{vendors.map(vendor => (
											<SelectItem key={vendor.id} value={vendor.id}>
												{vendor.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div>
								<Label>仕入先名スナップショット</Label>
								<Input name='vendorName' />
							</div>
							<div>
								<Label>納品予定日</Label>
								<Input name='expectedDeliveryDate' type='date' />
							</div>
							<div>
								<Label>通貨</Label>
								<Input name='currency' defaultValue='JPY' />
							</div>
							<div>
								<Label>ステータス</Label>
								<Select name='status' defaultValue='Draft'>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value='Draft'>下書き</SelectItem>
										<SelectItem value='Sent'>送付済</SelectItem>
										<SelectItem value='Received'>入荷済</SelectItem>
										<SelectItem value='Invoiced'>請求済</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<Button
								type='submit'
								className='w-full'
								disabled={vendors.length === 0}
							>
								作成
							</Button>
						</CardContent>
					</Card>
				</form>
			</MainLayout>
		</V1Layout>
	)
}

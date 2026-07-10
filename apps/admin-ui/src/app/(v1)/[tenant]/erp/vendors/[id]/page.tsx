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
import { notFound } from 'next/navigation'
import { fetchVendorAction, updateVendorAction } from '../actions'

export default async function VendorDetailPage({
	params: { tenant, id },
}: {
	params: { tenant: string; id: string }
}) {
	const result = await fetchVendorAction(tenant, id)
	const vendor = result.data
	if (!vendor) notFound()
	const submit = updateVendorAction.bind(null, tenant, id)

	return (
		<V1Layout current='vendors' tenant={tenant}>
			<MainLayout>
				<div>
					<h1 className='text-2xl font-semibold'>{vendor.name}</h1>
					<p className='text-sm text-muted-foreground'>{vendor.id}</p>
				</div>
				<form action={submit} className='grid gap-4 lg:grid-cols-[1fr_360px]'>
					<Card>
						<CardHeader>
							<CardTitle>基本情報</CardTitle>
						</CardHeader>
						<CardContent className='space-y-4'>
							<div>
								<Label>仕入先名</Label>
								<Input name='name' required defaultValue={vendor.name} />
							</div>
							<div>
								<Label>住所</Label>
								<Textarea
									name='address'
									rows={3}
									defaultValue={vendor.address ?? ''}
								/>
							</div>
							<div>
								<Label>備考</Label>
								<Textarea
									name='notes'
									rows={4}
									defaultValue={vendor.notes ?? ''}
								/>
							</div>
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle>連絡先</CardTitle>
						</CardHeader>
						<CardContent className='space-y-4'>
							<div>
								<Label>担当者</Label>
								<Input
									name='contactName'
									defaultValue={vendor.contactName ?? ''}
								/>
							</div>
							<div>
								<Label>メール</Label>
								<Input
									name='contactEmail'
									type='email'
									defaultValue={vendor.contactEmail ?? ''}
								/>
							</div>
							<div>
								<Label>電話番号</Label>
								<Input
									name='contactPhone'
									defaultValue={vendor.contactPhone ?? ''}
								/>
							</div>
							<div>
								<Label>支払条件</Label>
								<Input
									name='paymentTerms'
									defaultValue={vendor.paymentTerms ?? ''}
								/>
							</div>
							<div>
								<Label>ステータス</Label>
								<Select name='status' defaultValue={vendor.status}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value='Active'>有効</SelectItem>
										<SelectItem value='Inactive'>停止</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<Button type='submit' className='w-full'>
								保存
							</Button>
						</CardContent>
					</Card>
				</form>
			</MainLayout>
		</V1Layout>
	)
}

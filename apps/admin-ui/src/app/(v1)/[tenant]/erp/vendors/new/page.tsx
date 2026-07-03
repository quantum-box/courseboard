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
import { createVendorAction } from '../actions'

export default function NewVendorPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	const submit = createVendorAction.bind(null, tenant)

	return (
		<V1Layout current='vendors' tenant={tenant}>
			<MainLayout>
				<h1 className='text-2xl font-semibold'>仕入先作成</h1>
				<form action={submit} className='grid gap-4 lg:grid-cols-[1fr_360px]'>
					<Card>
						<CardHeader>
							<CardTitle>基本情報</CardTitle>
						</CardHeader>
						<CardContent className='space-y-4'>
							<div>
								<Label>仕入先名</Label>
								<Input name='name' required />
							</div>
							<div>
								<Label>住所</Label>
								<Textarea name='address' rows={3} />
							</div>
							<div>
								<Label>備考</Label>
								<Textarea name='notes' rows={4} />
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
								<Input name='contactName' />
							</div>
							<div>
								<Label>メール</Label>
								<Input name='contactEmail' type='email' />
							</div>
							<div>
								<Label>電話番号</Label>
								<Input name='contactPhone' />
							</div>
							<div>
								<Label>支払条件</Label>
								<Input name='paymentTerms' placeholder='月末締め翌月末払い' />
							</div>
							<div>
								<Label>ステータス</Label>
								<Select name='status' defaultValue='Active'>
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
								作成
							</Button>
						</CardContent>
					</Card>
				</form>
			</MainLayout>
		</V1Layout>
	)
}

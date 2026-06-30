import { authWithCheck } from 'app/auth'
import { Button } from 'components/ui/button'
import {
	type DocumentClientOption,
	DocumentClientSelector,
} from 'components/document-client-selector'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getGraphqlSdk } from 'lib/graphqlClient'
import { FilePlus2Icon, UsersIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { createQuotationAction } from '../action'
import { QuotationLineItemsEditor } from './quotation-line-items-editor'

export default async function NewQuotationPage({
	params: { tenant },
	searchParams,
}: {
	params: { tenant: string }
	searchParams?: {
		clientId?: string
		clientName?: string
		clientEmail?: string
	}
}) {
	const submit = createQuotationAction.bind(null, tenant)
	const session = await authWithCheck()
	const sdk = getGraphqlSdk(session, tenant)
	let clients: DocumentClientOption[] = []
	try {
		const result = await sdk.clientListPage()
		clients = (result.clients ?? []).map(client => ({
			id: client.id,
			name: client.name,
		}))
	} catch {
		clients = []
	}
	if (
		searchParams?.clientId &&
		!clients.some(client => client.id === searchParams.clientId)
	) {
		clients = [
			{
				id: searchParams.clientId,
				name: searchParams.clientName || searchParams.clientId,
				email: searchParams.clientEmail,
			},
			...clients,
		]
	}
	const defaultValidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10)

	return (
		<V1Layout current='quotations' tenant={tenant}>
			<MainLayout>
				<form action={submit} className='space-y-4'>
					<div className='flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between'>
						<div>
							<h1 className='text-2xl font-semibold tracking-tight'>
								見積書作成
							</h1>
							<p className='text-sm text-muted-foreground'>
								取引先・条件・明細をまとめて入力します
							</p>
						</div>
						<Button type='submit' className='h-10 w-full sm:w-auto'>
							<FilePlus2Icon className='mr-2 h-4 w-4' />
							見積書を作成
						</Button>
					</div>

					<section className='space-y-3 border-b pb-4'>
						<div className='flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between'>
							<div>
								<h2 className='text-base font-semibold'>見積先・条件</h2>
								<p className='text-xs text-muted-foreground'>
									取引先リストから宛先を選び、期限と送信オプションを設定します
								</p>
							</div>
							{clients.length === 0 ? (
								<Button asChild variant='outline' size='sm'>
									<Link href={`/${tenant}/library/clients` as Route}>
										<UsersIcon className='mr-2 h-4 w-4' />
										取引先一覧を開く
									</Link>
								</Button>
							) : null}
						</div>
						<div className='grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]'>
							<DocumentClientSelector clients={clients} compact />
							<div className='grid grid-cols-3 gap-2'>
								<div>
									<Label>有効期限</Label>
									<Input
										name='validUntil'
										type='date'
										required
										defaultValue={defaultValidUntil}
										className='h-9'
									/>
								</div>
								<div>
									<Label>通貨</Label>
									<Input name='currency' defaultValue='JPY' className='h-9' />
								</div>
								<div>
									<Label>税額</Label>
									<Input
										name='taxAmount'
										type='number'
										min='0'
										step='1'
										defaultValue={0}
										className='h-9'
									/>
								</div>
							</div>
						</div>
						<div className='flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:gap-5'>
							<label className='flex items-center gap-2'>
								<input name='createPaymentLink' type='checkbox' />
								<span>Square Payment Linkを作成</span>
							</label>
							<label className='flex items-center gap-2'>
								<input name='sendEmail' type='checkbox' />
								<span>作成後にメール送信</span>
							</label>
						</div>
					</section>

					<QuotationLineItemsEditor />
				</form>
			</MainLayout>
		</V1Layout>
	)
}

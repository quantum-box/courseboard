import { authWithCheck } from 'app/auth'
import {
	type DocumentClientOption,
	DocumentClientSelector,
} from 'components/document-client-selector'
import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Label } from 'components/ui/label'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getGraphqlSdk } from 'lib/graphqlClient'
import { FilePlus2Icon, UsersIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { createInvoiceAction } from '../action'
import { InvoiceLineItemsEditor } from './invoice-line-items-editor'

export default async function NewInvoicePage({
	params: { tenant },
	searchParams,
}: {
	params: { tenant: string }
	searchParams: {
		quoteId?: string
		clientId?: string
		clientName?: string
		clientEmail?: string
	}
}) {
	const session = await authWithCheck()
	const sdk = getGraphqlSdk(session, tenant)
	const { quoteId } = searchParams
	const quote = quoteId
		? (await sdk.QuotesList().catch(() => ({ quotes: [] }))).quotes?.find(
				item => item.id === quoteId,
			)
		: undefined
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
	const initialClient = {
		id: searchParams.clientId ?? quote?.clientId ?? '',
		name:
			searchParams.clientName ??
			quote?.client?.name ??
			searchParams.clientId ??
			quote?.clientId ??
			'',
		email: searchParams.clientEmail,
	}
	if (
		initialClient.id &&
		!clients.some(client => client.id === initialClient.id)
	) {
		clients = [initialClient, ...clients]
	}
	const submit = createInvoiceAction.bind(null, tenant)
	const defaultDueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10)

	return (
		<V1Layout current='invoices' tenant={tenant}>
			<MainLayout>
				<form action={submit} className='space-y-4'>
					<div className='flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-center sm:justify-between'>
						<div>
							<h1 className='text-2xl font-semibold tracking-tight'>
								請求書作成
							</h1>
							<p className='text-sm text-muted-foreground'>
								請求先・支払条件・明細をまとめて入力します
							</p>
						</div>
						<Button type='submit' className='h-10 w-full sm:w-auto'>
							<FilePlus2Icon className='mr-2 h-4 w-4' />
							請求書を作成
						</Button>
					</div>

					<section className='space-y-3 border-b pb-4'>
						<div className='flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between'>
							<div>
								<h2 className='text-base font-semibold'>請求先・条件</h2>
								<p className='text-xs text-muted-foreground'>
									取引先リストから請求先を選び、支払期限と送信オプションを設定します
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
						<div className='grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]'>
							<DocumentClientSelector
								clients={clients}
								label='請求先'
								compact
							/>
							<div className='grid grid-cols-2 gap-2'>
								<div>
									<Label>支払期限</Label>
									<Input
										name='dueDate'
										type='date'
										required
										defaultValue={defaultDueDate}
										className='h-9'
									/>
								</div>
								<div>
									<Label>税額</Label>
									<Input
										name='taxAmount'
										type='number'
										defaultValue={0}
										className='h-9'
									/>
								</div>
							</div>
						</div>
						<div className='flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:gap-5'>
							<label className='flex items-center gap-2'>
								<input
									name='createPaymentLink'
									type='checkbox'
									defaultChecked
								/>
								<span>公開決済リンクを作成</span>
							</label>
							<label className='flex items-center gap-2'>
								<input name='sendEmail' type='checkbox' />
								<span>作成後にメール送信</span>
							</label>
						</div>
					</section>

					<InvoiceLineItemsEditor initialItems={quote?.lineItems ?? []} />
				</form>
			</MainLayout>
		</V1Layout>
	)
}

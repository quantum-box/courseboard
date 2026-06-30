import { authWithCheck } from 'app/auth'
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from 'components/ui/breadcrumb'
import { Button } from 'components/ui/button'
import { Input } from 'components/ui/input'
import { Textarea } from 'components/ui/textarea'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { fetchTenantName } from 'lib/tenantName'
import { ArrowLeftIcon, ReceiptTextIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { fetchOrderAction } from '../../orders/action'
import { createCancellationFeeAction } from '../action'
import { FieldLabel } from './field-label'
import { CancellationFeeForm } from './form'
import { CancellationFeeSmsFields } from './sms-fields'
import { CancellationFeeSubmitButton } from './submit-button'

const yen = new Intl.NumberFormat('ja-JP', {
	style: 'currency',
	currency: 'JPY',
	maximumFractionDigits: 0,
})

export default async function NewCancellationFeePage({
	params: { tenant },
	searchParams: { orderId },
}: {
	params: { tenant: string }
	searchParams: { orderId?: string }
}) {
	const session = await authWithCheck()
	const tenantName = await fetchTenantName(session, tenant)
	const smsSenderName =
		process.env.TACHYON_FIELD_SMS_SENDER_NAME || tenantName || 'TACHYON Field'
	const order = orderId
		? (
				await fetchOrderAction(tenant, orderId).catch(() => ({
					data: undefined,
				}))
			).data
		: undefined
	const submit = createCancellationFeeAction.bind(null, tenant)
	const defaultDueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10)
	const reference = order ? `${order.orderNumber} / ${order.id}` : undefined

	return (
		<V1Layout
			current='cancellation-fees'
			session={session}
			tenant={tenant}
			tenantName={tenantName}
			breadcrumbs={
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink asChild>
								<Link href={`/${tenant}/invoices` as Route}>請求書一覧</Link>
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>キャンセル料請求</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			}
		>
			<MainLayout>
				<div className='mx-auto w-full max-w-6xl space-y-6'>
					<div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
						<div>
							<div className='flex items-center gap-2 text-sm text-muted-foreground'>
								<ReceiptTextIcon className='h-4 w-4' />
								<span>公開支払いページ付き請求</span>
							</div>
							<h1 className='mt-1 text-2xl font-semibold tracking-tight'>
								キャンセル料請求
							</h1>
							<p className='mt-1 text-sm text-muted-foreground'>
								公開支払いページ付きの請求書を作成し、メールまたはSMSで送信します。
							</p>
						</div>
						<Button asChild variant='outline' size='sm' className='shrink-0'>
							<Link href={`/${tenant}/invoices` as Route}>
								<ArrowLeftIcon className='mr-2 h-4 w-4' />
								請求書一覧
							</Link>
						</Button>
					</div>

					<div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start xl:grid-cols-[minmax(0,1fr)_320px]'>
						<CancellationFeeForm action={submit} tenant={tenant}>
							<section className='space-y-4 border-y py-5'>
								<div>
									<h2 className='text-base font-semibold'>キャンセル内容</h2>
									<p className='text-xs text-muted-foreground'>
										対象、金額、理由を上から順に確認します。
									</p>
								</div>
								{order ? (
									<div className='grid gap-3 bg-muted/30 p-3 text-sm sm:grid-cols-3'>
										<div>
											<div className='text-muted-foreground'>対象受注</div>
											<div className='font-medium'>{order.orderNumber}</div>
										</div>
										<div>
											<div className='text-muted-foreground'>受注金額</div>
											<div className='font-medium'>
												{yen.format(order.totalAmount)}
											</div>
										</div>
										<div>
											<div className='text-muted-foreground'>ステータス</div>
											<div className='font-medium'>{order.status}</div>
										</div>
									</div>
								) : null}
								<div className='space-y-4'>
									<div>
										<FieldLabel optional>対象予約・注文</FieldLabel>
										<Input
											name='reference'
											placeholder='予約番号 / 注文番号'
											defaultValue={reference}
											className='mt-1 h-9'
										/>
									</div>
									<div>
										<FieldLabel required>キャンセル料</FieldLabel>
										<Input
											name='amount'
											type='number'
											min={1}
											step={1}
											required
											placeholder='5000'
											className='mt-1 h-9'
										/>
									</div>
									<div>
										<FieldLabel optional>税額</FieldLabel>
										<Input
											name='taxAmount'
											type='number'
											min={0}
											defaultValue={0}
											className='mt-1 h-9'
										/>
									</div>
									<div>
										<FieldLabel optional>理由</FieldLabel>
										<Input
											name='reason'
											placeholder='当日キャンセル / 無断キャンセル など'
											className='mt-1 h-9'
										/>
									</div>
									<div>
										<FieldLabel optional>備考</FieldLabel>
										<Textarea
											name='notes'
											rows={4}
											placeholder='お客様に共有したい補足があれば入力'
											className='mt-1 min-h-24 resize-y'
										/>
									</div>
								</div>
							</section>

							<section className='space-y-4 border-y py-5'>
								<div>
									<h2 className='text-base font-semibold'>請求先</h2>
									<p className='text-xs text-muted-foreground'>
										取引先IDがない場合は取引先名だけでも作成できます。
									</p>
								</div>
								<div className='space-y-4'>
									<div>
										<FieldLabel required>取引先名</FieldLabel>
										<Input
											name='clientName'
											required
											defaultValue={order?.clientName ?? ''}
											className='mt-1 h-9'
										/>
									</div>
									<div>
										<FieldLabel optional>取引先ID</FieldLabel>
										<Input
											name='clientId'
											defaultValue={order?.clientId ?? ''}
											placeholder='任意'
											className='mt-1 h-9'
										/>
									</div>
									<div>
										<FieldLabel required>支払期限</FieldLabel>
										<Input
											name='dueDate'
											type='date'
											required
											defaultValue={defaultDueDate}
											className='mt-1 h-9'
										/>
									</div>
								</div>
							</section>

							<section className='space-y-4 border-y py-5'>
								<div>
									<h2 className='text-base font-semibold'>送信</h2>
									<p className='text-xs text-muted-foreground'>
										支払いURLは作成時に発行され、文面の {'{url}'}{' '}
										に差し込まれます。
									</p>
								</div>
								<CancellationFeeSmsFields
									defaultEmail={order?.clientEmail ?? ''}
									defaultMessage={`${smsSenderName}です。\nキャンセル料 {amount}{currency} のお支払いをお願いします。\n支払期限: {dueDate}\nお支払いURL: {url}`}
								/>
								<div className='border-t pt-4'>
									<CancellationFeeSubmitButton />
								</div>
							</section>
						</CancellationFeeForm>

						<aside
							aria-label='キャンセル料請求ガイド'
							className='hidden min-w-0 space-y-5 border-l py-1 pl-5 text-sm lg:sticky lg:top-4 lg:block'
						>
							{order ? (
								<section className='space-y-3'>
									<h2 className='text-base font-semibold'>対象受注</h2>
									<dl className='space-y-2 text-xs'>
										<div>
											<dt className='text-muted-foreground'>受注番号</dt>
											<dd className='font-medium text-foreground'>
												{order.orderNumber}
											</dd>
										</div>
										<div>
											<dt className='text-muted-foreground'>受注金額</dt>
											<dd className='font-medium text-foreground'>
												{yen.format(order.totalAmount)}
											</dd>
										</div>
										<div>
											<dt className='text-muted-foreground'>ステータス</dt>
											<dd className='font-medium text-foreground'>
												{order.status}
											</dd>
										</div>
									</dl>
								</section>
							) : null}

							<section className='space-y-3'>
								<h2 className='text-base font-semibold'>入力ガイド</h2>
								<ol className='space-y-3 text-muted-foreground'>
									<li>
										<div className='font-medium text-foreground'>
											1. キャンセル内容
										</div>
										<p className='mt-0.5 text-xs'>
											対象と金額を確定し、必要なら理由や備考を残します。
										</p>
									</li>
									<li>
										<div className='font-medium text-foreground'>2. 請求先</div>
										<p className='mt-0.5 text-xs'>
											請求先名と支払期限を確認します。
										</p>
									</li>
									<li>
										<div className='font-medium text-foreground'>3. 送信</div>
										<p className='mt-0.5 text-xs'>
											送信先と文面を確認して請求を作成します。
										</p>
									</li>
								</ol>
							</section>

							<section className='space-y-3 border-t pt-5'>
								<h2 className='text-base font-semibold'>確認ポイント</h2>
								<ul className='space-y-2 text-xs text-muted-foreground'>
									<li>キャンセル料と税額の扱いが運用ルールと合っているか</li>
									<li>支払期限が案内文と一致しているか</li>
									<li>SMSまたはメールの送信先が正しいか</li>
								</ul>
							</section>
						</aside>
					</div>
				</div>
			</MainLayout>
		</V1Layout>
	)
}

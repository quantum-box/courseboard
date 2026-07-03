import { authWithCheck } from 'app/auth'
import { ToastClient } from 'components/toast-client'
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { getDocumentPdfSettings } from 'lib/document-pdf-settings'
import { getServerModePrefix } from 'lib/mode'
import { ArrowLeftIcon, FileImageIcon, SaveIcon } from 'lucide-react'
import Link from 'next/link'
import { saveDocumentPdfSettingsAction } from './actions'

const templateLabels = {
	simple: 'シンプル',
	detailed: '詳細',
	japanese: '和風',
}

export default async function DocumentPdfSettingsPage({
	params: { tenant },
	searchParams,
}: {
	params: { tenant: string }
	searchParams: { documentPdf?: string; documentPdfError?: string }
}) {
	const session = await authWithCheck()
	const settings = await getDocumentPdfSettings(tenant, session.accessToken)
	const prefix = getServerModePrefix(tenant)
	const submit = saveDocumentPdfSettingsAction.bind(null, tenant)

	return (
		<V1Layout current='settings' tenant={tenant}>
			<MainLayout>
				<div className='container mx-auto max-w-4xl space-y-4'>
					<div className='flex items-center justify-between gap-3'>
						<div>
							<h1 className='text-xl font-bold sm:text-2xl'>
								PDFテンプレート設定
							</h1>
							<p className='text-sm text-muted-foreground'>
								見積書・請求書の既定テンプレート、ロゴ、社印をテナント別に保存します。
							</p>
						</div>
						<Button asChild variant='outline'>
							<Link href={`${prefix}/${tenant}/settings`}>
								<ArrowLeftIcon className='mr-2 size-4' />
								設定へ戻る
							</Link>
						</Button>
					</div>

					{searchParams.documentPdf === 'updated' ? (
						<ToastClient
							title='保存しました'
							description='PDFテンプレート設定を保存しました'
							variant='default'
						/>
					) : null}
					{searchParams.documentPdfError ? (
						<ToastClient
							title='保存に失敗しました'
							description={decodeURIComponent(searchParams.documentPdfError)}
							variant='destructive'
						/>
					) : null}

					<Card>
						<CardHeader>
							<CardTitle>書類PDF</CardTitle>
							<CardDescription>
								既存のPDFダウンロードではこの設定を既定値として使います。書類詳細画面ではテンプレートと捺印有無を一時的に上書きできます。
							</CardDescription>
						</CardHeader>
						<CardContent>
							<form action={submit} className='space-y-6'>
								<div className='grid gap-4 md:grid-cols-2'>
									<div className='space-y-2'>
										<Label>既定テンプレート</Label>
										<Select
											name='defaultTemplate'
											defaultValue={settings.defaultTemplate}
										>
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{Object.entries(templateLabels).map(
													([value, label]) => (
														<SelectItem key={value} value={value}>
															{label}
														</SelectItem>
													),
												)}
											</SelectContent>
										</Select>
									</div>
									<label className='flex items-center gap-2 self-end rounded-md border p-3 text-sm'>
										<input
											name='includeSealByDefault'
											type='checkbox'
											defaultChecked={settings.includeSealByDefault}
										/>
										社印を既定でPDFに捺印する
									</label>
								</div>

								<div className='grid gap-4 md:grid-cols-2'>
									<ImageUploadBlock
										label='ロゴ画像'
										name='logoImage'
										accept='image/png,image/jpeg,image/svg+xml'
										image={settings.logoImage}
										removeName='removeLogo'
									/>
									<ImageUploadBlock
										label='社印画像'
										name='sealImage'
										accept='image/png,image/jpeg'
										image={settings.sealImage}
										removeName='removeSeal'
									/>
								</div>

								<Button type='submit'>
									<SaveIcon className='mr-2 size-4' />
									保存
								</Button>
							</form>
						</CardContent>
					</Card>
				</div>
			</MainLayout>
		</V1Layout>
	)
}

function ImageUploadBlock({
	label,
	name,
	accept,
	image,
	removeName,
}: {
	label: string
	name: string
	accept: string
	image?: {
		filename: string
		contentType: string
		dataBase64: string
		updatedAt: string
	}
	removeName: string
}) {
	const src = image
		? `data:${image.contentType};base64,${image.dataBase64}`
		: undefined
	const currentImage = image
	return (
		<div className='space-y-3 rounded-md border p-4'>
			<div className='flex items-center gap-2'>
				<FileImageIcon className='size-4 text-muted-foreground' />
				<Label>{label}</Label>
			</div>
			{src && currentImage ? (
				<div className='flex items-center gap-3 rounded-md bg-muted/40 p-3'>
					<img
						alt={label}
						className='h-16 w-24 rounded border bg-white object-contain p-1'
						src={src}
					/>
					<div className='min-w-0 text-sm'>
						<div className='truncate font-medium'>{currentImage.filename}</div>
						<div className='text-muted-foreground'>
							{new Date(currentImage.updatedAt).toLocaleString('ja-JP')}
						</div>
					</div>
				</div>
			) : (
				<div className='rounded-md border border-dashed p-4 text-sm text-muted-foreground'>
					未設定
				</div>
			)}
			<Input accept={accept} name={name} type='file' />
			{image ? (
				<label className='flex items-center gap-2 text-sm text-muted-foreground'>
					<input name={removeName} type='checkbox' />
					現在の画像を削除する
				</label>
			) : null}
		</div>
	)
}

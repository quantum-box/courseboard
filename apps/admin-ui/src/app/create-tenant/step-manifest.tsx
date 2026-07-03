'use client'

import { Label } from 'components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from 'components/ui/select'

export type ManifestData = {
	squareEnvironment: 'sandbox' | 'production'
}

type Props = {
	data: ManifestData
	onChange: (data: ManifestData) => void
}

export function StepManifest({ data, onChange }: Props) {
	return (
		<div className='grid gap-4'>
			<p className='text-sm text-muted-foreground'>
				テナントのコマース基本設定です。
			</p>

			<div className='grid gap-2'>
				<Label>Square環境</Label>
				<Select
					value={data.squareEnvironment}
					onValueChange={v =>
						onChange({
							...data,
							squareEnvironment: v as 'sandbox' | 'production',
						})
					}
				>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value='sandbox'>Sandbox（テスト環境）</SelectItem>
						<SelectItem value='production'>Production（本番環境）</SelectItem>
					</SelectContent>
				</Select>
				<p className='text-xs text-muted-foreground'>
					Square APIの接続先環境を選択します。テスト時はSandboxを推奨します。
				</p>
			</div>
		</div>
	)
}

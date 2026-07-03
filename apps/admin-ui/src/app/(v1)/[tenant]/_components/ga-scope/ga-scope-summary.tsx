import { Badge } from 'components/ui/badge'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { CheckCircleIcon, InfoIcon, MinusCircleIcon } from 'lucide-react'
import React from 'react'
import {
	GA_SCOPE_DOC_PATH,
	gaExcludedDomains,
	gaIncludedDomains,
	gaScopeLongCopy,
	gaScopeShortCopy,
} from './ga-scope-copy'

type GaScopeSummaryProps = {
	compact?: boolean
	showLongCopy?: boolean
}

export function GaScopeSummary({
	compact = false,
	showLongCopy = false,
}: GaScopeSummaryProps) {
	return (
		<div className='space-y-4'>
			<div className='rounded-md border bg-muted/30 p-4'>
				<p className='text-sm leading-6 text-muted-foreground'>
					{gaScopeShortCopy}
				</p>
			</div>

			<div className='grid gap-4 lg:grid-cols-2'>
				<ScopeDomainCard
					title='対応する機能'
					description='GA included'
					items={gaIncludedDomains}
					icon={<CheckCircleIcon className='h-5 w-5 text-emerald-700' />}
					badgeClassName='border-emerald-200 bg-emerald-50 text-emerald-800'
				/>
				<ScopeDomainCard
					title='現時点でGAネイティブ機能の範囲外'
					description='GA excluded'
					items={gaExcludedDomains}
					icon={<MinusCircleIcon className='h-5 w-5 text-amber-700' />}
					badgeClassName='border-amber-200 bg-amber-50 text-amber-800'
				/>
			</div>

			{showLongCopy ? (
				<Card>
					<CardHeader>
						<CardTitle className='text-base'>説明文</CardTitle>
						<CardDescription>
							{GA_SCOPE_DOC_PATH} の User-Facing Explanation
						</CardDescription>
					</CardHeader>
					<CardContent className='space-y-3'>
						{gaScopeLongCopy.map(paragraph => (
							<p
								key={paragraph}
								className='text-sm leading-6 text-muted-foreground'
							>
								{paragraph}
							</p>
						))}
					</CardContent>
				</Card>
			) : null}

			{compact ? null : (
				<div className='flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700'>
					<InfoIcon className='mt-0.5 h-4 w-4 shrink-0' />
					<p>
						この表示は {GA_SCOPE_DOC_PATH} を出典とし、GA版の製品対象範囲を示します。
					</p>
				</div>
			)}
		</div>
	)
}

function ScopeDomainCard({
	title,
	description,
	items,
	icon,
	badgeClassName,
}: {
	title: string
	description: string
	items: string[]
	icon: React.ReactNode
	badgeClassName: string
}) {
	return (
		<Card>
			<CardHeader className='space-y-1'>
				<div className='flex items-center gap-2'>
					{icon}
					<CardTitle className='text-base'>{title}</CardTitle>
				</div>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				<div className='flex flex-wrap gap-2'>
					{items.map(item => (
						<Badge key={item} variant='outline' className={badgeClassName}>
							{item}
						</Badge>
					))}
				</div>
			</CardContent>
		</Card>
	)
}

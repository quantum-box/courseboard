import { Badge } from 'components/ui/badge'
import React from 'react'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from 'components/ui/table'
import type { Route } from 'next'
import Link from 'next/link'
import type { CloseReadinessSummary } from '../../procurement/_lib/erp-api'

type Props = {
	prefix: string
	tenant: string
	readiness: CloseReadinessSummary | null
}

function severityLabel(severity: string): string {
	return severity === 'warning' ? '警告' : '要対応'
}

function severityVariant(
	severity: string,
): 'default' | 'destructive' | 'outline' {
	return severity === 'warning' ? 'outline' : 'destructive'
}

function withTenantPath(
	prefix: string,
	tenant: string,
	drilldownUrl: string,
): Route {
	const path = drilldownUrl.startsWith('/') ? drilldownUrl : `/${drilldownUrl}`
	return `${prefix}/${tenant}${path}` as Route
}

export function CloseReadinessCockpit({ prefix, tenant, readiness }: Props) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>締め前コックピット</CardTitle>
				<CardDescription>
					証憑・OCR・ハッシュ検証・支払照合・締め後変更・保全確認を、期間クローズ前の運用チェックとして集約します。
				</CardDescription>
			</CardHeader>
			<CardContent className='space-y-4'>
				{readiness ? (
					<>
						<div className='grid gap-3 md:grid-cols-3'>
							<div className='rounded-lg border p-3'>
								<p className='text-sm text-muted-foreground'>ブロッカー総数</p>
								<p className='text-2xl font-semibold tabular-nums'>
									{readiness.blockerCount}
								</p>
							</div>
							<div className='rounded-lg border p-3'>
								<p className='text-sm text-muted-foreground'>要対応</p>
								<p className='text-2xl font-semibold tabular-nums'>
									{readiness.criticalCount}
								</p>
							</div>
							<div className='rounded-lg border p-3'>
								<p className='text-sm text-muted-foreground'>警告</p>
								<p className='text-2xl font-semibold tabular-nums'>
									{readiness.warningCount}
								</p>
							</div>
						</div>
						{readiness.blockers.length === 0 ? (
							<div className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
								締め前ブロッカーはありません。
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>種別</TableHead>
										<TableHead>件数</TableHead>
										<TableHead>重要度</TableHead>
										<TableHead>Source</TableHead>
										<TableHead>解消メモ</TableHead>
										<TableHead>遷移</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{readiness.blockers.map(blocker => (
										<TableRow key={blocker.kind}>
											<TableCell>
												<div className='space-y-1'>
													<p className='font-medium'>{blocker.label}</p>
													<p className='text-xs text-muted-foreground'>
														{blocker.description}
													</p>
												</div>
											</TableCell>
											<TableCell className='tabular-nums'>
												{blocker.count}
											</TableCell>
											<TableCell>
												<Badge variant={severityVariant(blocker.severity)}>
													{severityLabel(blocker.severity)}
												</Badge>
											</TableCell>
											<TableCell className='max-w-64 truncate text-xs'>
												<span className='font-mono'>
													{blocker.sourceType}
													{blocker.sourceId ? `:${blocker.sourceId}` : ''}
												</span>
											</TableCell>
											<TableCell className='max-w-80 text-xs text-muted-foreground'>
												{blocker.remediationHint}
											</TableCell>
											<TableCell>
												<Link
													className='text-sm font-medium text-primary underline-offset-4 hover:underline'
													href={withTenantPath(
														prefix,
														tenant,
														blocker.drilldownUrl,
													)}
												>
													詳細
												</Link>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</>
				) : (
					<div className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
						締め前コックピットを取得できませんでした。
					</div>
				)}
			</CardContent>
		</Card>
	)
}

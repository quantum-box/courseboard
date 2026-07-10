import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from 'components/ui/card'
import { Progress } from 'components/ui/progress'
import { getSdkWithAuth } from 'lib/graphqlClientWithAuth'

export async function WeeklyCard({ tenantId }: { tenantId: string }) {
	let recurringRevenue: {
		amount: number
		changePercentage?: number | null | undefined
	} | null = null

	try {
		const sdk = await getSdkWithAuth(tenantId)
		const result = await sdk.currentWeeklyRevenue({
			endDate: new Date().toISOString().split('T')[0],
		})
		recurringRevenue = result.recurringRevenue
	} catch {
		// API may not have order data yet
	}

	return (
		<Card>
			<CardHeader className='pb-2'>
				<CardDescription>今週</CardDescription>
				<CardTitle className='text-4xl'>
					¥{(recurringRevenue?.amount ?? 0).toLocaleString()}
				</CardTitle>
			</CardHeader>
			<CardContent>
				{recurringRevenue?.changePercentage != null && (
					<div className='text-xs text-muted-foreground'>
						先週比{' '}
						{recurringRevenue.changePercentage > 0
							? `+${recurringRevenue.changePercentage}`
							: recurringRevenue.changePercentage}
						%
					</div>
				)}
			</CardContent>
			<CardFooter>
				{recurringRevenue?.changePercentage != null && (
					<Progress
						value={Math.abs(recurringRevenue.changePercentage)}
						aria-label={`${
							recurringRevenue.changePercentage > 0 ? '増加' : '減少'
						}率 ${Math.abs(recurringRevenue.changePercentage)}%`}
					/>
				)}
			</CardFooter>
		</Card>
	)
}

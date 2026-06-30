import { Card, CardContent, CardHeader } from 'components/ui/card'
import { Skeleton } from 'components/ui/skeleton'
import { MainLayout } from 'components/v1-layout'

export default function InvoicesLoading() {
	return (
		<MainLayout>
			<div className='flex items-center justify-between gap-3'>
				<div className='space-y-2'>
					<Skeleton className='h-8 w-40' />
					<Skeleton className='h-4 w-72' />
				</div>
				<Skeleton className='h-10 w-28' />
			</div>
			<div className='grid gap-3 md:grid-cols-4'>
				{Array.from({ length: 4 }).map((_, index) => (
					<Card key={index}>
						<CardContent className='space-y-2 p-4'>
							<Skeleton className='h-4 w-20' />
							<Skeleton className='h-7 w-28' />
							<Skeleton className='h-3 w-24' />
						</CardContent>
					</Card>
				))}
			</div>
			<Card>
				<CardHeader>
					<Skeleton className='h-6 w-32' />
				</CardHeader>
				<CardContent className='space-y-3'>
					{Array.from({ length: 6 }).map((_, index) => (
						<Skeleton key={index} className='h-10 w-full' />
					))}
				</CardContent>
			</Card>
		</MainLayout>
	)
}

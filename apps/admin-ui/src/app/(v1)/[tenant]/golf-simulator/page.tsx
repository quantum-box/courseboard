import { Badge } from 'components/ui/badge'
import { MainLayout, V1Layout } from 'components/v1-layout'
import { GolfSimulatorClient } from './golf-simulator-client'

export const metadata = {
	title: 'ゴルフ料金計算 | TACHYON Field',
	description: 'Golf fee calculation and revenue range simulation.',
}

export default function GolfSimulatorPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	return (
		<V1Layout current='golf-simulator' tenant={tenant}>
			<MainLayout>
				<div className='flex flex-col gap-2 md:flex-row md:items-start md:justify-between'>
					<div className='space-y-1'>
						<h1 className='text-2xl font-semibold'>ゴルフ料金計算</h1>
						<p className='max-w-3xl text-sm text-muted-foreground'>
							tachyonfield-golf Cloud App API を利用して、ゴルフ場利用税と売上幅を計算します。
						</p>
					</div>
					<Badge variant='outline'>tachyonfield-golf</Badge>
				</div>
				<GolfSimulatorClient />
			</MainLayout>
		</V1Layout>
	)
}

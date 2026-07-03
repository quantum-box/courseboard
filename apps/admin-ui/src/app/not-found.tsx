import { Button } from 'components/ui/button'
import { MainLayout, V1Layout } from 'components/v1-layout'
import Link from 'next/link'

export default function NotFound() {
	return (
		<MainLayout>
			<div className='w-full text-center my-10'>
				<h1 className='text-4xl font-bold mb-2'>404 - Not Found</h1>
				<p className='text-gray-500 mb-6'>お探しのページは存在しません。</p>
				<Button asChild>
					<Link href='/'>ホームに戻る</Link>
				</Button>
			</div>
		</MainLayout>
	)
}

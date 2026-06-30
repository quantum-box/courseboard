import type { ProductListForCustomerFragment } from 'gen/graphql'

export function ProductListForCustomer(props: {
	data: ProductListForCustomerFragment[]
}) {
	return (
		<div className='mx-auto max-w-screen-lg'>
			<h1 className='my-12 text-gray-700 m-4'>商品一覧</h1>
			<ul className='grid grid-cols-3 gap-3'>
				{props.data.map(product => (
					<li
						key={product.id}
						className='p-4 bg-white border shadow rounded hover:bg-gray-100 hover:shadow-xl cursor-pointer flex flex-col justify-between gap-8'
					>
						<div className='flex flex-col items-center gap-2'>
							<h3 className='text-semibold w-full text-left'>{product.name}</h3>
							<p className='text-sm'>{product.description}</p>
							<p className='text-2xl text-gray-800 w-full'>
								{product.listPrice}円{' '}
								<span className='text-sm text-gray-500'>（税抜）</span>
							</p>
						</div>
						<button
							className='rounded-full border-2 border-blue-600 text-blue-600 text-xl text-center w-3/4 py-2 mx-auto'
							type='button'
						>
							詳細を見る
						</button>
					</li>
				))}
			</ul>
		</div>
	)
}

import { type ProductPriceTableForCustomerFragment } from 'gen/graphql'
import { RecurringBillingFrequency } from 'lib/product-constants'

export function ProductPriceTableForCustomer(props: {
	data: ProductPriceTableForCustomerFragment[]
}) {
	const monthly = props.data.filter(
		v => v.billingCycle === RecurringBillingFrequency.Monthly,
	)
	return (
		<div className='mx-auto max-w-screen-lg'>
			<h1 className='my-12 text-gray-700 m-4'>商品一覧</h1>
			<div className='shadow-xl border rounded p-2'>
				<table className='table-fixed w-full text-center'>
					<thead>
						<tr>
							{monthly.map(product => (
								<th key={product.id}>{product.name}</th>
							))}
						</tr>
					</thead>
					<tbody>
						<tr>
							{monthly.map(product => (
								<td key={product.id}>{product.listPrice}</td>
							))}
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	)
}

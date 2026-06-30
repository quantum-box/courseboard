import { redirect } from 'next/navigation'

export default function GolfReservationProductsAliasPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	redirect(`/${tenant}/extensions/golf-course/reservation-products`)
}

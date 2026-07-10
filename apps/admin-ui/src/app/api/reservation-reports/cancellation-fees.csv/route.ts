import { type NextRequest } from 'next/server'
import { proxyReservationReport } from '../report-route'

export async function GET(req: NextRequest) {
	return proxyReservationReport(
		req,
		'cancellation-fees.csv',
		'/v1/erp/reservation-reports/cancellation-fees.csv',
	)
}

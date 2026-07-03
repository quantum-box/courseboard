import { type NextRequest } from 'next/server'
import { proxyReservationReport } from '../report-route'

export async function GET(req: NextRequest) {
	return proxyReservationReport(
		req,
		'reservations.csv',
		'/v1/erp/reservations/export.csv',
	)
}

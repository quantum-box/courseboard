import { redirect } from 'next/navigation'

export default function GolfSettlementAliasPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	redirect(`/${tenant}/extensions/golf-course/settlement`)
}

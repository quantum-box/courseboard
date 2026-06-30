import { NewImport } from 'components/new-import'
import { V1Layout } from 'components/v1-layout'
import type { Route } from 'next'
import { createBridgeDefinitionAction } from '../actions'

export default function NewImportPage({
	params: { tenant },
}: {
	params: { tenant: string }
}) {
	return (
		<V1Layout current='imports' tenant={tenant}>
			<NewImport
				action={createBridgeDefinitionAction.bind(null, tenant)}
				backLink={`/${tenant}/imports` as Route}
			/>
		</V1Layout>
	)
}

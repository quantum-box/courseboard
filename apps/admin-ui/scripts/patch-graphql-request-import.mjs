import { readFileSync, writeFileSync } from 'node:fs'

const generatedFile = new URL('../src/gen/graphql.ts', import.meta.url)
const externalImports = `import { GraphQLClient } from 'graphql-request';
import { GraphQLClientRequestHeaders } from 'graphql-request/build/cjs/types';`
const nativeFetchImport =
	"import { GraphQLClient, type GraphQLClientRequestHeaders } from 'lib/graphql-request';"

const source = readFileSync(generatedFile, 'utf8')

if (!source.includes(externalImports)) {
	if (source.includes(nativeFetchImport)) {
		process.exit(0)
	}

	throw new Error(
		'Unable to patch generated GraphQL SDK imports. The generated import shape changed.',
	)
}

writeFileSync(
	generatedFile,
	source.replace(externalImports, nativeFetchImport),
)

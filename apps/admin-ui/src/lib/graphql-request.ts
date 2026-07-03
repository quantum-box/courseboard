import { print, type DocumentNode } from 'graphql'
import { fetchWithRetry, ReliableFetchError } from './reliable-fetch'

export type GraphQLClientRequestHeaders = Record<string, string>

type RequestDocument = string | DocumentNode
type Variables = Record<string, unknown> | undefined

type GraphQLResponse<T> = {
	data?: T
	errors?: Array<{
		message: string
		extensions?: Record<string, unknown>
	}>
}

type ClientOptions = {
	headers?: GraphQLClientRequestHeaders
	resolveHeaders?: (
		headers: GraphQLClientRequestHeaders,
	) => Promise<GraphQLClientRequestHeaders>
}

type GraphQLRequestContext = {
	query: string
	variables?: Variables
}

export class ClientError extends Error {
	response: GraphQLResponse<unknown> & {
		status: number
		headers: Headers
	}
	request: GraphQLRequestContext

	constructor(
		response: GraphQLResponse<unknown>,
		fetchResponse: Response,
		request: GraphQLRequestContext,
	) {
		const errorResponse = {
			...response,
			status: fetchResponse.status,
			headers: fetchResponse.headers,
		}
		const message = `${extractMessage(errorResponse)}: ${JSON.stringify({
			response: errorResponse,
			request,
		})}`

		super(message)
		this.name = 'ClientError'
		this.response = errorResponse
		this.request = request
	}
}

export class GraphQLClient {
	private readonly endpoint: string
	private readonly headers: GraphQLClientRequestHeaders
	private readonly resolveHeaders?: ClientOptions['resolveHeaders']

	constructor(endpoint: string, options: ClientOptions = {}) {
		this.endpoint = endpoint
		this.headers = options.headers ?? {}
		this.resolveHeaders = options.resolveHeaders
	}

	async request<T>(
		document: RequestDocument,
		variables?: Variables,
		requestHeaders: GraphQLClientRequestHeaders = {},
	): Promise<T> {
		const query = typeof document === 'string' ? document : print(document)
		const request = {
			query,
			variables,
		}
		const headers = {
			'content-type': 'application/json',
			...this.headers,
			...requestHeaders,
		}
		const resolvedHeaders = this.resolveHeaders
			? await this.resolveHeaders(headers)
			: headers
		const fetchResult = await fetchWithRetry(this.endpoint, {
			method: 'POST',
			headers: resolvedHeaders,
			body: JSON.stringify({
				query,
				variables,
			}),
		})
		if (!fetchResult.ok) {
			throw new ReliableFetchError(fetchResult.error)
		}

		const response = fetchResult.response
		const result = await parseGraphqlResponse<T>(response)
		if (!response.ok || result.errors?.length) {
			throw new ClientError(result, response, request)
		}

		return result.data as T
	}
}

function extractMessage(
	response: GraphQLResponse<unknown> & { status: number },
): string {
	return (
		response.errors?.[0]?.message ?? `GraphQL Error (Code: ${response.status})`
	)
}

async function parseGraphqlResponse<T>(
	response: Response,
): Promise<GraphQLResponse<T>> {
	try {
		return (await response.json()) as GraphQLResponse<T>
	} catch {
		return {
			errors: [
				{
					message: `GraphQL request failed with status ${response.status}`,
				},
			],
		}
	}
}

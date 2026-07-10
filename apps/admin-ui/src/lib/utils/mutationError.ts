import { useToast } from 'components/ui/use-toast'
import type { ApiError } from 'lib/graphqlClient'

export function useMutationError() {
	const { toast } = useToast()

	const errorToast = (title: string, error: unknown) => {
		console.error(error)
		let errorDetails: ApiError | null = null

		if (error instanceof Error) {
			const match = error.message.match(/Error:.*?:(.*)/s)
			if (match) {
				try {
					const errorJson = JSON.parse(match[1].trim())
					if ('response' in errorJson && 'errors' in errorJson.response) {
						errorDetails = errorJson as ApiError
						for (const err of errorDetails.response.errors) {
							toast({
								title,
								description: err.message,
								variant: 'destructive',
							})
						}
					}
				} catch (jsonError) {
					console.error('JSON解析エラー:', jsonError)
					toast({
						title,
						description: 'エラー情報の解析に失敗しました。',
						variant: 'destructive',
					})
				}
			} else {
				toast({
					title,
					description: error.message,
					variant: 'destructive',
				})
			}
		} else {
			toast({
				title,
				description: '予期せぬエラーが発生しました。',
				variant: 'destructive',
			})
		}

		console.log(JSON.stringify(errorDetails, null, 2))
	}

	return { toast, errorToast }
}

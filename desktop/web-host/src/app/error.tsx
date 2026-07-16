'use client'

export default function ErrorPage({ reset }: { reset: () => void }) {
	return (
		<main>
			<h1>Course Boardを読み込めませんでした</h1>
			<button type='button' onClick={reset}>再読み込み</button>
		</main>
	)
}

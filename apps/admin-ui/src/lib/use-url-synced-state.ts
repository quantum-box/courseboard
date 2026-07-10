'use client'

import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'

type UseUrlSyncedStateOptions<T> = {
	isEqual?: (left: T, right: T) => boolean
}

const isSameValue = <T>(left: T, right: T): boolean => Object.is(left, right)

export function useUrlSyncedState<T>(
	value: T,
	options: UseUrlSyncedStateOptions<T> = {},
): [T, Dispatch<SetStateAction<T>>] {
	const { isEqual = isSameValue } = options
	const [state, setState] = useState(value)

	useEffect(() => {
		setState(current => (isEqual(current, value) ? current : value))
	}, [isEqual, value])

	return [state, setState]
}

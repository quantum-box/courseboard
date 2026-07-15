import { getRuntimeEnv } from 'lib/runtime-env'

export const COURSEBOARD_REACT_ENTRY_PATH = '/courseboard-ui/index.html#/golf'

export function resolveCourseboardRootRedirect(enabled: string | undefined) {
	return enabled === 'true' ? COURSEBOARD_REACT_ENTRY_PATH : undefined
}

export function getCourseboardRootRedirect() {
	return resolveCourseboardRootRedirect(
		getRuntimeEnv('COURSEBOARD_REACT_ROOT'),
	)
}

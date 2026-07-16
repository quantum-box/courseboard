const noop = (...args) => args[0]

const sentryNoop = new Proxy(noop, {
	apply(_target, _thisArg, args) {
		return args[0]
	},
	get() {
		return noop
	},
})

export const init = noop
export const captureException = noop
export const captureRequestError = noop
export const withSentryConfig = (config) => config
export default sentryNoop

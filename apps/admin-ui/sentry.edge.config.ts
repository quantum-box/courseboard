// Keep the edge runtime free of @sentry/nextjs on Cloudflare Workers.
// The Sentry edge bundle currently depends on XMLHttpRequest during OAuth
// callbacks, which is not available in the Workers runtime.
export {}

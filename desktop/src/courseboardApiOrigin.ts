const PREVIEW_ORIGIN_PATTERN = /^https:\/\/pr(\d+)--courseboard\.txcloud\.app$/

export function previewCourseboardApiBaseUrl(origin: string): string | undefined {
  const match = PREVIEW_ORIGIN_PATTERN.exec(origin)
  return match ? `https://pr${match[1]}--courseboard-api.txcloud.app` : undefined
}

export function courseboardApiBaseUrlForOrigin(configured: string, origin: string): string {
  return previewCourseboardApiBaseUrl(origin) ?? configured.replace(/\/+$/, '')
}

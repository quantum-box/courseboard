/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COURSEBOARD_AUTH_MODE?: string
  readonly VITE_COURSEBOARD_API_BEARER?: string
  readonly VITE_COURSEBOARD_MOCK_DATA?: string
  readonly VITE_COURSEBOARD_TENANT_ID?: string
  readonly VITE_COURSEBOARD_TENANT_NAME?: string
  readonly VITE_COURSEBOARD_TENANT_SLUG?: string
  readonly VITE_COURSEBOARD_PLATFORM_ID?: string
  readonly VITE_COURSEBOARD_OPERATOR_ID?: string
  readonly VITE_COURSEBOARD_MODE?: string
  readonly VITE_COURSEBOARD_API_BASE_URL?: string
  readonly VITE_COURSEBOARD_PUBLIC_API_BASE_URL?: string
  readonly VITE_COURSEBOARD_OPERATOR_WEB_URL?: string
  readonly VITE_DEV_API_PROXY_TARGET?: string
  readonly VITE_AUTH_PROXY_TARGET?: string
  readonly VITE_COURSEBOARD_BROWSER_CLIENT_ID?: string
  readonly VITE_COURSEBOARD_BROWSER_CLIENT_SECRET?: string
  readonly VITE_COURSEBOARD_BROWSER_REDIRECT_URI?: string
  readonly VITE_COURSEBOARD_BROWSER_LOGIN_ENDPOINT?: string
  readonly VITE_COURSEBOARD_BROWSER_AUTHORIZATION_ENDPOINT?: string
  readonly VITE_COURSEBOARD_BROWSER_TOKEN_ENDPOINT?: string
  readonly VITE_COURSEBOARD_BROWSER_PROFILE_ENDPOINT?: string
  readonly VITE_COURSEBOARD_BROWSER_SCOPES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

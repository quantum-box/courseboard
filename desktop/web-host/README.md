# Course Board Web Host

Auth.js/Cognito and Field API BFF host for the shared React/Tauri Course Board UI.

## Local Development

```bash
corepack enable
pnpm install --frozen-lockfile
cd ..
npm run auth:env
cd web-host
pnpm dev
```

In another terminal, start Vite and open `http://127.0.0.1:5173`:

```bash
cd desktop
npm run dev -- --host 127.0.0.1
```

`npm run auth:env` creates or reuses the local confidential Cognito client and
writes its secret only to the ignored `web-host/.env.local` with mode `0600`.
The browser uses the same Auth.js cookie and Cognito refresh path as production.

## Photon Engine / Live Integration

The `/[tenant]/photon` workspace projects ERP records into Photon surfaces:
Table, Kanban, Docs, Files, Workflow, Chat context, and Sync Dashboard. The
runtime reads Photon settings from env and degrades to warnings when optional
sync values are missing.

Required non-secret env names:

```dotenv
VITE_PHOTON_DEPLOYMENT_MODE=local
VITE_PHOTON_TENANT_ID=tn_01hjjn348rn3t49zz6hvmfq67p
VITE_PHOTON_TENANT_NAME=TACHYON Field
VITE_PHOTON_WORKSPACE_ID=erp
VITE_PHOTON_WORKSPACE_NAME=TACHYON Field ERP
VITE_PHOTON_APP_SERVER_BACKEND=external-api
VITE_PHOTON_API_BASE_URL=http://localhost:50056
VITE_PHOTON_ENGINE_PUSH_PATH=/api/engine/push
VITE_PHOTON_ENGINE_PULL_PATH=/api/engine/pull
VITE_PHOTON_SYNC_BACKEND=rust-server
VITE_PHOTON_SYNC_WS_URL=ws://localhost:3001/ws
VITE_PHOTON_SYNC_ENABLED=true
VITE_PHOTON_RUNTIME_MODE=read_projection
```

Use `local`, `preview`, or `cloud` for `VITE_PHOTON_DEPLOYMENT_MODE`.
`preview` and `cloud` default the Live backend to
`cloudflare-durable-object`; `local` defaults to `rust-server`.

Preview/cloud validation:

```dotenv
VITE_PHOTON_DEPLOYMENT_MODE=cloud
VITE_PHOTON_API_BASE_URL=https://tachyon-field-api.txcloud.app
VITE_PHOTON_SYNC_BACKEND=cloudflare-durable-object
VITE_PHOTON_SYNC_WS_URL=wss://field-client.n1.tachy.one/ws
```

Do not commit credential values. Put auth secrets such as `NEXTAUTH_SECRET` and
`COGNITO_CLIENT_SECRET` in the deployment secret store or a private local env
file.

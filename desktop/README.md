# Course Board — Course Map

Course Board の React + Vite UI。ブラウザで開ける Web UI として動き、
デフォルト画面ではキャンセル料のSMS徴収リンクを作成する。SMSで開く公開支払いページは
`/#/pay/{token}` で、Stripe Payment Element を表示する。
Tauri wrapper で起動した場合はローカルのカート位置 WebSocket simulator も一緒に立ち上がる。

- フロントエンド: React 19 + Three.js (WebGL 2D top-down)
- ローカル wrapper: Tauri v2 (Rust)
- 同期: 内部 WebSocket サーバ (`ws://127.0.0.1:9001/ws`) からカート位置を 5 Hz でブロードキャスト
- データ層: [photon-engine](https://github.com/quantum-box/photon/tree/main/packages/photon-engine) を Rust 依存に取り込み済み（コース/ホール定義の durable 永続化に利用予定）

## セットアップ

```bash
cd desktop
npm install
```

## 起動

```bash
# Web UI としてブラウザで起動
VITE_COURSEBOARD_API_BASE_URL=http://localhost:8080 npm run dev

# Tauri wrapper で起動
npm run tauri:dev
```

`npm run dev` はブラウザで開ける。Field admin iframe内では query parameter の
`proxyBase` を使って認証付きAPIを呼び、ローカル直開きでは `VITE_COURSEBOARD_API_BASE_URL`
を使う。

`tauri:dev` で立ち上げると、Tauri Rust 側がアプリ起動と同時に `127.0.0.1:9001` に
WebSocket サーバを開き、ダミーカート 7 台が円周ループで動き続ける。
`/#/course-map` を開くとフロントが自動接続して Three.js でカートマーカーを更新する。

## 構成

```
desktop/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── src/
│   ├── App.tsx                    # 画面シェル / hash route
│   ├── CollectionConsole.tsx      # SMS徴収リンク作成
│   ├── PaymentPage.tsx            # Stripe支払いページ
│   ├── api.ts                     # Course Board API client
│   ├── main.tsx
│   ├── styles.css
│   ├── types.ts                   # CourseGeometry / CartUpdate
│   ├── data/course.ts             # 18 ホール分のジオメトリ
│   ├── components/CourseMap.tsx   # Three.js WebGL レンダラ
│   └── hooks/useCartUpdates.ts    # WebSocket クライアント
└── src-tauri/
    ├── Cargo.toml                 # photon-engine を git 依存に追加
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/default.json
    └── src/
        ├── main.rs
        ├── lib.rs                 # Tauri エントリ + ws_server 起動
        ├── ws_server.rs           # tokio-tungstenite WS サーバ
        ├── cart_simulator.rs      # ダミーカート位置シミュレータ
        └── photon_bridge.rs       # photon-engine apply_operation を再エクスポート
```

## 今後のTODO

- ホール選択 / 全体図切り替え (空沼/藻岩 など)
- 実カート機器からの位置データ受信 (現状はモック)
- photon-engine + Photon Live (Yjs/WS) でコース定義の協調編集
- アイコンファイル整備して `npm run tauri:build` を通す

# キャディ配置画面のタブ分離 検証レポート

## 対象

- Route: `/golf/caddies/dispatch`
- 対象build/commit: desktop `0.1.10`（commitはPR作成後に記録）
- Preview URL: 未確定（Ready PR作成後に記録）
- 検証日: 2026-09-01
- Linear issue: なし（ユーザー直依頼）

## 検証方針

この変更では、ローカル/mock、CI/PR、Preview API、認証済みブラウザを別ゲートとして扱う。
画面がbuildできたことだけではPreviewでの認証済み動作を証明しない。実データを変更する確認は
明示的なテスト対象に限り、終了後に後始末する。

## ローカル / mock

状態: 成功

- [x] `cd desktop && npm run type-check`
- [x] `cd desktop && npm run test`
- [x] `cd desktop && npm run build`
- [x] `git diff --check`
- [x] タブ初期値、`tab=duties`、欠落 `tab` の `rounds` fallback
- [x] `date` と `tab` の相互保持
- [x] タブの表示境界（ラウンド配置4ブロック / 別業務パネル）
- [ ] 予約0件、全件配置済み、7日/14日空、別業務0件の空状態
- [x] タブARIA、左右矢印、Home/End、フォーカス表示
- [ ] 既存の手動配置、自動配置preview/確定、別業務登録/解除、付け替えの回帰

実行結果:

```text
type-check: 成功
test: 108 files / 923 tests passed（最新mainへrebase後）
build: 成功（Vite 6.4.3、2171 modules transformed）
git diff --check: 成功
browser: local fixture でラウンド配置 / 別業務、date/tab URL保持、console warning/error 0件
design QA: design-qa.md final result passed
```

## CI / PR

状態: 未実施

- [ ] Ready PRを作成（タイトルに `[codex]` を付けない）
- [ ] 必須CIの全job成功を確認
- [ ] CIでdesktopのtest/type-check/buildが成功したことを確認
- [ ] CIでAPI/DB/authzに不要な変更がないことを差分で確認

PR/CI結果:

```text
未実施
```

## Preview

状態: 未実施

- [ ] Preview build/deployment IDとURLを記録
- [ ] 認証済みoperatorで対象tenantの `/golf/caddies/dispatch` を開く
- [ ] タブが画面内の最上段の操作要素にあり、共通サマリーが直下にある
- [ ] ラウンド配置タブで未配置、自動配置、配置済み、判断材料の順と表示境界を確認
- [ ] 別業務タブで別業務一覧・空き時間のあるキャディ・登録/解除導線を確認
- [ ] `date` と `tab` を含むURLの直接表示、再読み込み、タブ変更、日付変更、戻る/進むを確認
- [ ] 予約0件と全件配置済み、7日/14日空、別業務0件を実データまたは安全なfixtureで確認
- [ ] 手動配置、自動配置、別業務登録/解除、配置済み付け替え後に一覧とサマリーが更新されることを確認
- [ ] 狭い幅でタブ・サマリー・主要ボタンが欠けず、キーボード操作とfocus ringを確認

Preview結果:

```text
未実施
```

## API / DB / authz boundary

状態: ローカル差分確認済み（Preview確認待ち）

- [x] 新規endpoint、migration、DBテーブル/列の追加がない
- [x] `src/course_authz.rs` と既存actionの変更がない
- [x] 既存のCourseBoard API/Field API呼び出しが同じ契約である
- [ ] Previewの認証・tenant scope・provider error表示に後退がない

## 未確認・フォローアップ

- Previewの認証済みブラウザ確認までは本変更をリリース確認済みと扱わない。
- Previewで権限、実データ、Field接続が不足した場合は、失敗したゲートと未確認のゲートを分けて記録する。
- API/DB/authz変更が必要と判明した場合は、本タスクでは実装せず別タスクとして切り出す。

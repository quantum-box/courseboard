# 受付票の追加項目キー入力でフォーカスが外れる問題を直す

## 概要

受付票の項目設定で追加項目のキーを編集すると、最初の入力直後にフォーカスが外れ、続けて文字を入力できない状態だった。追加項目の行を識別する React の `key` に、編集中に変化する `fieldKey` を使用していたため、入力のたびに行全体が再生成されていた。行の安定した並び順を描画キーに使い、入力中の DOM 要素とフォーカスを維持する。

## 対応

1. `ReceptionFieldSettingsPanel` の追加項目行を `sortOrder` で識別する。
2. 項目キー変更後も同じ input がフォーカスを保持する回帰テストを追加する。
3. 保存 API、項目キーの検証、並べ替え、削除の挙動は変更しない。

## 対象

- `desktop/src/features/golf/customers/reception/ReceptionPage.tsx`
- `desktop/src/features/settings/ReceptionFieldsPage.analysis.test.tsx`

## 関連

- Linear issue: なし
- DD / ADR: なし。局所的な描画識別子の修正であり、API・DB・認可・UI ワークフローは変更しない。

## 完了条件

- 項目キーを複数文字連続で入力できる。
- 入力後も対象 input がフォーカスを保持する。
- frontend の型チェック、build、対象テストが成功する。
- ローカルブラウザで保存せずに入力挙動を確認する。

## 残タスク

- PR merge 後の build・deployment と本番画面への反映は別ゲートとして確認する。

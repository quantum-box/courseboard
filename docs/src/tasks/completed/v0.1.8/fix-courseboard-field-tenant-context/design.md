# Courseboard Field tenant context伝播の設計

## 背景

Reactは選択tenantから`operatorId`と`platformId`を組み立て、courseboard-apiへ両headerを送る。Fieldの認証・認可はbearerだけでなく両tenant headerをTachyon Authへ委譲する。一方、courseboard-apiのcourse gatewayは`GatewayCredentials`にoperatorしか保持せず、platformを失っていた。

## 採用案

`GatewayCredentials`へoptionalな`platform_id`を追加する。HTTP境界で`x-platform-id`を空白除去して読み、存在する場合のみ全Field gateway requestへ転送する。必須化は行わず、既存Tauri/local clientとの後方互換性を保つ。

Field URL、bearer override、operatorの選択規則は変更しない。proxy経路が既に採る「認証済みbearerとtenant headersを透過する」規則へcourse gatewayも揃える。

## 代替案

- `x-platform-id`を本番固定値で補完する案: 選択tenantごとの親platformが異なる場合に誤った権限文脈を作るため不採用。
- `x-platform-id`を必須にする案: 古いTauri/local clientを即時に400へ変えるため不採用。
- Field policyを緩和する案: Courseboard側の情報欠落を隠し、tenant境界を弱めるため不採用。

## セキュリティ

courseboard-apiはbearerを先に検証する。header値から権限を自己判定せず、Field/Tachyon Authがbearer subjectとtenant関係を検証する。platform headerを生成・固定せず、認証済みclientが選択した文脈を透過する。

## 検証

- request builder unit testでoperator/platform/bearerとtimeoutを確認する。
- platform省略時にheaderを付けない互換性testを追加する。
- provider errorがCORS付きJSON 502になるtestを維持する。
- previewでCourseboard tenantとField Golf Sandboxの名簿APIを実測する。

## ADR判定

新しいarchitecture decisionではない。ADR-0002で定めたcourseboard-api所有のField proxy/統制境界を、既存proxy実装と一貫させる修正であるため、新ADRは作成しない。

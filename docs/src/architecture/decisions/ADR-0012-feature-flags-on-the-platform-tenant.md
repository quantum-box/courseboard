# ADR-0012: CourseBoardのフィーチャーフラグはplatformテナントに置く

## Status

Accepted (2026-08-22)

## Context

ゴルフ場ごとに機能の出し分けをしたい。新しい画面を全テナントへ同時に出さず、
1つのゴルフ場で確かめてから広げる経路が要る。

フラグ評価の経路自体はすでにある。CourseBoardの `/v1/course/feature-flags/evaluate` が
利用者のbearerと `x-operator-id` をTachyonの `/v1/graphql` へ転送し、
`featureFlagValues(keys)` を叩く。キーは `feature.courseboard.` 接頭辞のみを許す。
しかし登録キーは疎通確認用の1つだけで、フラグで出し分けている画面は存在しなかった。

置き場を調べたところ、**フラグはhost / platformテナントに置いたものだけが評価される**。
利用者テナント（Operator）に置いたものはtachyon-appsが読み込んだうえで捨てる。

```rust
// tachyon-apps packages/feature_flag/src/configuration/mod.rs
if matches!(hierarchy.tenant_type, TenantType::Operator) {
    debug!("Operator-level feature flags are ignored; migrate them to platform or host");
}
```

`/v1/me` で実テナントを確認すると、CourseBoardの利用テナントはいずれもTachyon自身の
platformの配下にいた。CourseBoard専用のplatformは存在しない。

| テナント | platform |
|---|---|
| 札幌カントリー倶楽部 | `tn_01hjjn348rn3t49zz6hvmfq67p`（本番） |
| courseboard | `tn_01hjjn348rn3t49zz6hvmfq67p`（本番） |
| 札幌カントリー倶楽部デモ用アカウント | `tn_01hjryxysgey07h5jz5wagqj0m`（サンドボックス） |

## Decision

CourseBoardのフラグは、`kind: FeatureFlags` manifestとして本リポジトリで宣言し、
**Tachyonのplatformテナントへapplyする**。本番とサンドボックスで2本持つ。

- 宣言（キー・表示名・説明）はリポジトリが正。`.tachyon/manifests/courseboard-flags*.yml`
- ON/OFFと出し先の絞り込みは管理画面が正。manifestに `evaluationStrategy` は書けない
- `enabled` はmanifestに書かない。書くとapplyのたびに宣言値へ上書きされ、
  管理画面のトグルが次のapplyで戻る
- 本番platformは他社Operatorも配下にいる共有空間なので、出し先を絞るときは
  管理画面で `TenantTargeting` を設定する
- 接頭辞は `feature.courseboard.` に固定する（CourseBoard側のAPIがそれ以外を拒否する）

画面側は、ルートとフラグの対応表を1箇所に持ち、画面への入口すべてがそれを読む。

- ルータ、サイドバー、ピン留め、ホームのタイル、コマンドパレット（⌘K）
- 対応表: `desktop/src/feature-flags/gated-routes.ts`

**フラグが降りていれば、その画面は存在しないものとして扱う。** 直リンクは404、
入口はどこにも出ない。

**ただし評価できなかったときは隠さない。** フラグは認可ではなく出し分けのswitchで、
ルート自体はAPIの認可を通る。上流が答えられなかっただけで画面を消すと、受付には
理由が何も見えないまま入口が失われる。CLAUDE.mdの「上流が落ちても画面は使えるままに
する」に従い、`error` のときはvisibleにする。隠すのは「フラグが返ってきてOFFだった」
ときだけ。

## Consequences

**Positive**

- ゴルフ場ごとの出し分けができる。デモ用アカウントは物理的に別platformなので、
  サンドボックスで試しても本番に届かない
- 入口が1つの表から導かれるため、サイドバーだけ塞いでタイルが残る、といった
  取りこぼしが起きにくい
- 上流障害で画面が黙って消えない

**Negative**

- **applyが先、デプロイが後**という順序に依存する。`enabled` を書かないので
  新規作成時はfalseであり、画面をフラグで包むコードを先に出すとその画面は404になる
- 本番platformは共有空間で、置いたフラグは配下の全Operatorから見える。
  読むのはCourseBoardだけなので他社アプリの挙動は変わらないが、こちらの私物ではない
- `tachyon manifest apply` は `-f` 省略時に `.tachyon/manifests` 配下を全て
  discoveryする。golf authだけ流すつもりでplatformテナントのフラグにも書き込む
  事故が起こりうる
- 反映に最大60秒かかる（キャッシュのTTLと複数タスク構成）。Kill Switch用途では
  この遅延が前提になる
- モックモードは全フラグをONで返すため、E2EはOFF側を見ない。両方の分岐は
  `desktop/src/feature-flags/gated-routes.test.tsx` が押さえる

## Alternatives Considered

**利用者テナントごとにmanifestを1本ずつ持つ** — Operatorレベルのフラグは
tachyon-appsが明示的に無視するため、そもそも評価に効かない。成立しない。

**Field経由でフラグを引く** — CourseBoardはTachyonの `/v1/graphql` を直接叩いており、
Fieldを経由していない。Fieldに中継を足すのは、ADR-0005の分担に照らして
Fieldへゴルフの都合を持ち込むことになる。

**評価できなかったときも隠す（完全なfail-closed）** — 認可であればそうすべきだが、
フラグは出し分けのswitchであり、ルートの認可はAPI側が別に行う。上流の一時障害で
稼働中の画面が理由の説明もなく消えるほうが、運用上の害が大きい。

## References

- ADR-0005: ゴルフドメインの所有
- `desktop/src/feature-flags/gated-routes.ts` — ルートとフラグの対応表
- `.tachyon/manifests/courseboard-flags-prod.yml` / `courseboard-flags-sandbox.yml`
- tachyon-apps `docs/src/tachyon-apps/feature-flag/iac-manifest.md`

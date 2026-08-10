# SCC-3 コース横断予約商品

## Links

- [設計](./design.md)
- [PLT-3353](https://linear.app/quantum-box/issue/PLT-3353)

## 状態

PLT-3353 を blocker とする。CourseBoard Phase 2a の compatibility 実装は進めるが、
Field deploy 前に canonical writer は解禁しない。

## Plan

- [x] domain を `golfCourseIds` membership に変更し scalar alias を維持する。
- [x] config read を array 優先、scalar fallback、malformed fail closed にする。
- [x] API input で array / scalar の双方を受理し、曖昧入力と空 array を拒否する。
- [x] tee sheet と CourseBoard 予約作成を membership 判定に変更する。
- [x] canonical writer と course → resource 解決を実装し unit test する。
- [x] PLT-3353 deploy 前の production writer gate を閉じる。
- [x] fail-closed 5 パターン、legacy scalar 更新拒否、resource 不在時の全体拒否、
  `availability` 保持を test に固定する。
- [ ] PLT-3353 の deploy と、storefront が `eligibleResourceIds` を選択 resource の
  membership として解釈することを実リクエストで確認する。
- [ ] CourseBoard API の canonical writer gate を解禁して deploy する。
- [ ] CourseBoard SPA に複数 course 選択、array save、membership filter を実装して deploy する。
- [ ] Field storefront と CourseBoard の E2E を確認する。
- [ ] SCC-3 を完了にする。

## Non-goals

- SQL migration。商品の実体は Field の extension config に残す。
- course ごとの価格、`playType`、`availability`。
- CourseBoard からの availability 編集。
- entitlement の権利期間と複数回 redemption。

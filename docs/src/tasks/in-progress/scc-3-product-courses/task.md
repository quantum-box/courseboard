# SCC-3 コース横断予約商品

## Links

- [設計](./design.md)
- [PLT-3353](https://linear.app/quantum-box/issue/PLT-3353)

## 状態

PLT-3353 は Done（[tachyonfield#1034](https://github.com/quantum-box/tachyonfield/pull/1034)
が 2026-08-13 に merge）。CourseBoard の canonical writer と SPA の複数選択を実装済み。
残りは prod Field の deploy 確認と storefront の実リクエスト確認で、それが取れるまで
`COURSEBOARD_MULTI_COURSE_PRODUCT_WRITES=false` で writer を止められる。

## Plan

- [x] domain を `golfCourseIds` membership に変更し scalar alias を維持する。
- [x] config read を array 優先、scalar fallback、malformed fail closed にする。
- [x] API input で array / scalar の双方を受理し、曖昧入力と空 array を拒否する。
- [x] tee sheet と CourseBoard 予約作成を membership 判定に変更する。
- [x] canonical writer と course → resource 解決を実装し unit test する。
- [x] PLT-3353 deploy 前の production writer gate を閉じる。
- [x] fail-closed 5 パターン、legacy scalar 更新拒否、resource 不在時の全体拒否、
  `availability` 保持を test に固定する。
- [x] canonical writer gate を解禁し、kill switch を
  `COURSEBOARD_MULTI_COURSE_PRODUCT_WRITES` として env に出す。
- [x] 1 コースの商品は canonical 化せず scalar のままにする。resource 未作成の
  コースやデモ seed の保存を、複数コース化のために壊さない。
- [x] CourseBoard SPA に複数 course 選択、array save、予約時の membership filter を
  実装する。
- [x] 複数 course の保存時に、resource を持たない course の resource を自動で用意する。
  受付枠の置き場は Field の実装都合であり、コースを選ぶ操作の前提条件にしない。
- [ ] PLT-3353 が prod Field に deploy 済みであり、storefront が
  `eligibleResourceIds` を選択 resource の membership として解釈することを
  実リクエストで確認する。
- [ ] Field storefront と CourseBoard の E2E を確認する。
- [ ] SCC-3 を完了にする。

## Non-goals

- SQL migration。商品の実体は Field の extension config に残す。
- course ごとの価格、`playType`、`availability`。
- CourseBoard からの availability 編集。
- entitlement の権利期間と複数回 redemption。

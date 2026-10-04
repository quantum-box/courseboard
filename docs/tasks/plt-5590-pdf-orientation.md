# PLT-5590 PDFの自動回転による反転

- 受付用紙PDF（25ページ、5.54MB、1ページ目の回転メタデータ270度）で、本番の自動補正が追加90度を適用し逆さまになることを確認。
- 寸法から文字の上下は判定できないため、PDFは原本の回転を保持する。既存の手動回転はその原本を基準に反映する。
- 0/90/180/270度の保持と、270度PDFの手動左回転後の保持を回帰テストで確認する。
- 本番R2 CORSは対象Origin完全一致のPUTルールを適用済み。再planはchanged:false、OPTIONSは204、無関係Originは403。
- 本番OCR再試行はCourseBoard Lambdaで15012.80ms後に失敗。Fieldの25ページ処理修正PR #1541はマージ済みだが、本番ビルド bld_01m42nrzmyf8fbrc5pse2hhxev は検証時点でbuilding。本番OCR完走は未確認。
- ユーザーのPDFおよび個人情報はリポジトリに保存しない。

## 追加診断と修正

- Field PR #1541は署名URL発行の並列化であり、PDF advanceの15秒上限は修正しない。2026-10-04 05:59 UTCの本番反映後も再試行が15012.40msで失敗した。
- CourseBoardの受付OCR advanceだけHTTP timeoutを90秒とする。confirmおよび他のJSON APIは15秒を保持。送信・本文読み取りのtimeout診断にも実際の制限を使う。
- 本番CourseBoard Lambdaは30秒のため、manifestで120秒を宣言しHTTP timeoutの90秒を包含する。
- PDF回転テスト5件と既存受付API/モデルテスト64件、TypeScriptチェック、UI build、Rustの対象2ファイルのrustfmt、git diff --checkが成功。
- Rustはビルドキャッシュが無いため重いlocal compilationを行わず、追加した短時間のHTTP timeout結合テストとRust全体の型検証をPR CIに委ねる。
- 本番OCR完走と修正後UIの本番確認は未完了。

# STEP2.8 重大不具合修正・検証報告

2026-10-07（日本時間）。本番Supabaseへの接続/書き込み・migration適用・全国全件取込・求人取得は未実施。秘密情報/環境変数を変更せず、既存STEP1～STEP2.7を維持しました。追加SQLはローカルの使い捨てDBのみで検証しています。

## 全件移行判定

**C：全件取込には進めない。** 提供された実5シートの重大不具合は修正して検証を通過しましたが、全国実物47シートの認識・構造・行差分の必須確認が未完了です。補助47シートの合格を全国実物の合格とは扱いません。日付欄にURLが入った2行と、先頭0欠落と思われる電話1件は原文を保持して要確認です。

## 原因と修正

| 問題 | 原因 | 修正 |
|---|---|---|
| 禁止区間 | 会社行だけを解析し、開始/終了行の状態を持っていなかった | シート別状態を共有。明示終了まで継承、終了不明は末尾まで。開始行/見出し/対象元行を保存 |
| 架電禁止等 | 除外辞書が営業禁止/コール禁止中心 | 架電/電話/連絡/TEL禁止、電話しない・かけない等を安全側で解釈 |
| 契約/受注 | 成約以外の現在状態が未対応 | 明確な現在状態の契約/契約済/受注/導入済を成約済みに対応。予定/未契約/他社導入/一般論は除外しない補助試験 |
| 長崎欠落 | ExcelJS 4.4 WorkbookReader.parseのZIP列挙iterateStream経路が末尾worksheetを列挙しない | Node標準非同期ZIP列挙へ置換。ExcelJSのXML/セル解析は維持。manifest照合で欠落を例外停止 |
| 数値日付 | 日付文字列のみ対応。数値を無視して履歴日付へ代替 | 手動指定した日付列のみ1900シリアル変換。元日付セルを保存 |
| 電話 | 有効通常番号だけ抽出し、特殊/部分不明を捨てていた | 電話・FAX・special・unresolved・non_phoneを候補配列へ保存。特殊/不明は代表電話照合へ混ぜない |
| 注記の会社化 | 名称があれば会社とする経路 | 名称＋電話/住所を最低条件にし、見出し/注記/県名/区間指示をメタデータとして別保管 |
| 改名時の再実行 | 出典内source_fileが新たにrow_hashへ混入 | 元セル値/行位置は比較し、メタデータのファイル名だけをハッシュから除外 |

## 長崎欠落の根拠

workbook.xmlには長崎sheetId=5、rId5、visible、target=xl/worksheets/sheet5.xmlが存在。namespaceは通常のspreadsheetml/2006/main、sharedStrings・worksheet内容も正常。hidden/veryHiddenやrelationship欠損が原因ではありません。

元ExcelJSのparseに列挙パス記録を加えた診断で、30回中5回欠落を再現。失敗時はsheet5.xmlがZIP列挙ループへ到達しておらず、sheet name割当/セル解析より前で失われていました。標準async iteratorを使うアダプタでは20回連続で5シート取得。workbook/rels/styles/sharedStringsをすべて読むまで各worksheetを一時ディスクへ保留し、ZIP配置順にも依存しないようにしました。

独立XML直接読取は検証用scripts/xml-reference.pyのみです。通常インポータへのデータXMLフォールバックは追加していません。metadata XML（manifest）は正常性照合用に読みます。未対応namespace/target・1904日付方式は黙って落とさず停止します。アダプタはExcelJS private APIに依存するため4.4.0へ固定し、更新時に回帰試験が必要です。

## 実5シート 初回/再実行

| 項目 | 初回 | 再実行 |
|---|---:|---:|
| 会社行 | 322 | 322 |
| 新規 | 311 | 0 |
| 既存一致 | 0 | 311 |
| 候補 | 11 | 11 |
| 対象外（未統合候補を含む） | 176 | 176 |
| エラー | 0 | 0 |
| 時間 | 331ms | 61ms |

非空349行＝会社322行＋メタデータ27行。会社311件と候補11行を保持、再実行の新規0。候補は自動統合/新規登録しません。実DBと同じ追加SQL/RPCを使ったローカルPostgreSQLでも初回new311/candidate11/error0、再実行existing311/new0/error0、会社数311。禁止会社と候補のexcluded、DB推薦条件を照合し漏れ0を確認。元Excelハッシュ一致。

| シート | 会社行 | 禁止区間 | 対象外行 |
|---|---:|---:|---:|
| 北海道 | 54 | 36 | 37 |
| 茨城 | 89 | 18 | 26 |
| 愛知 | 95 | 69 | 70 |
| 千葉 | 56 | 31 | 36 |
| 長崎 | 28 | 7 | 7 |

## 合格基準の実測

| 基準 | 結果 |
|---|---|
| 禁止区間161行 | 全161行eligible_for_sales=false、見落とし0 |
| 明示禁止/成約/契約 | 実データ対象の除外漏れ0 |
| 見出し/注記の会社登録 | 0。27行をmetadataとして保持 |
| 数値日付 | 178件を1900方式で解析、変換エラー0、最終架電日が明示日付より古くなる件数0 |
| 電話番号 | 行エラー0。0078をspecialとして保持、不明固定番号4-7191-3670をunresolvedとして保持 |
| 二重登録 | 再実行new0、会社数311維持。改名の同一ファイルでも回帰試験通過 |
| 通常/XML差分 | 5シート、非空349行、元行番号・意味上のセル値差分0 |
| 47都道府県 | 補助Excelは47/47（hidden/veryHidden含む）。全国実物は未確認 |

セル差分は空欄を揃え、数値の45874.0と45874の表記差を同じセル値として比較しています。元ZIP/Excelは変更せず保持しています。

## 残る実データ確認

- 愛知49行、長崎9行：日付欄がURL。日付に推測変換せず、元値・URL候補・quality_warningsを保持して推薦停止（禁止区間も継承）。
- 千葉20行：4-7191-3670は先頭0欠落と思われるが、推測補完せずunresolved候補。携帯番号は通常電話候補として保持。
- 愛知93行：0078-6045-8906は掲載サイトの転送番号候補。特殊番号として保持し、代表電話重複根拠に使わない。
- 旧取込結果のrow_hashと新変換が違う同一元行は安全停止を維持。履歴削除で回避せず、旧誤判定会社を個別に見直す必要がある。
- 未知の禁止表現や自由記述の文脈は有限のルールなので、将来の全データに絶対保証はしない。禁止区間/明示キーワードの今回対象は漏れ0。

## 修正ファイル

- 新規：lib/import/stable-reader.ts、manifest.ts、entries.ts、phones.ts。
- 修正：lib/import/excel.ts、history.ts、types.ts、lib/types.ts、lib/scoring.ts。
- 修正：scripts/import-worker.ts、validate-local-master.ts、verify-import.ts、app/api/imports/[id]/route.ts、app/actions.ts、app/companies/[id]/page.tsx。
- 新規：scripts/verify-step28.ts、scripts/xml-reference.py、tests/import-safety.test.ts。
- 新規：supabase/migrations/202610070002_import_safety.sql。
- 修正：supabase/verify-step2.sql、SQL_EDITOR_SETUP.md、IMPORTING.md、package.json/lock（saxes直接依存、ExcelJS 4.4.0固定）。

## 実行した検証と再現方法

- 単体/回帰21件、型チェック、本番ビルド通過。
- 使い捨てローカルPostgreSQLで追加SQLと実5シート322行のバッチ取込/再実行/禁止・確認待ちを確認。
- 既存統合試験（架空102行）：アップロードAPI、列確認、実行、結果/エラーJSONL、通信切断後再開、改名再取込、検索/スコア、STEP1保持を確認。これは全国全件取込ではありません。

```bash
npx --no-install tsx scripts/verify-step28.ts /path/自動車全国リスト_STEP2.7_5都道府県検証用.xlsx .data/new-step28-audit
```

検証専用コマンドは指定5シート・各100物理行以内に限定し、本番環境変数を読まず、ネットワーク/DBを使用しません。既存出力には初回結果を上書きせず新しい出力ディレクトリを要求します。

全件前には、全国実物47シートのsheet name/relationship/行数の読み取り専用照合が必要です。全47シートを保った各20～100行・元列配置の検証用コピーなら実データ照合を進められます。追加SQLの本番適用と本番100件検証はまだ行いません。

適用順はSTEP1→STEP2→202610070001_import_quality.sql→202610070002_import_safety.sql→verify-step2.sql。これは手順の準備であり、本番適用済みではありません。

# STEP2.10 修正実装・47シート原本検証

**判定 B：Readerの重大問題は解消。列マッピングと不明元データの確認後、実Supabase100件検証へ進める。**

本番Supabase接続・書込み、マイグレーション、全国全件取込、求人取得は実施していない。原本のハッシュは前後同一。診断コピーではなく添付原本を通常経路で2回処理した。

## 実際に変更したファイル

- lib/import/workbook-reader.ts：新共通Reader。ZIP Openで全entryを参照、manifest順に47シートを列挙。Saxes xmlns=true、namespace URIとlocalNameで処理。各XML Bufferをfatal UTF-8で1回decode。数値セルの元値、行番号、共有文字列・inline文字列・数式のキャッシュ値を保持。式は実行しない。
- lib/import/stable-reader.ts：ExcelJS私有APIアダプタを廃止し共通Readerへの互換export。
- lib/import/excel.ts：通常取込とinspectで共通Reader使用。県別ヘッダー/値プロファイル候補、confidence/needs_review、原本行番号、日付/不明電話を安全保持。未知値・元セル置換文字は推薦除外。
- lib/import/manifest.ts：メタデータXMLもfatal UTF-8 decode。
- lib/import/date-classification.ts：valid_date/datetime/time_only/url_in_date_column/invalid_date/empty。
- lib/import/phones.ts：valid_phone/mobile/fax/multiple_phones/malformed_phone/unknown_numberを候補へ付与。元値は保持。推測補完なし。
- lib/import/types.ts：SheetMappingのconfidence/needs_review追加。既存設定形式との互換性維持。
- scripts/dump-workbook.ts、scripts/xml-reference.py：XML検証CLIも通常Readerへ統一。Pythonは互換CLIであり別XML Readerではない。
- scripts/verify-step28.ts：通常Readerへ統一。
- scripts/verify-step210.ts：47シート/各100物理行上限・2回ローカル検証・保存済セル基準比較・原本ハッシュ確認。
- tests/workbook-reader.test.ts：prefix x/other、UTF-8境界、指定日本語、日付分類。tests/import.test.ts：不明電話の新しい安全保持仕様を検証。

既存SQL・Supabase接続実装・環境変数・シークレットは変更なし。新分類は既存JSONカラムとimport_metadataに保存できる。

## Reader統一と文字化け

通常Excelアップロード/preview/worker/local検証 → workbookRows → readWorkbook → Sheet/Row/Cell → 明示Column Mapping → importEntries → 正規化/保存。独立XML Readerによる検証専用補正はない。今回セル差分チェックはSTEP2.9で保存した原セルJSONと比較しており、同じReaderを二回呼んで一致とする検査だけではない。

旧不具合は64KiBのBuffer境界で日本語のUTF-8バイトが分割され、チャンクごとの文字列化で置換されたこと。名前空間prefix除去replaceは使っていない。指定文字「株式会社 有限会社 鈑金 塗装 車輌 ㈱ ① 〜 － 全角スペース」の長文をprefix違いでも完全一致確認。

|STEP2.9差分セル|修正結果|
|---|---|
|北海道 K95|保存済原セルと一致|
|青森 B84|保存済原セルと一致|
|宮城 K83|保存済原セルと一致|
|福井 D69|保存済原セルと一致|
|東京 K64|保存済原セルと一致|
|岐阜 K62|保存済原セルと一致|
|大阪 K80|保存済原セルと一致|
|福岡 K77|保存済原セルと一致|
|佐賀 B64|保存済原セルと一致|
|沖縄 K61|保存済原セルと一致|

旧10セル差分は全件解消、全非空3,547行のセル比較も差分0。高知B58は原本自体にU+FFFD置換文字あり。Readerで生じた文字化けではなく、元データをそのまま保持しquality_warningsで営業推薦を止める。

## Column Mapping

固定県別番号を通常自動検出には使わない。ヘッダーaliases、電話・住所・URL・結果・日付・履歴の値プロファイルでシート毎に候補を出す。ヘッダーなし・結果列不一致・候補競合はneeds_review=true、enabled=false。実データ47シート中22シートが要確認。検証取込では既に確認した県別手動mappingを明示指定した。自動検出候補を無条件に自動取込したわけではない。

要確認シート：石川、福井、富山、群馬、埼玉、東京、神奈川、静岡、愛知、岐阜、三重、大阪、京都、兵庫、広島、岡山、山口、福岡、長崎、大分、宮崎、沖縄。

## 日付・電話

日付分類：{"empty": 1229, "valid_date": 2030, "url_in_date_column": 9, "invalid_date": 4, "time_only": 1}。日付解析例外0件。URL9、不正値4、時刻1は原値保存＋要確認＋営業推薦除外。日付列の電話2件（東京70/84）はphone_candidatesへ追加し、代表電話/重複照合へ自動移動しない。時刻をシリアル日付にしない。

電話分類集計：{"valid_phone": 2953, "multiple_phones": 249, "mobile": 188, "unknown_number": 7, "malformed_phone": 3}。複数番号を候補として保存。不明番号5候補は推測せず要確認。FAX・注文番号・金額・日付を電話へ採用しない。今回の電話解析例外0件。ただし元の番号が欠けた行について正しい番号そのものを復元できたとは主張しない。

## 原本47シート再検証

|項目|初回|再実行|
|---|---:|---:|
|会社処理行|3274|3274|
|新規会社|3167|0|
|既存一致|10|3177|
|候補|96|96|
|除外|973|973|
|エラー|1|1|

認識47/欠落0/シート重複0。最終沖縄・長崎を含む。非空3,547行、注記等273行、会社解析成功3,273行。保存会社3,167件を維持。初回22.743秒、再実行0.820秒。禁止区間の解析会社879行、営業可漏れ0。見出しメタデータと会社行の交差0。候補96件は自動統合せず保持。

残る1エラーは長野4：元会社名が空。原セルをerrors.jsonに保存して未登録、会社名を推定しない。日付/電話エラーではない。未知元データ、原本置換文字、県別mapping22件の確認が終わるまでA判定は出さない。

23テスト全件成功、TypeScript成功、Nextビルド成功。実DB RPC/Supabase性能同等性は今回未検証。10万件の処理性能は今回の軽量原本から断定しない。ZIP展開256MB・共有文字列64MB・総行数等の上限は維持。ReaderはシートXML単位でBuffer化し、巨大シートではメモリが増えるため全件実行前に実サイズを確認する。

再現コマンド：`npx tsx scripts/verify-step210.ts <47シート検証Excel> <確認済mapping.json> <新規出力ディレクトリ> <保存済セル基準.json>`。各シート100物理行超は中止し、全国全件取込は許可しない。

検証証跡は .data/step210-release/report.json、summary.json、errors.json、companies.json と .data/step210-final/detected-mappings.json。

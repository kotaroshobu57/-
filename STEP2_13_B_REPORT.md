# STEP2.13-B 大容量原本Dry Run対応

通常Web/APIの既定モードは変更せず、全国CLIだけtrustedLocalFullWorkbookオプションを指定する構成へ変更しました。HTTPリクエスト/環境変数/保存済みjobのフィールドからtrusted指定を読み取る処理はありません。全国workerは専用CLIの--full/--job/--expected経由だけでtrustedを使用します。

## 制限

|項目|通常|全国CLI専用|
|---|---|---|
|圧縮ファイルのWebアップロード|100MB|ローカル通常ファイルのみ。Web受付なし|
|展開総量|256MB|2GB|
|sharedStrings|64MB|64MB（維持）|
|内部ZIP項目|2000|2000（維持）|
|マクロ|拒否|拒否（維持）|
|workbook.xml|必須|必須（維持）|
|metadata XML|各8MB|各8MB（維持）|
|総XML行/セル/列上限|210000行/32000文字/512列|同じ（維持）|

ZIP中央ディレクトリの展開総量に加え、読取り中XMLの実展開バイトとZIP申告サイズ一致を確認。未指定オプションは常に通常制限です。URL/UNCは拒否し、通常ローカルファイルであることをstatで確認します。2GB以上やsharedStrings64MB以上の原本は、黙って上限を解除せず停止します。

## メモリ

共通Workbook Readerの名前空間URI/localName・シート順序・原行位置・原セル内容を維持し、XMLの全Buffer+全シート行配列を廃止しました。ZIPエントリはストリーム展開、UTF8はTextDecoderのstream対応で1回ずつdecodeし、各chunkから生成された行を排出します。UTF8の分割境界・任意prefixを含む既存テストも成功。

inspectWorkbookは先頭100物理行だけを各県のColumn Mapping/fingerprint確認に保持し、全行は件数/最大列だけ集計します。confirmed-mappings.json、正規化、会社判定、営業禁止/履歴/重複判定のルールは変更していません。100行より後の自動列候補に依存せず、未確認はneeds_reviewにします。

sharedStringsは上限64MB・最大200万件で保持するためメモリはゼロではありません。また全国重複予測のインデックスは会社数に応じて増加します。10万行テストの数値はReader/inspectの実測で、本番原本の全Dry Runでのピークメモリ保証ではありません。report.jsonにプロセスのpeakRssKB/heapUsedBytesを追加しました。

## 検証

- npm test：29件成功。
- npm run typecheck：成功。
- 合成10万行＋260MiBのZIP内付属データ：通常モードは256MB超過で拒否、全国trustedでは解析成功。
- 10万行のReader/inspectをNodeヒープ上限128MBで実行：読込100000、プロフィール行数100000、ピークRSS82688KB（約81MiB）、元Excelハッシュ一致、fetch禁止下で完了。
- 通常100MBファイル上限・内部ファイル数超過・workbook.xml欠損・trustedでもマクロ/共有文字列65MB/展開2GB超過を拒否。
- 47シート軽量版：47認識、欠落0、未確認mapping0、解析エラー0。会社3272/対象外982/候補89等、修正前と一致。原本ハッシュ一致、DB未接続。
- 使い捨てローカルPostgreSQL/PostgRESTの既存Web/worker統合検証：100件、中断再開、合成101行再実行new=0、検索/除外/結果API成功。本番Supabaseではありません。

本番原本【改】自動車全国リスト.xlsx全件はMac上で再実行して確認します。今回本番Supabase接続・全国本番書込みは実行していません。

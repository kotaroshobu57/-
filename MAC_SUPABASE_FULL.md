# STEP2.13：全国原本のDry Run（Mac）

まだ全国データを書き込みません。今回実行するのは **dry-runだけ** です。

## 1. 最新コードを取得

Macのプロジェクトフォルダで `signal-tool-step2-12` ブランチの最新版を取得します。

```bash
git pull --ff-only origin signal-tool-step2-12
npm ci
npm run typecheck
```

ローカル変更がある場合は上書きせず、pullのエラー内容を確認します。

## 2. 本番原本を最後まで解析（DB接続なし）

本番原本をDownloadsに保存してください。STEP2.9の軽量版とは別です。

```bash
npx tsx scripts/supabase-full.ts dry-run "$HOME/Downloads/【改】自動車全国リスト.xlsx"
```

この操作は `.env.local` をロードせず、Supabaseクライアントを生成せず、ネットワーク通信を行いません。INSERT / UPDATE / RPCはありません。元Excelは編集せず解析前後のSHA256一致も確認します。

全47シートを共通Reader→確定済みColumn Mapping→既存会社判定→既存正規化/営業除外へ通します。列マッピングの先頭100行fingerprintが変わった場合は会社取込を停止し、原本の非空行数だけ集計してCを返します。シートを無言で欠落させません。

画面に1000会社行ごとの進捗と、最後に集計・report.jsonの保存先が表示されます。

- `report.json`：全国・県別集計、列設定、欠落県、時間、判定、バッチ予測
- `rows.jsonl`：全会社行の変換結果、元シート/行番号、row_hash
- `metadata.jsonl`：見出し、禁止開始/解除、会社名欠損等の原値
- `review.jsonl`：確認待ちの原値・理由
- `duplicates.jsonl`：ファイル内の完全一致/類似候補
- `errors.jsonl`：解析できなかった行
- `mappings.json`：今回使用した47シートの確定済み設定

すべて `.data/full-dry-run/<ID>/` に保存し、Gitへ含めません。社内会社データなので公開しないでください。B/Cの場合、終了コード2です（異常終了したという意味ではなく、取込許可を出さない判定）。

## 3. 集計の意味と確認事項

会社行・営業対象/対象外は **元行単位** です。同じ会社の複数行が含まれます。禁止/成約/確認待ち等は分類が重複するため合計しません。

`callBan`はコール・架電・電話等禁止および禁止区間継承を含みます。`salesBan`は営業禁止です。`pending`は閉廃業確認待ち・セル異常の会社/注記行。`otherNeedsReview`は品質警告がある会社行。会社名欠損・置換文字の会社名は会社登録対象にせずmetadataへ残します。

`predictedNew`は **空DBを仮定したファイル内予測** です。実Supabaseの既存100件やその他既存データとは照合していません。実登録数とは異なる可能性があります。重複予測は電話優先、会社名+所在地、会社名類似の順に検索し、類似候補は自動統合しません。類似度はpg_trgm相当の近似で、SQLの履歴更新を再現する別インポータではありません。

確認待ち/類似候補がある場合B、欠落/未確認mapping/解析エラーはC。Aでも、先頭100行以降の構造変更や誤会社行がないかreview/rowsを確認してください。予測をもって100%の正確性は保証できません。

共通Readerの既存上限：内部ZIP2000項目、展開256MB（全国CLI専用trustedモードは2GB）、sharedStrings64MB、総XML行210000、1セル32000文字、最大512列。原本が上限を超えた場合は安全に停止します。上限を黙って解除しません。共通ReaderはZIP内XMLをストリーム処理し、inspectは県ごと先頭100物理行と件数/最大列だけを保持します。sharedStringsは64MB制限付きで保持し、重複予測のインデックスは会社数に応じて増えます。Macの原本でのピークメモリはreport.jsonのmemoryで確認できます。

推奨バッチは50。予測バッチ数は会社/解析エラー行数÷50の切上げで、metadataの書込みは別です。DB書込み時間は **未測定の推測** です。100件検証の実測バッチ時間×予測バッチ数が目安で、ネットワーク、pg_trgm検索、RPC更新、index、結果照合、再開時の再解析が影響します。

## 4. 本番CLI（今回は実行しない）

本番CLIは用意しましたが、A判定の原本Dry Runがない限りprepareを拒否します。B/Cのreport.jsonを書き換えて回避してはいけません。要確認解消後に同じ原本から再度Dry Runしてください。

以下は将来の操作です。**今は実行しません。**

```bash
npx tsx scripts/supabase-full.ts prepare "$HOME/Downloads/【改】自動車全国リスト.xlsx" "/実際の保存先/report.json"
npx tsx scripts/supabase-full.ts run --confirm-full-write
npx tsx scripts/supabase-full.ts status
npx tsx scripts/supabase-full.ts verify
```

prepareはDB非接続で原本コピー/ハッシュ/件数/確定mappingを保存します。runのみ環境変数 `DATA_MODE=supabase`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` を使った既存workerへ渡します。100件CLIのセッションとは別で、全国job IDだけを処理します。limit=0（全国）とDry Run件数の一致を強制し、100件上限の混入や不足件数を成功扱いしません。

workerは50会社行バッチ、DB処理後checkpoint、元ファイルhash+sheet+row台帳、進捗、結果/error/candidate JSONL隔離を使用します。再開時の同じrun ID/元行台帳再送で二重登録を防止します。

Control+Cは一度押して終了を待ちます。完了済みバッチは取り消しません。原本/job/checkpoint/台帳を消さず、statusを確認し、未完了なら以下で再開します。

```bash
npx tsx scripts/supabase-full.ts resume --confirm-full-write
```

verifyはDB読み取り専用で、期待元行数・row_hash・ledger欠落/重複・company_id・エラー0・営業対象外行に紐づく会社が営業可になっていないことを照合します。候補行はcompany_idなしが正常です。照合中は他の取込/会社編集を止めてください。

## 5. 今回共有する結果

Dry Run後の画面の集計と、report.jsonの判定/県別集計を共有してください。秘密キーや.env.localは共有しません。原本全件のDry Runが終わるまで全国取込は開始しません。

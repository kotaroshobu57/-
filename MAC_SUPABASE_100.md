# STEP2.12-B：Macから実Supabaseへ100会社行だけ検証する手順

この準備作業では実Supabaseに接続・書込みしていません。以下の `run` / `repeat` / `resume` は、あなたのMac上で実Supabaseへ書き込みます。全件モードはこのCLIにありません。

## 1. Macに最新実装と検証Excelを配置

Node.js 24 LTS、npmを使用します。Terminalでプロジェクトのpackage.jsonがあるディレクトリへ移動し、依存を導入します。

```bash
cd "$HOME/Projects/automotive-sales-signals"
npm ci
npm run typecheck
```

`cd`のパスは自分の保存場所に置き換えます。GitHubの古いREADMEだけの版では実行できません。このクラウド作業の最新ファイル（scripts/supabase-100.ts、更新済みimport-worker.ts、lib/import/confirmed-mappings.jsonを含む）をMacへ同期してください。

今回は **自動車全国リスト_STEP2.9_全国47シート構造検証用.xlsx** をDownloadsへ保存し使用します。全国マスター本体や以前の別100件ファイルに置き換えません。列マッピングは確認済み先頭100物理行のfingerprintに一致する47シート版を利用し、会社行の先頭100件だけが対象です。47県各100件をDBへ投入するわけではありません。

## 2. .env.local

プロジェクト直下の`.env.local`をローカルのエディタで作成/設定します。変数名は以下です。

- `DATA_MODE`：`supabase`
- `SUPABASE_URL`：対象プロジェクトURL
- `SUPABASE_SERVICE_ROLE_KEY`：対象プロジェクトのサーバー用service role / 対応するsecret key
- `IMPORT_BATCH_SIZE`：`50`（この100件CLIのworker起動は50を固定）

キーはチャットへ貼らず、NEXT_PUBLIC_を付けず、Gitへ追加しません。ファイル内容をTerminalへ出力しません。

```bash
chmod 600 .env.local
git check-ignore .env.local
```

後者が`.env.local`を出力することを確認します。内容の表示ではなくignore確認です。Nextサーバー起動は不要。通常のWeb用workerは止め、この専用CLIだけ実行します。

## 3. 準備と読み取り専用接続確認

```bash
npx tsx scripts/supabase-100.ts prepare "$HOME/Downloads/自動車全国リスト_STEP2.9_全国47シート構造検証用.xlsx"
npx tsx scripts/supabase-100.ts check
```

prepareはDBに接続せず、確認済み列設定・原本コピー・hash・対象100元行を保存します。未確認シートや解析エラーがあれば書込み前に停止します。checkはcompanies件数と対象元行台帳を読み、初期状態を保存します。値/キー/Authorizationは表示しません。`connected:true`を確認してください。

セッションは`.data/supabase-100-session.json`。既存セッションの上書きは拒否します。エラーが出てもこのファイルやDB台帳を削除してやり直しません。

## 4. 初回：100件のみ取込

```bash
npx tsx scripts/supabase-100.ts run
```

対象job ID限定で既存workerを起動し、limit=100を強制します。他のqueuedジョブは実行しません。バッチ50、最大2バッチの会社行処理です。会社以外の見出し/禁止区間/例外metadataは別で保存されるので、DBに書かれる全行の総数が100という意味ではありません。件数は新規・既存・候補を含む会社処理100件です。

終了後、`completed:true`・`counts.read:100`・`counts.errors:0`を確認。新規数は既存DB状態により変わるので100とは限りません。duplicate_candidateは会社へ自動統合しません。

## 5. 結果確認（ローカル、ネットワークなし）

```bash
npx tsx scripts/supabase-100.ts status
```

statusはjob状態、processed、各件数、処理時間ms、レポートディレクトリを表示します。results.jsonl / errors.jsonl / candidates.jsonlは表示されたディレクトリ内です。秘密値は含めませんが会社/営業履歴は社内データとして扱います。

## 6. 同じ100件を新しいrun IDで再実行

初回がcompletedかつerrors=0の場合のみ進めます。同じExcelコピー・同じ列設定・同じ100元行を使い、台帳は残します。

```bash
npx tsx scripts/supabase-100.ts repeat
npx tsx scripts/supabase-100.ts status
npx tsx scripts/supabase-100.ts verify
```

verifyは実DBを読み取り専用で照合します。`secondRunNew:0`、`sameCompanyIdsAndSourceRows:true`、`noDuplicateRegistration:true`を確認します。初回後と現在の会社総件数、対象元行のcompany_id / row_hash / sheet / rowを比較します。match_kindがnewからexistingへ変わるのは正常で比較対象にしません。他の担当者の同時取込や会社編集があると照合に影響するため、この間は行わないでください。

## 7. 安全な停止と再開

処理中のTerminalで **Control+Cを一度**押し、workerが終了するまで待ちます。進行中のバッチがDBで完了することはあります（最大50会社行）。DBに反映済みのデータは削除しません。停止直前のバッチは通信応答前でも台帳に記録され、同じrun IDの再開で照合します。

```bash
npx tsx scripts/supabase-100.ts status
npx tsx scripts/supabase-100.ts resume
```

resumeは未完了の同じ100件ジョブ/同じrun ID/保存済み処理位置を使用します。停止後に`run`や`repeat`で新規runを作らず、まずstatusを確認してください。completedならresumeは不要です。通信失敗時もstatusで確認し、原因解決後resumeします。元Excel・mapping・job.jsonを編集しません。

`.worker-lock`が残っていても動作中プロセスを確認せず削除しません。通常workerは停止時に解除し、異常終了ならPIDが存在しないことを確認して復旧します。

全国全件取込は実行しません。初回・再実行のcountsとverify結果を共有してから次へ進みます。

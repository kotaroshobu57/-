# 実Supabase・全国マスター100件検証

STEP2の実装は変更していません。この手順では全件取込を実行しません。

## 現在の検証結果

- 実SupabaseのURL/キー：環境変数・保存済み環境要件とも未設定。
- `.env.local`：存在しない。`.gitignore`によりGit除外され、Git追跡なし。
- 全国マスターExcel：未提供。アップロード済みジョブも0件。
- アプリはlocalモード。取込ワーカーは動作中。
- Client ComponentはSupabase接続モジュールを参照していない。キー読み取りはserver/workerでのみ行う。
- `NEXT_PUBLIC_` の利用なし。ブラウザ用 `.next/static` にservice roleキーの環境変数読み取りやキー設定処理なし。
- 取込状態APIは環境変数の設定有無だけを返し、キー値を送信しない。

実キーが未設定のため、実プロジェクト接続・実データ検証の結果ではありません。これまでの合成Excel/PostgreSQL/PostgRESTの結果を本番結果として扱いません。

## 必要な設定

`.env.local` またはサーバーの安全な環境設定へ以下を入力します。キー値をチャット・コード・Gitへ書かないでください。

- `DATA_MODE=supabase`
- `SUPABASE_URL`：接続先プロジェクトURL
- `SUPABASE_SERVICE_ROLE_KEY`：そのプロジェクトのサーバー用キー
- `IMPORT_BATCH_SIZE=200`：既定値。100件取込は1バッチで保存します。

対象プロジェクトのHTTPSホストをネットワーク設定で許可し、Next.jsとワーカーの両方を再起動します。取込画面の接続確認は読み取りと空配列RPCで、会社データを追加しません。接続先が正しいプロジェクトであることも設定時に確認します。

## マイグレーション適用・構造確認

既存STEP1 DBには `supabase/migrations/202610060002_master_import.sql` のみを適用します。新規DBには `202610060001_core.sql` → `202610060002_master_import.sql` の順で適用します。すでに適用済みの場合はそのまま再実行しません。本番に架空seedを投入しません。

Supabase SQL Editorで `supabase/verify-step2.sql` を実行してください。読み取り専用で、実データ・スキーマを変更しません。REST接続の確認だけではインデックス/ユニーク制約まで証明できないため、このカタログ結果も確認します。

期待する構造：

- companies / signals / snapshotsと、import_runs / company_import_records / import_outcomes / import_excluded_companiesが存在し、RLS有効。
- companiesの全STEP2カラムが存在。
- companiesの主キーは維持。会社名単独/電話単独の旧ユニークインデックスは存在しない（同名別会社・共有電話を許容）。
- 電話配列GIN、代表電話、正規化会社名と都道府県、trigram名検索、営業対象可否のインデックスが存在。
- 元行にはfile_hash＋source_sheet＋source_rowのユニーク制約。
- 行結果にはrun_id＋source_sheet＋source_row、除外台帳にはrun_id＋company_idの主キー。
- 更新時刻と営業対象可否のトリガーが存在。
- import_company_batch/search_companiesはservice_roleのみ実行可。anon/authenticatedは実行不可。
- pg_trgmはpublicまたはextensionsに存在し、service_roleにそのスキーマのUSAGE権限がある。

## 100件だけの取込と抜き取り

1. 本番 `【改】自動車全国リスト.xlsx` をアップロードし、各シートの列設定と都道府県を確認します。
2. **100件テスト取込**のみ開始。全件ボタンは押しません。
3. 読込行数、新規会社数、既存一致数、重複候補数、除外会社数、エラー数、処理時間を記録します。件数はヘッダー・空行を除いた元行単位です。除外会社数のみ会社IDを重複なく数えます。
4. 結果JSONLから最低10個の異なる登録/一致会社IDを選び、元行に結び付けて照合します。会社のsource_rowだけを見ると複数元行の照合履歴を見落とすため、company_import_recordsのsource_sheet/source_rowも使います。
5. 各社について、raw_company_name、normalized_company_name、raw_phone、normalized_phone、normalized_phones、都道府県、call_status、eligible_for_sales、元シート/行を確認します。
6. 電話一致、法人格、全半角、空白、英字大小、同名別会社、複数電話を実データ内で確認します。該当する例が100行内に存在しない場合は「実データで未確認」とし、合成テストの結果と区別します。
7. 営業禁止・コール禁止・成約済み・閉業・廃業の会社がDBに残り、eligible_for_sales=falseかつ今日の狙い目に出ないことを確認します。存在しない状態は未確認として報告します。

元行と会社を照合するSQL例（指定のrunの実データだけを対象とし、読み取り専用）：

```sql
-- 対象の実行UUIDへ置き換える。会社列の最新値と、この元行の生値を区別する。
select o.source_sheet,o.source_row,
       r.raw_company_name,c.normalized_company_name,
       r.raw_phone,c.normalized_phone,c.normalized_phones,
       c.prefecture,c.call_status,c.eligible_for_sales,
       c.source_file,c.source_sheet as current_company_sheet,c.source_row as current_company_row,
       c.id
from public.import_outcomes o
join public.companies c on c.id=(o.outcome->>'company_id')::uuid
join public.import_runs run on run.id=o.run_id
join public.company_import_records r
  on r.file_hash=run.file_hash and r.source_sheet=o.source_sheet and r.source_row=o.source_row
where o.run_id='対象の実行UUID'::uuid
order by o.source_sheet,o.source_row;
```

一覧から重複しない10社を選びます。実際に登録/一致した会社が10社未満の場合は全社を確認し、その限界を報告します。

## 同じ100件の再実行

列設定と原本を変えず、再び100件テスト取込を実行します（別run）。前後の会社ID集合、全会社数、元行の関連会社ID・source_sheet/source_rowを照合します。

- 新規会社数0が期待値。ただし前回候補/エラーを人が修正した場合は例外を別途説明。
- 前回新規登録した元行は既存一致になる。
- 前回候補は候補のまま残り得るので「100件すべて既存一致」を期待しない。
- 会社数、元行ユニーク件数、会社ID対応、元Excel SHA-256が不変。
- ソース行位置や新しい営業メモ/日付が上書き破損していない。

## 全件前の報告・停止・復旧

100件の安全性が確認できるまで全件取込には進みません。

- 推定時間：実測取込の行/秒を用い、解析/照合/書込/結果出力を区別して推定します。100件は1バッチであり、10万行では索引や会社数が増えるため単純比例は参考値に留めます。実測がない現在は時間を提示できません。
- バッチサイズ：既定200、設定範囲1〜250。タイムアウト時は50〜100へ下げて再起動・再開を検討します。
- 通常停止：ワーカーを動かしているターミナルでCtrl+C（SIGINT）、または確認した**ワーカー本体PID**へSIGTERM。npm/tsxラッパーだけを止めず、ワーカーへ届けます。通常は処理中バッチを保存した後に停止します。
- 強制停止：緊急時のみ本体を停止。DBが既にコミットしたか不明でも同じrunの台帳により再送時の二重登録を防ぎます。
- 再開：正常停止後のrunningジョブはワーカー再起動で再開。failedジョブは接続/原因を直し、取込画面の「処理済み位置から再開」を使用。
- 復旧：原本コピー、job.json、結果、DB台帳を削除しません。ディスク側の記録を失った場合は同じExcel/列設定で新しいrunとして再実行し、元行ユニーク制約と既存会社照合で重複を避けます。
- ロールバック：誤統合時は全件を止め、会社・シグナル・元行の関連を調査して個別修復します。取込には自動逆操作はありません。全件前にDBの復旧可能なバックアップを確保し、インポート中の会社手入力は避けます。

10万件の想定ボトルネック：trigram照合と電話配列索引の更新、バッチ内の行ごとのDB処理、DBアドバイザリロック、SupabaseのCPU/IO/statement timeout、ネットワーク遅延、共有文字列キャッシュ、再開時のExcel再走査、JSONL結果の全行取得・出力、永続ディスク容量。10万行解析の合成検証は済んでいますが、実Supabaseで10万件保存する性能保証ではありません。

元Excelは最大100MB、展開後256MB等の既存制限があります。超える場合はコピーを都道府県単位に分割して別ファイルとして検証し、元の原本は保持します。

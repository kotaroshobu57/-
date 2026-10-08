# STEP2.12-A：Supabase SQL Editor 手動適用手順

今回はSQLの静的確認と手順整備のみ。Codexから実Supabaseへ接続・実行していません。秘密情報をSQLへ貼る必要はありません。

## 空のDBへ適用する順番

SQL Editorで対象プロジェクトを選択し、以下を**1本ずつ、成功を確認してから**実行してください。対象のアプリ用テーブルが既にある場合はこの新規適用手順を最初から再実行せず、未適用の段階を確認します。

0. `supabase/verify-step2.sql` の全文を実行し現状を確認（読み取り専用）。空のアプリDBでは対象テーブル/カラムは exists=false。Supabase自身のauth/storage等のテーブルがあるのは正常です。
1. `supabase/migrations/202610060001_core.sql` の全文を貼り付けます。このファイルだけはトランザクションの囲いがないため、**先頭に `BEGIN;`、末尾に `COMMIT;` を追加**して一括実行します。
2. `supabase/migrations/202610060002_master_import.sql` の全文を実行します。既存のBEGIN〜COMMITを含め、そのまま実行します。
3. `supabase/migrations/202610070001_import_quality.sql` の全文を実行します。
4. `supabase/migrations/202610070002_import_safety.sql` の全文を実行します。
5. `supabase/manual/05_finalize_access.sql` の全文を実行します。PUBLIC/anon/authenticatedの対象テーブル・関数権限を明示的に撤回し、service_roleの関数実行権限を保持します。最後にPostgRESTのスキーマキャッシュを再読込します。データの変更・削除はありません。
6. 再度 `supabase/verify-step2.sql` の全文を実行し、下記の結果を確認します。

**成功したSQLは再実行しないでください。** CREATE TABLE / ADD COLUMN等は全体として再実行可能ではありません。エラー時は後続へ進まず、失敗中のトランザクションなら `ROLLBACK;` を実行して終了し、原因と適用済み段階を確認します。DROP TABLEなどでやり直しません。

`supabase/seed.sql`、`supabase/generate-seed.ts`は開発用です。本番SQL Editorでは適用しません。手順完了後もExcel取込・100件書込みは実行せず、次の指示を待ちます。

## 依存関係

|順番|追加内容|前提|
|---|---|---|
|1 STEP1|companies / signals / snapshots、更新日時trigger、RLS、pgcrypto|新規のアプリDB、Supabase標準ロール|
|2 STEP2|営業除外/出典/複数電話カラム、import関連4テーブル、検索/取込RPC、pg_trgm、index|STEP1のテーブル・制約・関数|
|3 STEP2.6|URL候補/携帯候補/閉廃業確認の5カラム、除外/取込関数の更新|STEP2の列・テーブル・RPC|
|4 STEP2.8|電話候補/元日付/import_metadata列、import_metadataテーブル、禁止継承/品質確認待ちの除外|STEP2.6の5カラムと既存関数|
|5 権限最終化|対象8テーブル・4関数の権限限定、スキーマ再読込|1〜4の全オブジェクト|

STEP2.9〜STEP2.11のReader・列設定・分類はアプリ側の変更です。新たなDB migrationは不要です。例外情報はcompanies.import_metadataとimport_metadata.raw_cellsのJSONへ格納します。raw_cellsは配列のままで、原セル列の後ろに構造化anomaliesを追加します。

## 最終確認で期待する状態

- **8テーブルがexists=true / RLS=true**：companies、signals、snapshots、import_runs、company_import_records、import_outcomes、import_excluded_companies、import_metadata。
- companiesのSTEP2以降21カラムがexists=true（13＋品質5＋安全3）。eligible_for_sales / source_file / source_sheet / source_row / raw_history / phone_candidates / raw_last_call_date / import_metadata等を含む。
- company_import_records：`unique(file_hash,source_sheet,source_row)`。import_metadata：同じ3列のprimary key。import_outcomes：`primary key(run_id,source_sheet,source_row)`。import_excluded_companies：`primary key(run_id,company_id)`。
- 候補管理は独立duplicateテーブルではなく、company_import_records.match_kind='duplicate_candidate'、candidate_ids、normalized_dataで保持。候補は会社へ自動統合しない。
- index：電話配列GIN、代表電話B-tree、正規化名＋都道府県、名前trigram GIN、営業可否、シグナル会社＋検知日、snapshot会社＋source、取込会社履歴。
- companies_updated_at、companies_sales_eligibilityのtriggerが存在。禁止/成約/閉廃業/closure_state pending・confirmed/quality_warningsが営業除外に反映される。
- RPC import_company_batch / search_companiesはsecurity_definer=false（SECURITY INVOKER）、service_role_execute=true、anon/authenticated_execute=false。補助trigger関数も最終化後は同じ権限結果。
- 対象8テーブルのanon/authenticatedのSELECT/INSERT/UPDATE/DELETEはすべてfalse。service_roleはtrue（既存migrationのALLを維持）。新たな強権限をクライアント用ロールへ付与しない。
- pg_policies：対象テーブルのクライアント許可ポリシーは0行。RLSに許可ポリシーを作らず通常クライアントを拒否し、サーバーのservice_roleのみ運用する。postgres等の管理者権限は変更しない。
- pg_trgmはpublicまたはextensions。別schemaならSTEP2の安全チェックが止めるため、そのまま後続へ進まない。SQL Editorのpostgres管理ロールで実行する。

## DROP・既存データへの影響

テーブル/DB/schemaのDROP、DELETE、TRUNCATE、DROP CASCADEはありません。ただしSTEP2には次の**構造変更**があります。

- `DROP INDEX` 2本：STEP1の正規化会社名単独/電話単独のuniqueを撤去。同名別会社・複数番号・重複候補を安全に扱うため。通常indexと元行uniqueに置換し、会社データは削除しません。
- `ALTER TABLE ... DROP CONSTRAINT companies_call_status_check`：直後に許可営業ステータスを拡張したCHECKを再作成。同一トランザクション内です。
- STEP2のUPDATE：既存データの正規化配列・raw原値・営業可否を初期化。STEP2.6のUPDATE：既存の明確な閉廃業をconfirmedへ引き継ぐ。空DBでは対象0行ですが、既存DBで無影響とは言いません。
- 外部キーのON DELETE CASCADEはsignals/snapshotsにあります。migrationは会社削除を実行しませんが、将来の会社削除操作は関連行へ波及します。
- 最終化SQLは権限REVOKE/GRANTとNOTIFYだけで、会社・履歴データは書き換えません。

## 確認の範囲

4 migrationは前工程の使い捨てローカルPostgres/PostgRESTで順序適用・RPC・RLS・検索・再実行を検証済みです。今回の新しい権限最終化SQLと確認SQLは静的に対象/型/依存関係を確認しました。この作業ではSQLを実行していません。実Supabase固有の既存権限・extension・適用状態の確認は、手動適用結果で行います。

# オフライン100件検証

Supabase・環境変数・既存開発データを変更せず、独立したローカルJSONに100行だけコピーします。元Excelは読み取り専用で、前後のSHA256一致を確認します。コマンドはネットワーク通信も環境変数読込も行いません。

```bash
npx --no-install tsx scripts/validate-local-master.ts '/path/【改】自動車全国リスト.xlsx'
```

同じ先頭100データ行を2回処理し、`.data/local-master-validation/report.json` に件数、処理時間、元値/正規化値/営業状態/適格性/シート/行番号と10件の抜き取りを保存します。エラーはerrors.json、列設定はmappings.json、会社と全履歴はcompanies.jsonに保存します。いずれもGit除外対象です。ファイルには営業データが含まれるので外部公開しないでください。

自動認識しないシートがあると取込前に停止します。出力されたmappings.jsonの1始まり列番号、ヘッダー行、履歴列、シート有効設定を確認し、コピーして修正した設定ファイルを第4引数に指定できます。

```bash
npx --no-install tsx scripts/validate-local-master.ts '/path/【改】自動車全国リスト.xlsx' '.data/local-master-validation' '/path/reviewed-mappings.json'
```

電話一致、名前＋所在地一致、候補、営業除外、元行の再実行を検証します。履歴が矛盾する別行は自動上書きせず候補とします。ローカル類似度はpg_trgmに近い計算ですが本番RPCとの同等性は保証しません。このコマンドはSupabaseインポータの代替検証にはなりません。会社一覧の開発用10社は変更しません。ローカル検証コマンドに全件取込オプションはありません。

全件前に必要なのは、全シートの列設定確認、誤統合候補の目視確認、履歴日付と除外表現の確認、ネットワーク復旧後の実DB100件・再実行検証です。100件のローカル時間からSupabase全件処理時間を推定することはできません。ボトルネックはExcel全体の事前走査/共有文字列、RPCの類似検索、DBロック、バッチ往復と再試行、ログ保存です。

マイグレーションの手動順序は [SQL_EDITOR_SETUP.md](SQL_EDITOR_SETUP.md) を参照してください。

# STEP2.14 全国B判定の分析準備と本番取込安全性確認

## 判定：C（本番取込は実行しない）

本番全国JSONLはMacにあり、この環境には未共有です。ユーザー提示のcandidate18809/pending6875は受領した集計で、内訳・20/20/20社・主要理由10社・全国再Dry Run後の値は未実測です。軽量版の件数を全国件数として扱いません。

独立して本番RPCの危険な更新分岐を見つけ、使い捨てローカルPostgreSQL/PostgRESTで再現しました。実Supabaseは読み書きしていません。

1. 品質警告のある新規会社はeligible=falseになる。しかし同一電話の別元行でquality_warnings=[]を受け取ると、import_metadataが上書きされ、未確認の警告が消えてeligible=trueになる。
2. 対象外会社には旧call_statusを優先するため、その次の元行が成約済みでも旧未架電を保持する。警告が上書きで消えると成約会社がeligible=trueになる。

再現結果：未架電の別行→eligible=true/未架電、成約済みの別行→eligible=true/未架電。SQLの修正・マイグレーション適用は今回行っていません。これを解消するまでAにできません。閉業pendingはclosure_stateで保持されますが、品質警告と成約状態はこの問題の影響を受けます。

再現確認：`npm run test:import:integration -- --diagnose-pending-safety`。使い捨てローカルDBのみを起動し、REPRODUCEDが出ることは不具合の再現成功であって本番安全性合格ではありません。

## 分析CLI

`npx tsx scripts/analyze-full-dry-run.ts "/全国Dry Run結果のディレクトリ"`

report.json/rows.jsonl/review.jsonlが必要です。duplicates.jsonlだけでは相手企業の情報がなく、根拠を復元できません。既存Forecastを元行順で再実行し、元のexact/candidateと全行の予測結果が一致することを確認します。差分があれば分析を不合格にします。Excel再解析・ネットワーク・env読込・Supabase使用はありません。

Forecastに一致理由と最大10相手の会社名/電話/住所/県/元行を残す機能を追加しました。予測条件/閾値/インデックス登録対象/本番RPCは変えていません。候補以外のexactも分類し、共用電話の会社名/住所競合を検出します。

分類は根拠別の複数タグと保守的なA/B/C/Dです。Aも分析上の仮分類で、実行可能な自動統合許可ではありません。電話一致＋会社名＋住所一致をA、識別部分/所在地一致をB、別県＋別電話をC、それ以外をDへ分類。支店語・法人格差・一般業界語だけで似ている疑いも付記します。電話共用の社名/住所競合はAにしません。

業界語を除いた識別部分は疑わしい候補のスクリーニングにだけ使い、元の類似候補を削除しません。真の重複を取り逃がさないため、実データ抜き取り確認前には閾値も変更しません。

出力（社内データ。Gitへ含めない）：
- step214-analysis/summary.json：件数、重複分類、理由組合せ、信頼度別最大20件、pending理由別最大10件。
- classified-duplicates.jsonl：exact/candidateの全根拠・相手情報・元行。
- classified-pending.jsonl：元行・理由・推奨保存方法。

抽出は各分類先頭からで、代表性を保証しません。分類に20件/10件存在しない場合は存在数だけ出力します。分類タグとpending理由の件数は重複するため合算できません。summaryのproductionBlockersに上記SQL問題を明示し、判定Cを出します。終了コード2は分析成功・本番保留、1は分析整合性失敗です。

## pendingの扱い

|理由|安全な保存方法|
|---|---|
|過去履歴の閉廃業記述|会社DB登録、closure_state=pending、eligible=false。会社の閉廃業確定は人間確認後|
|不明/欠けた電話|元値/候補を保持して会社DB登録、primaryへ推測設定しない、eligible=false|
|日付不明/URL/時刻|元日付/分類/URLを保持して会社DB登録、eligible=false|
|住所/履歴等の置換文字|元値と異常セル情報を保持、eligible=false|
|会社名欠損/会社名置換文字|会社登録せずmetadataに原値と出典を保持|
|構造不明、誤会社行、共用電話の誤統合疑い|本番取込前に人間確認|

DB登録可能なpendingを一律に捨てる方針ではありません。ただし現在RPCは複数行更新でその推薦停止が維持されないため、SQL修正が先です。

## 本番処理の確認

- 既存94社：原本と100件検証Excelはfile_hashが異なるので、電話/会社名・所在地で照合。必ず94件すべて一致するとは断定しない。
- exact：電話1社一致または会社名・所在地1社一致（両者に異電話ありは候補）でexisting更新。元行台帳は新しい元行を保持。共用電話が1社にしか登録されていない場合は現RPCが統合してしまうので抜き取り確認必須。
- candidate：会社の新規作成/自動統合なし。company_import_recordsにcompany_id=null、candidate_ids、raw/normalized_dataと元行を保存し、import_outcomesにも保存。禁止電話一致は安全側で既存候補会社にも禁止を反映。
- new：会社作成、禁止/成約/closure/品質警告をトリガーで除外。ただし後続existing更新には上記欠陥がある。

元行台帳はfile_hash+sheet+rowでunique。SQLは実DB既存会社でpg_trgmを用いるため、ファイル内Forecastの18809件が実DBでも同じとは限りません。

npm test：43件成功。typecheck成功。候補相手の証拠追加後も軽量版予測差分0。

## この環境で確認した軽量版（全国原本ではない）

47県先頭100行版：3272会社行、candidate89、exact17、予測再現差分0、件数整合true。

pending104の内訳：閉業確認待ち84、日付14（URL9を含む）、電話5、会社名欠損1、文字異常1、複数理由10。これらは重複集計。推薦漏れ0。exactの社名/住所競合13件は精査対象のフラグで、別会社確定ではありません。

全国原本の修正前：candidate18809/pending6875/errors0（ユーザーの実測）。修正後：未測定。判定ロジックはまだ修正していないため、減少を報告しません。まずMacで分析CLIを実行してsummary.jsonを共有し、実データ抜き取りで判断します。

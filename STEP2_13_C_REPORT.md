# STEP2.13-C 内容更新と列構造変更の分離

## 根本原因

旧confirmedMappingは各県のsampleFingerprintと先頭100物理行の実セルJSONを完全一致で比較し、不一致だけでneeds_reviewへ落としていました。生きたマスターの会社名/電話/履歴/ステータス/日付の正常更新まで列設定失効と判定しました。A-AA軽量版と原本の追加列内容の差もhashを変え得ます。47シート認識/104428非空行走査の成功は読取成功であり、旧CはReader失敗ではありません。

## 新しい検証

confirmed-mappings.jsonのcolumns/historyColumns/supplementaryUrlColumnsを一切変更していません。構造根拠は元のSTEP2.11確認済み47シート軽量版から別ファイルconfirmed-structure.jsonへ生成しました。生成スクリプトは47県・各sampleFingerprint完全一致を要求し、更新原本から根拠を勝手に上書きできません。

取込時は内容hash一致を必須にせず、以下を検証します。

1. 全国Dry Runは47県/シート数/欠落を従来通り確認。
2. 確定列（history/supplementaryを含む）がcolumnCount内、基本項目列の重複なし。
3. 確定会社名/電話/住所列にそれぞれ3件以上、非空セルの45%以上の対応形式が存在。
4. ヘッダーあり県は確認済み元行位置とラベル/列番号を照合。
5. ヘッダーなし県は日付/営業結果/履歴/URLのうち2種類以上で各3件以上の独立根拠を確認。STEP2.11の型傾向も使用。
6. status/memo/date/websiteの型が65%以上入れ替わり、別の確定項目にも逆方向の型変化がある場合のみ列交換を疑う。単にステータスが説明文へ更新されただけでは失効しない。
7. 日付とURLの相互交換を検出。数件の日付欄URL/不明電話は既存の行単位needs_reviewで推薦停止。
8. historyColumns/supplementaryUrlColumnsは確定設定と位置をそのまま使用し、重複する履歴/URL参照は意図的に許容。

根拠不足も安全側でneeds_reviewになります。列構造を推測補正しません。一般Webの別形式ヘッダー付きExcelは自動検出を維持しますが、この場合confirmed-registryにはせず、全国Dry RunはmappingIssuesとして停止します。

sampleFingerprintは削除せず、mappingAudit.sampleFingerprintMatchedへ監査結果を保存。構造合格はstructureVerified、停止理由はstructureReasons/mappingIssueDetailsへ保存・表示します。

同じ型の無見出し列どうしの交換など、サンプルの型情報だけで証明できない変更は残る限界です。個々の会社の原値・出典・行単位異常は従来通り保持するため、原本レビューも必要です。無関係Excelをシート名だけで承認する仕様ではありません。

## 検証

npm test 40件、typecheck成功。

追加テスト：履歴/ステータス/電話/会社名/日付の正常値更新、ステータスの説明文更新、ヘッダーなし根拠、列移動/削除、日付-URL交換、結果-履歴交換、ヘッダー位置変更、全47県名で偽装した無関係データ、少数異常セル。

|項目|47県実データ軽量版|47県合成更新10万行|
|---|---:|---:|
|recognizedSheets|47|47|
|missingSheets|0|0|
|mappingIssues|0|0|
|nonempty|3547|100000|
|company|3272|99972|
|metadata|275|28|
|eligible|2290|99972|
|excluded|982|0|
|salesBan|0|0|
|callBan|886|0|
|won|9|0|
|closed|0|0|
|pending|104|0|
|exactDuplicate|17|99971|
|duplicateCandidate|89|0|
|noPhone|11|0|
|unknownPhone|5|0|
|missingCompany|1|0|
|corruption|1|0|
|otherNeedsReview|19|0|
|errors|0|0|
|predictedNew|3166|1|
|durationMs|3669|42058|
|estimatedBatches|66|2000|

両方とも元ファイルhash一致、networkUsed=false、DB未接続。合成データは全行で同じ電話を意図的に使い、ファイル内照合と全行処理の確認用です（新規1という結果は全国原本の登録予測ではありません）。合成Dry RunのピークRSS192172KB、約188MiB。軽量版の確認待ちはBでありCにはしません。

## 本番原本の結果

本番原本【改】自動車全国リスト.xlsxはMacにあり、この環境で104428行の実測再解析はしていません。上記の合成/軽量検証結果を原本の実測と混同しません。Macで同じdry-runコマンドを再実行し、全統計と構造理由を確認してください。本番Supabase書込みは実行していません。

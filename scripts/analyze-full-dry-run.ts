// Offline STEP2.14 analysis of existing JSONL, no Excel, env, or Supabase client.
import {promises as fs,createReadStream} from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {DuplicateForecast,type ForecastCompany} from '../lib/import/dry-run';
import type {ImportRow} from '../lib/import/types';
async function* lines(file:string){const input=createReadStream(file);const reader=createInterface({input,crlfDelay:Infinity});try{for await(const line of reader)if(line.trim())yield JSON.parse(line);}finally{reader.close();input.destroy();}}
const increment=(counts:Record<string,number>,key:string)=>{counts[key]=(counts[key]??0)+1;};
export function distinctiveName(name:string){return name.replace(/オートサービス|カーショップ|自動車|モータース|鈑金塗装|板金塗装|鈑金|板金|塗装|整備工場|カーサービス|オート|モータ|株式会社|有限会社/g,'');}
export function classifyDuplicate(row:ImportRow,evidence:DuplicateForecast['evidence']){
 const refs=evidence.matches;const tags=new Set<string>();const matching=(fn:(r:ForecastCompany)=>boolean)=>refs.some(fn);
 const phone=matching(r=>row.normalized_phones.some(p=>r.normalized_phones.includes(p)));
 if(phone)tags.add('同一電話番号');if(evidence.reason==='multiple_phone_matches')tags.add('複数会社が同一電話番号');
 if(matching(r=>r.company_name.normalize('NFKC').trim()===row.company_name.normalize('NFKC').trim()))tags.add('完全同一会社名');
 if(matching(r=>r.normalized_company_name===row.normalized_company_name&&r.company_name!==row.company_name&&/株式会社|有限会社|合同会社|㈱|㈲|[（(][株有同][）)]/.test(r.company_name+row.company_name)))tags.add('法人格違い');
 if(matching(r=>r.normalized_company_name===row.normalized_company_name&&row.prefecture!==''&&r.prefecture===row.prefecture))tags.add('同一会社名＋同一都道府県');
 if(matching(r=>r.normalized_company_name===row.normalized_company_name&&row.normalized_address!==''&&r.normalized_address===row.normalized_address))tags.add('同一会社名＋同一住所');
 if(evidence.reason==='similar_name')tags.add('類似会社名のみ');
 if(/支店|本店|営業所|支社|本社|店舗/.test([row.company_name,...refs.map(r=>r.company_name)].join(' ')))tags.add('支店／本店／営業所の可能性');
 const different=matching(r=>r.prefecture!==''&&row.prefecture!==''&&r.prefecture!==row.prefecture&&r.normalized_phones.length>0&&row.normalized_phones.length>0&&!row.normalized_phones.some(p=>r.normalized_phones.includes(p)));
 if(different)tags.add('同名別会社の可能性');if(!tags.size)tags.add('その他');
 const core=distinctiveName(row.normalized_company_name);const distinctiveMatch=core.length>=2&&matching(r=>distinctiveName(r.normalized_company_name)===core);
 const industryOnly=evidence.reason==='similar_name'&&!distinctiveMatch;
 // A is an audit suggestion only, never an executable merge permission.
 const strong=matching(r=>r.normalized_company_name===row.normalized_company_name&&row.normalized_address!==''&&r.normalized_address===row.normalized_address);
 const sharedPhoneConflict=phone&&matching(r=>r.normalized_company_name!==row.normalized_company_name||r.normalized_address!==row.normalized_address);
 const grade=phone&&evidence.matchCount===1&&strong&&!sharedPhoneConflict?'A':different&&!phone?'C':strong||distinctiveMatch?'B':'D';
 const confidence=grade==='A'||strong?'high':grade==='B'?'medium':'low';
 return {grade,confidence,tags:[...tags],forecastReason:evidence.reason,industryCommonWordsOnlySuspected:industryOnly,distinctiveMatch,sharedPhoneConflict,autoMergeExecuted:false};
}
export function pendingReasons(entry:any){
 const reasons=new Set<string>();const r=entry.row as ImportRow|undefined;const meta=entry.metadata;
 if(r){if(r.closure_state==='pending')reasons.add('閉業確認待ち');if(r.phone_candidates?.some(p=>p.kind==='unresolved'))reasons.add('電話番号要確認');
 const date=(r.import_metadata?.date_classification as any)?.kind;if(date&&!['valid_date','datetime','empty'].includes(date))reasons.add('日付列要確認');if(date==='url_in_date_column')reasons.add('URL混入');
 if((r.import_metadata?.anomalies as any[]??[]).some(a=>a.anomaly_type==='source_text_corruption'))reasons.add('文字異常');
 const warnings=r.import_metadata?.quality_warnings as string[]??[];if(warnings.some(w=>!/日付列要確認|電話番号要確認|置換文字/.test(w)))reasons.add('その他quality warning');}
 for(const a of meta?.anomalies??[]){if(a.anomaly_type==='company_name_missing')reasons.add('会社名欠損');else if(a.anomaly_type==='source_text_corruption')reasons.add('文字異常');else reasons.add('その他quality warning');}
 if(!reasons.size)reasons.add('その他quality warning');return [...reasons];
}
async function main(){
 const directory=process.argv[2];if(!directory)throw Error('分析対象のreport.json/rows.jsonl/review.jsonlがあるディレクトリを指定してください');
 const report=JSON.parse(await fs.readFile(path.join(directory,'report.json'),'utf8'));const output=path.join(directory,'step214-analysis');await fs.mkdir(output,{recursive:true});
 const predictor=new DuplicateForecast(),tags:Record<string,number>={},grades:Record<string,number>={},candidateGrades:Record<string,number>={},pending:Record<string,number>={},combinations:Record<string,number>={};
 const duplicateSamples:Record<string,unknown[]>={high:[],medium:[],low:[]},pendingSamples:Record<string,unknown[]>={};let rows=0,candidates=0,exact=0,mismatches=0,reviewRows=0,multipleReasons=0,industryOnly=0,sharedPhoneConflicts=0,recommendationLeaks=0;
 const duplicates=await fs.open(path.join(output,'classified-duplicates.jsonl'),'w'),reviews=await fs.open(path.join(output,'classified-pending.jsonl'),'w');
 try{
 for await(const item of lines(path.join(directory,'rows.jsonl'))){const row=item.row as ImportRow;if(!row)throw Error('rows.jsonl形式が不正です');rows++;const prediction=predictor.accept(row);if(prediction!==item.duplicate)mismatches++;
 if(prediction==='new')continue;if(prediction==='candidate')candidates++;else exact++;
 const classification=classifyDuplicate(row,predictor.evidence);for(const tag of classification.tags)increment(tags,tag);increment(grades,classification.grade);if(prediction==='candidate'){increment(candidateGrades,classification.grade);if(classification.industryCommonWordsOnlySuspected)industryOnly++;}
 if(classification.sharedPhoneConflict)sharedPhoneConflicts++;
 const record={source_sheet:row.source_sheet,source_row:row.source_row,company_name:row.company_name,phone:row.phone,address:row.address,prefecture:row.prefecture,originalPrediction:item.duplicate,classification,evidence:predictor.evidence};await duplicates.write(JSON.stringify(record)+'\n');
 if(prediction==='candidate'&&duplicateSamples[classification.confidence].length<20)duplicateSamples[classification.confidence].push(record);
 }
 for await(const entry of lines(path.join(directory,'review.jsonl'))){reviewRows++;const reasons=pendingReasons(entry);for(const reason of reasons)increment(pending,reason);if(reasons.length>1)multipleReasons++;increment(combinations,[...reasons].sort().join(' + '));const row=entry.row as ImportRow|undefined;if(row?.eligible_for_sales)recommendationLeaks++;
 const disposition=row?'DB登録するが eligible_for_sales=false':'会社登録せずmetadataのみ';
 const record={source_sheet:row?.source_sheet??entry.metadata?.source_sheet,source_row:row?.source_row??entry.metadata?.source_row,company_name:row?.company_name,phone:row?.phone,address:row?.address,prefecture:row?.prefecture,reasons,disposition,eligible_for_sales:row?.eligible_for_sales,closure_reason:row?.closure_reason,raw_status:row?.raw_status,raw_last_call_date:row?.raw_last_call_date,phone_candidates:row?.phone_candidates,anomalies:row?.import_metadata?.anomalies??entry.metadata?.anomalies,raw_cells:entry.metadata?.raw_cells,closure_evidence:row?[row.raw_status,row.raw_memo,row.raw_history].flatMap(text=>text.split('\n').filter(line=>/閉業|廃業/.test(line)).map(line=>line.slice(0,500))).slice(0,20):[],history_excerpt:row?.raw_history.slice(0,1000)};await reviews.write(JSON.stringify(record)+'\n');
 for(const reason of reasons){pendingSamples[reason]??=[];if(pendingSamples[reason].length<10)pendingSamples[reason].push(record);}
 }
 }finally{await duplicates.close();await reviews.close();}
 const countsMatch=rows===report.counts.company&&candidates===report.counts.duplicateCandidate&&exact===report.counts.exactDuplicate&&reviewRows===report.counts.pending;
 const result={mode:'offline-step214-analysis',fileHash:report.fileHash,rows,candidates,exact,grades,candidateGrades,tags,pending,reasonCombinations:combinations,multipleReasons,industryCommonWordsOnlySuspected:industryOnly,sharedPhoneConflicts,recommendationLeaks,replayMismatches:mismatches,countsMatch,networkUsed:false,duplicateSamples,pendingSamples,sampleCoverage:{duplicates:Object.fromEntries(Object.entries(duplicateSamples).map(([key,value])=>[key,{requested:20,available:value.length}])),pending:Object.fromEntries(Object.entries(pendingSamples).map(([key,value])=>[key,{requested:10,available:value.length}]))},analysisIntegrity:countsMatch&&mismatches===0&&recommendationLeaks===0?'verified':'failed',decision:'C',productionBlockers:['既存RPCの品質警告上書きで営業対象外が営業可へ戻る問題をローカルDBで再現済み','既存対象外会社への成約ステータスが反映されない問題をローカルDBで再現済み'],limitations:['本番RPC/pg_trgmとは別のファイル内予測の分析。既存94社とは未照合。','タグは重複集計、複数理由も重複集計。サンプルは先頭抽出で代表性を保証しない。','A/B/C/Dは保守的な機械分類で人間確認済みではない。Aでも自動統合しない。','業界語のみ疑いはスクリーニング。実データを目視確認するまで閾値変更/候補除外しない。']};
 await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({output,rows,candidates,exact,candidateGrades,pending,multipleReasons,industryCommonWordsOnlySuspected:industryOnly,sharedPhoneConflicts,recommendationLeaks,replayMismatches:mismatches,countsMatch,analysisIntegrity:result.analysisIntegrity,productionBlockers:result.productionBlockers,decision:result.decision,networkUsed:false},null,2));process.exitCode=result.analysisIntegrity==='failed'?1:2;
}
if(process.argv[1]?.endsWith('analyze-full-dry-run.ts'))main().catch(e=>{console.error(e instanceof Error?e.message:'分析失敗');process.exitCode=1;});

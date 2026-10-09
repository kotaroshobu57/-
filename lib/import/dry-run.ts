// Offline audit: deliberately no Supabase import or environment loading.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {hashFile,inspectWorkbook,rowHash,workbookRows} from './excel';
import {importEntries} from './entries';
import {PREFECTURES,detectPrefecture} from '../normalize';
import type {ImportRow} from './types';
export const newAuditCounts=()=>({nonempty:0,company:0,metadata:0,eligible:0,excluded:0,salesBan:0,callBan:0,won:0,closed:0,pending:0,exactDuplicate:0,duplicateCandidate:0,noPhone:0,unknownPhone:0,missingCompany:0,corruption:0,otherNeedsReview:0,errors:0,predictedNew:0});
type Counts=ReturnType<typeof newAuditCounts>;
function grams(s:string){const out=new Set<string>();for(const word of s.match(/[\p{L}\p{N}]+/gu)??[]){const text=Array.from('  '+word+' ');for(let i=0;i<text.length-2;i++)out.add(text.slice(i,i+3).join(''));}return out;}
// File-only prediction. Indexes avoid scanning all preceding companies per row.
export class DuplicateForecast {
 private rows:Array<Pick<ImportRow,'normalized_company_name'|'normalized_phones'|'prefecture'|'normalized_address'>>=[];
 private phones=new Map<string,Set<number>>();private names=new Map<string,Set<number>>();private terms=new Map<string,Set<number>>();
 private put(map:Map<string,Set<number>>,key:string,id:number){if(!key)return;let ids=map.get(key);if(!ids){ids=new Set();map.set(key,ids);}ids.add(id);}
 accept(row:ImportRow):'new'|'exact'|'candidate'{
  const phoneMatches=new Set<number>();for(const p of row.normalized_phones)for(const id of this.phones.get(p)??[])phoneMatches.add(id);
  if(phoneMatches.size)return phoneMatches.size===1?'exact':'candidate';
  const same=[...(this.names.get(row.normalized_company_name)??[])];
  const strong=same.filter(id=>{const r=this.rows[id];return row.prefecture!==''&&r.prefecture===row.prefecture||row.normalized_address!==''&&r.normalized_address===row.normalized_address;});
  if(strong.length){if(strong.length>1)return 'candidate';return row.normalized_phones.length&&this.rows[strong[0]].normalized_phones.length?'candidate':'exact';}
  if(same.length)return 'candidate';
  const g=grams(row.normalized_company_name),hits=new Map<number,number>();for(const term of g)for(const id of this.terms.get(term)??[])hits.set(id,(hits.get(id)??0)+1);
  for(const [id,common] of hits){const other=grams(this.rows[id].normalized_company_name);if(common/(g.size+other.size-common||1)>=.85)return 'candidate';}
  const id=this.rows.length;this.rows.push({normalized_company_name:row.normalized_company_name,normalized_phones:row.normalized_phones,prefecture:row.prefecture,normalized_address:row.normalized_address});
  for(const p of row.normalized_phones)this.put(this.phones,p,id);this.put(this.names,row.normalized_company_name,id);for(const term of g)this.put(this.terms,term,id);return 'new';
 }
}
export async function dryRun(file:string,directory:string,require47=true){
 const started=Date.now();await fs.mkdir(directory,{recursive:true});const lock=await fs.open(path.join(directory,'audit.lock'),'wx');
 const streams=await Promise.all(['rows','metadata','errors','review','duplicates'].map(name=>fs.open(path.join(directory,name+'.jsonl'),'w')));
 try{
 const fileHash=await hashFile(file),mappings=await inspectWorkbook(file);const missing=PREFECTURES.filter(p=>!mappings.some(m=>detectPrefecture(m.sheet)===p));
 const mappingIssues=mappings.filter(m=>m.mappingSource!=='confirmed-registry'||m.needs_review||!m.enabled).map(m=>m.sheet);
 const counts=newAuditCounts(),sheets=Object.fromEntries(mappings.map(m=>[m.sheet,newAuditCounts()]));const predictor=new DuplicateForecast();
 await fs.writeFile(path.join(directory,'mappings.json'),JSON.stringify(mappings,null,2));
 const blocked=(require47&&(mappings.length!==47||missing.length>0))||mappingIssues.length>0;
 if(blocked)for await(const row of workbookRows(file)){counts.nonempty++;sheets[row.sheet].nonempty++;}
 if(!blocked)for await(const entry of importEntries(file,mappings,path.basename(file),fileHash)){
  const sheet=entry.kind==='company'?entry.row.source_sheet:entry.kind==='metadata'?entry.metadata.source_sheet:entry.source_sheet;const local=sheets[sheet];const add=(key:keyof Counts)=>{counts[key]++;local[key]++;};add('nonempty');
  if(entry.kind==='metadata'){
   add('metadata');await streams[1].write(JSON.stringify(entry.metadata)+'\n');
   const anomalies=entry.metadata.anomalies??[];if(anomalies.some(a=>a.anomaly_type==='company_name_missing'))add('missingCompany');if(anomalies.some(a=>a.anomaly_type==='source_text_corruption'))add('corruption');if(entry.metadata.needs_review){add('pending');await streams[3].write(JSON.stringify(entry)+'\n');}continue;
  }
  if(entry.kind==='error'){add('errors');await streams[2].write(JSON.stringify(entry)+'\n');continue;}
  const r=entry.row;add('company');add(r.eligible_for_sales?'eligible':'excluded');if(r.is_do_not_call){if(r.call_status==='営業禁止')add('salesBan');else add('callBan');}if(r.call_status==='成約済み')add('won');if(r.closure_state==='confirmed')add('closed');
  const warnings=r.import_metadata?.quality_warnings as string[]??[];const pending=r.closure_state==='pending'||warnings.length>0;
  if(pending){add('pending');await streams[3].write(JSON.stringify(entry)+'\n');}if(warnings.length)add('otherNeedsReview');
  if(!r.normalized_phones.length)add('noPhone');if(r.phone_candidates?.some(p=>p.kind==='unresolved'))add('unknownPhone');if((r.import_metadata?.anomalies as unknown[]??[]).length)add('corruption');
  const duplicate=predictor.accept(r);add(duplicate==='new'?'predictedNew':duplicate==='exact'?'exactDuplicate':'duplicateCandidate');
  const item={source_sheet:r.source_sheet,source_row:r.source_row,row_hash:rowHash(r),duplicate,row:r};await streams[0].write(JSON.stringify(item)+'\n');if(duplicate!=='new')await streams[4].write(JSON.stringify(item)+'\n');
  if(counts.company%1000===0)console.log(JSON.stringify({offline:true,processed:counts.company,sheet}));
 }
 const unchanged=await hashFile(file)===fileHash;if(!unchanged)throw Error('元Excelが解析中に変更されました');
 const durationMs=Date.now()-started;const decision=blocked||counts.errors?'C':counts.pending||counts.duplicateCandidate?'B':'A';
 const report={version:1,mode:'offline-full-dry-run',sourceFile:path.basename(file),fileHash,reader:'shared-workbook-reader',recognizedSheets:mappings.length,missingSheets:missing,mappingIssues,decision,blocked,counts,sheets,mappings,durationMs,originalUnchanged:unchanged,recommendedBatchSize:50,estimatedBatches:Math.ceil((counts.company+counts.errors)/50),prediction:{newCompanies:counts.predictedNew,duplicateCandidates:counts.duplicateCandidate,excludedCompanyRows:counts.excluded,reviewRows:counts.pending,errors:counts.errors,dbWriteTime:'未測定・推測のみ。Mac解析時間からDB通信/RPC時間は推定できません。100件実測のバッチ時間×推定バッチ数を目安にします。'},limitations:['DB未接続。既存Supabase会社との一致を含まないファイル内予測です。','重複予測は既存SQLの電話→会社名/所在地→類似度優先順位に基づく近似です。pg_trgmと履歴統合の最終結果は実DBで異なる可能性があります。','集計は元会社行単位。複数の除外/異常分類は重複し、登録後の一意会社数とは異なります。','先頭100行以降の列構造変更は目視レビューが必要です。']};
 await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));return report;
 }finally{await Promise.all(streams.map(s=>s.close()));await lock.close();await fs.unlink(path.join(directory,'audit.lock'));}
}

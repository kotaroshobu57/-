import {importEntries} from '../lib/import/entries';
// Offline only: no environment loading, Supabase imports, or network requests.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashFile, inspectWorkbook, workbookRows, parseImportRow, rowHash, validateMappings } from '../lib/import/excel';
import type { ImportRow, ImportOutcome, Counts } from '../lib/import/types';

export interface LocalState { companies: Array<ImportRow & {id:string}>; records: Record<string,{hash:string;outcome:ImportOutcome}>; }
export function applyRow(state:LocalState,row:ImportRow):ImportOutcome {
 const key=JSON.stringify([row.file_hash,row.source_sheet,row.source_row]);
 const previous=state.records[key];
 if(previous){if(previous.hash!==rowHash(row))throw new Error('同一元行の変換内容が変化しています');return {...previous.outcome,kind:previous.outcome.company_id?'existing':previous.outcome.kind};}
 let matches=state.companies.filter(c=>row.normalized_phones.some(p=>c.normalized_phones.includes(p)));
 // Confirmed telephone-level prohibition also suppresses existing matches; never
 // leave an earlier local company eligible merely because histories differ.
 if(row.is_do_not_call)for(const c of matches){c.is_do_not_call=true;c.eligible_for_sales=false;c.exclusion_reason='営業禁止';}
 let candidate=false;
 if(!matches.length){
  matches=state.companies.filter(c=>c.normalized_company_name===row.normalized_company_name&&((row.prefecture!==''&&row.prefecture===c.prefecture)||(row.normalized_address!==''&&row.normalized_address===c.normalized_address)));
  candidate=matches.length===1&&row.normalized_phones.length>0&&matches[0].normalized_phones.length>0;
 }
 if(!matches.length){matches=state.companies.filter(c=>c.normalized_company_name===row.normalized_company_name||similarity(c.normalized_company_name,row.normalized_company_name)>=.85);candidate=matches.length>0;}
 candidate ||= matches.length>1;
 // A different source row with conflicting sales history must be reviewed locally,
 // rather than silently overwriting a company. SQL production merge remains unchanged.
 if(matches.length===1&&!candidate){const c=matches[0];candidate=c.call_status!==row.call_status||c.call_memo!==row.call_memo||c.last_call_date!==row.last_call_date||c.eligible_for_sales!==row.eligible_for_sales;}
 const outcome:ImportOutcome={source_sheet:row.source_sheet,source_row:row.source_row,kind:candidate?'duplicate_candidate':matches.length?'existing':'new',company_id:candidate?null:matches[0]?.id??randomUUID(),candidate_ids:candidate?matches.map(c=>c.id):[],excluded:!row.eligible_for_sales,message:candidate?'ローカル検証候補：自動統合せず要確認':''};
 if(outcome.kind==='new')state.companies.push({...row,id:outcome.company_id!});
 state.records[key]={hash:rowHash(row),outcome};return outcome;
}
function similarity(a:string,b:string){
 const grams=(s:string)=>{const out=new Set<string>();for(const word of s.match(/[\p{L}\p{N}]+/gu)??[]){const chars=Array.from('  '+word+' ');for(let i=0;i<chars.length-2;i++)out.add(chars.slice(i,i+3).join(''));}return out;};
 const x=grams(a),y=grams(b);const common=[...x].filter(g=>y.has(g)).length;return common/(x.size+y.size-common||1);
}
export async function validateLocal(file:string,directory:string,mappingFile?:string,limit=100){
 await fs.mkdir(directory,{recursive:true});const lock=await fs.open(path.join(directory,'validation.lock'),'wx');
 try{
 const started=Date.now(),before=await hashFile(file);
 const mappings=validateMappings(mappingFile?JSON.parse(await fs.readFile(mappingFile,'utf8')):await inspectWorkbook(file));
 await fs.writeFile(path.join(directory,'mappings.json'),JSON.stringify(mappings,null,2));
 // Never silently omit an unrecognized sheet when automatically inspecting.
 if(!mappingFile&&mappings.some(m=>!m.enabled))throw new Error('未認識シートがあります。mappings.jsonを確認し、明示的な列設定を指定してください');
 const stateFile=path.join(directory,'companies.json');let state:LocalState;
 try{state=JSON.parse(await fs.readFile(stateFile,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;state={companies:[],records:{}};}
 const initial=state.companies.length;const runs=[];const metadata:unknown[]=[];
 for(let run=0;run<2;run++){
 const begin=Date.now();const counts:Counts={read:0,new:0,existing:0,duplicate_candidate:0,excluded:0,errors:0};const results=[];const excluded=new Set<string>();
 for await(const entry of importEntries(file,mappings,path.basename(file),before)){
  if(entry.kind==='metadata'){if(run===0)metadata.push(entry.metadata);continue;}
  if(counts.read>=limit)break;counts.read++;
  try{if(entry.kind==='error')throw Object.assign(new Error(entry.message),{entry});const row=entry.row;const outcome=applyRow(state,row);if(outcome.kind==='error')counts.errors++;else counts[outcome.kind]++;if(outcome.excluded)excluded.add(outcome.company_id??JSON.stringify([row.source_sheet,row.source_row]));results.push({row,outcome});}
  catch(e){counts.errors++;results.push({source_sheet:entry.kind==='error'?entry.source_sheet:entry.row.source_sheet,source_row:entry.kind==='error'?entry.source_row:entry.row.source_row,error:e instanceof Error?e.message:'解析失敗',raw_cells:entry.kind==='error'?entry.raw_cells:[]});}
 }
 counts.excluded=excluded.size;runs.push({counts,durationMs:Date.now()-begin,companyCount:state.companies.length,results});
 }
 if(await hashFile(file)!==before)throw new Error('元Excelのハッシュが変化しました。保存を中止');
 const report={mode:'offline-validation',limit,metadata,source_file:path.basename(file),durationMs:Date.now()-started,initialCompanyCount:initial,finalCompanyCount:state.companies.length,runs,samples:runs[0].results.filter(r=>'row' in r).slice(0,10),limitations:['ローカルの類似度はpg_trgm相当の近似。実DB RPCと同等性未検証','異なる元行の営業履歴が不一致の場合は保守的に候補化。Supabaseの更新処理は未検証','未対象行・他シートの重複と全件処理性能は未検証']};
 await fs.writeFile(stateFile+'.tmp',JSON.stringify(state,null,2));await fs.rename(stateFile+'.tmp',stateFile);
 await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
 await fs.writeFile(path.join(directory,'errors.json'),JSON.stringify(runs.flatMap(r=>r.results.filter(x=>'error' in x)),null,2));
 return report;
 }finally{await lock.close();await fs.unlink(path.join(directory,'validation.lock'));}
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
 const file=process.argv[2];if(!file)throw new Error('Usage: tsx scripts/validate-local-master.ts /path/master.xlsx [output-directory] [mapping.json]');
 const directory=path.resolve(process.argv[3]??'.data/local-master-validation');
 try{const report=await validateLocal(path.resolve(file),directory,process.argv[4]);console.log(JSON.stringify({mode:report.mode,runs:report.runs.map(({counts,durationMs,companyCount})=>({counts,durationMs,companyCount})),report_file:path.join(directory,'report.json')},null,2));}catch(e){console.error(e instanceof Error?e.message:'ローカル検証失敗');process.exitCode=1;}
}

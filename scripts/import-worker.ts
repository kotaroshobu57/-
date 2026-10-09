import {importEntries} from '../lib/import/entries';
import nextEnv from '@next/env';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { supabaseClient } from '../lib/supabase';
import { IMPORT_ROOT,listJobs,readJob,writeJob,jobDirectory } from '../lib/import/jobs';
import { inspectWorkbook,workbookRows,parseImportRow,rowHash,hashFile } from '../lib/import/excel';
import type { ImportJob,ImportOutcome } from '../lib/import/types';
nextEnv.loadEnvConfig(process.cwd(),true);
const batchSize=Number(process.env.IMPORT_BATCH_SIZE??200);
if(!Number.isInteger(batchSize)||batchSize<1||batchSize>250)throw new Error('IMPORT_BATCH_SIZE は1〜250');
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
const errorText=(e:unknown)=>e instanceof Error?e.message:'取込処理に失敗しました';
async function reports(job:ImportJob) {
 if(!job.runId)return;
 const db=supabaseClient(),dir=jobDirectory(job.id);const files=['results','errors','candidates'];
 const handles=await Promise.all(files.map(f=>fs.open(path.join(dir,f+'.jsonl.tmp'),'w')));
 try {
  for(let offset=0;;offset+=500){const {data,error}=await db.from('import_outcomes').select('outcome').eq('run_id',job.runId).order('source_sheet').order('source_row').range(offset,offset+499);if(error)throw new Error('取込結果の取得に失敗しました');
   for(const row of data){const o=row.outcome as ImportOutcome;const line=JSON.stringify(o)+'\n';await handles[0].write(line);if(o.kind==='error')await handles[1].write(line);if(o.kind==='duplicate_candidate')await handles[2].write(line);}
   if(data.length<500)break;
  }
 }finally{await Promise.all(handles.map(h=>h.close()));}
 for(const file of files)await fs.rename(path.join(dir,file+'.jsonl.tmp'),path.join(dir,file+'.jsonl'));
}
async function persistRun(job:ImportJob) {
 const {error}=await supabaseClient().from('import_runs').upsert({id:job.runId,source_file:job.sourceFile,file_hash:job.fileHash,status:job.status,counts:job.counts,processed:job.processed,duration_ms:job.durationMs,error_message:job.error??'',updated_at:new Date().toISOString()});
 if(error)throw new Error(`取込履歴の保存に失敗しました (${error.code})。STEP2マイグレーションを確認してください`);
}
async function batch(job:ImportJob,rows:Record<string,unknown>[]) {
 let outcomes:ImportOutcome[]|null=null;
 for(let attempt=0;attempt<3;attempt++){
  const {data,error}=await supabaseClient().rpc('import_company_batch',{p_run_id:job.runId,p_rows:rows});
  if(!error){outcomes=data as ImportOutcome[];break;}
  if(!['57014','PGRST003'].includes(error.code)&&!error.message.includes('fetch failed')&&!error.message.includes('timeout'))throw new Error(`バッチ保存に失敗しました (${error.code})。DB設定と権限を確認してください`);
  if(attempt===2)throw new Error('バッチの通信・タイムアウトが解消しません。接続を確認し、同じ取込を再開してください');
  await pause(1000*(attempt+1));
 }
 if(!outcomes||outcomes.length!==rows.length)throw new Error('バッチ結果の件数が一致しません。再開時にDBの処理記録を照合します');
 for(const o of outcomes){job.counts.read++;if(o.kind==='error')job.counts.errors++;else job.counts[o.kind]++;if(o.count_excluded)job.counts.excluded++;}
 job.processed+=outcomes.length;job.durationMs=Date.now()-Date.parse(job.startedAt!);
 // The DB ledger commits before this checkpoint: a crash here safely replays the same batch.
 await writeJob(job);await persistRun(job);
 console.log(JSON.stringify({job:job.id,processed:job.processed,counts:job.counts}));
}
async function processJob(job:ImportJob) {
 const file=path.join(jobDirectory(job.id),'original.xlsx');
 try {
  if(await hashFile(file)!==job.fileHash)throw new Error('保存されたExcelのハッシュが一致しません。元ファイルを再アップロードしてください');
  if(job.status==='inspecting'){job.mappings=await inspectWorkbook(file);job.status='ready';job.error=undefined;await writeJob(job);console.log(`列確認完了: ${job.id}`);return;}
  if(process.env.DATA_MODE!=='supabase')throw new Error('取込は DATA_MODE=supabase が必要です。ローカルSTEP1データは変更しません');
  const readiness=await supabaseClient().from('companies').select('closure_state,imported_urls,mobile_candidates,phone_candidates,import_metadata').limit(0);if(readiness.error)throw new Error('STEP2.6 migrationが未適用です。取込は開始しません');
  job.status='running';job.runId??=randomUUID();job.startedAt??=new Date().toISOString();job.error=undefined;await writeJob(job);await persistRun(job);
  const mapping=new Map(job.mappings.filter(m=>m.enabled).map(m=>[m.sheet,m]));
  const pending:Record<string,unknown>[]=[];const metadata:Record<string,unknown>[]=[];let seen=0;
  const flushMetadata=async()=>{if(!metadata.length)return;const {error}=await supabaseClient().from('import_metadata').upsert(metadata.splice(0),{onConflict:'file_hash,source_sheet,source_row'});if(error)throw new Error('取込メタデータの保存失敗');};
  for await(const entry of importEntries(file,job.mappings,job.sourceFile,job.fileHash)){
   if(stopping)return;
   if(entry.kind==='metadata'){
    const {anomalies,needs_review,...source}=entry.metadata;metadata.push({...source,raw_cells:anomalies?.length?[...source.raw_cells,{needs_review,anomalies}]:source.raw_cells});if(metadata.length>=batchSize)await flushMetadata();continue;
   }
   if(job.limit>0 && seen>=job.limit)break;
   seen++;if(seen<=job.processed)continue;
   if(entry.kind==='company')pending.push({...entry.row,row_hash:rowHash(entry.row)});
   else pending.push({source_sheet:entry.source_sheet,source_row:entry.source_row,parse_error:entry.message,raw_data:entry.raw_cells});
   if(pending.length>=batchSize){await flushMetadata();await batch(job,pending.splice(0));if(stopping)return;}
  }
  await flushMetadata();
  if(stopping)return;
  if(pending.length)await batch(job,pending);
  if(stopping)return;
  if(process.argv.includes('--full')){const expected=Number(process.argv[process.argv.indexOf('--expected')+1]);if(!Number.isInteger(expected)||expected<=0||job.processed!==expected)throw new Error('全国Dry Run件数と処理件数が一致しません');}
  if(seen<job.processed)throw new Error('処理位置とExcel行数が一致しません');
  job.durationMs=Date.now()-Date.parse(job.startedAt);await reports(job);job.status='completed';await persistRun(job);await writeJob(job);
 }catch(e){job.status='failed';job.error=errorText(e);job.durationMs=job.startedAt?Date.now()-Date.parse(job.startedAt):0;await writeJob(job);if(job.runId){try{await persistRun(job);await reports(job);}catch{console.error('DBへの失敗記録・結果ファイル保存は未完了です');}}console.error(JSON.stringify({job:job.id,error:job.error}));}
}
await fs.mkdir(IMPORT_ROOT,{recursive:true});
const lock=path.join(IMPORT_ROOT,'.worker-lock');
try{await fs.mkdir(lock);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const pid=Number(await fs.readFile(path.join(lock,'pid'),'utf8').catch(()=>''));if(!pid)throw new Error('ワーカーロックを確認してください');try{process.kill(pid,0);throw new Error('取込ワーカーは既に動作しています');}catch(check){if((check as NodeJS.ErrnoException).code!=='ESRCH')throw check;}await fs.rm(lock,{recursive:true});await fs.mkdir(lock);}
await fs.writeFile(path.join(lock,'pid'),String(process.pid));
const heartbeat=async()=>{await fs.writeFile(path.join(IMPORT_ROOT,'worker.json'),JSON.stringify({at:Date.now(),pid:process.pid}));};await heartbeat();
const timer=setInterval(()=>{heartbeat().catch(()=>{});},5000);
try{console.log('取込ワーカー起動（キーは出力しません）');do{const jobs=await listJobs();const selected=process.argv.includes('--job')?process.argv[process.argv.indexOf('--job')+1]:undefined;if(process.argv.includes('--job')&&!selected)throw new Error('--job に取込IDを指定してください');const next=jobs.find(j=>(!selected||j.id===selected)&&['inspecting','queued','running'].includes(j.status));if(next&&process.argv.includes('--max-100')&&next.limit!==100)throw new Error('安全上限：limit=100のジョブだけ実行できます');if(next&&process.argv.includes('--full')&&(next.limit!==0||!process.argv.includes('--expected')||!Number.isInteger(Number(process.argv[process.argv.indexOf('--expected')+1]))||Number(process.argv[process.argv.indexOf('--expected')+1])<=0))throw new Error('全国ジョブはlimit=0とDry Run対象件数が必要です');if(next)await processJob(await readJob(next.id));else if(process.argv.includes('--once'))break;else await pause(1000);}while(!stopping);
}finally{clearInterval(timer);await fs.rm(lock,{recursive:true,force:true});await fs.rm(path.join(IMPORT_ROOT,'worker.json'),{force:true});}

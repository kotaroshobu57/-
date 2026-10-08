// Mac-local operator CLI. Never runs imports without explicit run/repeat/resume.
import nextEnv from '@next/env';import {promises as fs} from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {spawn} from 'node:child_process';
import {supabaseClient} from '../lib/supabase';import {inspectWorkbook,hashFile} from '../lib/import/excel';import {importEntries} from '../lib/import/entries';import {jobDirectory,readJob,writeJob,emptyCounts} from '../lib/import/jobs';
nextEnv.loadEnvConfig(process.cwd(),true);
const action=process.argv[2],sessionFile=path.resolve('.data/supabase-100-session.json');
const save=(v:any)=>fs.writeFile(sessionFile,JSON.stringify(v,null,2),{mode:0o600});
async function snapshot(session:any){
 const db=supabaseClient();const count=await db.from('companies').select('id',{count:'exact',head:true});if(count.error)throw Error('会社件数取得失敗 ('+count.error.code+')');
 const records=await db.from('company_import_records').select('source_sheet,source_row,company_id,row_hash').eq('file_hash',session.fileHash).limit(1000);if(records.error)throw Error('元行台帳取得失敗 ('+records.error.code+')');
 const selected=(records.data??[]).filter(r=>session.rows.some((t:any)=>t.sheet===r.source_sheet&&t.row===r.source_row)).sort((a,b)=>(a.source_sheet+'/'+a.source_row).localeCompare(b.source_sheet+'/'+b.source_row));
 return {companyCount:count.count,records:selected};
}
try{
 if(action==='prepare'){
  try{await fs.access(sessionFile);throw Error('既存セッションがあります。上書きせずstatusで確認してください');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  const original=path.resolve(process.argv[3]??'');if(!process.argv[3])throw Error('prepare にExcelパスを指定してください');
  const mappings=await inspectWorkbook(original);if(mappings.some(m=>m.needs_review||!m.enabled))throw Error('未確認シートがあります。STEP2.9の確認済み47シート検証Excelを使用してください');
  const fileHash=await hashFile(original),rows=[];for await(const e of importEntries(original,mappings,path.basename(original),fileHash)){if(e.kind==='metadata')continue;if(e.kind==='error')throw Error('取込対象に解析エラーがあります');rows.push({sheet:e.row.source_sheet,row:e.row.source_row});if(rows.length===100)break;}
  if(rows.length!==100)throw Error('100会社行を選択できません');
  const id=randomUUID(),dir=jobDirectory(id);await fs.mkdir(dir,{recursive:true});await fs.copyFile(original,path.join(dir,'original.xlsx'));await fs.chmod(path.join(dir,'original.xlsx'),0o400);if(await hashFile(path.join(dir,'original.xlsx'))!==fileHash)throw Error('コピー一致確認失敗');
  const now=new Date().toISOString();await writeJob({id,sourceFile:path.basename(original),fileHash,status:'ready',createdAt:now,updatedAt:now,durationMs:0,processed:0,limit:100,counts:emptyCounts(),mappings});await save({id,fileHash,rows});console.log(JSON.stringify({prepared:true,job:id,limit:100,networkUsed:false}));
 }else{
  if(!['check','run','status','repeat','resume','verify'].includes(action))throw Error('prepare / check / run / status / repeat / resume / verify を指定してください');
  const session=JSON.parse(await fs.readFile(sessionFile,'utf8')),job=await readJob(session.id);
  if(job.limit!==100||job.fileHash!==session.fileHash)throw Error('100件セッションとジョブの設定が不一致');
  if(action==='status'){console.log(JSON.stringify({job:job.id,status:job.status,counts:job.counts,processed:job.processed,durationMs:job.durationMs,reports:jobDirectory(job.id)},null,2));process.exit(0);}
  for(const key of ['DATA_MODE','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'])if(!process.env[key])throw Error(key+' 未設定');if(process.env.DATA_MODE!=='supabase')throw Error('DATA_MODE=supabase が必要');
  if(action==='check'){const before=await snapshot(session);if(!session.before){session.before=before;await save(session);}console.log(JSON.stringify({connected:true,limit:100,companyCount:before.companyCount,targetLedgerRows:before.records.length,readOnly:true}));}
  else if(action==='verify'){
   if(!session.first||!session.second)throw Error('初回と再実行の両方を完了してください');const current=await snapshot(session);const same=JSON.stringify(session.first)===JSON.stringify(current);const complete=job.status==='completed'&&job.counts.read===100&&job.counts.errors===0&&current.records.length===100;console.log(JSON.stringify({secondRunNew:job.counts.new,ledgerRows:current.records.length,companyCount:current.companyCount,sameCompanyIdsAndSourceRows:same,all100RowsVerified:complete,noDuplicateRegistration:complete&&same&&job.counts.new===0},null,2));if(!complete||!same||job.counts.new!==0)process.exitCode=1;
  }else{
   if(!session.before)throw Error('先にcheckを実行してください');if(action==='run'&&job.status!=='ready')throw Error('初回はreadyジョブのみ。再実行はrepeat、停止後はresume');
   if(action==='repeat'&&(!session.first||job.status!=='completed'||job.counts.errors!==0))throw Error('初回完了後のみrepeatできます');
   if(action==='resume'&&!['failed','running','queued'].includes(job.status))throw Error('再開対象ではありません');
   if(action!=='resume'){job.runId=randomUUID();job.processed=0;job.counts=emptyCounts();job.startedAt=undefined;job.durationMs=0;}job.status='queued';job.error=undefined;await writeJob(job);
   const worker=spawn(path.resolve('node_modules/.bin/tsx'),['scripts/import-worker.ts','--once','--job',job.id,'--max-100'],{stdio:'inherit',env:{...process.env,IMPORT_BATCH_SIZE:'50'}});let interrupted=false;const stop=()=>{interrupted=true;worker.kill('SIGTERM');};process.on('SIGINT',stop);process.on('SIGTERM',stop);
   const code=await new Promise<number|null>(resolve=>worker.on('exit',resolve));process.off('SIGINT',stop);process.off('SIGTERM',stop);const completed=await readJob(job.id);if(interrupted||code!==0||completed.status!=='completed')throw Error('停止または未完了。statusで確認し、同じセッションをresumeしてください');
   const result=await snapshot(session);if(!session.first)session.first=result;else session.second=result;await save(session);console.log(JSON.stringify({completed:true,counts:completed.counts,durationMs:completed.durationMs,companyCount:result.companyCount,targetLedgerRows:result.records.length},null,2));
  }
 }
}catch(e){console.error(e instanceof Error?e.message:'処理失敗');process.exitCode=1;}

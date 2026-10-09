import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createReadStream} from 'node:fs';
import {dryRun} from '../lib/import/dry-run';
import {requireLocalWorkbookPath} from '../lib/import/workbook-options';
import {hashFile} from '../lib/import/excel';
import {readJob,writeJob,jobDirectory,emptyCounts} from '../lib/import/jobs';
const action=process.argv[2],sessionFile=path.resolve('.data/supabase-full-session.json');
const save=async(value:unknown)=>{await fs.mkdir(path.dirname(sessionFile),{recursive:true});const tmp=sessionFile+'.tmp';await fs.writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});await fs.rename(tmp,sessionFile);};
try{
 if(action==='dry-run'){
  if(!process.argv[3])throw Error('dry-run にExcelパスを指定してください');
  requireLocalWorkbookPath(process.argv[3]);
  const dir=path.resolve('.data/full-dry-run',randomUUID());const report=await dryRun(path.resolve(process.argv[3]),dir,true,{trustedLocalFullWorkbook:true});
  console.log(JSON.stringify({report:path.join(dir,'report.json'),decision:report.decision,recognizedSheets:report.recognizedSheets,missingSheets:report.missingSheets,mappingIssues:report.mappingIssues,counts:report.counts,durationMs:report.durationMs,recommendedBatchSize:report.recommendedBatchSize,estimatedBatches:report.estimatedBatches,networkUsed:false},null,2));if(report.decision!=='A')process.exitCode=2;
 }else if(action==='prepare'){
  if(!process.argv[3]||!process.argv[4])throw Error('prepare Excelパス report.jsonパス');
  try{await fs.access(sessionFile);throw Error('既存全国セッションがあります。statusで確認してください');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  requireLocalWorkbookPath(process.argv[3]);
  const report=JSON.parse(await fs.readFile(process.argv[4],'utf8'));const file=path.resolve(process.argv[3]);
  if(report.mode!=='offline-full-dry-run'||report.decision!=='A'||report.blocked||report.recognizedSheets!==47||report.mappingIssues.length||report.counts.errors||!report.counts.company)throw Error('A判定の全国Dry Runが必要です。要確認を解消するまで準備できません');
  if(await hashFile(file)!==report.fileHash)throw Error('Dry Runと元Excelが異なります');
  const id=randomUUID(),dir=jobDirectory(id);await fs.mkdir(dir,{recursive:true});await fs.copyFile(file,path.join(dir,'original.xlsx'));await fs.chmod(path.join(dir,'original.xlsx'),0o400);
  if(await hashFile(path.join(dir,'original.xlsx'))!==report.fileHash)throw Error('原本コピーの一致確認失敗');
  await fs.copyFile(path.join(path.dirname(process.argv[4]),'rows.jsonl'),path.join(dir,'expected-rows.jsonl'));
  const now=new Date().toISOString();await writeJob({id,sourceFile:path.basename(file),fileHash:report.fileHash,status:'ready',createdAt:now,updatedAt:now,durationMs:0,processed:0,limit:0,counts:emptyCounts(),mappings:report.mappings});
  await save({id,fileHash:report.fileHash,expected:report.counts.company,batchSize:50});console.log(JSON.stringify({prepared:true,expected:report.counts.company,limit:'full',networkUsed:false}));
 }else{
  if(!['run','resume','status','verify'].includes(action))throw Error('dry-run / prepare / run / resume / status / verify を指定してください');
  const session=JSON.parse(await fs.readFile(sessionFile,'utf8')),job=await readJob(session.id);
  if(job.limit!==0||job.fileHash!==session.fileHash||!session.expected)throw Error('全国セッションの上限/ハッシュが不一致');
  if(action==='status'){console.log(JSON.stringify({status:job.status,processed:job.processed,expected:session.expected,counts:job.counts,durationMs:job.durationMs,reports:jobDirectory(job.id)},null,2));process.exit(0);}
  if(action==='verify'){
   const nextEnv=await import('@next/env');nextEnv.default.loadEnvConfig(process.cwd(),true);
   if(process.env.DATA_MODE!=='supabase')throw Error('DATA_MODE=supabase が必要');
   const {supabaseClient}=await import('../lib/supabase');const db=supabaseClient();const expected=new Map<string,string>();const excludedRows=new Set<string>();const excludedIds=new Set<string>();
   const lines=createInterface({input:createReadStream(path.join(jobDirectory(job.id),'expected-rows.jsonl')),crlfDelay:Infinity});for await(const line of lines){const r=JSON.parse(line);const key=JSON.stringify([r.source_sheet,r.source_row]);expected.set(key,r.row_hash);if(!r.row.eligible_for_sales)excludedRows.add(key);}
   let ledgerRows=0,mismatches=0;const seen=new Set<string>();
   for(let offset=0;;offset+=500){const result=await db.from('company_import_records').select('source_sheet,source_row,row_hash,company_id,match_kind').eq('file_hash',session.fileHash).order('source_sheet').order('source_row').range(offset,offset+499);if(result.error)throw Error('台帳照合失敗 ('+result.error.code+')');for(const r of result.data){const key=JSON.stringify([r.source_sheet,r.source_row]);if(seen.has(key)||expected.get(key)!==r.row_hash||(r.match_kind!=='duplicate_candidate'&&!r.company_id))mismatches++;if(excludedRows.has(key)&&r.company_id)excludedIds.add(r.company_id);seen.add(key);ledgerRows++;}if(result.data.length<500)break;}
   let exclusionLeaks=0;const ids=[...excludedIds];for(let offset=0;offset<ids.length;offset+=50){const result=await db.from('companies').select('id,eligible_for_sales').in('id',ids.slice(offset,offset+50));if(result.error)throw Error('営業除外照合失敗 ('+result.error.code+')');exclusionLeaks+=result.data.filter(r=>r.eligible_for_sales).length;}
   const missing=[...expected.keys()].filter(k=>!seen.has(k)).length;const passed=job.status==='completed'&&job.counts.errors===0&&job.counts.read===session.expected&&ledgerRows===session.expected&&mismatches===0&&missing===0&&exclusionLeaks===0;
   console.log(JSON.stringify({passed,ledgerRows,expected:session.expected,missing,mismatches,exclusionLeaks,errors:job.counts.errors,readOnly:true},null,2));if(!passed)process.exitCode=1;
  }else{
   if(!process.argv.includes('--confirm-full-write'))throw Error('書込みには --confirm-full-write が必要です。Dry Runだけならdry-runを使用してください');
   if(action==='run'&&job.status!=='ready')throw Error('初回はreadyのみ。未完了はresumeしてください');if(action==='resume'&&!['queued','running','failed'].includes(job.status))throw Error('再開対象ではありません');
   job.status='queued';await writeJob(job);
   const child=spawn(path.resolve('node_modules/.bin/tsx'),['scripts/import-worker.ts','--once','--job',job.id,'--full','--expected',String(session.expected)],{stdio:'inherit',env:{...process.env,IMPORT_BATCH_SIZE:String(session.batchSize)}});
   let stopped=false;const stop=()=>{stopped=true;child.kill('SIGTERM');};process.on('SIGINT',stop);process.on('SIGTERM',stop);
   const code=await new Promise<number|null>((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});process.off('SIGINT',stop);process.off('SIGTERM',stop);
   const result=await readJob(job.id);if(stopped||code!==0||result.status!=='completed')throw Error('停止または未完了。statusで確認後、同じセッションをresumeしてください');
   console.log(JSON.stringify({completed:true,counts:result.counts,durationMs:result.durationMs}));
  }
 }
}catch(e){console.error(e instanceof Error?e.message:'全国CLI処理失敗');process.exitCode=1;}

// Disposable integration environment only. Never loads .env.local or connects to a real project.
import assert from 'node:assert/strict';
import { execFileSync,spawn,type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { createHash,createHmac,randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { inspectWorkbook,hashFile,workbookRows } from '../lib/import/excel';
import { emptyCounts } from '../lib/import/jobs';
import type { ImportJob } from '../lib/import/types';
import { calculateScore } from '../lib/scoring';
const root=process.cwd(),work=await fs.mkdtemp(path.join(tmpdir(),'automotive-import-'));
const postfix=randomUUID().slice(0,8),dbName='auto-test-db-'+postfix,apiName='auto-test-api-'+postfix;
let worker:ChildProcess|undefined,app:ChildProcess|undefined,proxy:http.Server|undefined,armed=false,crashed=false;
const docker=(args:string[],input?:string)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const secret='disposable-integration-fixture-not-a-real-secret';
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
const unsigned=encode({alg:'HS256',typ:'JWT'})+'.'+encode({role:'service_role',exp:4102444800});
const token=unsigned+'.'+createHmac('sha256',secret).update(unsigned).digest('base64url');
const workbookNames=Array.from({length:90},(_,i)=>'テスト'+createHash('sha256').update(String(i+1)).digest('hex').slice(0,16)+'整備');
const phone=(n:number)=>`03-4567-${String(n).padStart(4,'0')}`;
const jobId=randomUUID(),directory=path.join(work,'.data','imports',jobId);
const getJob=async()=>JSON.parse(await fs.readFile(path.join(directory,'job.json'),'utf8')) as ImportJob;
const putJob=async(job:ImportJob)=>fs.writeFile(path.join(directory,'job.json'),JSON.stringify(job));
try{
 docker(['run','--pull=never','--name',dbName,'-e','POSTGRES_HOST_AUTH_METHOD=trust','-d','postgres:17-alpine']);
 for(let i=0;;i++){try{docker(['exec',dbName,'pg_isready','-h','127.0.0.1','-U','postgres']);break;}catch{if(i>=50)throw new Error('PostgreSQL startup timeout');await pause(200);}}
 docker(['exec','-i',dbName,'psql','-U','postgres','-v','ON_ERROR_STOP=1'], 'create role anon; create role authenticated; create role service_role bypassrls;');
 for(const filename of ['supabase/migrations/202610060001_core.sql','supabase/seed.sql','supabase/migrations/202610060002_master_import.sql','supabase/migrations/202610070001_import_quality.sql','supabase/migrations/202610070002_import_safety.sql'])docker(['exec','-i',dbName,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],await fs.readFile(path.join(root,filename),'utf8'));
 docker(['run','--pull=never','--name',apiName,'--network','container:'+dbName,'-e','PGRST_DB_URI=postgres://postgres@127.0.0.1:5432/postgres','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET='+secret,'-d','postgrest/postgrest:v14.1']);
 const ip=docker(['inspect','-f','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',dbName]);
 proxy=http.createServer((req,res)=>{
  const upstream=http.request({host:ip,port:3000,path:req.url!.replace(/^\/rest\/v1/,''),method:req.method,headers:{...req.headers,host:ip}},response=>{
   const chunks:Buffer[]=[];response.on('data',c=>chunks.push(c));response.on('end',()=>{
    if(armed&&req.url?.includes('/rpc/import_company_batch')&&response.statusCode===200){armed=false;crashed=true;worker?.kill('SIGKILL');res.destroy();return;}
    res.writeHead(response.statusCode??500,response.headers);res.end(Buffer.concat(chunks));
   });
  });upstream.on('error',()=>{res.writeHead(502);res.end('temporary local API unavailable');});req.pipe(upstream);
 });
 await new Promise<void>(resolve=>proxy!.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+(proxy.address() as import('node:net').AddressInfo).port;
 const client=createClient(url,token,{auth:{persistSession:false}});
 for(let i=0;;i++){const r=await client.from('companies').select('id').limit(1);if(!r.error)break;if(i>=50)throw new Error('PostgREST startup timeout');await pause(200);}
 const env:NodeJS.ProcessEnv={...process.env,NODE_ENV:'development',DATA_MODE:'supabase',SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:token,IMPORT_BATCH_SIZE:'50'};
 await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'original.xlsx');const workbook=new ExcelJS.Workbook();
 const headers=['会社名','電話番号','携帯番号','住所','コール','メモ','最終架電日','独自列'];
 const sheets=['東京都','大阪府'].map(name=>{const sheet=workbook.addWorksheet(name);sheet.addRow(headers);return sheet;});
 for(let i=1;i<=90;i++){const status=({1:'NG',2:'営業禁止',3:'成約',4:'閉業',5:'廃業',6:'コール禁止',7:'代表不在'} as Record<number,string>)[i]??'未架電';sheets[i<=50?0:1].addRow([workbookNames[i-1],phone(i).replace(/\d/g,d=>String.fromCharCode(d.charCodeAt(0)+0xfee0)),i===1?'＋８１ ９０－１２３４－５６７８':'','架空のテスト住所'+i,status,'履歴メモ'+i,i===1?'2024/01/01':'','元データ保持'+i]);}
 for(let i=1;i<=5;i++)sheets[1].addRow(['別表記'+i,phone(i),'','','未架電','','','重複元行']);
 sheets[1].addRow([workbookNames[7]+'店',phone(96),'','架空住所','未架電','','','類似候補']);
 sheets[1].addRow(['解析エラー会社','31234567','','','','','','先頭0欠落']);
 sheets[1].addRow(['',phone(98),'','','','','','会社名欠落']);
 sheets[1].addRow(['電話一致別名',phone(1),'','','未架電','','','']);
 sheets[1].addRow([workbookNames[59],'','','架空のテスト住所60','未架電','','','名前所在地一致']);
 sheets[1].addRow(['全件限定追加会社ZZ特殊',phone(101),'','架空の追加住所','見込み','全件のメモ','2025/02/01','']);
 sheets[1].addRow(['古い履歴別表記',phone(1),'','','NG','古いメモで上書き禁止','2020/01/01','']);
 await workbook.xlsx.writeFile(file);const before=await hashFile(file);const mappings=await inspectWorkbook(file);const now=new Date().toISOString();
 let job:ImportJob={id:jobId,sourceFile:'【改】自動車全国リスト-test.xlsx',fileHash:before,status:'queued',runId:randomUUID(),createdAt:now,updatedAt:now,durationMs:0,processed:0,limit:100,counts:emptyCounts(),mappings};await putJob(job);
 async function runWorker(expectCrash=false){let output='';worker=spawn(process.execPath,['--import',path.join(root,'node_modules/tsx/dist/loader.mjs'),path.join(root,'scripts/import-worker.ts'),'--once'],{cwd:work,env,stdio:['ignore','pipe','pipe']});worker!.stdout?.on('data',c=>{output+=c;});worker!.stderr?.on('data',c=>{output+=c;});const status=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>worker!.on('exit',(code,signal)=>resolve({code,signal})));if(expectCrash){assert.ok(crashed);assert.equal(status.signal,'SIGKILL');}else assert.equal(status.code,0,output);worker=undefined;}
 armed=true;await runWorker(true);job=await getJob();assert.equal(job.status,'running');
 await runWorker();job=await getJob();assert.equal(job.status,'completed',job.error??'取込完了せず');
 console.log('100件・通信切断後再開:',job.counts);if(job.counts.errors>2)console.log((await fs.readFile(path.join(directory,'errors.jsonl'),'utf8')).split('\n')[0]);
 assert.deepEqual(job.counts,{read:100,new:92,existing:7,duplicate_candidate:1,excluded:6,errors:0});
 const {data:companies,error}=await client.from('companies').select('*').eq('source','national_master');assert.equal(error,null);assert.equal(companies!.length,92);
 const missing=await client.from('import_metadata').select('raw_cells').eq('source_sheet','大阪府').eq('source_row',49);assert.equal(missing.error,null);const exceptionRows=await client.from('import_metadata').select('raw_cells');assert.ok(exceptionRows.data!.some(r=>r.raw_cells.some((c:any)=>c?.anomalies?.some((a:any)=>a.anomaly_type==='company_name_missing'))));
 const c=companies!.find(c=>c.normalized_phone==='0345670001');assert.equal(c.raw_phone.includes('０３'),false); // matched rows preserve latest raw form; original remains in import records
 assert.equal(c.phone,'０３-４５６７-０００１');assert.equal(c.call_status,'NG');assert.equal(c.last_call_date,'2024-01-01');assert.equal(c.call_memo,'履歴メモ1');assert.ok(c.normalized_phones.includes('09012345678'));assert.equal(c.existing_master,true);
 const history=await client.from('company_import_records').select('*').eq('company_id',c.id);assert.equal(history.data!.length,3);assert.ok(history.data!.some(r=>r.raw_phone.includes('０３')));
 assert.equal(calculateScore(c,[]).score,15);
 for(const run of [1,2]){job={...job,status:'queued',runId:randomUUID(),processed:0,counts:emptyCounts(),limit:0,startedAt:undefined};await putJob(job);await runWorker();job=await getJob();assert.equal(job.status,'completed',job.error??'取込完了せず');assert.equal(job.counts.new,0);assert.equal(job.counts.read,101);assert.equal(job.counts.errors,0);assert.equal(job.counts.duplicate_candidate,1);console.log('全件/再実行:',job.counts);}
 const all=await client.from('companies').select('id',{count:'exact'});assert.equal(all.count,102); // STEP1 10 + imported 92
 const after=await client.from('companies').select('*').eq('id',c.id).single();assert.equal(after.data!.last_call_date,'2024-01-01');assert.equal(after.data!.call_memo,'履歴メモ1');
 assert.equal(await hashFile(file),before);
 const search=await client.rpc('search_companies',{p_name:'',p_phone:'09012345678',p_prefecture:'東京都',p_page:1,p_page_size:100});assert.equal(search.error,null);assert.equal(search.data.total,1);assert.equal(search.data.companies[0].id,c.id);
 const paged=await client.rpc('search_companies',{p_name:'',p_phone:'',p_prefecture:'',p_page:2,p_page_size:100});assert.equal(paged.data.companies.length,2);
 const anonymous=createClient(url,'fixture-anonymous-key',{auth:{persistSession:false},global:{headers:{Authorization:'Bearer invalid'}}});assert.ok((await anonymous.from('companies').select('id')).error);
 // Ambiguous phone ownership: two different existing companies must remain candidates.
 const a=companies![10],b=companies![11];await client.from('companies').update({normalized_phones:[...b.normalized_phones,...a.normalized_phones]}).eq('id',b.id);
 const records=await client.from('company_import_records').select('normalized_data').eq('company_id',a.id).limit(1);const row={...records.data![0].normalized_data,file_hash:'different-test-hash',source_row:500,row_hash:'ambiguous-test-row'};
 const run=randomUUID();await client.from('import_runs').insert({id:run,source_file:'ambiguous-test.xlsx',file_hash:'different-test-hash',status:'running'});
 const result=await client.rpc('import_company_batch',{p_run_id:run,p_rows:[row]});assert.equal(result.error,null);assert.equal(result.data[0].kind,'duplicate_candidate');assert.equal(result.data[0].candidate_ids.length,2);
 // Functional reads through the actual Next.js Supabase adapter.
 const {error:signalError}=await client.from('signals').insert(['new_store','job_new'].map((type,i)=>({company_id:c.id,signal_type:type,title:'インポート後スコア検証'+i,score:i===0?40:30})));assert.equal(signalError,null);
 for(const dir of ['.next','node_modules','app'])await fs.symlink(path.join(root,dir),path.join(work,dir),'dir');for(const name of ['package.json','next.config.ts','tsconfig.json'])await fs.copyFile(path.join(root,name),path.join(work,name));
 const webPort=3100+Math.floor(Math.random()*1000);let appLogs='';
 app=spawn(path.join(root,'node_modules/.bin/next'),['start','--hostname','127.0.0.1','--port',String(webPort)],{cwd:work,env:{...env,NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});app.stdout?.on('data',c=>{appLogs+=c;});app.stderr?.on('data',c=>{appLogs+=c;});
 const base='http://127.0.0.1:'+webPort;
 for(let i=0;;i++){try{const res=await fetch(base+'/imports');if(res.ok)break;}catch{}if(i>=100)throw new Error('Next startup failed: '+appLogs);await pause(100);}
 const detail=await (await fetch(base+'/companies/'+c.id)).text();assert.ok(detail.replace(/<!--.*?-->/g,'').includes('営業スコア：85点'));assert.ok(detail.includes('履歴メモ1'));
 const list=await (await fetch(base+'/companies?q=09012345678')).text();assert.ok(list.includes(c.company_name));
 const home=await (await fetch(base+'/')).text();assert.ok(home.includes(c.company_name));assert.ok(!home.includes(workbookNames[1]));
 const uploaded=await fetch(base+'/api/imports',{method:'POST',headers:{Origin:base,'x-file-name':encodeURIComponent('【改】自動車全国リスト.xlsx')},body:await fs.readFile(file)});assert.equal(uploaded.status,201,await uploaded.clone().text());const uploadedId=(await uploaded.json()).id;
 await runWorker();let uploadedJob=await (await fetch(base+'/api/imports/'+uploadedId)).json();assert.equal(uploadedJob.status,'ready');
 const rejected=await fetch(base+'/api/imports/'+uploadedId,{method:'POST',headers:{Origin:'https://wrong-origin.example','Content-Type':'application/json'},body:JSON.stringify({limit:100,mappingConfirmed:true,mappings:uploadedJob.mappings})});assert.equal(rejected.status,400);
 const queued=await fetch(base+'/api/imports/'+uploadedId,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({limit:100,mappingConfirmed:true,mappings:uploadedJob.mappings})});assert.equal(queued.status,200);
 await runWorker();uploadedJob=await (await fetch(base+'/api/imports/'+uploadedId)).json();assert.equal(uploadedJob.status,'completed',uploadedJob.error);assert.equal(uploadedJob.counts.new,0);assert.equal(uploadedJob.counts.read,100);
 const errorReport=await fetch(base+'/api/imports/'+uploadedId+'/files?kind=errors');assert.equal(errorReport.status,200);assert.equal((await errorReport.text()).trim(),'');
 assert.equal(await hashFile(path.join(work,'.data','imports',uploadedId,'original.xlsx')),before);
 console.log('PASS: アップロードAPI、列確認、実行API、結果API、エラーJSONL、同一オリジン制約、アップロードコピー保持');
 console.log('PASS: DB移行、100件、中断再開、全件、二重登録防止、元Excel/全履歴保持、電話・強一致・類似・曖昧候補、除外、DB検索・ページ分割、スコア、STEP1データ保持');
 // Optional large-workbook parser test; does not write 100,000 rows into a real DB.
 if(process.argv.includes('--large')){const large=path.join(work,'100k.xlsx');const writer=new ExcelJS.stream.xlsx.WorkbookWriter({filename:large,useSharedStrings:false});const sheet=writer.addWorksheet('東京都');sheet.addRow(headers).commit();for(let i=0;i<100000;i++)sheet.addRow(['会社'+i,phone(i%9000+1)]).commit();await writer.commit();const started=Date.now();let count=0;for await(const row of workbookRows(large)){void row;count++;}assert.equal(count,100001);console.log(`10万行ストリーミング解析: ${count-1}行, ${Date.now()-started}ms`);}
}finally{
 worker?.kill('SIGTERM');app?.kill('SIGTERM');if(proxy)await new Promise<void>(resolve=>proxy!.close(()=>resolve()));
 for(const name of [apiName,dbName]){try{docker(['rm','-f',name]);}catch{}}
 await fs.rm(work,{recursive:true,force:true});
}

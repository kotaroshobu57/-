import {importEntries} from '@/lib/import/entries';
import { randomUUID } from 'node:crypto';
import { readJob,writeJob,emptyCounts,requireSameOrigin } from '@/lib/import/jobs';
import { jobDirectory } from '@/lib/import/jobs';
import path from 'node:path';
import { workbookRows,parseImportRow,validateMappings } from '@/lib/import/excel';
import { checkSupabase } from '@/lib/supabase';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
 try{return Response.json(await readJob((await params).id));}catch{return Response.json({error:'取込が見つかりません'},{status:404});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 try{
  requireSameOrigin(request);const job=await readJob((await params).id);
  if(!['ready','completed','failed'].includes(job.status))return Response.json({error:'現在処理中です'},{status:409});
  const raw=await request.text();if(raw.length>1024*1024)throw new Error('設定が大きすぎます');const body=JSON.parse(raw);
  if(body.preview){const mappings=validateMappings(body.mappings);if(mappings.length!==job.mappings.length||mappings.some(m=>!job.mappings.some(old=>old.sheet===m.sheet)))throw new Error('元Excelにないシートです');const rows=[];for await(const entry of importEntries(path.join(jobDirectory(job.id),'original.xlsx'),mappings,job.sourceFile,job.fileHash)){if(entry.kind==='metadata')continue;rows.push(entry.kind==='company'?entry.row:entry);if(rows.length>=10)break;}return Response.json({rows,warnings:job.mappings.flatMap(m=>m.warnings??[])});}
  if(!body.resume&&body.mappingConfirmed!==true)throw new Error('列マッピングとプレビューの確認が必要です');
  const connection=await checkSupabase();if(connection.mode!=='supabase'||!connection.connected||!connection.importReady)throw new Error(connection.mode!=='supabase'?'DATA_MODE=supabase に設定して再起動してください':connection.message);
  if(body.resume){if(job.status!=='failed'||!job.runId)throw new Error('再開できる取込処理がありません');job.status='queued';job.error=undefined;}
  else {
   const proposed=validateMappings(body.mappings);
   if(proposed.length!==job.mappings.length || proposed.some(m=>!job.mappings.some(old=>old.sheet===m.sheet)))throw new Error('元Excelにないシートです');
   const limit=Number(body.limit);if(limit!==0&&limit!==100)throw new Error('100件または全件を選択してください');
   job.mappings=proposed.map(m=>({...job.mappings.find(old=>old.sheet===m.sheet)!,sheet:m.sheet,enabled:m.enabled,headerRow:m.headerRow,columns:m.columns,historyColumns:m.historyColumns,prefecture:m.prefecture}));
   job.limit=limit;job.runId=randomUUID();job.status='queued';job.counts=emptyCounts();job.processed=0;job.durationMs=0;job.startedAt=undefined;job.error=undefined;
  }
  await writeJob(job);return Response.json(job);
 }catch(e){return Response.json({error:e instanceof Error?e.message:'取込を開始できません'},{status:400});}
}

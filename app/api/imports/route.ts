import { randomUUID, createHash } from 'node:crypto';
import { promises as fs,createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { jobDirectory,writeJob,listJobs,emptyCounts,workerStatus,requireSameOrigin } from '@/lib/import/jobs';
import { MAX_UPLOAD_BYTES } from '@/lib/import/excel';
import { checkSupabase } from '@/lib/supabase';
export const runtime='nodejs';
export const maxDuration=300;
export async function GET() {return Response.json({jobs:await listJobs(),worker:await workerStatus(),connection:await checkSupabase()});}
export async function POST(request:Request) {
 let dir:string|undefined;
 try{
  requireSameOrigin(request);
  const name=decodeURIComponent(request.headers.get('x-file-name')??'');if(!name || !/\.xlsx$/i.test(name) || name.length>250 || /[\\/\x00-\x1f]/.test(name))throw new Error('.xlsx ファイルを指定してください');
  if(!request.body)throw new Error('ファイルが空です');if(Number(request.headers.get('content-length')??0)>MAX_UPLOAD_BYTES)return Response.json({error:'ファイル上限は100MBです'},{status:413});
  const id=randomUUID();dir=jobDirectory(id);await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'original.xlsx');let bytes=0;const hash=createHash('sha256');
  const guard=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;if(bytes>MAX_UPLOAD_BYTES){callback(new Error('ファイル上限は100MBです'));return;}hash.update(chunk);callback(null,chunk);}});
  await pipeline(Readable.fromWeb(request.body as import('node:stream/web').ReadableStream),guard,createWriteStream(file,{flags:'wx',mode:0o600}));
  if(bytes<4)throw new Error('ファイルが空または不正です');await fs.chmod(file,0o400);
  const now=new Date().toISOString();await writeJob({id,sourceFile:name,fileHash:hash.digest('hex'),status:'inspecting',createdAt:now,updatedAt:now,durationMs:0,processed:0,limit:100,counts:emptyCounts(),mappings:[]});
  return Response.json({id},{status:201});
 }catch(e){if(dir)await fs.rm(dir,{recursive:true,force:true});return Response.json({error:e instanceof Error?e.message:'アップロードに失敗しました'},{status:400});}
}

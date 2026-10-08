import { createReadStream,promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { jobDirectory } from '@/lib/import/jobs';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
 try{const kind=new URL(request.url).searchParams.get('kind')??'errors';if(!['errors','candidates','results'].includes(kind))throw new Error('invalid report');const file=path.join(jobDirectory((await params).id),kind+'.jsonl');await fs.access(file);return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Content-Disposition':`attachment; filename="${kind}.jsonl"`,'Cache-Control':'no-store'}});}catch{return Response.json({error:'結果ファイルはまだ作成されていません'},{status:404});}
}

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ImportJob, Counts } from './types';
export const IMPORT_ROOT=path.join(process.cwd(),'.data','imports');
export const emptyCounts=():Counts=>({read:0,new:0,existing:0,duplicate_candidate:0,excluded:0,errors:0});
export function jobDirectory(id:string) {if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))throw new Error('取込IDが不正です');return path.join(IMPORT_ROOT,id);}
export async function readJob(id:string):Promise<ImportJob> {return JSON.parse(await fs.readFile(path.join(jobDirectory(id),'job.json'),'utf8'));}
export async function writeJob(job:ImportJob){job.updatedAt=new Date().toISOString();const file=path.join(jobDirectory(job.id),'job.json');const temp=file+'.'+process.pid+'.tmp';await fs.writeFile(temp,JSON.stringify(job,null,2));await fs.rename(temp,file);}
export async function listJobs():Promise<ImportJob[]> {
 await fs.mkdir(IMPORT_ROOT,{recursive:true});const entries=await fs.readdir(IMPORT_ROOT,{withFileTypes:true});const jobs:ImportJob[]=[];
 for(const entry of entries){if(entry.isDirectory() && /^[a-f0-9-]{36}$/i.test(entry.name)){try{jobs.push(await readJob(entry.name));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}}
 return jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export async function workerStatus(){try{const stamp=JSON.parse(await fs.readFile(path.join(IMPORT_ROOT,'worker.json'),'utf8'));return {running:Date.now()-stamp.at<15000};}catch{return {running:false};}}
export function requireSameOrigin(request:Request) {const origin=request.headers.get('origin');if(!origin || new URL(origin).host!==(request.headers.get('host')??new URL(request.url).host))throw new Error('同じサイトから操作してください');}

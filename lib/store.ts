import 'server-only';
import { supabaseClient } from './supabase';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Company, Database, Signal } from './types';
import { createSeed } from './seed';
import { duplicateCompany } from './normalize';
export function dataMode() { const mode = process.env.DATA_MODE ?? 'local'; if (!['local','supabase'].includes(mode)) throw new Error('DATA_MODE は local または supabase を指定してください'); return mode; }
const client=supabaseClient;
const file=path.join(process.cwd(),'.data','development.json');
let queue: Promise<unknown> = Promise.resolve();
async function write(data: Database) { await fs.mkdir(path.dirname(file),{recursive:true}); const temp=file+'.tmp'; await fs.writeFile(temp,JSON.stringify(data,null,2)); await fs.rename(temp,file); }
async function localRead(): Promise<Database> {
 try { return JSON.parse(await fs.readFile(file,'utf8')); } catch(e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; const data=createSeed(); await write(data); return data; }
}
function serialized<T>(op:()=>Promise<T>):Promise<T> { const result=queue.then(op); queue=result.catch(()=>{}); return result; }
export async function readDatabase(): Promise<Database> {
 if(dataMode()==='local') return serialized(localRead);
 const db=client();
 async function allRows(table:'companies'|'signals') { const rows: unknown[]=[]; for(let offset=0;;offset+=500) {const result=await db.from(table).select('*').order('id').range(offset,offset+499);if(result.error)throw new Error(result.error.message);rows.push(...result.data);if(result.data.length<500)return rows;} }
 const [companies,signals]=await Promise.all([allRows('companies'),allRows('signals')]);
 return {companies:companies as Company[],signals:signals as Signal[],snapshots:[]};
}
export async function saveCompany(company: Company) {
 if(dataMode()==='supabase') { const {error}=await client().from('companies').upsert(company); if(error) throw new Error(error.message); return; }
 await serialized(async()=>{const data=await localRead(); if(duplicateCompany(data.companies.filter(c=>c.id!==company.id),company.company_name,company.phone,company.prefecture,company.address))throw new Error('会社名または電話番号が既存会社と重複しています'); const i=data.companies.findIndex(c=>c.id===company.id); if(i<0)data.companies.push(company);else data.companies[i]=company;await write(data);});
}
export async function saveSignal(signal: Signal) {
 if(dataMode()==='supabase') { const {error}=await client().from('signals').upsert(signal); if(error) throw new Error(error.message); return; }
 await serialized(async()=>{const data=await localRead(); if(!data.companies.some(c=>c.id===signal.company_id))throw new Error('会社が存在しません');const i=data.signals.findIndex(s=>s.id===signal.id);if(i<0)data.signals.push(signal);else data.signals[i]=signal;await write(data);});
}

export async function getCompanyData(id:string):Promise<{company:Company|undefined;signals:Signal[]}> {
 if(!/^[a-f0-9-]{36}$/i.test(id))return {company:undefined,signals:[]};
 if(dataMode()==='local'){const db=await readDatabase();return {company:db.companies.find(c=>c.id===id),signals:db.signals.filter(s=>s.company_id===id)};}
 const db=client();const {data,error}=await db.from('companies').select('*').eq('id',id).maybeSingle();if(error)throw new Error(error.message);
 const signals:Signal[]=[];
 if(data)for(let offset=0;;offset+=500){const result=await db.from('signals').select('*').eq('company_id',id).order('detected_at',{ascending:false}).order('id').range(offset,offset+499);if(result.error)throw new Error(result.error.message);signals.push(...result.data);if(result.data.length<500)break;}
 return {company:data??undefined,signals};
}
export async function findDuplicate(name:string,phone:string,prefecture:string,address:string) {
 if(dataMode()==='local')return duplicateCompany((await readDatabase()).companies,name,phone,prefecture,address);
 const {normalizeCompanyName,normalizePhones,normalizeAddress}=await import('./normalize');
 const db=client(),phones=normalizePhones(phone);let rows:Company[]=[];
 if(phones.length){const {data,error}=await db.from('companies').select('*').overlaps('normalized_phones',phones).limit(2);if(error)throw new Error(error.message);rows=data;}
 if(rows.length)return rows[0];
 const {data,error}=await db.from('companies').select('*').eq('normalized_company_name',normalizeCompanyName(name)).limit(100);if(error)throw new Error(error.message);
 return data.find(c=>(prefecture && c.prefecture===prefecture)||(address && c.normalized_address===normalizeAddress(address))||(!prefecture&&!address));
}
export async function getDashboardDatabase():Promise<Database> {
 if(dataMode()==='local')return readDatabase();
 const db=client(),signals:Signal[]=[];
 for(let offset=0;;offset+=500){const result=await db.from('signals').select('*').eq('status','active').order('id').range(offset,offset+499);if(result.error)throw new Error(result.error.message);signals.push(...result.data);if(result.data.length<500)break;}
 const ids=[...new Set(signals.map(s=>s.company_id))],companies:Company[]=[];
 for(let i=0;i<ids.length;i+=100){const result=await db.from('companies').select('*').in('id',ids.slice(i,i+100)).eq('eligible_for_sales',true);if(result.error)throw new Error(result.error.message);companies.push(...result.data);}
 return {companies,signals,snapshots:[]};
}
export async function searchCompanies(query:string,prefecture:string,page:number,pageSize=100):Promise<{companies:Company[];total:number}> {
 const {normalizeCompanyName,normalizePhone,normalizePhones}=await import('./normalize');
 const name=normalizeCompanyName(query),phone=normalizePhone(query);
 if(dataMode()==='local'){const db=await readDatabase();const rows=db.companies.filter(c=>(!query || (name && c.normalized_company_name.includes(name)) || (phone && [c.normalized_phone,...(c.normalized_phones??[]),...normalizePhones(c.mobile_phone)].some(p=>p.includes(phone)))) && (!prefecture||c.prefecture===prefecture));return {companies:rows.slice((page-1)*pageSize,page*pageSize),total:rows.length};}
 const {data,error}=await client().rpc('search_companies',{p_name:name,p_phone:phone,p_prefecture:prefecture,p_page:page,p_page_size:pageSize});if(error)throw new Error(error.message);return {companies:data.companies,total:data.total};
}
export async function getImportHistory(companyId:string) {
 if(dataMode()==='local')return {rows:[],total:0};
 const {data,error,count}=await client().from('company_import_records').select('source_file,source_sheet,source_row,raw_company_name,raw_phone,raw_status,raw_memo,raw_history,created_at',{count:'exact'}).eq('company_id',companyId).order('created_at',{ascending:false}).limit(50);if(error)throw new Error(error.message);return {rows:data,total:count??0};
}

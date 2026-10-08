"use server";
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getCompanyData, findDuplicate, saveCompany, saveSignal } from '@/lib/store';
import { normalizeCompanyName, normalizePhone, normalizePhones, normalizeAddress } from '@/lib/normalize';
import { CALL_STATUSES, SIGNAL_TYPES, type Company, type SignalType } from '@/lib/types';
import { SCORE_RULES } from '@/lib/scoring';
function text(f:FormData,key:string,max=2000) {return String(f.get(key)??'').trim().slice(0,max);}
function url(f:FormData,key:string) {const value=text(f,key);if(value && !/^https?:\/\//i.test(value))throw new Error('URLはhttp://またはhttps://で入力してください');if(value)new URL(value);return value;}
function date(f:FormData,key:string) {const value=text(f,key);if(value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value))throw new Error('日付が不正です');return value||null;}
function refresh(id:string) {revalidatePath('/');revalidatePath('/companies');revalidatePath(`/companies/${id}`);}
export async function createCompany(f:FormData) {
 let id='';let error='';
 try {
 const name=text(f,'company_name',200),phone=text(f,'phone',40);if(!name || !normalizeCompanyName(name))throw new Error('会社名を入力してください');
 const duplicate=await findDuplicate(name,phone,text(f,'prefecture',20),text(f,'address'));if(duplicate)throw new Error(`重複候補：${duplicate.company_name}。既存の会社詳細を確認してください。`);
 const now=new Date().toISOString();id=randomUUID();
 const company:Company={id,company_name:name,normalized_company_name:normalizeCompanyName(name),phone,normalized_phone:normalizePhone(phone),normalized_phones:normalizePhones(phone+'\n'+text(f,'mobile_phone',40)),normalized_address:normalizeAddress(text(f,'address')),mobile_phone:text(f,'mobile_phone',40),address:text(f,'address'),prefecture:text(f,'prefecture',20),website_url:url(f,'website_url'),instagram_url:url(f,'instagram_url'),google_maps_url:url(f,'google_maps_url'),goopit_url:url(f,'goopit_url'),source:'manual',existing_master:f.get('existing_master')==='on',call_status:'未架電',last_call_date:null,call_memo:'',is_do_not_call:false,created_at:now,updated_at:now};
 await saveCompany(company);refresh(id);
 }catch(e){error=e instanceof Error?e.message:'保存に失敗しました';}
 if(error)redirect('/companies?error='+encodeURIComponent(error));redirect(`/companies/${id}`);
}
export async function updateCall(f:FormData) {
 const id=text(f,'company_id');let error='';
 try {const {company}=await getCompanyData(id);if(!company)throw new Error('会社が存在しません');const status=text(f,'call_status');if(!CALL_STATUSES.includes(status as Company['call_status']))throw new Error('営業状況が不正です');await saveCompany({...company,call_status:status as Company['call_status'],last_call_date:date(f,'last_call_date'),call_memo:text(f,'call_memo'),eligible_for_sales:!['成約済み','営業禁止','コール禁止','閉業','廃業'].includes(status)&&f.get('is_do_not_call')!=='on'&&!(Array.isArray(company.import_metadata?.quality_warnings)&&company.import_metadata.quality_warnings.length)&&!(Array.isArray(company.import_metadata?.ban_origins)&&company.import_metadata.ban_origins.length)&&!company.is_closed&&!['pending','confirmed'].includes(company.closure_state??'normal'),is_do_not_call:f.get('is_do_not_call')==='on',updated_at:new Date().toISOString()});refresh(id);}catch(e){error=e instanceof Error?e.message:'保存に失敗しました';}
 redirect(`/companies/${id}`+(error?'?error='+encodeURIComponent(error):'?saved=1'));
}
export async function createSignal(f:FormData) {
 const id=text(f,'company_id');let error='';
 try {const {company}=await getCompanyData(id);if(!company)throw new Error('会社が存在しません');const type=text(f,'signal_type') as SignalType;if(!SIGNAL_TYPES.includes(type))throw new Error('シグナル種別が不正です');const title=text(f,'title',200);if(!title)throw new Error('タイトルを入力してください');const now=new Date().toISOString();const detected=date(f,'detected_at');await saveSignal({id:randomUUID(),company_id:id,signal_type:type,title,description:text(f,'description'),detected_at:detected?detected+'T00:00:00Z':now,source_url:url(f,'source_url'),before_value:text(f,'before_value'),after_value:text(f,'after_value'),score:SCORE_RULES.signal[type],ai_summary:'',recommended_talk:'',status:'active',created_at:now});refresh(id);}catch(e){error=e instanceof Error?e.message:'保存に失敗しました';}
 redirect(`/companies/${id}`+(error?'?error='+encodeURIComponent(error):'?saved=1'));
}
export async function archiveSignal(f:FormData) {
 const id=text(f,'company_id'), signalId=text(f,'signal_id');const {signals}=await getCompanyData(id);const signal=signals.find(s=>s.id===signalId && s.company_id===id);if(!signal)throw new Error('シグナルが存在しません');await saveSignal({...signal,status:signal.status==='active'?'archived':'active'});refresh(id);redirect(`/companies/${id}`);
}

export async function reviewClosure(f:FormData) {
 const id=text(f,'company_id');let error='';
 try{const {company}=await getCompanyData(id);if(!company||company.closure_state!=='pending')throw new Error('確認待ちの会社ではありません');const decision=text(f,'decision'),note=text(f,'review_note');if(!['normal','confirmed'].includes(decision)||!note)throw new Error('確認結果と根拠を記入してください');const confirmed=decision==='confirmed';const next={...company,closure_state:decision as 'normal'|'confirmed',closure_reason:note,is_closed:confirmed,call_status:confirmed?'廃業' as const:company.call_status,updated_at:new Date().toISOString()};next.eligible_for_sales=!confirmed&&!next.is_do_not_call&&!['成約済み','営業禁止','コール禁止','閉業','廃業'].includes(next.call_status);next.exclusion_reason=next.eligible_for_sales?'':confirmed?'廃業':company.exclusion_reason;await saveCompany(next);refresh(id);}catch(e){error=e instanceof Error?e.message:'保存に失敗しました';}
 redirect(`/companies/${id}`+(error?'?error='+encodeURIComponent(error):'?saved=1'));
}

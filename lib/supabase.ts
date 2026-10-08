import { createClient } from '@supabase/supabase-js';
export function supabaseClient() {
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url || !key)throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY をサーバーの環境変数または .env.local に設定してください');
 const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol))throw new Error('SUPABASE_URL が不正です');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:init?.signal??AbortSignal.timeout(60000)})}});
}
export async function checkSupabase() {
 const variables=Object.fromEntries(['DATA_MODE','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'].map(k=>[k,Boolean(process.env[k])]));
 if(!variables.SUPABASE_URL || !variables.SUPABASE_SERVICE_ROLE_KEY)return {connected:false,importReady:false,mode:process.env.DATA_MODE??'local',variables,message:'Supabase 接続情報が未設定です。キーは .env.local または環境設定へ入力してください。'};
 try {const db=supabaseClient();const {error}=await db.from('companies').select('id,eligible_for_sales').limit(1);if(error)throw error;const {error:rpc}=await db.rpc('import_company_batch',{p_run_id:'00000000-0000-4000-8000-000000000000',p_rows:[]});return {connected:true,importReady:!rpc,mode:process.env.DATA_MODE??'local',variables,message:rpc?'接続済み。STEP2マイグレーション・権限を確認してください。':'接続・STEP2取込API確認済み'};}catch{return {connected:false,importReady:false,mode:process.env.DATA_MODE??'local',variables,message:'接続またはSTEP2スキーマの確認に失敗しました。URL・キー・ネットワーク・マイグレーションを確認してください。'};}
}

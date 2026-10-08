import type { Database, Company, SignalType } from './types';
import { normalizeCompanyName, normalizePhone } from './normalize';
import { SCORE_RULES, SIGNAL_LABELS } from './scoring';
export function createSeed(now = new Date()): Database {
 const specs: {name:string;pref:string;types:SignalType[];master:boolean;status?:Company['call_status'];ban?:boolean;mobile?:boolean;old?:boolean}[] = [
 {name:'テスト北海モータース',pref:'北海道',types:['new_store','job_new'],master:false},
 {name:'テスト仙台自動車',pref:'宮城県',types:['job_new'],master:true},
 {name:'テスト東京整備',pref:'東京都',types:['goopit_new','job_new'],master:false},
 {name:'テスト横浜カーサービス',pref:'神奈川県',types:['new_factory','job_updated'],master:true,status:'NG',old:true,mobile:true},
 {name:'テスト名古屋オート',pref:'愛知県',types:['new_store','job_new'],master:false,ban:true},
 {name:'テスト大阪モーター',pref:'大阪府',types:['new_factory','goopit_new'],master:true,status:'成約済み'},
 {name:'テスト神戸自動車',pref:'兵庫県',types:['job_new','goopit_activity'],master:false,mobile:true},
 {name:'テスト広島整備',pref:'広島県',types:['website_update','new_store'],master:false},
 {name:'テスト福岡オート',pref:'福岡県',types:['goopit_new','job_updated'],master:true,old:true},
 {name:'テスト沖縄モータース',pref:'沖縄県',types:[],master:false,mobile:true},
 ];
 const timestamp = now.toISOString();
 const companies: Company[] = specs.map((s,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,company_name:`株式会社${s.name}`,normalized_company_name:normalizeCompanyName(s.name),phone:`03-0000-${String(i+1).padStart(4,'0')}`,normalized_phone:normalizePhone(`03-0000-${String(i+1).padStart(4,'0')}`),mobile_phone:s.mobile?'090-0000-0000':'',address:`${s.pref}（架空の開発用住所）`,prefecture:s.pref,website_url:'',instagram_url:'',google_maps_url:'',goopit_url:'',source:'development_seed',existing_master:s.master,call_status:s.status??'未架電',last_call_date:s.old?new Date(now.getTime()-400*86400000).toISOString().slice(0,10):null,call_memo:s.status==='NG'?'以前はタイミングが合わず見送り（架空）':'',is_do_not_call:s.ban??false,created_at:timestamp,updated_at:timestamp}));
 let counter = 0;
 const signals = specs.flatMap((s,i)=>s.types.map(type=>({id:`10000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`,company_id:companies[i].id,signal_type:type,title:`${SIGNAL_LABELS[type]}のテスト`,description:'架空データ。外部サイトの取得は行っていません。',detected_at:timestamp,source_url:'',before_value:'',after_value:'テスト状態',score:SCORE_RULES.signal[type],ai_summary:'',recommended_talk:'',status:'active' as const,created_at:timestamp})));
 return {companies,signals,snapshots:[]};
}

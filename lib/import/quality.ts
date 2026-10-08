import { normalizePhones } from '../normalize';
export interface ImportedUrl {url:string;kind:'sns'|'other'|'unclassified';source:string;}
export interface MobileCandidate {phone:string;context:string;source:'history';status:'pending';}
export function splitUrls(raw:string,source:string):ImportedUrl[] {
 // Split even adjacent protocols; retain the complete original separately.
 const chunks=raw.replace(/(?<![=/?&])(?<!^)(https?:\/\/)/gi,'\n$1').match(/https?:\/\/[^\s<>「」『』"，、]+/gi)??[];
 const out:ImportedUrl[]=[];
 for(const chunk of chunks){const token=chunk.replace(/[。;,）)]+$/g,'');try{const u=new URL(token);if(!['http:','https:'].includes(u.protocol)||!u.hostname.includes('.')||u.username||u.password)continue;
 const host=u.hostname.toLowerCase().replace(/^www\./,'');const is=(domain:string)=>host===domain||host.endsWith('.'+domain);
 const kind=is('instagram.com')||is('facebook.com')||is('x.com')||is('twitter.com')||is('youtube.com')||is('tiktok.com')?'sns':is('goo-net.com')||is('google.com')||is('maps.app.goo.gl')?'other':'unclassified';
 if(!out.some(x=>x.url===u.href))out.push({url:u.href,kind,source});}catch{/* Original is retained for manual review. */}}
 return out;
}
export function mobileCandidates(history:string):MobileCandidate[]{
 const out:MobileCandidate[]=[];
 for(const line of history.split('\n')){
  if(!/(?:携帯|担当.{0,4}直通|代表.{0,4}直通|社長.{0,4}直通|mobile)/i.test(line))continue;
  // Require the label close to the phone; IDs/money elsewhere in the memo are not contacts.
  if(/注文番号|伝票番号|管理番号|金額|円|注文ID/.test(line))continue;
  const contexts=line.match(/(?:携帯|担当.{0,4}直通|代表.{0,4}直通|社長.{0,4}直通|mobile)[^\n]{0,45}/gi)??[];
  for(const context of contexts)for(const phone of normalizePhones(context))if(/^0[789]0\d{8}$/.test(phone)&&!out.some(x=>x.phone===phone))out.push({phone,context,source:'history',status:'pending'});
 }
 return out;
}
export function closureAssessment(rawStatus:string,memo:string,history:string){
 const current=rawStatus.normalize('NFKC').trim();
 const confirmed=/^(?:閉業|廃業)(?:済み|済|確定|確認済み|確認済)?$/.test(current);
 const evidence=[rawStatus,memo,history].join('\n').normalize('NFKC');
 // Explicit negation alone is not evidence; mixed/uncertain/history evidence is pending.
 const positive=evidence.replace(/未閉業|未廃業|(?:閉業|廃業)(?:ではない|していない|なし)/g,'');
 const pending=!confirmed&&/閉業|廃業/.test(positive);
 return {closure_state:confirmed?'confirmed' as const:pending?'pending' as const:'normal' as const,closure_reason:confirmed?current:pending?'閉業・廃業の記述あり（確認待ち）':''};
}

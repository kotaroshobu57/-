import {normalizePhones} from '../normalize';
export interface PhoneCandidate {raw:string;normalized:string|null;kind:'telephone'|'special'|'fax'|'unresolved'|'non_phone';reason:string;classification?:'valid_phone'|'mobile'|'fax'|'multiple_phones'|'malformed_phone'|'unknown_number'|'not_phone';}
export function parsePhones(raw:string):PhoneCandidate[]{
 const out:PhoneCandidate[]=[];
 // Labels delimit numbers even when TEL and FAX share a single cell.
 const segments=raw.normalize('NFKC').replace(/(?=FAX|ファックス|TEL(?:\s*[:：]|\s+\d)|電話(?:\s*[:：]|\s+\d))/gi,'\n').split(/[\r\n/,，、;；|｜]+/);
 for(const segment of segments){const s=segment.trim();if(!s||!/[0-9]/.test(s))continue;
  if(/FAX|ファックス/i.test(s)){out.push({raw:s,normalized:null,kind:'fax',reason:'FAXとして明示'});continue;}
  if(/管理番号|注文番号|郵便|〒|金額|円/.test(s)||/^\d{4}[年/.]\d{1,2}[月/.]\d{1,2}/.test(s)){out.push({raw:s,normalized:null,kind:'non_phone',reason:'電話以外の識別情報'});continue;}
  const special=s.replace(/[\s()‐‑‒–—―−ー-]/g,'').match(/(?<!\d)0078\d{8}(?!\d)/g)??[];
  for(const n of special)out.push({raw:s,normalized:n,kind:'special',reason:'0078掲載サイト転送番号。代表電話照合に使用しない'});
  const phones=normalizePhones(s);for(const p of phones)if(!out.some(x=>x.normalized===p))out.push({raw:s,normalized:p,kind:'telephone',reason:''});
  if(!special.length&&!phones.length)out.push({raw:s,normalized:null,kind:'unresolved',reason:'桁/先頭0等を要確認。推測補完しない'});
 }
 for(const p of out)p.classification=p.kind==='telephone'?(out.filter(x=>x.kind==='telephone').length>1?'multiple_phones':/^0[789]0/.test(p.normalized??'')?'mobile':'valid_phone'):p.kind==='fax'?'fax':p.kind==='non_phone'?'not_phone':p.kind==='unresolved'&&(/[0-9].*[-－].*[0-9]/.test(p.raw)||/^\d{10,11}$/.test(p.raw))?'malformed_phone':'unknown_number';
 return out;
}

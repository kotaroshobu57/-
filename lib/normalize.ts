export function normalizeCompanyName(value: string): string {
 return value.normalize('NFKC').toLowerCase().replace(/株式会社|有限会社|合同会社|\(\s*株\s*\)|\(\s*有\s*\)|\(\s*同\s*\)/g, '').replace(/[\p{P}\p{S}\s]/gu, '');
}
export function normalizeAddress(value:string) {return value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu,'');}
export const PREFECTURES = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
export function detectPrefecture(value:string):string {const v=value.normalize('NFKC').trim();return PREFECTURES.find(p=>v.includes(p)) ?? PREFECTURES.find(p=>v===p.replace(/[都府県]$/,'')) ?? '';}
export function normalizePhones(value: string): string[] {
 const v=value.normalize('NFKC').replace(/(?:TEL|電話|携帯)\s*[:：]?/gi,'');
 const sep='[\\s()‐‑‒–—―−ー-]*';
 const digit=sep+'\\d';
 const prefix='(?:\\+81'+sep+'(?:\\('+sep+'0'+sep+'\\)'+sep+')?|0)';
 const pattern=new RegExp('(?<!\\d)'+prefix+'(?:[789]0(?:'+digit+'){8}|50(?:'+digit+'){8}|800(?:'+digit+'){7}|120(?:'+digit+'){6}|[1-9](?:'+digit+'){8})(?!\\d)','g');
 const phones = [...v.matchAll(pattern)].map(m=>m[0].replace(/[\s()‐‑‒–—―−ー-]/g,'').replace(/^\+81(?:0)?/,'0'));
 return [...new Set(phones)];
}
export function normalizePhone(value: string): string {
 const valid=normalizePhones(value)[0];if(valid)return valid;
 const compact=value.normalize('NFKC').split(/[,，、;；/／\r\n|｜]/)[0].replace(/[\s()（）‐‑‒–—―−ー-]/g,'');
 return compact.replace(/^\+81(?:0)?/,'0').replace(/\D/g,'');
}
export function duplicateCompany<T extends {normalized_company_name:string; normalized_phone:string; normalized_phones?:string[];prefecture?:string;address?:string}>(companies:T[],name:string,phone:string,prefecture='',address=''):T|undefined {
 const n=normalizeCompanyName(name),phones=normalizePhones(phone),fallback=normalizePhone(phone);
 if(!phones.length && fallback)phones.push(fallback);
 const byPhone=companies.find(c=>phones.some(p=>[c.normalized_phone,...(c.normalized_phones??[])].includes(p)));if(byPhone)return byPhone;
 return companies.find(c=>n!=='' && c.normalized_company_name===n && ((prefecture!=='' && c.prefecture===prefecture) || (address!=='' && normalizeAddress(c.address??'')===normalizeAddress(address)) || (!prefecture && !address)));
}

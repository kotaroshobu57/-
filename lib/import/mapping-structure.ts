import {normalizePhones} from '../normalize';
import {classifyDate} from './date-classification';
export function columnTraits(raw:string){
 const v=raw.normalize('NFKC').trim();const phone=normalizePhones(v).length>0;
 return {filled:!!v,company:!!v&&v.length<=200&&/[\p{L}]/u.test(v)&&!phone&&!/https?:|[\r\n]|^(?:以下|ここから|以降|メモ|注意|見出し|会社名|電話番号|住所|NG$|コール$|アポ$|成約|契約|架電禁止)/i.test(v),phone,
 address:/[市区町村郡]/.test(v)&&!/[\r\n]|https?:/.test(v),url:/https?:\/\//i.test(v),date:v.length<=40&&!/[\r\n]/.test(v)&&['valid_date','datetime','time_only'].includes(classifyDate(v).kind),
 status:/^(?:NG|コール|架電|アポ|成約|契約|リサーチ|見込み|代表不在|受付ブロック|再コール予定|不在|留守|不通|営業禁止|架電禁止|コール禁止|受注|導入済)(?:済み|済)?$/.test(v),history:/[\r\n]|20\d{2}[年/.-].*(?:コール|架電|NG|アポ|不在|担当|契約)/i.test(v)};
}
export function structureProfile(rows:Array<{row:number;cells:string[]}>,width:number){
 const columns=Array.from({length:width},()=>({filled:0,company:0,phone:0,address:0,url:0,date:0,status:0,history:0}));const headers:Array<{row:number;cells:Array<{column:number;label:string}>}>=[];
 for(const row of rows){for(let i=0;i<width;i++){const t=columnTraits(row.cells[i]??'');for(const key of Object.keys(t) as Array<keyof typeof t>)if(t[key])columns[i][key]++;}
 if(row.cells.some(v=>/^(?:店名もしくは法人名|会社名|企業名|法人名)$/.test(v.trim()))&&row.cells.some(v=>/^(?:電話番号|TEL)$/i.test(v.trim()))){headers.push({row:row.row,cells:row.cells.flatMap((v,i)=>v.trim()?[{column:i+1,label:v.normalize('NFKC').replace(/\s/g,'')}]:[])});}}
 return {sampleRows:rows.length,width,columns,headers};
}

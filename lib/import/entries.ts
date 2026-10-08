import {workbookRows,parseImportRow} from './excel';
import {normalizeCompanyName,normalizePhones,detectPrefecture} from '../normalize';
import type {SheetMapping,ImportRow} from './types';
export interface ImportMetadata {source_file:string;file_hash:string;source_sheet:string;source_row:number;kind:'ban_start'|'ban_end'|'header'|'annotation';raw_cells:string[];needs_review?:boolean;anomalies?:Array<{raw_value:string;sheet:string;cell:string;source_row:number;anomaly_type:string;needs_review:boolean}>;}
export type ImportEntry={kind:'company';row:ImportRow}|{kind:'metadata';metadata:ImportMetadata}|{kind:'error';source_sheet:string;source_row:number;message:string;raw_cells:string[]};
export async function* importEntries(file:string,mappings:SheetMapping[],sourceFile:string,fileHash:string):AsyncGenerator<ImportEntry>{
 const states=new Map<string,{bans:ImportMetadata[];headers:ImportMetadata[]}>();
 for await(const source of workbookRows(file)){
  const mapping=mappings.find(m=>m.sheet===source.sheet&&m.enabled);if(!mapping)continue;
  let state=states.get(source.sheet);if(!state){state={bans:[],headers:[]};states.set(source.sheet,state);}
  const get=(n?:number)=>source.cells[(n??0)-1]??'';const name=get(mapping.columns.company_name).trim();
  const phone=get(mapping.columns.phone),address=get(mapping.columns.address).trim();
  const compact=name.normalize('NFKC').replace(/[\s、。:：]/g,'');
  const hasContact=normalizePhones(phone).length>0||(/^\+?\d/.test(phone)&&/\d/.test(address));
  const isHeader=/^(会社名|企業名|社名|法人名|店舗名|店名|店名もしくは法人名)$/.test(compact)&&/電話|TEL/i.test(phone);
  const start=/^(?:以下|ここから|以降|これ以降|ここより|以後).*(?:コール|架電|営業|電話|連絡|TEL).*(?:禁止|不可|NG)/i.test(compact)||/^(?:(?:コール|架電|営業|電話|連絡|TEL)禁止|電話しない|かけない)$/i.test(compact);
  const end=/^(?:以上|ここまで).*(?:コール|架電|営業|電話|連絡|TEL).*禁止$/i.test(compact)||/^(?:禁止区間終了|(?:コール|架電|営業|電話|連絡|TEL)禁止解除|(?:ここから|以降)(?:営業|コール|架電|電話)可)$/i.test(compact);
  const annotation=(!normalizeCompanyName(name)&&!hasContact)||(!phone.trim()&&!address)||/^(?:メモ|注意|見出し|ここから|過去アポ|過去見込み|過去リサーチ|リサーチ)/.test(compact)&&!hasContact;
  if(source.row<=mapping.headerRow||isHeader||(!hasContact&&(start||end))||annotation){
   const kind=source.row===mapping.headerRow||isHeader?'header':!hasContact&&end?'ban_end':!hasContact&&start?'ban_start':'annotation';
   const metadata:ImportMetadata={source_file:sourceFile,file_hash:fileHash,source_sheet:source.sheet,source_row:source.row,kind,raw_cells:source.cells};
   if(kind==='ban_start')state.bans.push(metadata);else if(kind==='ban_end')state.bans=[];else if(kind==='header')state.headers.push(metadata);
   yield {kind:'metadata',metadata};continue;
  }
  if((!name&&hasContact)||name.includes('\uFFFD')){
   const n=mapping.columns.company_name!;let letter='',column=n;while(column){letter=String.fromCharCode(65+(column-1)%26)+letter;column=Math.floor((column-1)/26);}
   yield {kind:'metadata',metadata:{source_file:sourceFile,file_hash:fileHash,source_sheet:source.sheet,source_row:source.row,kind:'annotation',raw_cells:source.cells,needs_review:true,anomalies:[{raw_value:get(n),sheet:source.sheet,cell:letter+source.row,source_row:source.row,anomaly_type:name.includes('\uFFFD')?'source_text_corruption':'company_name_missing',needs_review:true}]}};continue;
  }
  try{const parsed=parseImportRow(sourceFile,fileHash,mapping,source.row,source.cells);
   parsed.import_metadata={...parsed.import_metadata,headers:state.headers,ban_origins:state.bans,target_row:source.row};
   if(state.bans.length){parsed.is_do_not_call=true;parsed.eligible_for_sales=false;parsed.call_status='コール禁止';parsed.exclusion_reason='禁止区間から継承';}
   yield {kind:'company',row:parsed};
  }catch(e){yield {kind:'error',source_sheet:source.sheet,source_row:source.row,message:e instanceof Error?e.message:'解析失敗',raw_cells:source.cells};}
 }
}

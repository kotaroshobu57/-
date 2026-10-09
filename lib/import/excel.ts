import {stat} from 'node:fs/promises';
import {TRUSTED_LOCAL_EXPANDED_BYTES,requireLocalWorkbookPath,type WorkbookOptions} from './workbook-options';
import {confirmedMapping} from './mapping-registry';
import {readWorkbook} from './workbook-reader';
import {classifyDate} from './date-classification';
import {workbookManifest} from './manifest';
import {parsePhones} from './phones';
import {splitUrls,mobileCandidates} from './quality';
import unzipper from 'unzipper';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { normalizeCompanyName, normalizePhones, normalizeAddress, detectPrefecture } from '../normalize';
import { parseSalesHistory } from './history';
import { COLUMN_FIELDS, type ColumnField, type SheetMapping, type ImportRow } from './types';
export const MAX_UPLOAD_BYTES=100*1024*1024;
export const MAX_ROWS=200000;
const aliases:Record<ColumnField,string[]>={company_name:['会社名','企業名','社名','法人名','店舗名','店名','事業所名','名称'],phone:['電話番号','電話','tel','代表電話','固定電話'],mobile_phone:['携帯番号','携帯電話','携帯','mobile'],address:['所在地','住所','会社住所'],prefecture:['都道府県','県','エリア'],website_url:['hp','ホームページ','website','url','hpurl'],instagram_url:['instagram','インスタ','instagramurl'],status:['営業状況','営業ステータス','ステータス','コール','架電結果','営業結果','status','状況'],memo:['メモ','備考','営業メモ','コールメモ','コメント'],last_call_date:['最終架電日','最終コール日','架電日','コール日','日付','営業日']};
function headerKey(v:string){return v.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');}
export async function validateWorkbook(file:string,options:WorkbookOptions={}) {
 requireLocalWorkbookPath(file);const info=await stat(file);if(!info.isFile())throw Error('Excelは通常のローカルファイルが必要です');if(!options.trustedLocalFullWorkbook&&info.size>MAX_UPLOAD_BYTES)throw Error('Excelファイルが100MBを超えています');
 const zip=await unzipper.Open.file(file);if(zip.files.length>2000)throw new Error('Excelの内部ファイル数が上限を超えています');
 let size=0;for(const entry of zip.files){size+=entry.uncompressedSize;if(entry.path==='xl/sharedStrings.xml'&&entry.uncompressedSize>64*1024*1024)throw new Error('共有文字列が64MBを超えています。都道府県単位に分けてください');}
 if(size>(options.trustedLocalFullWorkbook?TRUSTED_LOCAL_EXPANDED_BYTES:256*1024*1024))throw new Error(options.trustedLocalFullWorkbook?'全国Excelの展開サイズが2GBを超えています。安全上処理できません':'Excelの展開サイズが256MBを超えています。都道府県単位に分けてください');
 if(!zip.files.some(f=>f.path==='xl/workbook.xml'))throw new Error('有効な .xlsx ファイルではありません');
 if(zip.files.some(f=>/vbaProject\.bin$/i.test(f.path)))throw new Error('マクロ付きファイルは対象外です');
}
export async function hashFile(file:string) {const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
export async function* workbookRows(file:string,options:WorkbookOptions={}) { await validateWorkbook(file,options); yield* readWorkbook(file,options); }
export function guessColumns(headers:string[]) {
 const result:Partial<Record<ColumnField,number>>={};
 for(const field of COLUMN_FIELDS){const index=headers.findIndex(h=>aliases[field].includes(headerKey(h)));if(index>=0)result[field]=index+1;}
 return result;
}
export async function inspectWorkbook(file:string,options:WorkbookOptions={}):Promise<SheetMapping[]> {
 await validateWorkbook(file,options);const manifest=await workbookManifest(file);const positions=new WeakMap<string[],number>();const grouped=new Map<string,string[][]>(manifest.sheets.map(s=>[s.name,[]]));
 const statistics=new Map(manifest.sheets.map(s=>[s.name,{rowCount:0,width:0}]));
 for await(const r of workbookRows(file,options)){const info=statistics.get(r.sheet)!;info.rowCount++;info.width=Math.max(info.width,r.cells.length);if(r.row<=100){grouped.get(r.sheet)!.push(r.cells);positions.set(r.cells,r.row);}}
 const result=manifest.sheets.map(({name})=>{
 const rows=grouped.get(name)!,width=rows.reduce((max,r)=>Math.max(max,r.length),0);const columns:SheetMapping['columns']={};const warnings:string[]=[];let headers:string[]=[];let headerRow=0;
 for(const row of rows){const company=row.findIndex(v=>/^(店名もしくは法人名|会社名|企業名|法人名)$/.test(v.trim()));if(company>=0&&row.some(v=>v.trim()==='電話番号')){headers=row;headerRow=positions.get(row)!;Object.assign(columns,guessColumns(row));columns.company_name=company+1;row.forEach((v,i)=>{if(v.trim()==='結果')columns.status=i+1;if(/^詳細/.test(v))columns.memo=i+1;if(/^最終コール日/.test(v))columns.last_call_date=i+1;});}}
 const frequency=(test:(v:string)=>boolean)=>Array.from({length:width},(_,i)=>rows.filter(r=>test(r[i]??'')).length);
 const choose=(scores:number[])=>{const best=Math.max(0,...scores),idx=scores.indexOf(best);return best>=3&&scores.filter(v=>v===best).length===1?idx+1:undefined;};
 const phones=frequency(v=>normalizePhones(v).length>0);const address=frequency(v=>Boolean(detectPrefecture(v))&&/市|区|町|村/.test(v));
 const phoneColumn=choose(phones),addressColumn=choose(address);
 if(!columns.phone&&phoneColumn)columns.phone=phoneColumn;if(!columns.address&&addressColumn)columns.address=addressColumn;
 if(!columns.company_name){const guess=choose(frequency(v=>v.length>1&&v.length<200&&/[\p{L}]/u.test(v)&&!/^https?:/.test(v)&&!normalizePhones(v).length&&!detectPrefecture(v)&&!/[\r\n]/.test(v)));if(guess)columns.company_name=guess;}
 if(!columns.last_call_date)columns.last_call_date=choose(frequency(v=>['valid_date','datetime'].includes(classifyDate(v).kind)));
 if(!columns.memo)columns.memo=choose(frequency(v=>/[\r\n]/.test(v)&&/20\d{2}[年\/.-]/.test(v)));
 const statusColumn=choose(frequency(v=>/^(NG|コール|アポ|成約|契約|リサーチ|見込み|代表不在|受付ブロック|架電禁止|再コール予定)$/.test(v.trim())));
 if(statusColumn&&columns.status&&statusColumn!==columns.status)warnings.push('見出しと結果データの列が不一致');if(!columns.status&&statusColumn)columns.status=statusColumn;
 if(!columns.website_url)columns.website_url=choose(frequency(v=>/^https?:\/\//.test(v.trim())));
 for(const key of Object.keys(columns) as ColumnField[])if(!columns[key])delete columns[key];
 const assignments=Object.values(columns);if(new Set(assignments).size!==assignments.length)warnings.push('複数項目の列候補が競合：手動確認必須');
 const known=Boolean(headers.length&&columns.company_name&&columns.phone&&columns.address);if(!known)warnings.push('ヘッダーなし／低信頼列構成：手動確認必須');
 const historyColumns=[...new Set([...headers.flatMap((v,i)=>/詳細|履歴|メモ|備考/.test(v)?[i+1]:[]),...(columns.memo?[columns.memo]:[])])];
 const confidence=known&&!warnings.length?1:0.4;
 return {sheet:name,enabled:confidence>=0.9,headerRow:known&&!rows.slice(0,headerRow-1).some(r=>normalizePhones(r[(columns.phone??0)-1]??'').length)?headerRow:0,columns,historyColumns,prefecture:detectPrefecture(name),headers,samples:rows.slice(0,3),rowCount:statistics.get(name)!.rowCount,columnCount:statistics.get(name)!.width,warnings,confidence,needs_review:confidence<0.9};
 });
 for(const m of result)if(result.some(o=>JSON.stringify(o.columns)!==JSON.stringify(m.columns)))m.warnings.push('他シートと列構成が異なります。個別に確認してください。');
 return result.map(m=>confirmedMapping(m,(grouped.get(m.sheet)??[]).map(cells=>({row:positions.get(cells)!,cells}))));
}
export function validateMappings(mappings:unknown):SheetMapping[] {
 if(!Array.isArray(mappings)||!mappings.length||mappings.length>100)throw new Error('シート設定が不正です');
 const names=new Set<string>();
 for(const m of mappings){if(typeof m.sheet!=='string'||names.has(m.sheet))throw new Error('シート名が不正です');names.add(m.sheet);
  if(typeof m.enabled!=='boolean'||!Number.isInteger(m.headerRow)||m.headerRow<0||m.headerRow>1000||!m.columns||typeof m.columns!=='object'||!Array.isArray(m.historyColumns)||typeof m.prefecture!=='string')throw new Error('列設定が不正です');
  for(const [key,v] of Object.entries(m.columns)){if(!COLUMN_FIELDS.includes(key as ColumnField)||!Number.isInteger(v)||Number(v)<1||Number(v)>512)throw new Error('列番号が不正です');}
  if(m.historyColumns.some((v:unknown)=>!Number.isInteger(v)||Number(v)<1||Number(v)>512))throw new Error('履歴列が不正です');
  const assigned=Object.values(m.columns);if(new Set(assigned).size!==assigned.length)throw new Error('複数項目に同じ列を指定しないでください');
  if(m.enabled&&!m.columns.company_name)throw new Error(`${m.sheet} の会社名列を指定してください`);
 }
 if(!mappings.some(m=>m.enabled))throw new Error('取込対象のシートを選択してください');return mappings as SheetMapping[];
}
export function parseImportRow(sourceFile:string,fileHash:string,sheet:SheetMapping,rowNumber:number,cells:string[]):ImportRow {
 const get=(field:ColumnField)=>cells[(sheet.columns[field]??0)-1]??'';
 const name=get('company_name').trim();const normalized=normalizeCompanyName(name);
 if(!normalized)throw new Error('会社名が空または法人格・記号のみです');
 if(name.length>1000)throw new Error('会社名が1000文字を超えています');
 const rawPhone=get('phone'),mobile=get('mobile_phone');const phoneCandidates=parsePhones(rawPhone+'\n'+mobile);const phones=phoneCandidates.filter(x=>x.kind==='telephone').map(x=>x.normalized!);

 const rawStatus=get('status'),rawMemo=get('memo');
 const history=[...new Set([sheet.columns.status,sheet.columns.memo,sheet.columns.last_call_date,...sheet.historyColumns].filter((v):v is number=>Boolean(v)))].map(i=>`${sheet.headers[i-1]??'列'+i}: ${cells[i-1]??''}`).join('\n');
 const rawDate=get('last_call_date');const dateClassification=classifyDate(rawDate);const misplacedUrl=dateClassification.kind==='url_in_date_column';
 if(dateClassification.kind==='invalid_date')for(const p of parsePhones(rawDate)){if(p.kind==='telephone'){p.reason='日付列内の番号：要確認。代表電話へ自動移動しない';phoneCandidates.push(p);}}
 const dateValue=['valid_date','datetime'].includes(dateClassification.kind)?dateClassification.date??rawDate:'';
 const urls=[...(misplacedUrl?splitUrls(rawDate,'date_column'):[]),...splitUrls(get('website_url'),'website'),...splitUrls(get('instagram_url'),'instagram'),...(sheet.supplementaryUrlColumns??[]).filter(i=>i!==sheet.columns.last_call_date).flatMap(i=>splitUrls(cells[i-1]??'','column_'+i))];
 const candidates=mobileCandidates(rawMemo+'\n'+history);
 const sales=parseSalesHistory(rawStatus,rawMemo,history,dateValue);

 const rawData=Object.fromEntries(cells.map((v,i)=>[`${i+1}:${sheet.headers[i]??''}`,v]));
 const address=get('address').trim();const prefecture=detectPrefecture(get('prefecture'))||detectPrefecture(address)||sheet.prefecture;
 const warnings:string[]=[];if(cells.some(c=>c.includes('\uFFFD')))warnings.push('元セルに置換文字あり：原本要確認');if(!['valid_date','datetime','empty'].includes(dateClassification.kind))warnings.push('日付列要確認：'+dateClassification.kind);if(phoneCandidates.some(p=>p.kind==='unresolved'))warnings.push('電話番号要確認');if(warnings.length){sales.eligible_for_sales=false;if(!sales.exclusion_reason)sales.exclusion_reason='取込値要確認';}
 const anomalies=cells.flatMap((value,i)=>value.includes('\uFFFD')?[{raw_value:value,sheet:sheet.sheet,cell:columnLetter(i+1)+rowNumber,source_row:rowNumber,anomaly_type:'source_text_corruption',needs_review:true}]:[]);
 return {import_metadata:{anomalies,date_classification:dateClassification,quality_warnings:warnings},phone_candidates:phoneCandidates,raw_last_call_date:get('last_call_date'),raw_website_url:get('website_url'),imported_urls:urls,mobile_candidates:candidates,source_file:sourceFile,file_hash:fileHash,source_sheet:sheet.sheet,source_row:rowNumber,company_name:name,normalized_company_name:normalized,phone:rawPhone,normalized_phone:phones[0]??'',normalized_phones:phones,mobile_phone:mobile||phones.find(p=>/^0[789]0/.test(p))||'',address,normalized_address:normalizeAddress(address),prefecture,website_url:'',instagram_url:urls.find(u=>{const host=new URL(u.url).hostname;return host==='instagram.com'||host.endsWith('.instagram.com');})?.url??'',raw_company_name:get('company_name'),raw_phone:rawPhone,raw_status:rawStatus,raw_memo:rawMemo,raw_history:history,raw_data:rawData,...sales};
}
export function rowHash(row:ImportRow){
 const {source_file,...contents}=row;void source_file;
 const stableMetadata=(value:unknown):unknown=>Array.isArray(value)?value.map(stableMetadata):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='source_file').map(([key,v])=>[key,stableMetadata(v)])):value;
 // Renaming the same workbook must not change hashes through provenance filenames.
 if(contents.import_metadata)contents.import_metadata=stableMetadata(contents.import_metadata) as Record<string,unknown>;
 return createHash('sha256').update(JSON.stringify(contents)).digest('hex');
}

function columnLetter(n:number){let s='';while(n){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s;}

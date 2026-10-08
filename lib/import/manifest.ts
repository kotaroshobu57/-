import unzipper from 'unzipper';
import {SaxesParser} from 'saxes';
import path from 'node:path';
export interface WorkbookSheet {name:string;sheetId:string;relationship:string;state:string;target:string;}
export async function workbookManifest(file:string){
 const zip=await unzipper.Open.file(file);const entry=(name:string)=>{const e=zip.files.find(x=>x.path===name);if(!e||e.uncompressedSize>8*1024*1024)throw new Error(`Excel metadata missing/oversized: ${name}`);return e;};
 const names:Array<Omit<WorkbookSheet,'target'>>=[];const rels=new Map<string,string>();let date1904=false;
 const workbook=new SaxesParser({xmlns:true});workbook.on('opentag',(tag)=>{const attrs=Object.fromEntries(Object.values(tag.attributes).map(a=>[a.local,a.value]));
 if(tag.local==='workbookPr')date1904=['1','true'].includes(attrs.date1904);
 if(tag.local==='sheet'){if(!tag.uri.endsWith('/spreadsheetml/2006/main'))throw new Error('未対応のExcel XML namespace');names.push({name:attrs.name,sheetId:attrs.sheetId,relationship:attrs.id,state:attrs.state??'visible'});}});
 workbook.write(new TextDecoder('utf-8',{fatal:true}).decode(await entry('xl/workbook.xml').buffer())).close();
 const relationships=new SaxesParser({xmlns:true});relationships.on('opentag',(tag)=>{if(tag.local!=='Relationship')return;const a=Object.fromEntries(Object.values(tag.attributes).map(x=>[x.local,x.value]));if(a.Type.endsWith('/worksheet')){if(a.TargetMode==='External')throw new Error('外部worksheetは取込不可');rels.set(a.Id,a.Target);}});
 relationships.write(new TextDecoder('utf-8',{fatal:true}).decode(await entry('xl/_rels/workbook.xml.rels').buffer())).close();
 if(date1904)throw new Error('1904日付システムは未対応。元ファイルを変更せず別途確認してください');
 if(names.length>100||new Set(names.map(s=>s.name)).size!==names.length||new Set(names.map(s=>s.sheetId)).size!==names.length)throw new Error('シート一覧が不正です');
 const sheets=names.map(s=>{const target=rels.get(s.relationship);if(!target)throw new Error(`${s.name}: worksheet relationshipなし`);const resolved=target.startsWith('/')?target.slice(1):path.posix.normalize(path.posix.join('xl',target));if(!/^xl\/worksheets\/sheet\d+\.xml$/.test(resolved)||!zip.files.some(x=>x.path===resolved))throw new Error(`${s.name}: 未対応/不存在worksheet target`);return {...s,target:resolved};});
 return {sheets,date1904};
}

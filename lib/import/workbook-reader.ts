import unzipper from 'unzipper';
import {SaxesParser} from 'saxes';
import {workbookManifest} from './manifest';
const MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export interface WorkbookRow {sheet:string;row:number;cells:string[];}
// Each ZIP XML Buffer is decoded exactly once, with fatal UTF-8 validation.
async function xml(entry:any,open:(n:any)=>void,text:(s:string)=>void,close:(n:any)=>void){
 const buffer=await entry.buffer();const decoded=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
 const parser=new SaxesParser({xmlns:true});parser.on('opentag',open);parser.on('text',text);parser.on('closetag',close);parser.write(decoded).close();
}
export async function* readWorkbook(file:string):AsyncGenerator<WorkbookRow>{
 const manifest=await workbookManifest(file),zip=await unzipper.Open.file(file);
 const shared:string[]=[];const strings=zip.files.find(e=>e.path==='xl/sharedStrings.xml');
 if(strings){let value='',inside=false,inText=false;await xml(strings,n=>{if(n.uri!==MAIN)return;if(n.local==='si'){inside=true;value='';}if(n.local==='t')inText=true;},s=>{if(inside&&inText)value+=s;},n=>{if(n.uri!==MAIN)return;if(n.local==='t')inText=false;if(n.local==='si'){shared.push(value);inside=false;}});}
 let total=0;
 for(const sheet of manifest.sheets){const entry=zip.files.find(e=>e.path===sheet.target);if(!entry)throw Error('シートXML欠落');
  const rows:WorkbookRow[]=[];let row=0,cells:string[]=[],column=0,type='',value='',textValue='',inValue=false,inText=false;
  await xml(entry,n=>{if(n.uri!==MAIN)return;const attr=(key:string)=>String(n.attributes[key]?.value??'');
   if(n.local==='row'){row=Number(attr('r'));cells=[];}
   if(n.local==='c'){const letters=attr('r').match(/^[A-Z]+/)?.[0]??'';column=0;for(const ch of letters)column=column*26+ch.charCodeAt(0)-64;if(!column||column>512)throw Error('セル列番号が不正');type=attr('t');value='';textValue='';}
   if(n.local==='v')inValue=true;if(n.local==='t')inText=true;
  },s=>{if(inValue)value+=s;if(inText)textValue+=s;},n=>{if(n.uri!==MAIN)return;if(n.local==='v')inValue=false;if(n.local==='t')inText=false;
   if(n.local==='c'){const v=type==='s'?shared[Number(value)]??'':type==='inlineStr'?textValue:value; if(v.length>32000)throw Error('セルが長すぎます');cells[column-1]=v;}
   if(n.local==='row'){if(++total>210000)throw Error('総行数上限');cells=Array.from({length:cells.length},(_,i)=>cells[i]??'');if(cells.some(c=>c.trim()))rows.push({sheet:sheet.name,row,cells});}
  });
  for(const r of rows)yield r;
 }
}

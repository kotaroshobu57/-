import unzipper from 'unzipper';
import {SaxesParser} from 'saxes';
import {workbookManifest} from './manifest';
import {TRUSTED_LOCAL_EXPANDED_BYTES,type WorkbookOptions} from './workbook-options';
const MAIN='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export interface WorkbookRow {sheet:string;row:number;cells:string[];}
// One incremental UTF-8 decode per ZIP stream; namespace URI/localName unchanged.
// Actual inflated bytes are metered too, so central-directory sizes are not trusted alone.
async function* xml(entry:any,budget:{used:number;max:number},open:(n:any)=>void,text:(s:string)=>void,close:(n:any)=>void){
 const parser=new SaxesParser({xmlns:true}),decoder=new TextDecoder('utf-8',{fatal:true});
 parser.on('opentag',open);parser.on('text',text);parser.on('closetag',close);
 const stream=entry.stream();let bytes=0;
 try{for await(const chunk of stream){bytes+=chunk.length;budget.used+=chunk.length;if(bytes>entry.uncompressedSize||budget.used>budget.max)throw Error('XML展開実測サイズが安全上限を超えました');parser.write(decoder.decode(chunk,{stream:true}));yield undefined;}if(bytes!==entry.uncompressedSize)throw Error('XML展開サイズがZIP申告値と一致しません');parser.write(decoder.decode()).close();yield undefined;}
 finally{stream.destroy();}
}
export async function* readWorkbook(file:string,options:WorkbookOptions={}):AsyncGenerator<WorkbookRow>{
 const manifest=await workbookManifest(file),zip=await unzipper.Open.file(file);
 const budget={used:0,max:options.trustedLocalFullWorkbook?TRUSTED_LOCAL_EXPANDED_BYTES:256*1024*1024};
 // sharedStrings remains capped at 64MB in both modes. Worksheets are never buffered.
 const shared:string[]=[];const strings=zip.files.find(e=>e.path==='xl/sharedStrings.xml');
 if(strings){if(strings.uncompressedSize>64*1024*1024)throw Error('共有文字列が64MBを超えています');let value='',inside=false,inText=false;
 for await(const _ of xml(strings,budget,n=>{if(n.uri!==MAIN)return;if(n.local==='si'){inside=true;value='';}if(n.local==='t')inText=true;},s=>{if(inside&&inText){value+=s;if(value.length>32000)throw Error('セルが長すぎます');}},n=>{if(n.uri!==MAIN)return;if(n.local==='t')inText=false;if(n.local==='si'){if(shared.length>=2000000)throw Error('共有文字列件数の安全上限');shared.push(value);inside=false;}})){void _;}}
 let total=0;
 for(const sheet of manifest.sheets){const entry=zip.files.find(e=>e.path===sheet.target);if(!entry)throw Error('シートXML欠落');
  const rows:WorkbookRow[]=[];let row=0,cells:string[]=[],column=0,type='',value='',textValue='',inValue=false,inText=false;
  for await(const _ of xml(entry,budget,n=>{if(n.uri!==MAIN)return;const attr=(key:string)=>String(n.attributes[key]?.value??'');
   if(n.local==='row'){row=Number(attr('r'));cells=[];}
   if(n.local==='c'){const letters=attr('r').match(/^[A-Z]+/)?.[0]??'';column=0;for(const ch of letters)column=column*26+ch.charCodeAt(0)-64;if(!column||column>512)throw Error('セル列番号が不正');type=attr('t');value='';textValue='';}
   if(n.local==='v')inValue=true;if(n.local==='t')inText=true;
  },s=>{if(inValue){value+=s;if(value.length>32000)throw Error('セルが長すぎます');}if(inText){textValue+=s;if(textValue.length>32000)throw Error('セルが長すぎます');}},n=>{if(n.uri!==MAIN)return;if(n.local==='v')inValue=false;if(n.local==='t')inText=false;
   if(n.local==='c'){const v=type==='s'?shared[Number(value)]??'':type==='inlineStr'?textValue:value;if(v.length>32000)throw Error('セルが長すぎます');cells[column-1]=v;}
   if(n.local==='row'){if(++total>210000)throw Error('総行数上限');cells=Array.from({length:cells.length},(_,i)=>cells[i]??'');if(cells.some(c=>c.trim()))rows.push({sheet:sheet.name,row,cells});}
  })){void _;for(const r of rows)yield r;rows.length=0;}
 }
}

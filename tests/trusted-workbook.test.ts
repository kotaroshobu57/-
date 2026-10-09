import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {validateWorkbook} from '../lib/import/excel';
test('大容量は全国trustedだけ許可。通常256MB、sharedStrings/マクロ/ローカル制約を維持。10万行は128MB heapで解析',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'trusted-workbook-'));
 try{
 const oversized=path.join(dir,'oversized.xlsx');const handle=await open(oversized,'w');await handle.truncate(101*1024*1024);await handle.close();await assert.rejects(validateWorkbook(oversized),/100MB/);
 const file=path.join(dir,'large.xlsx');execFileSync('python3',['-c',`import zipfile,sys
with zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED) as z:
 z.writestr('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="北海道" sheetId="1" r:id="rId1"/></sheets></workbook>')
 z.writestr('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
 with z.open('xl/worksheets/sheet1.xml','w') as out:
  out.write(b'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>')
  for i in range(1,100001):out.write(('<row r="%d"><c r="B%d" t="inlineStr"><is><t>株式会社テスト%d</t></is></c><c r="C%d" t="inlineStr"><is><t>011-123-4567</t></is></c><c r="D%d" t="inlineStr"><is><t>北海道札幌市1</t></is></c></row>'%(i,i,i,i,i)).encode())
  out.write(b'</sheetData></worksheet>')
 with z.open('xl/styles.xml','w') as out:
  for i in range(260*1024):out.write(b' '*1024)
`,file]);
 await assert.rejects(validateWorkbook(file),/256MB/);
 await validateWorkbook(file,{trustedLocalFullWorkbook:true});
 await assert.rejects(validateWorkbook('https://example.com/a.xlsx',{trustedLocalFullWorkbook:true}),/ローカル/);
 const code=`import {inspectWorkbook,workbookRows,hashFile} from './lib/import/excel.ts';globalThis.fetch=async()=>{throw Error('network forbidden')};const file=process.argv[1];const before=await hashFile(file);const options={trustedLocalFullWorkbook:true};const mappings=await inspectWorkbook(file,options);let rows=0;for await(const row of workbookRows(file,options))rows++;console.log(JSON.stringify({rows,profileRows:mappings[0].rowCount,samples:mappings[0].samples.length,unchanged:before===await hashFile(file),peakRssKB:process.resourceUsage().maxRSS}));`;
 const result=JSON.parse(execFileSync(process.execPath,['--max-old-space-size=128','--import','tsx','--input-type=module','-e',code,file],{cwd:process.cwd(),encoding:'utf8',timeout:120000}));
 assert.equal(result.rows,100000);assert.equal(result.profileRows,100000);assert.equal(result.unchanged,true);assert.ok(result.peakRssKB<320*1024,JSON.stringify(result));console.log('10万行・128MB heapメモリ検証:',result);
 for(const [name,entries] of [['missing-workbook',1],['many-entries',2001]] as const){const target=path.join(dir,name+'.xlsx');execFileSync('python3',['-c',`import sys,zipfile
with zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED) as z:
 for n in range(int(sys.argv[2])):z.writestr('entry'+str(n),b'')
`,target,String(entries)]);await assert.rejects(validateWorkbook(target,{trustedLocalFullWorkbook:true}),name==='missing-workbook'?/xlsx/:/内部ファイル数/);}
 const bomb=path.join(dir,'declared-bomb.xlsx');execFileSync('python3',['-c',`import sys,struct
b=bytearray(open(sys.argv[1],'rb').read());i=b.find(b'PK\\x01\\x02')
while i>=0:
 size=struct.unpack_from('<H',b,i+28)[0];name=bytes(b[i+46:i+46+size])
 if name==b'xl/styles.xml':struct.pack_into('<I',b,i+24,2147483649);break
 i=b.find(b'PK\\x01\\x02',i+46+size)
open(sys.argv[2],'wb').write(b)
`,file,bomb]);await assert.rejects(validateWorkbook(bomb,{trustedLocalFullWorkbook:true}),/2GB/);
 for(const [name,content,size] of [['macro','xl/vbaProject.bin',1],['strings','xl/sharedStrings.xml',65*1024*1024]] as const){const target=path.join(dir,name+'.xlsx');execFileSync('python3',['-c',`import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as src,zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED) as dst:
 for n in src.namelist():
  if n=='xl/styles.xml':continue
  dst.writestr(n,src.read(n))
 with dst.open(sys.argv[3],'w') as out:
  remaining=int(sys.argv[4])
  while remaining:
   count=min(65536,remaining);out.write(b' '*count);remaining-=count
`,file,target,content,String(size)]);await assert.rejects(validateWorkbook(target,{trustedLocalFullWorkbook:true}),name==='macro'?/マクロ/:/64MB/);}
 }finally{await rm(dir,{recursive:true,force:true});}
});

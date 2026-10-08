import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ExcelJS from 'exceljs';
import {workbookRows} from '../lib/import/excel';
import {classifyDate} from '../lib/import/date-classification';
test('共通Readerは任意prefix・UTF8境界・原セル値を保持',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'reader-'));try{
 const file=path.join(dir,'base.xlsx');const b=new ExcelJS.Workbook();const sheet=b.addWorksheet('沖縄');const value='株式会社 有限会社 鈑金 塗装 車輌 ㈱ ① 〜 －　';sheet.addRow([value,value.repeat(500),'45200']);await b.xlsx.writeFile(file);
 for(const prefix of ['x','other']){const target=path.join(dir,prefix+'.xlsx');execFileSync('python3',['-c',`import zipfile,sys,xml.etree.ElementTree as E
E.register_namespace(sys.argv[3],'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
with zipfile.ZipFile(sys.argv[1]) as src,zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED) as dst:
 for n in src.namelist():
  data=src.read(n)
  if n.endswith('.xml'):data=E.tostring(E.fromstring(data),encoding='utf-8',xml_declaration=True)
  dst.writestr(n,data)`,file,target,prefix]);const rows=[];for await(const r of workbookRows(target))rows.push(r);assert.equal(rows.length,1);assert.equal(rows[0].sheet,'沖縄');assert.equal(rows[0].cells[0],value);assert.equal(rows[0].cells[1],value.repeat(500));}
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('日付分類は電話/URL/時刻を日付にしない',()=>{
 for(const [raw,kind] of [['45200','valid_date'],['2026/10/8 12:34','datetime'],['0.5','time_only'],['12:34','time_only'],['https://example.com','url_in_date_column'],['03-3933-8375','invalid_date'],['顧客','invalid_date'],['','empty']])assert.equal(classifyDate(raw).kind,kind);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {dryRun,DuplicateForecast} from '../lib/import/dry-run';
import {parseImportRow} from '../lib/import/excel';
import type {SheetMapping} from '../lib/import/types';
test('全国Dry Runは未確認mappingを停止し、非空行を欠落させず、通信しない',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'full-audit-'));const previous=globalThis.fetch;globalThis.fetch=async()=>{throw Error('通信禁止');};
 try{const file=path.join(dir,'fixture.xlsx');const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('北海道');sheet.addRow(['会社名','電話番号','住所']);sheet.addRow(['株式会社確認','011-123-4567','北海道札幌市中央区1']);await book.xlsx.writeFile(file);
 const report=await dryRun(file,path.join(dir,'report'));assert.equal(report.decision,'C');assert.equal(report.counts.nonempty,2);assert.equal(report.counts.company,0);assert.equal(report.missingSheets.length,46);assert.equal(report.originalUnchanged,true);assert.equal(JSON.parse(await readFile(path.join(dir,'report/report.json'),'utf8')).mode,'offline-full-dry-run');
 }finally{globalThis.fetch=previous;await rm(dir,{recursive:true,force:true});}
});
test('全国重複予測は電話を優先し、同名別県/異電話を候補として自動登録しない',()=>{
 const mapping:SheetMapping={sheet:'北海道',enabled:true,headerRow:0,columns:{company_name:1,phone:2,address:3},historyColumns:[],prefecture:'北海道',headers:[],samples:[],rowCount:0};
 const row=(name:string,phone:string,address:string)=>parseImportRow('fixture','hash',mapping,1,[name,phone,address]);const p=new DuplicateForecast();
 assert.equal(p.accept(row('株式会社ABC','011-123-4567','北海道札幌市1')),'new');
 assert.equal(p.accept(row('別名','011-123-4567','北海道函館市1')),'exact');
 assert.equal(p.accept(row('（株）ＡＢＣ','011-987-6543','北海道札幌市1')),'candidate');
 assert.equal(p.accept(row('ABC','03-1234-5678','東京都港区1')),'candidate');
 assert.equal(p.accept(row('別会社','03-8765-4321','東京都港区2')),'new');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { validateLocal } from '../scripts/validate-local-master';
import { hashFile } from '../lib/import/excel';
test('offline100件上限、5除外、電話一致、同名別会社候補、再実行、元Excel不変',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'local-validation-'));
 try{
 const file=path.join(directory,'synthetic.xlsx'),output=path.join(directory,'output');
 const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('東京都');
 sheet.addRow(['会社名','電話番号','住所','コール','メモ']);
 const statuses=['営業禁止','コール禁止','成約','閉業','廃業'];
 for(let i=0;i<102;i++)sheet.addRow([`株式会社架空${i}整備会社`, `03-${String(1000+i)}-5678`,'東京都架空住所'+i,statuses[i]??'未架電','']);
 sheet.getCell('A8').value='（有）架空5整備会社';sheet.getCell('B8').value='０３－１００５－５６７８';sheet.getCell('C8').value='東京都架空住所5';
 sheet.getCell('A9').value='架空5整備会社';sheet.getCell('C9').value='大阪府別住所';
 await book.xlsx.writeFile(file);const hash=await hashFile(file);
 const report=await validateLocal(file,output);
 assert.equal(report.runs[0].counts.read,100);assert.equal(report.runs[0].counts.new,98);assert.equal(report.runs[0].counts.existing,1);assert.equal(report.runs[0].counts.duplicate_candidate,1);assert.equal(report.runs[0].counts.excluded,5);assert.equal(report.runs[0].counts.errors,0);
 assert.equal(report.runs[1].counts.new,0);assert.equal(report.runs[1].counts.existing,99);assert.equal(report.runs[1].counts.duplicate_candidate,1);assert.equal(report.runs[1].companyCount,98);
 assert.equal(report.samples.length,10);assert.equal(await hashFile(file),hash);
 const state=JSON.parse(await readFile(path.join(output,'companies.json'),'utf8'));assert.equal(state.companies.filter((c:{eligible_for_sales:boolean})=>!c.eligible_for_sales).length,5);
 const again=await validateLocal(file,output);assert.equal(again.runs[0].counts.new,0);assert.equal(again.finalCompanyCount,98);
 }finally{await rm(directory,{recursive:true,force:true});}
});

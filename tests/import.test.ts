import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { normalizeCompanyName,normalizePhones,normalizePhone } from '../lib/normalize';
import { parseSalesHistory,parseDate } from '../lib/import/history';
import { inspectWorkbook,workbookRows,parseImportRow,hashFile,validateMappings } from '../lib/import/excel';
import { calculateScore } from '../lib/scoring';
import { createSeed } from '../lib/seed';
test('STEP2法人格、改行、複数電話、国番号',()=>{
 for(const name of ['株式会社ABCモータース','ABCモータース','（株）ABCモータース','㈱ ＡＢＣ\nモータース','(有)ABCモータース','（有）ABCモータース'])assert.equal(normalizeCompanyName(name),'abcモータース');
 assert.deepEqual(normalizePhones('＋８１ (0)３－１２３４－５６７８ / ０９０－１２３４－５６７８\n03-1234-5678'),['0312345678','09012345678']);
 assert.deepEqual(normalizePhones('03-1234-5678、080-1234-5678;0120-123-456'),['0312345678','08012345678','0120123456']);
 assert.equal(normalizePhone('+81 (0)90 1234 5678'),'09012345678');
});
test('営業状態・日付を保持し曖昧な閉業や成約予定は除外しない',()=>{
 for(const label of ['NG','アポ','見込み','代表不在','受付ブロック','再コール予定','留守','不通']){const parsed=parseSalesHistory(label,'メモ',label,'2025/1/2');assert.equal(parsed.call_status,label);assert.equal(parsed.last_call_date,'2025-01-02');assert.equal(parsed.eligible_for_sales,true);}
 for(const label of ['営業禁止','コール禁止','成約','閉業','廃業'])assert.equal(parseSalesHistory(label,'','','').eligible_for_sales,false);
 for(const label of ['成約予定','営業禁止ではない'])assert.equal(parseSalesHistory(label,'','','').eligible_for_sales,true);
 assert.equal(parseSalesHistory('閉業の可能性','','','').closure_state,'pending');
 assert.equal(parseSalesHistory('閉業の可能性','','','').eligible_for_sales,false);
 assert.equal(parseDate('2026-02-30'),null);
 assert.equal(parseSalesHistory('未架電','', 'コール: 未架電\nメモ: \n最終架電日: ', '').call_status,'未架電');
 assert.equal(parseSalesHistory('未架電','2020/01/01 開業','メモ: 2020/01/01 開業','').last_call_date,null);
});
test('除外会社は高得点でも対象にならず、既存マスターは+15なし',()=>{
 const db=createSeed();const c={...db.companies[0],existing_master:true};
 assert.equal(calculateScore(c,db.signals).score,70);
 for(const status of ['閉業','廃業','コール禁止'] as const)assert.equal(calculateScore({...c,call_status:status},db.signals).isTarget,false);
 assert.equal(calculateScore({...c,eligible_for_sales:false,exclusion_reason:'確認済み閉業'},db.signals).isTarget,false);
});
test('複数シートのExcelを読み取り専用解析、元行と履歴を保持',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'auto-master-'));try{
 const file=path.join(dir,'master.xlsx');const workbook=new ExcelJS.Workbook();
 for(const name of ['東京都','大阪府']){const sheet=workbook.addWorksheet(name);sheet.addRow(['テスト用マスター']);sheet.addRow(['会社名','電話番号','住所','コール','メモ','最終架電日','未対応列']);sheet.addRow(['㈱ ＡＢＣモータース','＋８１ ３－１２３４－５６７８ / ０９０－１２３４－５６７８',name+'架空住所','NG','過去のメモ',new Date('2025-01-02'),'必ず保持']);sheet.getCell('F3').numFmt='yyyy-mm-dd';}
 await workbook.xlsx.writeFile(file);const before=await hashFile(file);const sheets=await inspectWorkbook(file);assert.equal(sheets.length,2);assert.equal(sheets[0].headerRow,2);assert.equal(sheets[0].columns.company_name,1);assert.equal(sheets[1].prefecture,'大阪府');validateMappings(sheets);
 const rows=[];for await(const row of workbookRows(file))if(row.row===3)rows.push(parseImportRow('master.xlsx',before,sheets.find(s=>s.sheet===row.sheet)!,row.row,row.cells));
 assert.equal(rows.length,2);assert.equal(rows[0].source_row,3);assert.equal(rows[0].raw_company_name,'㈱ ＡＢＣモータース');assert.equal(rows[0].normalized_company_name,'abcモータース');assert.equal(rows[0].last_call_date,'2025-01-02');assert.equal(rows[0].raw_data['7:未対応列'],'必ず保持');assert.equal(rows[0].call_status,'NG');assert.equal(await hashFile(file),before);
 const unknown=parseImportRow('master.xlsx',before,sheets[0],4,['会社','31234']);assert.equal(unknown.eligible_for_sales,false);assert.equal(unknown.phone_candidates?.[0].classification,'unknown_number');assert.equal(unknown.raw_phone,'31234');
 }finally{await rm(dir,{recursive:true,force:true});}
});

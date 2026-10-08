import test from 'node:test';import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {parseDate,parseSalesHistory} from '../lib/import/history';import {parsePhones} from '../lib/import/phones';import {inspectWorkbook,workbookRows,hashFile} from '../lib/import/excel';import {workbookManifest} from '../lib/import/manifest';import {importEntries} from '../lib/import/entries';import {PREFECTURES} from '../lib/normalize';
test('日付列のみ1900シリアルを解析、架空1900/2/29は拒否',()=>{assert.equal(parseDate('45200'),null);assert.equal(parseDate('45200',true),'2023-10-01');assert.equal(parseDate('45678.7',true),'2025-01-21');assert.equal(parseDate('60',true),null);assert.equal(parseDate('59',true),'1900-02-28');assert.equal(parseDate('61',true),'1900-03-01');});
test('禁止同義語・過去指示は安全側、成約は明確な状態優先、将来/一般論は成約にしない',()=>{
 for(const word of ['営業禁止','コール禁止','架電禁止','電話禁止','連絡禁止','TEL禁止','電話しない','かけない'])assert.equal(parseSalesHistory(word,'','','').eligible_for_sales,false,word);
 for(const word of ['成約','契約','契約済','受注','導入済'])assert.equal(parseSalesHistory(word,'','','').eligible_for_sales,false,word);
 for(const memo of ['契約予定です','成約直前まで進んだ','契約書の作成について','未契約','未受注','他社導入済','他社契約済','成約済みの参考例です'])assert.notEqual(parseSalesHistory('アポ',memo,'','').call_status,'成約済み',memo);
 assert.equal(parseSalesHistory('アポ','','2025/1/1 もうかけてこないでもらっていいですか','').eligible_for_sales,false);
});
test('複数電話は候補に全保持、FAX/ID/郵便番号/金額を代表番号にしない',()=>{
 const x=parsePhones('TEL:＋８１ (0)３－１２３４－５６７８ / 090-1234-5678\nFAX:03-1111-2222\n管理番号09011112222\n〒123-4567\n金額09011112222円\n0078-6045-8906\n4-7191-3670');
 assert.deepEqual(x.filter(x=>x.kind==='telephone').map(x=>x.normalized),['0312345678','09012345678']);assert.equal(x.filter(x=>x.kind==='fax').length,1);assert.equal(x.filter(x=>x.kind==='special').length,1);assert.equal(x.filter(x=>x.kind==='unresolved').length,1);
});
test('禁止区間は明示解除まで継承、途中見出し/地域/注記を保持。47シートhiddenも欠落なし',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'safety-'));try{const file=path.join(dir,'47.xlsx');const book=new ExcelJS.Workbook();
 for(const [i,name] of PREFECTURES.entries()){const s=book.addWorksheet(name,{state:i===46?'veryHidden':i===45?'hidden':'visible'});s.addRow(['会社名','電話番号','住所']);s.addRow(['以下架電禁止']);s.addRow(['テスト会社','03-1234-5678',name+'住所']);s.addRow(['メモ']);s.addRow(['会社名','電話番号','住所']);if(i===0)s.addRow(['以上架電禁止']);s.addRow(['別会社','03-1234-5679',name+'別住所']);}
 await book.xlsx.writeFile(file);const before=await hashFile(file);const manifest=await workbookManifest(file);assert.deepEqual(manifest.sheets.map(s=>s.name),PREFECTURES);assert.equal(manifest.sheets[46].state,'veryHidden');
 const m=await inspectWorkbook(file);assert.equal(m.length,47);const entries=[];for await(const e of importEntries(file,m,'47.xlsx',before))entries.push(e);const companies=entries.filter(e=>e.kind==='company');assert.equal(companies.length,94);assert.equal(companies.filter(e=>e.kind==='company'&&e.row.eligible_for_sales).length,1);assert.ok(companies.every(e=>e.kind==='company'&&e.row.import_metadata?.target_row));assert.equal(entries.filter(e=>e.kind==='error').length,0);assert.equal(await hashFile(file),before);
 const counts=new Set<string>();for await(const r of workbookRows(file))counts.add(r.sheet);assert.equal(counts.size,47);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('既存電話一致の禁止指示は履歴差で候補化されても営業可を残さない',async()=>{
 const {applyRow}=await import('../scripts/validate-local-master');const {parseImportRow}=await import('../lib/import/excel');
 const m={sheet:'東京都',enabled:true,headerRow:0,columns:{company_name:1,phone:2,address:3,status:4},historyColumns:[],prefecture:'東京都',headers:[],samples:[],rowCount:2};
 const state={companies:[],records:{}} as import('../scripts/validate-local-master').LocalState;
 applyRow(state,parseImportRow('fixture.xlsx','hash',m,1,['ABC','03-1234-5678','東京都住所','アポ']));applyRow(state,parseImportRow('fixture.xlsx','hash',m,2,['ABC','03-1234-5678','東京都住所','架電禁止']));assert.equal(state.companies[0].eligible_for_sales,false);assert.equal(state.companies[0].is_do_not_call,true);
});
test('出典のファイル名変更は見出し・区間メタデータ経由でも再実行ハッシュを変えない',async()=>{
 const {rowHash,parseImportRow}=await import('../lib/import/excel');const mapping={sheet:'東京都',enabled:true,headerRow:0,columns:{company_name:1,phone:2,address:3},historyColumns:[],prefecture:'東京都',headers:[],samples:[],rowCount:1};
 const a=parseImportRow('a.xlsx','same-hash',mapping,1,['ABC','03-1234-5678','東京都住所']);a.import_metadata={ban_origins:[{source_file:'a.xlsx',source_row:1}],headers:[{source_file:'a.xlsx',source_row:0}]};const b={...a,source_file:'b.xlsx',import_metadata:{ban_origins:[{source_file:'b.xlsx',source_row:1}],headers:[{source_file:'b.xlsx',source_row:0}]}};assert.equal(rowHash(a),rowHash(b));assert.notEqual(rowHash(a),rowHash({...b,raw_company_name:'別の会社'}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {splitUrls,mobileCandidates} from '../lib/import/quality';
import {parseSalesHistory} from '../lib/import/history';
import {inspectWorkbook,validateMappings,workbookRows,parseImportRow,hashFile} from '../lib/import/excel';
import {validateLocal} from '../scripts/validate-local-master';
import {calculateScore} from '../lib/scoring';
import {createSeed} from '../lib/seed';
test('閉廃業は現状態の明確な根拠のみ確定、禁止履歴は残し要確認も推薦しない',()=>{
 for(const label of ['廃業','閉業済み','廃業確認済']){const x=parseSalesHistory(label,'','','');assert.equal(x.closure_state,'confirmed');assert.equal(x.is_closed,true);assert.equal(x.eligible_for_sales,false);}
 for(const [status,memo,history] of [['現アナ/廃番/廃業','',''],['NG','廃業かも',''],['コール','','2025/1/1 廃業'],['未架電','閉業の可能性','']]){const x=parseSalesHistory(status,memo,history,'');assert.equal(x.closure_state,'pending');assert.equal(x.is_closed,false);assert.notEqual(x.call_status,'廃業');assert.notEqual(x.call_status,'閉業');assert.equal(x.eligible_for_sales,false);const seed=createSeed();assert.equal(calculateScore({...seed.companies[0],...x},seed.signals).isTarget,false);}
 for(const label of ['営業禁止','コール禁止']){const x=parseSalesHistory('見込み','',`2020/1/1 ${label}\n2026/1/1 コール`,'2026/1/1');assert.equal(x.is_do_not_call,true);assert.equal(x.eligible_for_sales,false);}
 assert.equal(parseSalesHistory('成約済み','','','').eligible_for_sales,false);
 assert.equal(parseSalesHistory('営業禁止ではない','','','').eligible_for_sales,true);
});
test('複数URLを分離、分類不能は未分類、類似ドメインをSNSと認めない',()=>{
 const urls=splitUrls('https://r.goope.jp/sr/　https://www.goo-net.com/pit/shop/1/top\nhttps://www.instagram.com/abc https://instagram.com.attacker.example/x','website');
 assert.equal(urls.length,4);assert.deepEqual(urls.map(u=>u.kind),['unclassified','other','sns','unclassified']);
 assert.equal(splitUrls('https://a.example/xhttps://b.example/y','website').length,2);
 assert.equal(splitUrls('https://a.example/?next=https://b.example/x','website').length,1);
 assert.equal(splitUrls('https://user:pass@example.com/','website').length,0);
});
test('携帯は明示ラベル近傍の候補のみ、代表電話や重複電話には混ぜない',()=>{
 const x=mobileCandidates('山下社長携帯(090-8903-0180)\n担当直通 ０８０－１２３４－５６７８\n注文番号 09012345678\n携帯の注文番号09012345678\n2026/10/5 09012345678\n金額09012345678円');
 assert.deepEqual(x.map(c=>c.phone),['09089030180','08012345678']);assert.ok(x.every(c=>c.status==='pending'));
});
test('ヘッダー混在/異構造は警告、未知列は未設定、headerRow0の通常CLI再実行で元行維持',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'quality-import-'));try{
 const file=path.join(dir,'mixed.xlsx');const book=new ExcelJS.Workbook();const a=book.addWorksheet('北海道');a.addRow(['㈱ＡＢＣ','0139-52-1107','北海道住所']);a.addRow(['別会社','0139-52-1108','北海道住所2']);const b=book.addWorksheet('大阪府');b.addRow(['電話番号','会社名','住所']);b.addRow(['06-1234-5678','大阪整備','大阪府住所']);await book.xlsx.writeFile(file);const hash=await hashFile(file);
 const m=await inspectWorkbook(file);assert.equal(m[0].enabled,false);assert.deepEqual(m[0].columns,{});assert.equal(m[0].headerRow,0);assert.equal(m[0].rowCount,2);assert.ok(m.every(s=>s.warnings?.length));m[0].enabled=true;m[0].columns={company_name:1,phone:2,address:3};validateMappings(m);
 const config=path.join(dir,'mapping.json');await (await import('node:fs/promises')).writeFile(config,JSON.stringify(m));const report=await validateLocal(file,path.join(dir,'output'),config);assert.equal(report.runs[0].counts.new,3);assert.equal(report.runs[1].counts.new,0);assert.equal(report.samples[0].row?.source_row,1);assert.equal(await hashFile(file),hash);
 for await(const r of workbookRows(file))if(r.sheet==='北海道'&&r.row===1){const p=parseImportRow('mixed.xlsx',hash,m[0],r.row,r.cells);assert.equal(p.raw_company_name,'㈱ＡＢＣ');assert.equal(p.normalized_phone,'0139521107');}
 }finally{await rm(dir,{recursive:true,force:true});}
});

import test from 'node:test';import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {importEntries} from '../lib/import/entries';import {parsePhones} from '../lib/import/phones';import {confirmedMapping,mappingFingerprint} from '../lib/import/mapping-registry';
test('会社名欠損と原本会社名置換文字は原値付きメタデータに保存し会社を作らない',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'exceptions-'));try{const file=path.join(dir,'exceptions.xlsx');const b=new ExcelJS.Workbook(),s=b.addWorksheet('長野');s.addRow(['','0263-31-0767','長野県安曇野市豊科2944-3']);s.addRow(['原本�会社','0263-31-0768','長野県住所']);await b.xlsx.writeFile(file);const mapping={sheet:'長野',enabled:true,headerRow:0,columns:{company_name:1,phone:2,address:3},historyColumns:[],prefecture:'長野県',headers:[],samples:[],rowCount:2};const entries=[];for await(const e of importEntries(file,[mapping],'exceptions.xlsx','hash'))entries.push(e);assert.equal(entries.filter(e=>e.kind==='company').length,0);assert.equal(entries.length,2);for(const e of entries){assert.equal(e.kind,'metadata');if(e.kind==='metadata'){assert.equal(e.metadata.needs_review,true);assert.equal(e.metadata.anomalies?.[0].source_row,e.metadata.source_row);}}assert.equal(entries[0].kind==='metadata'&&entries[0].metadata.anomalies?.[0].anomaly_type,'company_name_missing');assert.equal(entries[1].kind==='metadata'&&entries[1].metadata.anomalies?.[0].raw_value,'原本�会社');}finally{await rm(dir,{recursive:true,force:true});}
});
test('不明電話は推測補完せず全候補に原値/分類を残す',()=>{
 for(const [raw,label] of [['2','unknown_number'],['9041818440','malformed_phone'],['42-597-5035','malformed_phone'],['4-7191-3670','malformed_phone'],['0078-6045-5684577','malformed_phone'],['注文番号12345','not_phone']]){const c=parsePhones(raw)[0];assert.equal(c.classification,label);assert.equal(c.normalized,null);assert.equal(c.raw,raw);}
});
test('確認済mappingは同名の別元データへ無条件適用しない。京都名を切り詰めない',()=>{
 const m={sheet:'京都',enabled:true,headerRow:0,columns:{company_name:2,phone:3,address:4},historyColumns:[],prefecture:'京都府',headers:[],samples:[],rowCount:1};const result=confirmedMapping(m,[{row:1,cells:['','別の元データ']}]);assert.equal(result.enabled,false);assert.equal(result.needs_review,true);assert.equal(mappingFingerprint([{row:1,cells:['a','']}]),mappingFingerprint([{row:1,cells:['a']}]));
});

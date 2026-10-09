import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmedMapping} from '../lib/import/mapping-registry';
import rules from '../lib/import/confirmed-mappings.json';
import structures from '../lib/import/confirmed-structure.json';
import type {SheetMapping} from '../lib/import/types';
function fixture(sheet='北海道'){
 const rule=(rules as Record<string,any>)[sheet],baseline=(structures as Record<string,any>)[sheet];
 const rows=Array.from({length:100},(_,i)=>{const cells=Array<string>(27).fill('');cells[rule.columns.company_name-1]='株式会社サンプル整備'+i;cells[rule.columns.phone-1]='011-123-4567';cells[rule.columns.address-1]='北海道札幌市中央区1';cells[rule.columns.website_url-1]='https://example.com';cells[rule.columns.last_call_date-1]='2026/10/09';cells[rule.columns.status-1]='NG';cells[rule.columns.memo-1]='2026/10/09 架電\n代表不在';return {row:i+1,cells};});
 for(const header of baseline.headers){rows[header.row-1].cells=Array<string>(27).fill('');for(const cell of header.cells)rows[header.row-1].cells[cell.column-1]=cell.label;}
 const mapping:SheetMapping={sheet,enabled:false,headerRow:0,columns:{...rule.columns},historyColumns:[],prefecture:'北海道',headers:[],samples:[],rowCount:100,columnCount:27};return {rows,mapping,rule};
}
for(const [name,field,value] of [['営業履歴','memo','2026/10/10 コール\n担当者と相談'],['ステータス','status','契約済'],['電話番号','phone','011-987-6543'],['会社名','company_name','有限会社更新モータース'],['日付','last_call_date','2026/10/10']] as const)test(name+'の値更新は構造確定を維持',()=>{
 const {rows,mapping,rule}=fixture();for(const r of rows)if(r.row!==41)r.cells[rule.columns[field]-1]=value;
 const result=confirmedMapping(mapping,rows);assert.equal(result.mappingSource,'confirmed-registry');assert.equal(result.needs_review,false);assert.equal(result.mappingAudit?.sampleFingerprintMatched,false);assert.deepEqual(result.columns,rule.columns);assert.deepEqual(result.historyColumns,rule.historyColumns);assert.deepEqual(result.supplementaryUrlColumns,rule.supplementaryUrlColumns);
});
test('ヘッダーなし県はcore列と日付/結果/履歴の独立根拠を照合',()=>{const {rows,mapping}=fixture('沖縄');assert.equal(confirmedMapping(mapping,rows).needs_review,false);});
test('列の移動、削除、日付とURL交換、ヘッダー位置変更は停止',()=>{
 for(const action of ['shift','delete','swap','header']){const {rows,mapping,rule}=fixture();if(action==='shift'){for(const r of rows)r.cells.unshift('');mapping.columnCount=28;}if(action==='delete'){for(const r of rows)r.cells.splice(2,1);mapping.columnCount=26;}if(action==='swap'){for(const r of rows){const a=rule.columns.last_call_date-1,b=rule.columns.website_url-1;[r.cells[a],r.cells[b]]=[r.cells[b],r.cells[a]];}}if(action==='header')rows[40].row=42;const result=confirmedMapping(mapping,rows);assert.equal(result.needs_review,true,action);assert.notEqual(result.mappingSource,'confirmed-registry',action);}
});
test('県名47個だけを偽装した無関係Excelは確定しない',()=>{
 for(const sheet of Object.keys(rules)){const {rows,mapping}=fixture(sheet);for(const r of rows)r.cells=Array(27).fill('注文管理番号12345');const result=confirmedMapping(mapping,rows);assert.equal(result.needs_review,true,sheet);assert.notEqual(result.mappingSource,'confirmed-registry',sheet);}
});
test('日付欄URL等の少数異常はシート全体を失効させない',()=>{const {rows,mapping,rule}=fixture('沖縄');rows[0].cells[rule.columns.last_call_date-1]='https://example.com/date';assert.equal(confirmedMapping(mapping,rows).needs_review,false);});

test('ステータスが説明文へ更新されただけなら列移動と決めつけない',()=>{const {rows,mapping,rule}=fixture('沖縄');for(const r of rows)r.cells[rule.columns.status-1]='担当者より相談あり\n翌週の連絡希望';assert.equal(confirmedMapping(mapping,rows).needs_review,false);});
test('ヘッダーなしでも営業結果と履歴の相互移動は停止',()=>{const {rows,mapping,rule}=fixture('沖縄');for(const r of rows){const a=rule.columns.status-1,b=rule.columns.memo-1;[r.cells[a],r.cells[b]]=[r.cells[b],r.cells[a]];}assert.equal(confirmedMapping(mapping,rows).needs_review,true);});

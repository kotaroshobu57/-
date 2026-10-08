import {createHash} from 'node:crypto';
import confirmed from './confirmed-mappings.json';
import type {SheetMapping} from './types';
export function mappingFingerprint(rows:Array<{row:number;cells:string[]}>){return createHash('sha256').update(JSON.stringify(rows.filter(r=>r.row<=100).map(r=>{const cells=[...r.cells];while(cells.length&&!cells[cells.length-1])cells.pop();return {row:r.row,cells};}))).digest('hex');}
export function confirmedMapping(sheet:SheetMapping,rows:Array<{row:number;cells:string[]}>):SheetMapping{
 const key=sheet.sheet in confirmed?sheet.sheet:sheet.sheet.replace(/[都府県]$/,'');const rule=(confirmed as Record<string,any>)[key];if(!rule)return sheet;
 // Do not trust a familiar prefecture name in an unrelated or changed workbook.
 if(rule.sampleFingerprint!==mappingFingerprint(rows)){if(['company_name','phone','address'].some(key=>(sheet.columns as Record<string,number>)[key]!==rule.columns[key]))return sheet;return {...sheet,needs_review:true,enabled:false,warnings:[...(sheet.warnings??[]),'確認済みサンプルから元セルが変化：設定再確認必須']};}
 return {...sheet,headerRow:0,columns:{...rule.columns},historyColumns:[...rule.historyColumns],supplementaryUrlColumns:[...rule.supplementaryUrlColumns],enabled:true,confidence:1,needs_review:false,mappingSource:'confirmed-registry',warnings:['確認済みサンプル一致。日付/電話等の異常セルは別途要確認として保持。']};
}

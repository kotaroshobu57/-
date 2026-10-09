import {createHash} from 'node:crypto';
import confirmed from './confirmed-mappings.json';
import structures from './confirmed-structure.json';
import {structureProfile} from './mapping-structure';
import type {SheetMapping} from './types';
export function mappingFingerprint(rows:Array<{row:number;cells:string[]}>){return createHash('sha256').update(JSON.stringify(rows.filter(r=>r.row<=100).map(r=>{const cells=[...r.cells];while(cells.length&&!cells[cells.length-1])cells.pop();return {row:r.row,cells};}))).digest('hex');}
export function confirmedMapping(sheet:SheetMapping,rows:Array<{row:number;cells:string[]}>):SheetMapping{
 const key=sheet.sheet in confirmed?sheet.sheet:sheet.sheet.replace(/[都府県]$/,'');const rule=(confirmed as Record<string,any>)[key];if(!rule)return sheet;
 const baseline=(structures as Record<string,ReturnType<typeof structureProfile>>)[key];
 const width=sheet.columnCount??Math.max(0,...rows.map(r=>r.cells.length));const current=structureProfile(rows,width);const reasons:string[]=[];
 const columns=Object.values(rule.columns) as number[];const required=[...columns,...rule.historyColumns,...rule.supplementaryUrlColumns];
 if(required.some(n=>n<1||n>width))reasons.push('確定列が現在の最大使用列を超えています（列削除/不足）');
 if(new Set(columns).size!==columns.length)reasons.push('確定項目に列番号の競合があります');
 const count=(column:number,trait:keyof ReturnType<typeof structureProfile>['columns'][number])=>current.columns[column-1]?.[trait]??0;
 for(const [field,trait] of [['company_name','company'],['phone','phone'],['address','address']] as const){const n=rule.columns[field];const filled=count(n,'filled');if(count(n,trait)<3||count(n,trait)/Math.max(filled,1)<.45)reasons.push(`${field}列の実データ傾向が不一致`);}
 if(!baseline)reasons.push('STEP2.11構造根拠がありません');
 else{
  // Headers carry schema, not mutable sales data. Require each reviewed header row/label.
  for(const header of baseline.headers){const now=current.headers.find(h=>h.row===header.row);if(!now||header.cells.some(cell=>!now.cells.some(c=>c.column===cell.column&&c.label===cell.label)))reasons.push(`確認済みヘッダーの位置/名称不一致（元行${header.row}）`);}
  if(!baseline.headers.length&&current.headers.length){for(const header of current.headers){for(const [field,label] of [['company_name',/会社名|法人名|店名/],['phone',/電話番号|TEL/i],['address',/^住所|所在地/]] as const){if(!header.cells.some(c=>c.column===rule.columns[field]&&label.test(c.label)))reasons.push('新しいヘッダーと確定列が不一致');}}}
  const evidence=[count(rule.columns.last_call_date,'date'),count(rule.columns.status,'status'),count(rule.columns.memo,'history'),count(rule.columns.website_url,'url')].filter(n=>n>=3).length;
  if(!baseline.headers.length&&evidence<2)reasons.push('ヘッダーなし：日付/営業結果/履歴/URLの複数根拠が不足');
  // A few malformed cells stay row-level review. Only dominant incompatible types block a sheet.
  const incompatible=(field:string,traits:Array<'phone'|'address'|'url'|'history'|'status'>)=>{const n=rule.columns[field];if(!n)return;const filled=count(n,'filled');if(filled<5)return;for(const trait of traits){const old=baseline.columns[n-1];const expectedTraits:Record<string,'company'|'phone'|'address'|'url'|'date'|'status'|'history'>={company_name:'company',phone:'phone',address:'address',website_url:'url',last_call_date:'date',status:'status',memo:'history'};
   const expected=expectedTraits[field];const displaced=Object.entries(expectedTraits).some(([otherField,otherTrait])=>{if(otherField===field||otherTrait!==trait)return false;const col=rule.columns[otherField],previous=baseline.columns[col-1];return count(col,expected)>=5&&count(col,expected)/Math.max(count(col,'filled'),1)>=.65&&(previous?.[expected]??0)/Math.max(previous?.filled??0,1)<.3;});
   if(count(n,trait)/filled>=.65&&(old?.[trait]??0)/Math.max(old?.filled??0,1)<.3&&displaced)reasons.push(`${field}列と別項目の傾向が入れ替わっています（列移動の疑い）`);}};
  incompatible('status',['phone','address','url','history']);incompatible('memo',['phone','address','status']);incompatible('last_call_date',['phone','address','history']);incompatible('website_url',['phone','address','history','status']);
  // Detect date<->URL swap only with corroborating displaced date evidence; isolated URL dates are review rows.
  const dateColumn=rule.columns.last_call_date,urlColumn=rule.columns.website_url;
  if(count(dateColumn,'url')>=5&&count(dateColumn,'url')/Math.max(count(dateColumn,'filled'),1)>=.65&&count(urlColumn,'date')>=5)reasons.push('日付列とURL列の交換が疑われます');
 }
 const audit={sampleFingerprintMatched:rule.sampleFingerprint===mappingFingerprint(rows),structureVerified:reasons.length===0,structureReasons:reasons};
 if(reasons.length){const generic=sheet.headers.length>0&&['company_name','phone','address'].some(f=>(sheet.columns as Record<string,number>)[f]!==rule.columns[f]);return {...sheet,enabled:generic?sheet.enabled:false,needs_review:true,mappingAudit:audit,warnings:[...(sheet.warnings??[]),...reasons]};}
 return {...sheet,headerRow:0,columns:{...rule.columns},historyColumns:[...rule.historyColumns],supplementaryUrlColumns:[...rule.supplementaryUrlColumns],enabled:true,confidence:1,needs_review:false,mappingSource:'confirmed-registry',mappingAudit:audit,warnings:[audit.sampleFingerprintMatched?'確認済み構造とサンプル一致':'セル値更新あり。確認済み構造検証に合格（内容hashは監査用）','異常セルは行単位で要確認として保持。']};
}

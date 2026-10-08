// Explicit offline audit of the supplied five prefectures, maximum 100 physical rows/sheet.
// Does not load environment files, import Supabase, or permit national full import.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {inspectWorkbook,workbookRows,hashFile} from '../lib/import/excel';
import {workbookManifest} from '../lib/import/manifest';
import {parseDate} from '../lib/import/history';
import {validateLocal} from './validate-local-master';
const file=path.resolve(process.argv[2]??'');if(!process.argv[2])throw new Error('Usage: tsx scripts/verify-step28.ts sample.xlsx [new-output-directory]');
const output=path.resolve(process.argv[3]??'.data/step28-audit');await fs.mkdir(output,{recursive:true});
try{await fs.access(path.join(output,'companies.json'));throw new Error('初回比較には新しい出力ディレクトリを指定してください');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
const hash=await hashFile(file);const manifest=await workbookManifest(file);
assert.deepEqual(manifest.sheets.map(s=>s.name),['北海道','茨城','愛知','千葉','長崎']);
const reference={sheets:manifest.sheets,rows:[] as Array<{sheet:string;row:number;cells:string[]}>};for await(const row of workbookRows(file))reference.rows.push(row);
assert.ok(reference.rows.every((r:any)=>r.row<=100),'検証専用：各シート先頭100物理行まで');
const mappings=await inspectWorkbook(file);for(const m of mappings){const o=m.sheet==='茨城'?1:0;m.enabled=true;m.headerRow=0;m.columns={company_name:2+o,phone:3+o,address:4+o,website_url:5+o,last_call_date:6+o,status:m.sheet==='長崎'?9:10,memo:m.sheet==='茨城'?12:11};m.historyColumns=m.sheet==='茨城'?[7,9,10,11,12,13]:[6,8,9,10,11,12,13,14,15,16,17];}
const config=path.join(output,'reviewed-mapping.json');await fs.writeFile(config,JSON.stringify(mappings,null,2));
const report=await validateLocal(file,output,config,500);
const normal=[];for await(const r of workbookRows(file))normal.push(r);
const dictionary=new Map(normal.map(r=>[`${r.sheet}/${r.row}`,r]));const diffs=[];
const equivalent=(a:string,b:string)=>a===b||(a.trim()!==''&&b.trim()!==''&&Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Number(a)===Number(b));
for(const row of reference.rows){const actual=dictionary.get(`${row.sheet}/${row.row}`);if(!actual){diffs.push({sheet:row.sheet,row:row.row,kind:'missing'});continue;}for(let i=0;i<Math.max(row.cells.length,actual.cells.length);i++)if(!equivalent(row.cells[i]??'',actual.cells[i]??''))diffs.push({sheet:row.sheet,row:row.row,column:i+1,xml:row.cells[i]??'',normal:actual.cells[i]??''});}
for(const row of normal)if(!reference.rows.some((r:any)=>r.sheet===row.sheet&&r.row===row.row))diffs.push({sheet:row.sheet,row:row.row,kind:'extra'});
const rows=report.runs[0].results.flatMap(x=>'row' in x&&x.row?[x.row]:[]);
const banned=rows.filter(r=>Array.isArray(r.import_metadata?.ban_origins)&&(r.import_metadata!.ban_origins as unknown[]).length>0);
const numericDates=rows.filter(r=>/^\d+(?:\.\d+)?$/.test(r.raw_last_call_date??''));
const dateErrors=numericDates.filter(r=>!parseDate(r.raw_last_call_date!,true));
const latestWrong=numericDates.filter(r=>!r.last_call_date||r.last_call_date<parseDate(r.raw_last_call_date!,true)!);
const explicitExclusionLeaks=rows.filter(r=>/^(営業禁止|コール禁止|架電禁止|電話禁止|連絡禁止|TEL禁止|成約|契約|契約済|受注|導入済)$/.test(r.raw_status)&&r.eligible_for_sales);
const phoneCandidates=rows.flatMap(r=>r.phone_candidates??[]);
const metadata=(report.metadata as Array<{source_sheet:string;source_row:number}>);
const titleRegistrations=rows.filter(r=>metadata.some(m=>m.source_sheet===r.source_sheet&&m.source_row===r.source_row));
const summary={manifest,sourceUnchanged:hash===await hashFile(file),normalRows:normal.length,xmlRows:reference.rows.length,differences:diffs.length,runs:report.runs.map(({counts,durationMs,companyCount})=>({counts,durationMs,companyCount})),banSectionRows:banned.length,banLeaks:banned.filter(r=>r.eligible_for_sales).length,explicitExclusionLeaks:explicitExclusionLeaks.length,numericDates:numericDates.length,numericDateErrors:dateErrors.length,latestBeforeExplicit:latestWrong.length,titleRegistrations:titleRegistrations.length,metadataRows:metadata.length,phoneErrors:report.runs[0].results.filter(x=>'error' in x&&x.error?.includes('電話')).length,unresolvedPhones:phoneCandidates.filter(x=>x.kind==='unresolved'),specialPhones:phoneCandidates.filter(x=>x.kind==='special'),qualityReviewRows:rows.filter(r=>(r.import_metadata?.quality_warnings as unknown[]|undefined)?.length).map(r=>({sheet:r.source_sheet,row:r.source_row})),perSheet:manifest.sheets.map(s=>({sheet:s.name,rows:rows.filter(r=>r.source_sheet===s.name).length,banned:banned.filter(r=>r.source_sheet===s.name).length,excluded:rows.filter(r=>r.source_sheet===s.name&&!r.eligible_for_sales).length}))};
await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2));await fs.writeFile(path.join(output,'differences.json'),JSON.stringify(diffs,null,2));
assert.equal(summary.banSectionRows,161);assert.equal(summary.banLeaks,0);assert.equal(summary.explicitExclusionLeaks,0);assert.equal(summary.numericDateErrors,0);assert.equal(summary.latestBeforeExplicit,0);assert.equal(summary.differences,0);assert.equal(summary.titleRegistrations,0);assert.equal(report.runs[0].counts.errors,0);assert.equal(report.runs[1].counts.new,0);assert.equal(summary.sourceUnchanged,true);
console.log(JSON.stringify(summary,null,2));

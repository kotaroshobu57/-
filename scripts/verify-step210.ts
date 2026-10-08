// Offline only, reviewed per-sheet mapping required, at most 100 physical rows/sheet.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {workbookRows,hashFile} from '../lib/import/excel';
import {workbookManifest} from '../lib/import/manifest';
import {validateLocal} from './validate-local-master';
const [file,mapping,output,baseline]=process.argv.slice(2);if(!file||!mapping||!output)throw Error('Usage: tsx scripts/verify-step210.ts sample.xlsx reviewed-mapping.json fresh-output [saved-cell-baseline.json]');
const manifest=await workbookManifest(file);if(manifest.sheets.length!==47)throw Error('47シート検証専用');
const rows=[];for await(const r of workbookRows(file)){if(r.row>100)throw Error('100行範囲外：全件取込禁止');rows.push(r);}
try{await fs.access(path.join(output,'companies.json'));throw Error('新しい出力先を指定してください');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
const before=await hashFile(file),report=await validateLocal(file,output,mapping,4700);
const parsed=report.runs[0].results.flatMap(x=>x.row?[x.row]:[]);let differences:number|null=null;
if(baseline){const reference=JSON.parse(await fs.readFile(baseline,'utf8'));const index=new Map(rows.map(r=>[r.sheet+'/'+r.row,r]));differences=0;for(const r of reference.rows){const a=index.get(r.sheet+'/'+r.row);if(!a){differences++;continue;}for(let i=0;i<Math.max(a.cells.length,r.cells.length);i++){const x=a.cells[i]??'',y=r.cells[i]??'';if(x!==y&&!(x.trim()&&y.trim()&&Number.isFinite(+x)&&Number.isFinite(+y)&&+x===+y))differences++;}}if(rows.length!==reference.rows.length)differences++;}
const summary={sheets:manifest.sheets.map(s=>s.name),nonemptyRows:rows.length,sourceUnchanged:before===await hashFile(file),runs:report.runs.map(({counts,durationMs,companyCount})=>({counts,durationMs,companyCount})),cellDifferencesAgainstSavedBaseline:differences,banRows:parsed.filter(r=>(r.import_metadata?.ban_origins as unknown[])?.length).length,banLeaks:parsed.filter(r=>(r.import_metadata?.ban_origins as unknown[])?.length&&r.eligible_for_sales).length,dateClassification:parsed.reduce((counts,r)=>{const kind=(r.import_metadata?.date_classification as {kind:string})?.kind??'missing';counts[kind]=(counts[kind]??0)+1;return counts;},{} as Record<string,number>)};
await fs.writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
if(summary.banLeaks||report.runs[1].counts.new||differences)process.exitCode=1;

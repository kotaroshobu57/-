// One-time audit generation from the unchanged STEP2.11 reviewed sample, never from an unreviewed master.
import {workbookRows} from '../lib/import/excel';
import rules from '../lib/import/confirmed-mappings.json';
import {mappingFingerprint} from '../lib/import/mapping-registry';
import {structureProfile} from '../lib/import/mapping-structure';
import {writeFile} from 'node:fs/promises';
const rows=new Map<string,Array<{row:number;cells:string[]}>>();for await(const r of workbookRows(process.argv[2])){if(r.row>100)continue;let sheet=rows.get(r.sheet);if(!sheet){sheet=[];rows.set(r.sheet,sheet);}sheet.push(r);}
if(rows.size!==47)throw Error('構造根拠の生成には確認済み47シートが必要です');for(const [sheet,values] of rows){const rule=(rules as Record<string,any>)[sheet];if(!rule||mappingFingerprint(values)!==rule.sampleFingerprint)throw Error('未確認データから構造根拠を上書きできません');}
const result=Object.fromEntries([...rows].map(([sheet,values])=>[sheet,structureProfile(values,Math.max(27,...values.map(v=>v.cells.length)))]));await writeFile('lib/import/confirmed-structure.json',JSON.stringify(result,null,2));

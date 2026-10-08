// Verification export uses exactly the production Workbook Reader.
import {workbookManifest} from '../lib/import/manifest';
import {workbookRows} from '../lib/import/excel';
const file=process.argv[2];if(!file)throw Error('Usage: tsx scripts/dump-workbook.ts workbook.xlsx');
const manifest=await workbookManifest(file),rows=[];for await(const row of workbookRows(file))rows.push(row);
console.log(JSON.stringify({sheets:manifest.sheets,rows}));

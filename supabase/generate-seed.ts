import { writeFileSync } from 'node:fs';
import { createSeed } from '../lib/seed';
const data=createSeed(new Date('2026-10-06T12:00:00Z'));
function literal(v:unknown):string {if(v===null)return 'NULL';if(typeof v==='boolean'||typeof v==='number')return String(v);return "'"+String(v).replaceAll("'","''")+"'";}
let sql='-- 架空の開発用データ。再実行時は既存IDを変更しません。\nbegin;\n';
for(const table of ['companies','signals'] as const){const rows=data[table];const columns=Object.keys(rows[0]);sql+=`insert into public.${table} (${columns.join(', ')}) values\n`+rows.map(row=>'('+columns.map(key=>literal((row as unknown as Record<string,unknown>)[key])).join(', ')+')').join(',\n')+'\non conflict (id) do nothing;\n';}
sql+='commit;\n';writeFileSync('supabase/seed.sql',sql);

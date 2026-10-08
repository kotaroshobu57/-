import { closureAssessment } from './quality';
import type { CallStatus } from '../types';
export function parseDate(value:string,serialAllowed=false):string|null {
 const v=value.normalize('NFKC').trim();
 if(serialAllowed&&/^\d+(?:\.\d+)?$/.test(v)){const days=Math.floor(Number(v));if(days<1||days>73050||days===60)return null;return new Date(Date.UTC(1899,11,31)+(days-(days>60?1:0))*86400000).toISOString().slice(0,10);}
 const m=v.match(/(20\d{2}|19\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/);
 if(!m)return null;const date=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
 const t=Date.parse(date);return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===date?date:null;
}
function status(text:string):CallStatus|null {
 const v=text.normalize('NFKC').replace(/^[^:\n]{1,80}[:：]\s*/gm,'');
 if(/^(未架電|未コール|コール未実施|架電未実施)$/.test(v.trim()))return '未架電';
 const clean=v.replace(/未成約|未契約|未閉業|未廃業|未架電|未コール|コール未実施|架電未実施/g,'').replace(/(?:営業禁止|コール禁止|架電禁止|電話禁止|連絡禁止|TEL禁止|成約(?:済み)?|閉業|廃業)(?:解除|ではない|なし|予定|見込み|かも|の可能性|の疑い)/g,'');
 if(/(?:コール|架電|電話|連絡|TEL)禁止|電話しない|(?:もう|今後|二度と).{0,12}(?:かけない|かけてこない|電話しない)|(?:^|[\s:：])かけない(?:$|[\s。])/i.test(clean))return 'コール禁止';if(/営業禁止/.test(clean))return '営業禁止';
 if(/廃業/.test(clean))return '廃業';if(/閉業/.test(clean))return '閉業';const wonEvidence=clean.split('\n').filter(line=>!/(他社|別会社|競合|未契約|未受注|未導入|(?:成約|契約|受注|導入済)(?:ではない|予定|見込み|直前))/.test(line)).join('\n');
 if(/(?:^|\n)\s*(?:(?:成約|契約|受注)(?:済み|済|確定)?|導入済)\s*(?:$|\n)|(?:→|矢印)\s*成約(?:$|[\s。])|(?:当社|弊社|本サービス).*(?:成約|契約|受注|導入)(?:済み|済|確定)|(?:^|\n)\d{4}[年/.-].*\s(?:成約|契約済|受注済|導入済)(?:$|[\s。])/m.test(wonEvidence))return '成約済み';
 for(const [pattern,label] of [[/受付ブロック/,'受付ブロック'],[/代表不在/,'代表不在'],[/再コール|再架電/,'再コール予定'],[/アポ/,'アポ'],[/見込み/,'見込み'],[/留守/,'留守'],[/不通/,'不通'],[/\bNG\b|お断り|断られ/i,'NG'],[/不在/,'不在'],[/検討/,'検討中'],[/コール|架電/,'コール済み']] as [RegExp,CallStatus][])if(pattern.test(clean))return label;
 return null;
}
export function parseSalesHistory(rawStatus:string,rawMemo:string,rawHistory:string,dateValue:string) {
 const full=[rawStatus,rawMemo,rawHistory].filter(Boolean).join('\n');
 // Explicit exclusion evidence stays conservative across historical calls; import never reopens it.
 const detected=status(full);const prohibited=detected==='営業禁止'||detected==='コール禁止';
 const closure=closureAssessment(rawStatus,rawMemo,rawHistory);
 const closed=closure.closure_state==='confirmed';const pending=closure.closure_state==='pending';const won=status(rawStatus)==='成約済み'||detected==='成約済み';
 const lines=rawHistory.split('\n').map(line=>({line,date:parseDate(line),status:status(line)}));
 const dated=lines.filter(l=>l.date && (l.status || /(?:架電|コール).*日/.test(l.line))).sort((a,b)=>b.date!.localeCompare(a.date!));
 const explicitDate=parseDate(dateValue,true);const lastDate=[explicitDate,...dated.map(l=>l.date)].filter((d):d is string=>Boolean(d)).sort().at(-1)??null;
 const latest=dated.find(l=>l.date===lastDate&&l.status)?.status;
 const safeStatus=(text:string)=>{const value=status(text);return value==='閉業'||value==='廃業'?(/現アナ|廃番|不通/.test(text)?'不通' as const:null):value;};
 const callStatus=(prohibited?detected:won?'成約済み':closed?status(rawStatus):null)??(explicitDate && explicitDate===lastDate?safeStatus(rawStatus):(latest==='閉業'||latest==='廃業'?null:latest))??safeStatus(rawStatus)??(latest==='閉業'||latest==='廃業'?null:latest)??safeStatus(full)??'未架電';
 return {...closure,call_status:callStatus,last_call_date:lastDate,call_memo:rawMemo||rawHistory,is_do_not_call:prohibited,is_closed:closed,eligible_for_sales:!prohibited&&!closed&&!won&&!pending,exclusion_reason:prohibited||closed||won?(closed?rawStatus.trim():detected!) : pending?closure.closure_reason:''};
}

import { normalizePhone, normalizePhones } from './normalize';
import type { Company, Signal, SignalType } from './types';
export const SIGNAL_LABELS: Record<SignalType, string> = {
 job_new: '新規求人', job_updated: '求人更新', new_store: '新店舗', relocation: '移転', new_factory: '新工場', goopit_new: 'グーピット新規掲載', goopit_activity: 'グーピット活動増加', website_update: 'HP新サービス・重要更新'
};
export const SCORE_RULES = {
 threshold: 70, signal: {job_new:30, job_updated:15, new_store:40, relocation:0, new_factory:40, goopit_new:30, goopit_activity:15, website_update:15} satisfies Record<SignalType,number>,
 notInMaster:15, oldCall:10, mobile:5, oldCallDays:365,
};
export function calculateScore(company: Company, signals: Signal[], now = new Date()) {
 const reasons: {label:string; points:number}[] = [];
 for (const s of signals.filter(s=>s.company_id === company.id && s.status === 'active')) reasons.push({label:`${SIGNAL_LABELS[s.signal_type]}：${s.title}`,points:SCORE_RULES.signal[s.signal_type]});
 if (!company.existing_master) reasons.push({label:'全国既存マスターに存在しない',points:SCORE_RULES.notInMaster});
 const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
 if (company.last_call_date && today - Date.parse(company.last_call_date.slice(0,10)+'T00:00:00Z') >= SCORE_RULES.oldCallDays * 86400000) reasons.push({label:'最終架電から365日以上',points:SCORE_RULES.oldCall});
 if ([...(company.normalized_phones??[]),...normalizePhones(company.phone),...normalizePhones(company.mobile_phone)].some(p=>/^0[789]0\d{8}$/.test(normalizePhone(p)))) reasons.push({label:'携帯番号あり',points:SCORE_RULES.mobile});
 const score = reasons.reduce((n,r)=>n+r.points,0);
 const excludedReason = salesExclusionReason(company);
 return {score,reasons,excludedReason,isTarget:!excludedReason && score >= SCORE_RULES.threshold};
}

export function salesExclusionReason(company:Company):string|null {
 if(Array.isArray(company.import_metadata?.ban_origins)&&company.import_metadata.ban_origins.length)return '禁止区間から継承';
 if(Array.isArray(company.import_metadata?.quality_warnings)&&company.import_metadata.quality_warnings.length)return '取込列の確認待ち';
 if(company.closure_state==='pending')return '閉業・廃業の確認待ち';
 if(company.is_do_not_call)return '営業禁止';
 if(['成約済み','営業禁止','コール禁止','閉業','廃業'].includes(company.call_status))return company.call_status;
 if(company.is_closed)return '閉業・廃業';
 if(company.eligible_for_sales===false)return company.exclusion_reason || '営業対象外';
 return null;
}

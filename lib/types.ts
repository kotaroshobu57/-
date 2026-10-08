export const SIGNAL_TYPES = ['job_new','job_updated','new_store','relocation','new_factory','goopit_new','goopit_activity','website_update'] as const;
export type SignalType = typeof SIGNAL_TYPES[number];
export const CALL_STATUSES = ['未架電','不在','検討中','NG','成約済み','コール済み','アポ','見込み','代表不在','受付ブロック','再コール予定','留守','不通','営業禁止','コール禁止','閉業','廃業'] as const;
export type CallStatus = typeof CALL_STATUSES[number];
export interface Company {phone_candidates?:import('./import/phones').PhoneCandidate[];raw_last_call_date?:string;import_metadata?:Record<string,unknown>;
 raw_website_url?:string; imported_urls?:import('./import/quality').ImportedUrl[]; mobile_candidates?:import('./import/quality').MobileCandidate[]; closure_state?:'normal'|'pending'|'confirmed'; closure_reason?:string;
 normalized_phones?: string[]; normalized_address?: string; eligible_for_sales?: boolean; exclusion_reason?: string; is_closed?: boolean;
 source_file?: string; source_sheet?: string; source_row?: number | null; raw_company_name?: string; raw_phone?: string; raw_status?: string; raw_memo?: string; raw_history?: string;
 id: string; company_name: string; normalized_company_name: string;
 phone: string; normalized_phone: string; mobile_phone: string; address: string; prefecture: string;
 website_url: string; instagram_url: string; google_maps_url: string; goopit_url: string;
 source: string; existing_master: boolean; call_status: CallStatus; last_call_date: string | null;
 call_memo: string; is_do_not_call: boolean; created_at: string; updated_at: string;
}
export interface Signal {
 id: string; company_id: string; signal_type: SignalType; title: string; description: string;
 detected_at: string; source_url: string; before_value: string; after_value: string; score: number;
 ai_summary: string; recommended_talk: string; status: 'active' | 'archived'; created_at: string;
}
export interface Snapshot { id: string; company_id: string; source_type: string; source_url: string; captured_at: string; content_hash: string; raw_text: string; structured_data: Record<string, unknown>; created_at: string; }
export interface Database { companies: Company[]; signals: Signal[]; snapshots: Snapshot[]; }

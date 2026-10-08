-- phone_candidates is added only by 202610070002_import_safety.sql.
-- The other three migrations do not add it; 05_finalize_access.sql adds no columns.
-- Apply order is correct; already-exists alone does not prove the whole migration completed.
-- Resume STEP2.8 safely, then finalize permissions. No data deletion/column dropping.
rollback; -- End any failed SQL Editor transaction first.
begin;
do $$
begin
 if to_regclass('public.companies') is null
 or to_regclass('public.company_import_records') is null
 or to_regprocedure('public.search_companies(text,text,text,integer,integer)') is null
 or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='closure_state')
 then raise exception 'STEP1 / STEP2 / import_quality prerequisites missing. No changes applied.';end if;
end $$;
alter table public.companies
 add column if not exists phone_candidates jsonb not null default '[]'::jsonb check(jsonb_typeof(phone_candidates)='array'),
 add column if not exists raw_last_call_date text not null default '',
 add column if not exists import_metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(import_metadata)='object');
create table if not exists public.import_metadata (
 file_hash text not null,source_file text not null,source_sheet text not null,source_row integer not null,
 kind text not null check(kind in ('ban_start','ban_end','header','annotation')),
 raw_cells jsonb not null check(jsonb_typeof(raw_cells)='array'),
 primary key(file_hash,source_sheet,source_row)
);
-- Existing columns/tables are retained. Reject incompatible definitions instead of altering data.
do $$
declare expected record; actual record;
begin
 for expected in select * from (values
 ('companies','phone_candidates','jsonb'),('companies','raw_last_call_date','text'),
 ('companies','import_metadata','jsonb'),('import_metadata','file_hash','text'),
 ('import_metadata','source_file','text'),('import_metadata','source_sheet','text'),
 ('import_metadata','source_row','integer'),('import_metadata','kind','text'),
 ('import_metadata','raw_cells','jsonb')) v(tbl,col,typ)
 loop
  select data_type,is_nullable into actual from information_schema.columns
  where table_schema='public' and table_name=expected.tbl and column_name=expected.col;
  if not found or actual.data_type<>expected.typ or actual.is_nullable<>'NO' then
   raise exception 'Incompatible definition: %.%. No data modified.',expected.tbl,expected.col;
  end if;
 end loop;
 if not exists(select 1 from pg_constraint where conrelid='public.import_metadata'::regclass
 and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (file_hash, source_sheet, source_row)') then
  raise exception 'import_metadata primary key mismatch. No data modified.';
 end if;
end $$;
alter table public.import_metadata enable row level security;
revoke all on public.import_metadata from public,anon,authenticated;
grant all on public.import_metadata to service_role;
create or replace function public.set_sales_eligibility() returns trigger language plpgsql set search_path=public as $$
begin
 if jsonb_array_length(coalesce(new.import_metadata->'ban_origins','[]'::jsonb))>0 then new.is_do_not_call=true;end if;
 new.eligible_for_sales=not(new.is_do_not_call or new.is_closed or new.call_status in ('営業禁止','コール禁止','成約済み','閉業','廃業') or new.closure_state in ('pending','confirmed') or jsonb_array_length(coalesce(new.import_metadata->'quality_warnings','[]'::jsonb))>0);
 new.exclusion_reason=case when new.is_do_not_call then '営業禁止' when new.call_status in ('営業禁止','コール禁止','成約済み','閉業','廃業') then new.call_status when new.is_closed or new.closure_state='confirmed' then '閉業・廃業' when new.closure_state='pending' then '閉業・廃業の確認待ち' when jsonb_array_length(coalesce(new.import_metadata->'quality_warnings','[]'::jsonb))>0 then '取込列の確認待ち' else '' end;
 return new;
end $$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.companies'::regclass
 and tgname='companies_sales_eligibility' and not tgisinternal) then
  create trigger companies_sales_eligibility before insert or update on public.companies
  for each row execute function public.set_sales_eligibility();
 end if;
end $$;
create or replace function public.import_company_batch(p_run_id uuid,p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path=public,extensions as $$
declare
 r jsonb; results jsonb='[]'; outcome jsonb; ids uuid[]; matched_id uuid; match_kind text; reason text;
 old public.companies%rowtype; prior public.company_import_records%rowtype;
 phones text[]; newer boolean; incoming_status text; incoming_date date; was_excluded boolean;count_excluded boolean;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>250 then raise exception 'batch must be an array of at most 250 rows'; end if;
 if jsonb_array_length(p_rows)=0 then return '[]'::jsonb; end if;
 if not exists(select 1 from public.import_runs where id=p_run_id) then raise exception 'import run not registered'; end if;
 perform pg_advisory_xact_lock(867520260006::bigint);
 perform set_config('pg_trgm.similarity_threshold','0.8',true);
 for r in select value from jsonb_array_elements(p_rows) loop
  outcome=null;matched_id=null;ids='{}';match_kind='new';reason='';was_excluded=false;count_excluded=false;
  select o.outcome into outcome from public.import_outcomes o where o.run_id=p_run_id and o.source_sheet=r->>'source_sheet' and o.source_row=(r->>'source_row')::integer;
  if outcome is not null then results=results||jsonb_build_array(outcome);continue;end if;
  begin
   if r ? 'parse_error' then raise exception '%',r->>'parse_error';end if;
   if coalesce(r->>'normalized_company_name','')='' or length(r->>'company_name')>1000 then raise exception '会社名が空または長すぎます';end if;
   phones=array(select jsonb_array_elements_text(r->'normalized_phones'));
   select * into prior from public.company_import_records where file_hash=r->>'file_hash' and source_sheet=r->>'source_sheet' and source_row=(r->>'source_row')::integer;
   if prior.id is not null and prior.row_hash<>r->>'row_hash' then raise exception '同じ元行の列設定・解析結果が変更されています。既存履歴を確認してください';end if;
   if prior.id is null and coalesce((r->>'is_do_not_call')::boolean,false) then
    update public.companies set is_do_not_call=true where normalized_phones && phones or (normalized_phone<>'' and normalized_phone=any(phones));
   end if;
   if prior.company_id is not null then matched_id=prior.company_id;match_kind='existing';
   else
    select array_agg(id order by id) into ids from public.companies where normalized_phones && phones or (normalized_phone<>'' and normalized_phone=any(phones));
    if cardinality(ids)=1 then matched_id=ids[1];match_kind='existing';reason='電話番号完全一致';
    elsif cardinality(ids)>1 then match_kind='duplicate_candidate';reason='電話番号が複数会社に一致';
    else
     select array_agg(id order by id) into ids from public.companies where normalized_company_name=r->>'normalized_company_name' and ((coalesce(r->>'prefecture','')<>'' and prefecture=r->>'prefecture') or (coalesce(r->>'normalized_address','')<>'' and normalized_address=r->>'normalized_address'));
     if cardinality(ids)=1 then
      select * into old from public.companies where id=ids[1];
      if cardinality(phones)>0 and cardinality(old.normalized_phones)>0 and not(old.normalized_phones && phones) then match_kind='duplicate_candidate';reason='会社名・所在地一致だが電話番号が異なる';
      else matched_id=ids[1];match_kind='existing';reason='会社名・所在地一致';end if;
     elsif cardinality(ids)>1 then match_kind='duplicate_candidate';reason='会社名・所在地が複数会社に一致';
     else
      select array_agg(id) into ids from (select id from public.companies where normalized_company_name=r->>'normalized_company_name' or (normalized_company_name % (r->>'normalized_company_name') and similarity(normalized_company_name,r->>'normalized_company_name')>=0.85) order by similarity(normalized_company_name,r->>'normalized_company_name') desc,id limit 10) candidates;
      if cardinality(ids)>0 then match_kind='duplicate_candidate';reason='会社名の類似候補。自動統合しません';end if;
     end if;
    end if;
   end if;
   incoming_status=r->>'call_status';incoming_date=nullif(r->>'last_call_date','')::date;
   if match_kind='new' then
    insert into public.companies(company_name,normalized_company_name,phone,normalized_phone,normalized_phones,mobile_phone,address,normalized_address,prefecture,website_url,instagram_url,source,existing_master,call_status,last_call_date,call_memo,is_do_not_call,is_closed,source_file,source_sheet,source_row,raw_company_name,raw_phone,raw_status,raw_memo,raw_history,raw_website_url,imported_urls,mobile_candidates,closure_state,closure_reason,phone_candidates,raw_last_call_date,import_metadata)
    values(r->>'company_name',r->>'normalized_company_name',r->>'phone',r->>'normalized_phone',phones,r->>'mobile_phone',r->>'address',r->>'normalized_address',r->>'prefecture',r->>'website_url',r->>'instagram_url','national_master',true,incoming_status,incoming_date,r->>'call_memo',(r->>'is_do_not_call')::boolean,(r->>'is_closed')::boolean,r->>'source_file',r->>'source_sheet',(r->>'source_row')::integer,r->>'raw_company_name',r->>'raw_phone',r->>'raw_status',r->>'raw_memo',r->>'raw_history',coalesce(r->>'raw_website_url',''),coalesce(r->'imported_urls','[]'::jsonb),coalesce(r->'mobile_candidates','[]'::jsonb),coalesce(r->>'closure_state','normal'),coalesce(r->>'closure_reason',''),coalesce(r->'phone_candidates','[]'::jsonb),coalesce(r->>'raw_last_call_date',''),coalesce(r->'import_metadata','{}'::jsonb)) returning id,not eligible_for_sales into matched_id,was_excluded;
   elsif match_kind='existing' then
    select * into old from public.companies where id=matched_id for update;
    if prior.company_id is null then
     newer=old.last_call_date is null or (incoming_date is not null and incoming_date>=old.last_call_date);
     update public.companies set
      normalized_phones=array(select distinct unnest(old.normalized_phones||phones)),
      phone=case when old.phone='' then r->>'phone' else old.phone end,
      normalized_phone=case when old.normalized_phone='' then r->>'normalized_phone' else old.normalized_phone end,
      mobile_phone=case when old.mobile_phone='' then r->>'mobile_phone' else old.mobile_phone end,
      address=case when old.address='' then r->>'address' else old.address end,
      normalized_address=case when old.address='' then r->>'normalized_address' else old.normalized_address end,
      prefecture=case when old.prefecture='' then r->>'prefecture' else old.prefecture end,
      website_url=case when old.website_url='' then r->>'website_url' else old.website_url end,
      instagram_url=case when old.instagram_url='' then r->>'instagram_url' else old.instagram_url end,
      phone_candidates=(select coalesce(jsonb_agg(distinct v),'[]'::jsonb) from jsonb_array_elements(old.phone_candidates||coalesce(r->'phone_candidates','[]'::jsonb)) as t(v)),
      raw_last_call_date=coalesce(r->>'raw_last_call_date',''),
      import_metadata=coalesce(r->'import_metadata','{}'::jsonb),
      raw_website_url=case when coalesce(r->>'raw_website_url','')<>'' then r->>'raw_website_url' else old.raw_website_url end,
      imported_urls=(select coalesce(jsonb_agg(distinct v),'[]'::jsonb) from jsonb_array_elements(old.imported_urls||coalesce(r->'imported_urls','[]'::jsonb)) as t(v)),
      mobile_candidates=(select coalesce(jsonb_agg(distinct v),'[]'::jsonb) from jsonb_array_elements(old.mobile_candidates||coalesce(r->'mobile_candidates','[]'::jsonb)) as t(v)),
      closure_state=case when old.closure_state='confirmed' or r->>'closure_state'='confirmed' then 'confirmed' when old.closure_state='pending' or r->>'closure_state'='pending' then 'pending' else 'normal' end,
      closure_reason=case when coalesce(r->>'closure_reason','')<>'' then r->>'closure_reason' else old.closure_reason end,
      existing_master=true,
      call_status=case when not old.eligible_for_sales then old.call_status when incoming_status in ('営業禁止','コール禁止','成約済み','閉業','廃業') then incoming_status when newer and incoming_status<>'未架電' then incoming_status else old.call_status end,
      last_call_date=greatest(old.last_call_date,incoming_date),
      call_memo=case when newer and coalesce(r->>'call_memo','')<>'' then r->>'call_memo' else old.call_memo end,
      is_do_not_call=old.is_do_not_call or (r->>'is_do_not_call')::boolean,
      is_closed=old.is_closed or (r->>'is_closed')::boolean,
      source_file=r->>'source_file',source_sheet=r->>'source_sheet',source_row=(r->>'source_row')::integer,
      raw_company_name=r->>'raw_company_name',raw_phone=r->>'raw_phone',raw_status=r->>'raw_status',raw_memo=r->>'raw_memo',raw_history=r->>'raw_history'
     where id=matched_id returning not eligible_for_sales into was_excluded;
    else was_excluded=not old.eligible_for_sales;end if;
   else was_excluded=not (r->>'eligible_for_sales')::boolean;
   end if;
   insert into public.company_import_records(company_id,file_hash,source_file,source_sheet,source_row,row_hash,match_kind,candidate_ids,raw_company_name,raw_phone,raw_status,raw_memo,raw_history,raw_data,normalized_data)
   values(matched_id,r->>'file_hash',r->>'source_file',r->>'source_sheet',(r->>'source_row')::integer,r->>'row_hash',match_kind,case when match_kind='duplicate_candidate' then coalesce(ids,'{}') else '{}' end,r->>'raw_company_name',r->>'raw_phone',r->>'raw_status',r->>'raw_memo',r->>'raw_history',r->'raw_data',r)
   on conflict(file_hash,source_sheet,source_row) do update set company_id=excluded.company_id,match_kind=excluded.match_kind,candidate_ids=excluded.candidate_ids;
   if was_excluded and matched_id is not null then
    insert into public.import_excluded_companies(run_id,company_id) values(p_run_id,matched_id) on conflict do nothing;
    count_excluded=found;
   end if;
   outcome=jsonb_build_object('source_sheet',r->>'source_sheet','source_row',(r->>'source_row')::integer,'kind',match_kind,'company_id',matched_id,'candidate_ids',case when match_kind='duplicate_candidate' then coalesce(ids,'{}') else '{}' end,'excluded',was_excluded,'count_excluded',count_excluded,'message',reason);
  exception when others then
   outcome=jsonb_build_object('source_sheet',r->>'source_sheet','source_row',(r->>'source_row')::integer,'kind','error','company_id',null,'candidate_ids','[]'::jsonb,'excluded',false,'message',sqlerrm,'raw_data',r->'raw_data');
  end;
  insert into public.import_outcomes(run_id,source_sheet,source_row,outcome) values(p_run_id,r->>'source_sheet',(r->>'source_row')::integer,outcome);
  results=results||jsonb_build_array(outcome);
 end loop;
 return results;
end $$;
revoke all on function public.import_company_batch(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.import_company_batch(uuid,jsonb) to service_role;



revoke all on public.companies,public.signals,public.snapshots,
 public.import_runs,public.company_import_records,public.import_outcomes,
 public.import_excluded_companies,public.import_metadata from public,anon,authenticated;
revoke all on function public.set_updated_at(),public.set_sales_eligibility(),
 public.import_company_batch(uuid,jsonb),
 public.search_companies(text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.set_updated_at(),public.set_sales_eligibility(),
 public.import_company_batch(uuid,jsonb),
 public.search_companies(text,text,text,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;

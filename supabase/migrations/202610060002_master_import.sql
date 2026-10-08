begin;
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
-- Leave the STEP1 tables and records intact; names alone no longer imply unique identity.
drop index if exists public.companies_normalized_name_unique;
drop index if exists public.companies_normalized_phone_unique;
alter table public.companies
 add column normalized_phones text[] not null default '{}',
 add column normalized_address text not null default '',
 add column eligible_for_sales boolean not null default true,
 add column exclusion_reason text not null default '',
 add column is_closed boolean not null default false,
 add column source_file text not null default '',
 add column source_sheet text not null default '',
 add column source_row integer,
 add column raw_company_name text not null default '',
 add column raw_phone text not null default '',
 add column raw_status text not null default '',
 add column raw_memo text not null default '',
 add column raw_history text not null default '';
alter table public.companies drop constraint companies_call_status_check;
alter table public.companies add constraint companies_call_status_check check(call_status in ('未架電','不在','検討中','NG','成約済み','コール済み','アポ','見込み','代表不在','受付ブロック','再コール予定','留守','不通','営業禁止','コール禁止','閉業','廃業'));
update public.companies set normalized_phones=array_remove(array[nullif(normalized_phone,''),nullif(regexp_replace(mobile_phone,'[^0-9]','','g'),'')],null), normalized_address=lower(regexp_replace(address,'[[:space:][:punct:]]','','g')),raw_company_name=company_name,raw_phone=phone;
create function public.set_sales_eligibility() returns trigger language plpgsql set search_path=public as $$
begin
 new.eligible_for_sales=not(new.is_do_not_call or new.is_closed or new.call_status in ('営業禁止','コール禁止','成約済み','閉業','廃業'));
 new.exclusion_reason=case when new.is_do_not_call then '営業禁止' when new.call_status in ('営業禁止','コール禁止','成約済み','閉業','廃業') then new.call_status when new.is_closed then '閉業・廃業' else '' end;
 return new;
end $$;
create trigger companies_sales_eligibility before insert or update on public.companies for each row execute function public.set_sales_eligibility();
update public.companies set eligible_for_sales=eligible_for_sales;
create index companies_phones_gin on public.companies using gin(normalized_phones);
create index companies_phone_idx on public.companies(normalized_phone);
create index companies_name_pref_idx on public.companies(normalized_company_name,prefecture);
do $$ declare namespace text; begin
 select n.nspname into namespace from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm';
 if namespace not in ('public','extensions') then raise exception 'pg_trgm must be in public or extensions; inspect existing extension settings before migration';end if;
 execute format('grant usage on schema %I to service_role',namespace);
 execute format('create index companies_name_trgm on public.companies using gin(normalized_company_name %I.gin_trgm_ops)',namespace);
end $$;
create index companies_eligible_idx on public.companies(eligible_for_sales);
create table public.import_runs (
 id uuid primary key, source_file text not null, file_hash text not null, status text not null,
 counts jsonb not null default '{}', processed integer not null default 0, duration_ms bigint not null default 0,
 error_message text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.company_import_records (
 id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id),
 file_hash text not null, source_file text not null, source_sheet text not null, source_row integer not null,
 row_hash text not null, match_kind text not null, candidate_ids uuid[] not null default '{}',
 raw_company_name text not null, raw_phone text not null, raw_status text not null, raw_memo text not null, raw_history text not null,
 raw_data jsonb not null, normalized_data jsonb not null, created_at timestamptz not null default now(),
 unique(file_hash,source_sheet,source_row)
);
create index import_records_company_idx on public.company_import_records(company_id,created_at desc);
create table public.import_outcomes (
 run_id uuid not null references public.import_runs(id), source_sheet text not null, source_row integer not null,
 outcome jsonb not null, primary key(run_id,source_sheet,source_row)
);
create table public.import_excluded_companies (run_id uuid not null references public.import_runs(id),company_id uuid not null references public.companies(id),primary key(run_id,company_id));
alter table public.import_excluded_companies enable row level security;
alter table public.import_runs enable row level security;
alter table public.company_import_records enable row level security;
alter table public.import_outcomes enable row level security;
revoke all on public.import_runs,public.company_import_records,public.import_outcomes,public.import_excluded_companies from anon,authenticated;
grant all on public.import_runs,public.company_import_records,public.import_outcomes,public.import_excluded_companies to service_role;

create function public.import_company_batch(p_run_id uuid,p_rows jsonb) returns jsonb
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
    insert into public.companies(company_name,normalized_company_name,phone,normalized_phone,normalized_phones,mobile_phone,address,normalized_address,prefecture,website_url,instagram_url,source,existing_master,call_status,last_call_date,call_memo,is_do_not_call,is_closed,source_file,source_sheet,source_row,raw_company_name,raw_phone,raw_status,raw_memo,raw_history)
    values(r->>'company_name',r->>'normalized_company_name',r->>'phone',r->>'normalized_phone',phones,r->>'mobile_phone',r->>'address',r->>'normalized_address',r->>'prefecture',r->>'website_url',r->>'instagram_url','national_master',true,incoming_status,incoming_date,r->>'call_memo',(r->>'is_do_not_call')::boolean,(r->>'is_closed')::boolean,r->>'source_file',r->>'source_sheet',(r->>'source_row')::integer,r->>'raw_company_name',r->>'raw_phone',r->>'raw_status',r->>'raw_memo',r->>'raw_history') returning id,not eligible_for_sales into matched_id,was_excluded;
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

create function public.search_companies(p_name text default '',p_phone text default '',p_prefecture text default '',p_page integer default 1,p_page_size integer default 100)
returns jsonb language sql stable security invoker set search_path=public,extensions as $$
 with matched as not materialized (
  select * from public.companies c where (p_prefecture='' or c.prefecture=p_prefecture) and
  ((p_name='' and p_phone='') or (p_name<>'' and c.normalized_company_name like '%'||p_name||'%') or
   (p_phone<>'' and (c.normalized_phone like '%'||p_phone||'%' or
    (length(p_phone)>=10 and c.normalized_phones @> array[p_phone]) or
    (length(p_phone)<10 and exists(select 1 from unnest(c.normalized_phones) phone where phone like '%'||p_phone||'%')))))
 ), page_rows as (select * from matched order by company_name,id limit least(greatest(p_page_size,1),100) offset (greatest(p_page,1)-1)*least(greatest(p_page_size,1),100))
 select jsonb_build_object('companies',coalesce((select jsonb_agg(to_jsonb(page_rows)) from page_rows),'[]'::jsonb),'total',(select count(*) from matched));
$$;
revoke all on function public.search_companies(text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.search_companies(text,text,text,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;

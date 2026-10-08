-- Supabase SQL Editor: read-only STEP2 verification. Does not apply migrations.
begin transaction read only;

with expected(table_name) as (values
 ('companies'),('signals'),('snapshots'),('import_runs'),
 ('company_import_records'),('import_outcomes'),('import_excluded_companies'),('import_metadata')
)
select e.table_name, c.oid is not null as exists, c.relrowsecurity as rls_enabled
from expected e left join pg_class c on c.oid=to_regclass('public.'||e.table_name)
order by e.table_name;

with expected(column_name) as (values
 ('normalized_phones'),('normalized_address'),('eligible_for_sales'),('exclusion_reason'),('is_closed'),
 ('source_file'),('source_sheet'),('source_row'),('raw_company_name'),('raw_phone'),
 ('raw_status'),('raw_memo'),('raw_history'),('raw_website_url'),('imported_urls'),
 ('mobile_candidates'),('closure_state'),('closure_reason'),('phone_candidates'),('raw_last_call_date'),('import_metadata')
)
select e.column_name, c.column_name is not null as exists, c.data_type,c.is_nullable,c.column_default
from expected e left join information_schema.columns c
 on c.table_schema='public' and c.table_name='companies' and c.column_name=e.column_name
order by e.column_name;

select tablename,indexname,indexdef from pg_indexes
where schemaname='public' and tablename in
 ('companies','signals','snapshots','import_runs','company_import_records','import_outcomes','import_excluded_companies','import_metadata')
order by tablename,indexname;

select r.relname as table_name,c.conname,c.contype,pg_get_constraintdef(c.oid) as definition
from pg_constraint c join pg_class r on r.oid=c.conrelid
join pg_namespace n on n.oid=r.relnamespace
where n.nspname='public' and r.relname in
 ('companies','signals','snapshots','import_runs','company_import_records','import_outcomes','import_excluded_companies','import_metadata')
order by r.relname,c.conname;

select r.relname as table_name,t.tgname,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class r on r.oid=t.tgrelid
where r.oid=to_regclass('public.companies') and not t.tgisinternal;

select p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosecdef as security_definer,p.proconfig,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('import_company_batch','search_companies','set_updated_at','set_sales_eligibility');

select e.extname,n.nspname as extension_schema,
 has_schema_privilege('service_role',n.oid,'USAGE') as service_role_usage
from pg_extension e join pg_namespace n on n.oid=e.extnamespace
where e.extname in ('pgcrypto','pg_trgm');

commit;

-- STEP2.6: expected five quality columns (read-only).
select column_name,data_type from information_schema.columns
where table_schema='public' and table_name='companies'
and column_name in ('raw_website_url','imported_urls','mobile_candidates','closure_state','closure_reason') order by column_name;
-- Pending closures must never be sales-eligible; expected 0 (run after STEP2.6).
-- select count(*) as unsafe_pending from public.companies where closure_state='pending' and eligible_for_sales;

-- STEP2.8 read-only catalog verification. Expected three columns + one table.
select column_name,data_type from information_schema.columns where table_schema='public' and table_name='companies' and column_name in ('phone_candidates','raw_last_call_date','import_metadata');
select tablename,rowsecurity from pg_tables where schemaname='public' and tablename='import_metadata';

-- Effective table permissions. Expected anon/authenticated: all false.
-- service_role: SELECT/INSERT/UPDATE true; DELETE reflects existing service_role grant.
select c.relname as table_name,role_name,
 has_table_privilege(role_name,c.oid,'SELECT') as can_select,
 has_table_privilege(role_name,c.oid,'INSERT') as can_insert,
 has_table_privilege(role_name,c.oid,'UPDATE') as can_update,
 has_table_privilege(role_name,c.oid,'DELETE') as can_delete
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join (values ('anon'),('authenticated'),('service_role')) roles(role_name)
where n.nspname='public' and c.relname in ('companies','signals','snapshots','import_runs',
 'company_import_records','import_outcomes','import_excluded_companies','import_metadata')
order by c.relname,role_name;
-- No client policies expected. Review any returned rows before proceeding.
select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('companies','signals','snapshots','import_runs',
 'company_import_records','import_outcomes','import_excluded_companies','import_metadata');

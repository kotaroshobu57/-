-- SQL Editor ONLY: apply after all four migrations.
-- No data mutation/deletion. Restrict application access and reload PostgREST cache.
begin;
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

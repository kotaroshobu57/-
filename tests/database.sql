-- Run after the migration against an isolated PostgreSQL/Supabase development DB.
-- All test writes are rolled back.
begin;
do $$
declare company_uuid uuid; snapshot_uuid uuid; begin
 insert into public.companies(company_name, normalized_company_name, phone, normalized_phone)
 values ('DBテスト会社','dbtestcompany','03-1234-9999','0312349999') returning id into company_uuid;
 begin
  insert into public.companies(company_name, normalized_company_name) values ('重複','dbtestcompany');
  raise exception 'duplicate name accepted';
 exception when unique_violation then null; end;
 begin
  insert into public.companies(company_name, normalized_company_name, normalized_phone) values ('別名','anotherdbtest','0312349999');
  raise exception 'duplicate phone accepted';
 exception when unique_violation then null; end;
 begin
  insert into public.signals(company_id,signal_type,title) values (gen_random_uuid(),'job_new','存在しない会社');
  raise exception 'invalid company accepted';
 exception when foreign_key_violation then null; end;
 begin
  insert into public.signals(company_id,signal_type,title) values (company_uuid,'unknown_type','不正種別');
  raise exception 'invalid signal type accepted';
 exception when check_violation then null; end;
 insert into public.signals(company_id,signal_type,title,score) values (company_uuid,'job_new','求人テスト',30);
 insert into public.snapshots(company_id,source_type,content_hash,raw_text,structured_data)
 values (company_uuid,'website','test-hash','テスト原文','{"state":"before"}') returning id into snapshot_uuid;
 if (select structured_data->>'state' from public.snapshots where id=snapshot_uuid) <> 'before' then raise exception 'snapshot not persisted'; end if;
 delete from public.companies where id=company_uuid;
 if exists(select 1 from public.signals where company_id=company_uuid) or exists(select 1 from public.snapshots where company_id=company_uuid) then raise exception 'cascade failed'; end if;
end $$;
set local role anon;
do $$ begin
 begin
  perform 1 from public.companies;
  raise exception 'anon access allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;

create extension if not exists pgcrypto;
create table public.companies (
 id uuid primary key default gen_random_uuid(), company_name text not null check(length(trim(company_name))>0), normalized_company_name text not null,
 phone text not null default '', normalized_phone text not null default '', mobile_phone text not null default '', address text not null default '', prefecture text not null default '',
 website_url text not null default '', instagram_url text not null default '', google_maps_url text not null default '', goopit_url text not null default '', source text not null default 'manual',
 existing_master boolean not null default false, call_status text not null default '未架電' check(call_status in ('未架電','不在','検討中','NG','成約済み')), last_call_date date, call_memo text not null default '', is_do_not_call boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index companies_normalized_name_unique on public.companies(normalized_company_name) where normalized_company_name <> '';
create unique index companies_normalized_phone_unique on public.companies(normalized_phone) where normalized_phone <> '';
create index companies_prefecture_idx on public.companies(prefecture);
create table public.signals (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 signal_type text not null check(signal_type in ('job_new','job_updated','new_store','relocation','new_factory','goopit_new','goopit_activity','website_update')),
 title text not null check(length(trim(title))>0), description text not null default '', detected_at timestamptz not null default now(), source_url text not null default '',
 before_value text not null default '', after_value text not null default '', score integer not null default 0,
 ai_summary text not null default '', recommended_talk text not null default '', status text not null default 'active' check(status in ('active','archived')), created_at timestamptz not null default now()
);
create index signals_company_detected_idx on public.signals(company_id,detected_at desc);
create table public.snapshots (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 source_type text not null, source_url text not null default '', captured_at timestamptz not null default now(), content_hash text not null,
 raw_text text not null default '', structured_data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index snapshots_company_source_idx on public.snapshots(company_id,source_type,captured_at desc);
create function public.set_updated_at() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at=now(); return new; end; $$;
create trigger companies_updated_at before update on public.companies for each row execute function public.set_updated_at();
alter table public.companies enable row level security;
alter table public.signals enable row level security;
alter table public.snapshots enable row level security;
revoke all on public.companies, public.signals, public.snapshots from anon, authenticated;
grant all on public.companies, public.signals, public.snapshots to service_role;

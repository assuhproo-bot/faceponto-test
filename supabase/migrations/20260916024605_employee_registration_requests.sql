create table public.employee_registration_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check (length(trim(name)) between 1 and 160),
  registration text check (registration is null or length(trim(registration)) between 1 and 40),
  contact text check (contact is null or length(trim(contact)) between 1 and 160),
  note text check (note is null or length(trim(note)) between 1 and 500),
  status text not null default 'pending' check (status in ('pending','reviewed','declined')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  check ((status = 'pending' and reviewed_at is null and reviewed_by is null) or status in ('reviewed','declined'))
);

create index employee_registration_requests_company_status_idx
  on public.employee_registration_requests(company_id, status, created_at desc);

alter table public.employee_registration_requests enable row level security;
revoke all on table public.employee_registration_requests from public, anon, authenticated;
grant select, update(status, reviewed_at, reviewed_by) on table public.employee_registration_requests to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.employee_registration_requests to postgres;
grant maintain, references, trigger, truncate on table public.employee_registration_requests to service_role;

create policy "registration_requests_read" on public.employee_registration_requests for select to authenticated
  using(private.can_manage(company_id));

create policy "registration_requests_review" on public.employee_registration_requests for update to authenticated
  using(private.can_manage(company_id))
  with check(private.can_manage(company_id));

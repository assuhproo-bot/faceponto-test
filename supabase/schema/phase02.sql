-- Working schema for phase 02. Apply locally with db query; migration generated after verification.
begin;
set local search_path = public, extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create extension if not exists btree_gist with schema extensions;

create type public.member_role as enum ('administrator', 'manager', 'hr', 'operator');
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  timezone text not null default 'America/Fortaleza',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.users (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(trim(display_name)) between 1 and 160),
  created_at timestamptz not null default now()
);
create table public.company_memberships (
  company_id uuid not null references public.companies(id),
  user_id uuid not null references auth.users(id),
  role public.member_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index memberships_user_idx on public.company_memberships(user_id, company_id) where active;
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check (length(trim(name)) between 1 and 160),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id, id), unique(company_id, name)
);
create table public.member_locations (
  company_id uuid not null,
  user_id uuid not null,
  location_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(company_id, user_id, location_id),
  foreign key(company_id, user_id) references public.company_memberships(company_id, user_id),
  foreign key(company_id, location_id) references public.locations(company_id, id)
);
create index member_locations_location_idx on public.member_locations(company_id, location_id);
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check(length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique(company_id, id), unique(company_id, name)
);
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  registration text not null check(length(trim(registration)) between 1 and 40),
  name text not null check(length(trim(name)) between 1 and 160),
  job_title text not null default '',
  department_id uuid,
  home_location_id uuid not null,
  active boolean not null default true,
  version integer not null default 1 check(version > 0),
  created_at timestamptz not null default now(),
  unique(company_id, id), unique(company_id, registration),
  foreign key(company_id, department_id) references public.departments(company_id, id),
  foreign key(company_id, home_location_id) references public.locations(company_id, id)
);
create index employees_location_idx on public.employees(company_id, home_location_id);
create index employees_department_idx on public.employees(company_id, department_id);
-- Optional CPF is isolated from the ordinary employee listing, even within a tenant.
create table private.employee_documents (
  company_id uuid not null,
  employee_id uuid not null,
  cpf_ciphertext bytea not null,
  key_version integer not null check(key_version > 0),
  created_at timestamptz not null default now(),
  primary key(company_id, employee_id),
  foreign key(company_id, employee_id) references public.employees(company_id, id)
);
create table public.employee_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  location_id uuid not null,
  valid_from timestamptz not null,
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  check(valid_to is null or valid_to > valid_from),
  foreign key(company_id, employee_id) references public.employees(company_id, id),
  foreign key(company_id, location_id) references public.locations(company_id, id),
  exclude using gist (company_id with =, employee_id with =, location_id with =,
    tstzrange(valid_from, valid_to, '[)') with &&)
);
create index employee_locations_employee_idx on public.employee_locations(company_id, employee_id);
create index employee_locations_location_idx on public.employee_locations(company_id, location_id);
create table public.terminals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  location_id uuid not null,
  auth_user_id uuid unique references auth.users(id),
  code text not null check(length(trim(code)) between 1 and 40),
  name text not null check(length(trim(name)) between 1 and 160),
  active boolean not null default true,
  last_heartbeat_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id, id), unique(company_id, code),
  foreign key(company_id, location_id) references public.locations(company_id, id)
);
create index terminals_location_idx on public.terminals(company_id, location_id);
create table public.terminal_location_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  terminal_id uuid not null,
  location_id uuid not null,
  version integer not null check(version > 0),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id, id), unique(company_id, terminal_id, version),
  check(valid_to is null or valid_to > valid_from),
  foreign key(company_id, terminal_id) references public.terminals(company_id, id),
  foreign key(company_id, location_id) references public.locations(company_id, id),
  exclude using gist(company_id with =, terminal_id with =, tstzrange(valid_from, valid_to, '[)') with &&)
);
create index terminal_assignments_location_idx on public.terminal_location_assignments(company_id, location_id);
create table public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check(length(trim(name)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id, id), unique(company_id, name)
);
create table public.schedule_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  schedule_id uuid not null,
  version integer not null check(version > 0),
  timezone text not null default 'America/Fortaleza',
  rules jsonb not null default '{"late_tolerance_minutes":0,"overtime_tolerance_minutes":0,"missing_punch_grace_minutes":60}',
  created_at timestamptz not null default now(),
  unique(company_id, id), unique(company_id, schedule_id, version),
  check(jsonb_typeof(rules) = 'object'),
  check(rules ?& array['late_tolerance_minutes','overtime_tolerance_minutes','missing_punch_grace_minutes']),
  check(jsonb_typeof(rules->'late_tolerance_minutes') = 'number' and (rules->>'late_tolerance_minutes') ~ '^[0-9]{1,4}$'),
  check(jsonb_typeof(rules->'overtime_tolerance_minutes') = 'number' and (rules->>'overtime_tolerance_minutes') ~ '^[0-9]{1,4}$'),
  check(jsonb_typeof(rules->'missing_punch_grace_minutes') = 'number' and (rules->>'missing_punch_grace_minutes') ~ '^[0-9]{1,4}$'),
  foreign key(company_id, schedule_id) references public.work_schedules(company_id, id)
);
create table public.schedule_weekdays (
  company_id uuid not null,
  schedule_version_id uuid not null,
  iso_weekday smallint not null check(iso_weekday between 1 and 7),
  created_at timestamptz not null default now(),
  primary key(company_id, schedule_version_id, iso_weekday),
  foreign key(company_id, schedule_version_id) references public.schedule_versions(company_id, id)
);
create table public.schedule_segments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  schedule_version_id uuid not null,
  ordinal smallint not null check(ordinal between 1 and 12),
  start_minute integer not null check(start_minute >= 0 and start_minute < 2880),
  end_minute integer not null check(end_minute > 0 and end_minute <= 2880),
  created_at timestamptz not null default now(),
  check(end_minute > start_minute),
  unique(company_id, schedule_version_id, ordinal),
  foreign key(company_id, schedule_version_id) references public.schedule_versions(company_id, id),
  exclude using gist(company_id with =, schedule_version_id with =,
    int4range(start_minute, end_minute, '[)') with &&)
);
create table public.schedule_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  schedule_version_id uuid not null,
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  check(valid_to is null or valid_to > valid_from),
  foreign key(company_id, employee_id) references public.employees(company_id, id),
  foreign key(company_id, schedule_version_id) references public.schedule_versions(company_id, id),
  exclude using gist(company_id with =, employee_id with =, daterange(valid_from, valid_to, '[)') with &&)
);
create index schedule_assignments_employee_idx on public.schedule_assignments(company_id, employee_id);
create index schedule_assignments_version_idx on public.schedule_assignments(company_id, schedule_version_id);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_company_time_idx on public.audit_logs(company_id, created_at desc);

-- Authorization lookups in an unexposed schema avoid recursive membership policies.
create function private.company_role(p_company uuid)
returns public.member_role language sql stable security definer set search_path = '' as $$
  select m.role from public.company_memberships m
  join public.companies c on c.id = m.company_id and c.active
  join auth.users u on u.id = m.user_id and u.deleted_at is null
  where (select auth.uid()) is not null and m.user_id = (select auth.uid())
    and m.company_id = p_company and m.active
$$;
create function private.can_manage(p_company uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(private.company_role(p_company) in ('administrator','hr'), false)
$$;
create function private.can_access_location(p_company uuid, p_location uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    private.can_manage(p_company) or (
      private.company_role(p_company) = 'manager' and exists (
        select 1 from public.member_locations ml where ml.company_id = p_company
          and ml.location_id = p_location and ml.user_id = (select auth.uid())
      )
    )
  )
$$;
create function private.can_access_employee(p_company uuid, p_employee uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.employees e where e.company_id = p_company and e.id = p_employee
      and private.can_access_location(e.company_id, e.home_location_id)
  )
$$;
create function private.audit_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data jsonb; prior jsonb;
begin
  -- Trigger only: caller cannot invoke it as a regular function or set the author.
  row_data := to_jsonb(new);
  if tg_op = 'UPDATE' then prior := to_jsonb(old); end if;
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (case when tg_table_name = 'companies' then (row_data->>'id')::uuid else (row_data->>'company_id')::uuid end,
    auth.uid(), tg_op, tg_table_name,
    coalesce(row_data->>'id', row_data->>'user_id', row_data->>'schedule_version_id'),
    prior - 'auth_user_id', row_data - 'auth_user_id');
  return new;
end $$;
create function private.guard_record()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Records cannot be deleted' using errcode = '42501'; end if;
  if (to_jsonb(old)->'id') is distinct from (to_jsonb(new)->'id')
    or (to_jsonb(old)->'company_id') is distinct from (to_jsonb(new)->'company_id')
    or old.created_at is distinct from new.created_at then
    raise exception 'Record identity is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create function private.validate_timezone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown IANA timezone' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger company_timezone before insert or update on public.companies
for each row execute function private.validate_timezone();
create trigger schedule_timezone before insert or update on public.schedule_versions
for each row execute function private.validate_timezone();

-- The elevated operation is private; the Data API wrapper runs as its caller.
create function private.create_company(p_name text, p_display_name text, p_timezone text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); result uuid;
begin
  if caller is null or not exists(select 1 from auth.users where id = caller and deleted_at is null and not is_anonymous)
    or exists(select 1 from public.terminals where auth_user_id = caller) then
    raise exception 'Administrative identity required' using errcode = '42501';
  end if;
  insert into public.users(id, display_name) values(caller, p_display_name) on conflict(id) do nothing;
  insert into public.companies(name, timezone) values(p_name, p_timezone) returning id into result;
  insert into public.company_memberships(company_id, user_id, role) values(result, caller, 'administrator');
  return result;
end $$;
create function public.create_company(p_name text, p_display_name text, p_timezone text default 'America/Fortaleza')
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_company(p_name, p_display_name, p_timezone)
$$;

create function private.register_terminal(p_company uuid, p_location uuid, p_code text, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if auth.uid() is null or private.company_role(p_company) is distinct from 'administrator' then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if not exists(select 1 from public.locations where company_id=p_company and id=p_location and active) then
    raise exception 'Active company location required' using errcode = '23514';
  end if;
  insert into public.terminals(company_id,location_id,code,name)
    values(p_company,p_location,p_code,p_name) returning id into result;
  insert into public.terminal_location_assignments(company_id,terminal_id,location_id,version)
    values(p_company,result,p_location,1);
  return result;
end $$;
create function public.register_terminal(p_company uuid, p_location uuid, p_code text, p_name text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.register_terminal(p_company,p_location,p_code,p_name)
$$;

-- RLS and grants are separate. Deny first, then opt in to specific operations.
do $$
declare t text;
begin
  foreach t in array array['companies','users','company_memberships','locations','member_locations',
    'departments','employees','employee_locations','terminals','terminal_location_assignments',
    'work_schedules','schedule_versions','schedule_weekdays','schedule_segments','schedule_assignments','audit_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    if t not in ('users','audit_logs') then
      execute format('create trigger audit_change after insert or update on public.%I for each row execute function private.audit_change()', t);
      execute format('create trigger guard_record before update or delete on public.%I for each row execute function private.guard_record()', t);
    end if;
  end loop;
end $$;
alter table private.employee_documents enable row level security;
revoke all on private.employee_documents from public, anon, authenticated;
create policy employee_documents_deny_clients on private.employee_documents
for all to anon, authenticated using(false) with check(false);
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.company_role(uuid), private.can_manage(uuid),
  private.can_access_location(uuid,uuid), private.can_access_employee(uuid,uuid),
  private.create_company(text,text,text), private.register_terminal(uuid,uuid,text,text) to authenticated;
revoke all on function public.create_company(text,text,text) from public, anon;
grant execute on function public.create_company(text,text,text) to authenticated;
revoke all on function public.register_terminal(uuid,uuid,text,text) from public, anon;
grant execute on function public.register_terminal(uuid,uuid,text,text) to authenticated;

create policy companies_read on public.companies for select to authenticated
using (private.company_role(id) is not null);
create policy companies_update on public.companies for update to authenticated
using(private.company_role(id) = 'administrator') with check(private.company_role(id) = 'administrator');
grant update(name, timezone) on public.companies to authenticated;
create policy users_self on public.users for select to authenticated using(id = (select auth.uid()));
create policy memberships_read on public.company_memberships for select to authenticated
using (private.company_role(company_id) = 'administrator' or (user_id = (select auth.uid()) and active and private.company_role(company_id) is not null));
-- Membership mutation is reserved for an audited administration RPC in phase 03.
create policy member_locations_read on public.member_locations for select to authenticated
using (private.company_role(company_id) = 'administrator' or (user_id = (select auth.uid()) and private.company_role(company_id) is not null));

create policy locations_read on public.locations for select to authenticated
using (private.can_access_location(company_id,id) or private.company_role(company_id) = 'operator');
create policy departments_read on public.departments for select to authenticated
using (private.company_role(company_id) in ('administrator','hr','manager'));
create policy employees_read on public.employees for select to authenticated
using (private.can_access_location(company_id,home_location_id));
create policy employees_insert on public.employees for insert to authenticated
with check(private.can_access_location(company_id,home_location_id));
create policy employees_update on public.employees for update to authenticated
using(private.can_access_location(company_id,home_location_id))
with check(private.can_access_location(company_id,home_location_id));
grant insert(company_id,registration,name,job_title,department_id,home_location_id),
  update(registration,name,job_title,department_id,home_location_id,active) on public.employees to authenticated;
create function private.bump_employee_version() returns trigger language plpgsql set search_path = '' as $$
begin new.version := old.version + 1; return new; end $$;
revoke all on function private.bump_employee_version() from public, anon, authenticated;
create trigger employee_version before update on public.employees for each row execute function private.bump_employee_version();

create policy employee_locations_read on public.employee_locations for select to authenticated
using(private.can_access_employee(company_id,employee_id));
create policy terminals_read on public.terminals for select to authenticated
using(private.can_access_location(company_id,location_id) or private.company_role(company_id) = 'operator');
create policy terminals_update on public.terminals for update to authenticated
using(private.company_role(company_id) = 'administrator') with check(private.company_role(company_id) = 'administrator');
grant update(name,active) on public.terminals to authenticated;
create policy terminal_assignments_read on public.terminal_location_assignments for select to authenticated
using(private.can_access_location(company_id,location_id) or private.company_role(company_id) = 'operator');
create policy audit_logs_read on public.audit_logs for select to authenticated using(private.can_manage(company_id));

do $$
declare t text;
begin
  foreach t in array array['work_schedules','schedule_versions','schedule_weekdays','schedule_segments'] loop
    execute format('create policy tenant_read on public.%I for select to authenticated using(private.company_role(company_id) in (''administrator'',''hr'',''manager''))',t);
  end loop;
  foreach t in array array['locations','departments','employee_locations','work_schedules','schedule_versions','schedule_weekdays','schedule_segments','schedule_assignments'] loop
    execute format('create policy managed_insert on public.%I for insert to authenticated with check(private.can_manage(company_id))',t);
  end loop;
  foreach t in array array['locations','departments','work_schedules'] loop
    execute format('grant update(name) on public.%I to authenticated',t);
    execute format('create policy managed_update on public.%I for update to authenticated using(private.can_manage(company_id)) with check(private.can_manage(company_id))',t);
  end loop;
end $$;
grant insert(company_id,name,active) on public.locations, public.work_schedules to authenticated;
grant insert(company_id,name) on public.departments to authenticated;
grant insert(company_id,employee_id,location_id,valid_from,valid_to) on public.employee_locations to authenticated;
grant insert(company_id,schedule_id,version,timezone,rules) on public.schedule_versions to authenticated;
grant insert(company_id,schedule_version_id,iso_weekday) on public.schedule_weekdays to authenticated;
grant insert(company_id,schedule_version_id,ordinal,start_minute,end_minute) on public.schedule_segments to authenticated;
grant insert(company_id,employee_id,schedule_version_id,valid_from,valid_to) on public.schedule_assignments to authenticated;
grant update(active) on public.locations, public.work_schedules to authenticated;
create policy schedule_assignments_read on public.schedule_assignments for select to authenticated
using(private.can_access_employee(company_id,employee_id));

-- A published schedule (one that has an assignment) cannot gain new segments/days.
create function private.guard_schedule_definition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null and current_setting('role',true) = 'authenticated' then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  perform 1 from public.schedule_versions where company_id=new.company_id and id=new.schedule_version_id for update;
  if exists(select 1 from public.schedule_assignments where company_id=new.company_id and schedule_version_id=new.schedule_version_id) then
    raise exception 'Assigned schedule definition is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create function private.validate_schedule_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null and current_setting('role',true) = 'authenticated' then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  perform 1 from public.schedule_versions where company_id=new.company_id and id=new.schedule_version_id for update;
  if not exists(select 1 from public.schedule_segments where company_id=new.company_id and schedule_version_id=new.schedule_version_id)
    or not exists(select 1 from public.schedule_weekdays where company_id=new.company_id and schedule_version_id=new.schedule_version_id) then
    raise exception 'Schedule needs segments and weekdays' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_schedule_definition(), private.validate_schedule_assignment() from public, anon, authenticated;
create trigger schedule_segments_immutable before insert on public.schedule_segments for each row execute function private.guard_schedule_definition();
create trigger schedule_weekdays_immutable before insert on public.schedule_weekdays for each row execute function private.guard_schedule_definition();
create trigger schedule_assignment_complete before insert on public.schedule_assignments for each row execute function private.validate_schedule_assignment();
commit;

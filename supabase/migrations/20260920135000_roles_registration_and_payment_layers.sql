-- Cargos, matrícula automática e camadas de valores.
--
-- Esta migração mantém os registros existentes: cargos não são apagados,
-- matrículas legadas em texto permanecem válidas e valores individuais
-- anteriores continuam exclusivos quando essa era a escolha do gestor.

alter table public.departments
  add column if not exists active boolean not null default true,
  add column if not exists version integer not null default 1 check (version > 0),
  add column if not exists updated_at timestamptz not null default now();

create or replace function private.bump_department_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.name is distinct from old.name or new.active is distinct from old.active then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists department_version on public.departments;
create trigger department_version
before update on public.departments
for each row
execute function private.bump_department_version();

create table if not exists private.employee_registration_counters (
  company_id uuid primary key references public.companies(id) on delete cascade,
  next_registration bigint not null check (next_registration > 0)
);

create or replace function private.seed_company_people_defaults(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.departments(company_id, name)
  values
    (p_company, 'Administrativo'),
    (p_company, 'Chapa')
  on conflict (company_id, name) do nothing;

  insert into private.employee_registration_counters(company_id, next_registration)
  select
    p_company,
    greatest(
      1::bigint,
      coalesce(max(e.registration::bigint) filter (where e.registration ~ '^[0-9]{1,18}$'), 0::bigint) + 1
    )
  from public.employees e
  where e.company_id = p_company
  on conflict (company_id) do update
    set next_registration = greatest(
      private.employee_registration_counters.next_registration,
      excluded.next_registration
    );
end
$$;

create or replace function private.seed_company_people_defaults_on_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.seed_company_people_defaults(new.id);
  return new;
end
$$;

drop trigger if exists company_people_defaults on public.companies;
create trigger company_people_defaults
after insert on public.companies
for each row
execute function private.seed_company_people_defaults_on_insert();

select private.seed_company_people_defaults(id)
from public.companies;

create or replace function private.sync_employee_registration_counter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next bigint;
begin
  if new.registration ~ '^[0-9]{1,18}$' then
    v_next := new.registration::bigint + 1;
    insert into private.employee_registration_counters(company_id, next_registration)
    values(new.company_id, v_next)
    on conflict (company_id) do update
      set next_registration = greatest(
        private.employee_registration_counters.next_registration,
        excluded.next_registration
      );
  end if;
  return new;
end
$$;

drop trigger if exists employee_registration_counter_sync on public.employees;
create trigger employee_registration_counter_sync
after insert or update of registration on public.employees
for each row
execute function private.sync_employee_registration_counter();

create or replace function private.validate_employee_department_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.department_id is not null
    and (tg_op = 'INSERT' or new.department_id is distinct from old.department_id)
    and not exists (
      select 1
      from public.departments
      where company_id = new.company_id
        and id = new.department_id
        and active
    ) then
    raise exception 'Active department not found' using errcode = '23503';
  end if;
  return new;
end
$$;

drop trigger if exists employee_department_assignment on public.employees;
create trigger employee_department_assignment
before insert or update of department_id on public.employees
for each row
execute function private.validate_employee_department_assignment();

create or replace function private.create_employee_with_registration(
  p_company uuid,
  p_registration text,
  p_name text,
  p_job_title text,
  p_department uuid,
  p_home_location uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registration text;
  v_next bigint;
  v_manual bigint;
  saved public.employees;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 160 then
    raise exception 'Invalid employee name' using errcode = '23514';
  end if;
  if p_job_title is not null and length(btrim(p_job_title)) > 160 then
    raise exception 'Invalid job title' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.companies
    where id = p_company and active
  ) then
    raise exception 'Company not found' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.locations
    where company_id = p_company and id = p_home_location and active
  ) then
    raise exception 'Active home location not found' using errcode = '23503';
  end if;
  if p_department is not null and not exists (
    select 1 from public.departments
    where company_id = p_company and id = p_department and active
  ) then
    raise exception 'Active department not found' using errcode = '23503';
  end if;

  v_registration := nullif(btrim(p_registration), '');
  if v_registration is not null and length(v_registration) > 40 then
    raise exception 'Invalid registration' using errcode = '23514';
  end if;

  perform private.seed_company_people_defaults(p_company);
  select next_registration into v_next
  from private.employee_registration_counters
  where company_id = p_company
  for update;

  if v_registration is null then
    if v_next >= 9223372036854775807 then
      raise exception 'Registration counter exhausted' using errcode = '22003';
    end if;
    v_registration := v_next::text;
    update private.employee_registration_counters
      set next_registration = v_next + 1
      where company_id = p_company;
  elsif v_registration ~ '^[0-9]{1,18}$' then
    v_manual := v_registration::bigint;
    if v_manual >= v_next then
      if v_manual >= 9223372036854775806 then
        raise exception 'Registration counter exhausted' using errcode = '22003';
      end if;
      update private.employee_registration_counters
        set next_registration = v_manual + 1
        where company_id = p_company;
    end if;
  end if;

  insert into public.employees(
    company_id, registration, name, job_title, department_id, home_location_id
  )
  values(
    p_company, v_registration, btrim(p_name), coalesce(btrim(p_job_title), ''),
    p_department, p_home_location
  )
  returning * into saved;

  return jsonb_build_object(
    'id', saved.id,
    'company_id', saved.company_id,
    'registration', saved.registration,
    'name', saved.name,
    'job_title', saved.job_title,
    'department_id', saved.department_id,
    'home_location_id', saved.home_location_id,
    'active', saved.active,
    'version', saved.version,
    'created_at', saved.created_at
  );
end
$$;

create or replace function public.create_employee_with_registration(
  p_company uuid,
  p_registration text,
  p_name text,
  p_job_title text,
  p_department uuid,
  p_home_location uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.create_employee_with_registration(
    p_company, p_registration, p_name, p_job_title, p_department, p_home_location
  )
$$;

create or replace function private.create_department(
  p_company uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.departments;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120 then
    raise exception 'Invalid department name' using errcode = '23514';
  end if;
  insert into public.departments(company_id, name)
  values(p_company, btrim(p_name))
  returning * into saved;
  return jsonb_build_object(
    'id', saved.id,
    'company_id', saved.company_id,
    'name', saved.name,
    'active', saved.active,
    'version', saved.version,
    'created_at', saved.created_at,
    'updated_at', saved.updated_at
  );
end
$$;

create or replace function public.create_department(
  p_company uuid,
  p_name text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.create_department(p_company, p_name)
$$;

create or replace function private.update_department(
  p_company uuid,
  p_department uuid,
  p_expected_version integer,
  p_name text default null,
  p_active boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.departments;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'Expected version is required' using errcode = '23514';
  end if;
  if p_name is null and p_active is null then
    raise exception 'No department changes supplied' using errcode = '23514';
  end if;
  if p_name is not null and length(btrim(p_name)) not between 1 and 120 then
    raise exception 'Invalid department name' using errcode = '23514';
  end if;
  update public.departments
  set
    name = coalesce(btrim(p_name), name),
    active = coalesce(p_active, active)
  where id = p_department
    and company_id = p_company
    and version = p_expected_version
  returning * into saved;
  if saved.id is null then
    raise exception 'Department changed or unavailable' using errcode = '40001';
  end if;
  return jsonb_build_object(
    'id', saved.id,
    'company_id', saved.company_id,
    'name', saved.name,
    'active', saved.active,
    'version', saved.version,
    'created_at', saved.created_at,
    'updated_at', saved.updated_at
  );
end
$$;

create or replace function public.update_department(
  p_company uuid,
  p_department uuid,
  p_expected_version integer,
  p_name text default null,
  p_active boolean default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.update_department(
    p_company, p_department, p_expected_version, p_name, p_active
  )
$$;

alter table public.company_payment_settings
  add column if not exists serao_cents integer not null default 0
    check (serao_cents between 0 and 10000000);

alter table public.employee_payment_settings
  alter column regular_hour_cents drop not null,
  alter column regular_hour_cents drop default,
  alter column overtime_hour_cents drop not null,
  alter column overtime_hour_cents drop default,
  alter column meal_cents drop not null,
  alter column meal_cents drop default,
  alter column dinner_cents drop not null,
  alter column dinner_cents drop default,
  alter column daily_allowance_cents drop not null,
  alter column daily_allowance_cents drop default,
  alter column night_shift_cents drop not null,
  alter column night_shift_cents drop default,
  alter column saturday_cents drop not null,
  alter column saturday_cents drop default,
  add column if not exists serao_cents integer
    check (serao_cents is null or serao_cents between 0 and 10000000);

update public.employee_payment_settings
set
  regular_hour_cents = null,
  overtime_hour_cents = null,
  meal_cents = null,
  dinner_cents = null,
  daily_allowance_cents = null,
  night_shift_cents = null,
  saturday_cents = null,
  serao_cents = null
where use_company_defaults;

alter table public.employee_payment_days
  add column if not exists serao_units integer not null default 0
    check (serao_units between 0 and 10);

create table if not exists public.department_payment_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  department_id uuid not null,
  regular_hour_cents integer check (regular_hour_cents is null or regular_hour_cents between 0 and 10000000),
  overtime_hour_cents integer check (overtime_hour_cents is null or overtime_hour_cents between 0 and 10000000),
  serao_cents integer check (serao_cents is null or serao_cents between 0 and 10000000),
  meal_cents integer check (meal_cents is null or meal_cents between 0 and 10000000),
  dinner_cents integer check (dinner_cents is null or dinner_cents between 0 and 10000000),
  daily_allowance_cents integer check (daily_allowance_cents is null or daily_allowance_cents between 0 and 10000000),
  night_shift_cents integer check (night_shift_cents is null or night_shift_cents between 0 and 10000000),
  saturday_cents integer check (saturday_cents is null or saturday_cents between 0 and 10000000),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, department_id),
  foreign key(company_id, department_id) references public.departments(company_id, id)
);

create index if not exists department_payment_settings_company_department_idx
  on public.department_payment_settings(company_id, department_id);

alter table public.department_payment_settings enable row level security;
revoke all on public.department_payment_settings from public, anon, authenticated;
grant select on public.department_payment_settings to authenticated;
create policy department_payment_settings_read on public.department_payment_settings
  for select to authenticated
  using (private.can_manage(company_id));

drop function if exists public.save_company_payment_settings(uuid, integer, integer, integer, integer, integer, integer, integer, integer);
drop function if exists private.save_company_payment_settings(uuid, integer, integer, integer, integer, integer, integer, integer, integer);
drop function if exists public.save_employee_payment_settings(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, integer);
drop function if exists private.save_employee_payment_settings(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, integer);
drop function if exists public.save_employee_payment_day(uuid, uuid, date, integer, integer, integer, integer, integer, integer);
drop function if exists private.save_employee_payment_day(uuid, uuid, date, integer, integer, integer, integer, integer, integer);

create or replace function private.save_company_payment_settings(
  p_company uuid,
  p_regular_hour_cents integer,
  p_overtime_hour_cents integer,
  p_serao_cents integer,
  p_meal_cents integer,
  p_dinner_cents integer,
  p_daily_allowance_cents integer,
  p_night_shift_cents integer,
  p_saturday_cents integer,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.company_payment_settings;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if p_regular_hour_cents not between 0 and 10000000
    or p_overtime_hour_cents not between 0 and 10000000
    or p_serao_cents not between 0 and 10000000
    or p_meal_cents not between 0 and 10000000
    or p_dinner_cents not between 0 and 10000000
    or p_daily_allowance_cents not between 0 and 10000000
    or p_night_shift_cents not between 0 and 10000000
    or p_saturday_cents not between 0 and 10000000 then
    raise exception 'Invalid payment value' using errcode = '23514';
  end if;
  select * into saved
  from public.company_payment_settings
  where company_id = p_company
  for update;
  if saved.id is null then
    if p_expected_version is not null then
      raise exception 'Payment settings changed' using errcode = '40001';
    end if;
    insert into public.company_payment_settings(
      company_id, regular_hour_cents, overtime_hour_cents, serao_cents, meal_cents,
      dinner_cents, daily_allowance_cents, night_shift_cents, saturday_cents
    )
    values(
      p_company, p_regular_hour_cents, p_overtime_hour_cents, p_serao_cents, p_meal_cents,
      p_dinner_cents, p_daily_allowance_cents, p_night_shift_cents, p_saturday_cents
    )
    returning * into saved;
  else
    if p_expected_version is distinct from saved.version then
      raise exception 'Payment settings changed' using errcode = '40001';
    end if;
    update public.company_payment_settings
    set
      regular_hour_cents = p_regular_hour_cents,
      overtime_hour_cents = p_overtime_hour_cents,
      serao_cents = p_serao_cents,
      meal_cents = p_meal_cents,
      dinner_cents = p_dinner_cents,
      daily_allowance_cents = p_daily_allowance_cents,
      night_shift_cents = p_night_shift_cents,
      saturday_cents = p_saturday_cents,
      version = version + 1,
      updated_at = now()
    where id = saved.id
    returning * into saved;
  end if;
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, new_value)
  values(
    p_company, auth.uid(), 'COMPANY_PAYMENT_SETTINGS_SAVED', 'company_payment_settings', saved.id::text,
    jsonb_build_object(
      'regular_hour_cents', p_regular_hour_cents,
      'overtime_hour_cents', p_overtime_hour_cents,
      'serao_cents', p_serao_cents,
      'meal_cents', p_meal_cents,
      'dinner_cents', p_dinner_cents,
      'daily_allowance_cents', p_daily_allowance_cents,
      'night_shift_cents', p_night_shift_cents,
      'saturday_cents', p_saturday_cents
    )
  );
  return jsonb_build_object(
    'id', saved.id,
    'company_id', saved.company_id,
    'regular_hour_cents', saved.regular_hour_cents,
    'overtime_hour_cents', saved.overtime_hour_cents,
    'serao_cents', saved.serao_cents,
    'meal_cents', saved.meal_cents,
    'dinner_cents', saved.dinner_cents,
    'daily_allowance_cents', saved.daily_allowance_cents,
    'night_shift_cents', saved.night_shift_cents,
    'saturday_cents', saved.saturday_cents,
    'version', saved.version
  );
end
$$;

create or replace function public.save_company_payment_settings(
  p_company uuid,
  p_regular_hour_cents integer,
  p_overtime_hour_cents integer,
  p_serao_cents integer,
  p_meal_cents integer,
  p_dinner_cents integer,
  p_daily_allowance_cents integer,
  p_night_shift_cents integer,
  p_saturday_cents integer,
  p_expected_version integer default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.save_company_payment_settings(
    p_company, p_regular_hour_cents, p_overtime_hour_cents, p_serao_cents, p_meal_cents,
    p_dinner_cents, p_daily_allowance_cents, p_night_shift_cents, p_saturday_cents, p_expected_version
  )
$$;

create or replace function private.save_department_payment_settings(
  p_company uuid,
  p_department uuid,
  p_regular_hour_cents integer,
  p_overtime_hour_cents integer,
  p_serao_cents integer,
  p_meal_cents integer,
  p_dinner_cents integer,
  p_daily_allowance_cents integer,
  p_night_shift_cents integer,
  p_saturday_cents integer,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.department_payment_settings;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.departments where company_id = p_company and id = p_department
  ) then
    raise exception 'Department not found' using errcode = '23503';
  end if;
  if (p_regular_hour_cents is not null and p_regular_hour_cents not between 0 and 10000000)
    or (p_overtime_hour_cents is not null and p_overtime_hour_cents not between 0 and 10000000)
    or (p_serao_cents is not null and p_serao_cents not between 0 and 10000000)
    or (p_meal_cents is not null and p_meal_cents not between 0 and 10000000)
    or (p_dinner_cents is not null and p_dinner_cents not between 0 and 10000000)
    or (p_daily_allowance_cents is not null and p_daily_allowance_cents not between 0 and 10000000)
    or (p_night_shift_cents is not null and p_night_shift_cents not between 0 and 10000000)
    or (p_saturday_cents is not null and p_saturday_cents not between 0 and 10000000) then
    raise exception 'Invalid payment value' using errcode = '23514';
  end if;
  select * into saved
  from public.department_payment_settings
  where company_id = p_company and department_id = p_department
  for update;
  if saved.id is null then
    if p_expected_version is not null then
      raise exception 'Department payment settings changed' using errcode = '40001';
    end if;
    insert into public.department_payment_settings(
      company_id, department_id, regular_hour_cents, overtime_hour_cents, serao_cents,
      meal_cents, dinner_cents, daily_allowance_cents, night_shift_cents, saturday_cents
    )
    values(
      p_company, p_department, p_regular_hour_cents, p_overtime_hour_cents, p_serao_cents,
      p_meal_cents, p_dinner_cents, p_daily_allowance_cents, p_night_shift_cents, p_saturday_cents
    )
    returning * into saved;
  else
    if p_expected_version is distinct from saved.version then
      raise exception 'Department payment settings changed' using errcode = '40001';
    end if;
    update public.department_payment_settings
    set
      regular_hour_cents = p_regular_hour_cents,
      overtime_hour_cents = p_overtime_hour_cents,
      serao_cents = p_serao_cents,
      meal_cents = p_meal_cents,
      dinner_cents = p_dinner_cents,
      daily_allowance_cents = p_daily_allowance_cents,
      night_shift_cents = p_night_shift_cents,
      saturday_cents = p_saturday_cents,
      version = version + 1,
      updated_at = now()
    where id = saved.id
    returning * into saved;
  end if;
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, new_value)
  values(
    p_company, auth.uid(), 'DEPARTMENT_PAYMENT_SETTINGS_SAVED', 'department_payment_settings', saved.id::text,
    jsonb_build_object('department_id', p_department)
  );
  return jsonb_build_object(
    'id', saved.id,
    'company_id', saved.company_id,
    'department_id', saved.department_id,
    'regular_hour_cents', saved.regular_hour_cents,
    'overtime_hour_cents', saved.overtime_hour_cents,
    'serao_cents', saved.serao_cents,
    'meal_cents', saved.meal_cents,
    'dinner_cents', saved.dinner_cents,
    'daily_allowance_cents', saved.daily_allowance_cents,
    'night_shift_cents', saved.night_shift_cents,
    'saturday_cents', saved.saturday_cents,
    'version', saved.version
  );
end
$$;

create or replace function public.save_department_payment_settings(
  p_company uuid,
  p_department uuid,
  p_regular_hour_cents integer,
  p_overtime_hour_cents integer,
  p_serao_cents integer,
  p_meal_cents integer,
  p_dinner_cents integer,
  p_daily_allowance_cents integer,
  p_night_shift_cents integer,
  p_saturday_cents integer,
  p_expected_version integer default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.save_department_payment_settings(
    p_company, p_department, p_regular_hour_cents, p_overtime_hour_cents, p_serao_cents,
    p_meal_cents, p_dinner_cents, p_daily_allowance_cents, p_night_shift_cents,
    p_saturday_cents, p_expected_version
  )
$$;

create or replace function private.save_employee_payment_settings(
  p_company uuid,
  p_employee uuid,
  p_regular_hour_cents integer,
  p_overtime_hour_cents integer,
  p_serao_cents integer,
  p_meal_cents integer,
  p_dinner_cents integer,
  p_daily_allowance_cents integer,
  p_night_shift_cents integer,
  p_saturday_cents integer,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.employees;
  saved public.employee_payment_settings;
  v_inherits_all boolean;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if (p_regular_hour_cents is not null and p_regular_hour_cents not between 0 and 10000000)
    or (p_overtime_hour_cents is not null and p_overtime_hour_cents not between 0 and 10000000)
    or (p_serao_cents is not null and p_serao_cents not between 0 and 10000000)
    or (p_meal_cents is not null and p_meal_cents not between 0 and 10000000)
    or (p_dinner_cents is not null and p_dinner_cents not between 0 and 10000000)
    or (p_daily_allowance_cents is not null and p_daily_allowance_cents not between 0 and 10000000)
    or (p_night_shift_cents is not null and p_night_shift_cents not between 0 and 10000000)
    or (p_saturday_cents is not null and p_saturday_cents not between 0 and 10000000) then
    raise exception 'Invalid payment value' using errcode = '23514';
  end if;
  select * into target
  from public.employees
  where company_id = p_company and id = p_employee;
  if target.id is null then
    raise exception 'Employee not found' using errcode = '23503';
  end if;
  v_inherits_all := p_regular_hour_cents is null
    and p_overtime_hour_cents is null
    and p_serao_cents is null
    and p_meal_cents is null
    and p_dinner_cents is null
    and p_daily_allowance_cents is null
    and p_night_shift_cents is null
    and p_saturday_cents is null;
  select * into saved
  from public.employee_payment_settings
  where company_id = p_company and employee_id = p_employee
  for update;
  if saved.id is null then
    if p_expected_version is not null then
      raise exception 'Payment settings changed' using errcode = '40001';
    end if;
    insert into public.employee_payment_settings(
      company_id, employee_id, regular_hour_cents, overtime_hour_cents, serao_cents,
      meal_cents, dinner_cents, daily_allowance_cents, night_shift_cents, saturday_cents, use_company_defaults
    )
    values(
      p_company, p_employee, p_regular_hour_cents, p_overtime_hour_cents, p_serao_cents,
      p_meal_cents, p_dinner_cents, p_daily_allowance_cents, p_night_shift_cents, p_saturday_cents, v_inherits_all
    )
    returning * into saved;
  else
    if p_expected_version is distinct from saved.version then
      raise exception 'Payment settings changed' using errcode = '40001';
    end if;
    update public.employee_payment_settings
    set
      regular_hour_cents = p_regular_hour_cents,
      overtime_hour_cents = p_overtime_hour_cents,
      serao_cents = p_serao_cents,
      meal_cents = p_meal_cents,
      dinner_cents = p_dinner_cents,
      daily_allowance_cents = p_daily_allowance_cents,
      night_shift_cents = p_night_shift_cents,
      saturday_cents = p_saturday_cents,
      use_company_defaults = v_inherits_all,
      version = version + 1,
      updated_at = now()
    where id = saved.id
    returning * into saved;
  end if;
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, new_value)
  values(
    p_company, auth.uid(), 'PAYMENT_SETTINGS_SAVED', 'employee_payment_settings', saved.id::text,
    jsonb_build_object('employee_id', p_employee)
  );
  return jsonb_build_object(
    'id', saved.id,
    'company_id', saved.company_id,
    'employee_id', saved.employee_id,
    'regular_hour_cents', saved.regular_hour_cents,
    'overtime_hour_cents', saved.overtime_hour_cents,
    'serao_cents', saved.serao_cents,
    'meal_cents', saved.meal_cents,
    'dinner_cents', saved.dinner_cents,
    'daily_allowance_cents', saved.daily_allowance_cents,
    'night_shift_cents', saved.night_shift_cents,
    'saturday_cents', saved.saturday_cents,
    'version', saved.version
  );
end
$$;

create or replace function public.save_employee_payment_settings(
  p_company uuid,
  p_employee uuid,
  p_regular_hour_cents integer,
  p_overtime_hour_cents integer,
  p_serao_cents integer,
  p_meal_cents integer,
  p_dinner_cents integer,
  p_daily_allowance_cents integer,
  p_night_shift_cents integer,
  p_saturday_cents integer,
  p_expected_version integer default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.save_employee_payment_settings(
    p_company, p_employee, p_regular_hour_cents, p_overtime_hour_cents, p_serao_cents,
    p_meal_cents, p_dinner_cents, p_daily_allowance_cents, p_night_shift_cents,
    p_saturday_cents, p_expected_version
  )
$$;

create or replace function private.save_employee_payment_day(
  p_company uuid,
  p_employee uuid,
  p_local_date date,
  p_meal_units integer,
  p_dinner_units integer,
  p_daily_allowance_units integer,
  p_night_shift_units integer,
  p_saturday_units integer,
  p_serao_units integer,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.employees;
  saved public.employee_payment_days;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if p_meal_units not between 0 and 10
    or p_dinner_units not between 0 and 10
    or p_daily_allowance_units not between 0 and 10
    or p_night_shift_units not between 0 and 10
    or p_saturday_units not between 0 and 10
    or p_serao_units not between 0 and 10 then
    raise exception 'Invalid payment units' using errcode = '23514';
  end if;
  select * into target
  from public.employees
  where company_id = p_company and id = p_employee;
  if target.id is null then
    raise exception 'Employee not found' using errcode = '23503';
  end if;
  select * into saved
  from public.employee_payment_days
  where company_id = p_company and employee_id = p_employee and local_date = p_local_date
  for update;
  if saved.id is null then
    if p_expected_version is not null then
      raise exception 'Payment day changed' using errcode = '40001';
    end if;
    insert into public.employee_payment_days(
      company_id, employee_id, local_date, meal_units, dinner_units, daily_allowance_units,
      night_shift_units, saturday_units, serao_units
    )
    values(
      p_company, p_employee, p_local_date, p_meal_units, p_dinner_units, p_daily_allowance_units,
      p_night_shift_units, p_saturday_units, p_serao_units
    )
    returning * into saved;
  else
    if p_expected_version is distinct from saved.version then
      raise exception 'Payment day changed' using errcode = '40001';
    end if;
    update public.employee_payment_days
    set
      meal_units = p_meal_units,
      dinner_units = p_dinner_units,
      daily_allowance_units = p_daily_allowance_units,
      night_shift_units = p_night_shift_units,
      saturday_units = p_saturday_units,
      serao_units = p_serao_units,
      version = version + 1,
      updated_at = now()
    where id = saved.id
    returning * into saved;
  end if;
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, new_value)
  values(
    p_company, auth.uid(), 'PAYMENT_DAY_SAVED', 'employee_payment_day', saved.id::text,
    jsonb_build_object('employee_id', p_employee, 'local_date', p_local_date, 'serao_units', p_serao_units)
  );
  return jsonb_build_object(
    'id', saved.id,
    'company_id', saved.company_id,
    'employee_id', saved.employee_id,
    'local_date', saved.local_date,
    'meal_units', saved.meal_units,
    'dinner_units', saved.dinner_units,
    'daily_allowance_units', saved.daily_allowance_units,
    'night_shift_units', saved.night_shift_units,
    'saturday_units', saved.saturday_units,
    'serao_units', saved.serao_units,
    'version', saved.version
  );
end
$$;

create or replace function public.save_employee_payment_day(
  p_company uuid,
  p_employee uuid,
  p_local_date date,
  p_meal_units integer,
  p_dinner_units integer,
  p_daily_allowance_units integer,
  p_night_shift_units integer,
  p_saturday_units integer,
  p_serao_units integer,
  p_expected_version integer default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.save_employee_payment_day(
    p_company, p_employee, p_local_date, p_meal_units, p_dinner_units, p_daily_allowance_units,
    p_night_shift_units, p_saturday_units, p_serao_units, p_expected_version
  )
$$;

create or replace function private.resolve_employee_payment_rates(
  p_company uuid,
  p_employee uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.employees;
  employee_rates public.employee_payment_settings;
  department_rates public.department_payment_settings;
  company_rates public.company_payment_settings;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  select * into target
  from public.employees
  where company_id = p_company and id = p_employee;
  if target.id is null then
    raise exception 'Employee not found' using errcode = '23503';
  end if;
  select * into employee_rates
  from public.employee_payment_settings
  where company_id = p_company and employee_id = p_employee;
  if target.department_id is not null then
    select * into department_rates
    from public.department_payment_settings
    where company_id = p_company and department_id = target.department_id;
  end if;
  select * into company_rates
  from public.company_payment_settings
  where company_id = p_company;

  return jsonb_build_object(
    'regular_hour_cents', jsonb_build_object(
      'cents', coalesce(employee_rates.regular_hour_cents, department_rates.regular_hour_cents, company_rates.regular_hour_cents, 0),
      'source', case
        when employee_rates.regular_hour_cents is not null then 'employee'
        when department_rates.regular_hour_cents is not null then 'department'
        when company_rates.id is not null then 'company'
        else 'none'
      end
    ),
    'overtime_hour_cents', jsonb_build_object(
      'cents', coalesce(employee_rates.overtime_hour_cents, department_rates.overtime_hour_cents, company_rates.overtime_hour_cents, 0),
      'source', case
        when employee_rates.overtime_hour_cents is not null then 'employee'
        when department_rates.overtime_hour_cents is not null then 'department'
        when company_rates.id is not null then 'company'
        else 'none'
      end
    ),
    'serao_cents', jsonb_build_object(
      'cents', coalesce(employee_rates.serao_cents, department_rates.serao_cents, company_rates.serao_cents, 0),
      'source', case
        when employee_rates.serao_cents is not null then 'employee'
        when department_rates.serao_cents is not null then 'department'
        when company_rates.id is not null then 'company'
        else 'none'
      end
    ),
    'meal_cents', jsonb_build_object(
      'cents', coalesce(employee_rates.meal_cents, department_rates.meal_cents, company_rates.meal_cents, 0),
      'source', case
        when employee_rates.meal_cents is not null then 'employee'
        when department_rates.meal_cents is not null then 'department'
        when company_rates.id is not null then 'company'
        else 'none'
      end
    ),
    'dinner_cents', jsonb_build_object(
      'cents', coalesce(employee_rates.dinner_cents, department_rates.dinner_cents, company_rates.dinner_cents, 0),
      'source', case
        when employee_rates.dinner_cents is not null then 'employee'
        when department_rates.dinner_cents is not null then 'department'
        when company_rates.id is not null then 'company'
        else 'none'
      end
    ),
    'daily_allowance_cents', jsonb_build_object(
      'cents', coalesce(employee_rates.daily_allowance_cents, department_rates.daily_allowance_cents, company_rates.daily_allowance_cents, 0),
      'source', case
        when employee_rates.daily_allowance_cents is not null then 'employee'
        when department_rates.daily_allowance_cents is not null then 'department'
        when company_rates.id is not null then 'company'
        else 'none'
      end
    ),
    'night_shift_cents', jsonb_build_object(
      'cents', coalesce(employee_rates.night_shift_cents, department_rates.night_shift_cents, company_rates.night_shift_cents, 0),
      'source', case
        when employee_rates.night_shift_cents is not null then 'employee'
        when department_rates.night_shift_cents is not null then 'department'
        when company_rates.id is not null then 'company'
        else 'none'
      end
    ),
    'saturday_cents', jsonb_build_object(
      'cents', coalesce(employee_rates.saturday_cents, department_rates.saturday_cents, company_rates.saturday_cents, 0),
      'source', case
        when employee_rates.saturday_cents is not null then 'employee'
        when department_rates.saturday_cents is not null then 'department'
        when company_rates.id is not null then 'company'
        else 'none'
      end
    )
  );
end
$$;

create or replace function public.resolve_employee_payment_rates(
  p_company uuid,
  p_employee uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.resolve_employee_payment_rates(p_company, p_employee)
$$;

revoke all on function private.bump_department_version() from public;
grant execute on function private.bump_department_version() to postgres;
revoke all on function private.seed_company_people_defaults(uuid) from public;
grant execute on function private.seed_company_people_defaults(uuid) to postgres;
revoke all on function private.seed_company_people_defaults_on_insert() from public;
grant execute on function private.seed_company_people_defaults_on_insert() to postgres;
revoke all on function private.sync_employee_registration_counter() from public;
grant execute on function private.sync_employee_registration_counter() to postgres;
revoke all on function private.validate_employee_department_assignment() from public;
grant execute on function private.validate_employee_department_assignment() to postgres;
revoke all on function private.create_employee_with_registration(uuid, text, text, text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.create_employee_with_registration(uuid, text, text, text, uuid, uuid) to postgres;
revoke all on function public.create_employee_with_registration(uuid, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.create_employee_with_registration(uuid, text, text, text, uuid, uuid) to authenticated;
revoke all on function private.create_department(uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.create_department(uuid, text) to postgres;
revoke all on function public.create_department(uuid, text) from public, anon;
grant execute on function public.create_department(uuid, text) to authenticated;
revoke all on function private.update_department(uuid, uuid, integer, text, boolean) from public, anon, authenticated, service_role;
grant execute on function private.update_department(uuid, uuid, integer, text, boolean) to postgres;
revoke all on function public.update_department(uuid, uuid, integer, text, boolean) from public, anon;
grant execute on function public.update_department(uuid, uuid, integer, text, boolean) to authenticated;
revoke all on function private.save_company_payment_settings(uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer) from public, anon, authenticated, service_role;
grant execute on function private.save_company_payment_settings(uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer) to postgres;
revoke all on function public.save_company_payment_settings(uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.save_company_payment_settings(uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer) to authenticated;
revoke all on function private.save_department_payment_settings(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer) from public, anon, authenticated, service_role;
grant execute on function private.save_department_payment_settings(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer) to postgres;
revoke all on function public.save_department_payment_settings(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.save_department_payment_settings(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer) to authenticated;
revoke all on function private.save_employee_payment_settings(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer) from public, anon, authenticated, service_role;
grant execute on function private.save_employee_payment_settings(uuid, uuid, integer, integer,integer, integer, integer, integer, integer, integer, integer) to postgres;
revoke all on function public.save_employee_payment_settings(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.save_employee_payment_settings(uuid, uuid, integer, integer, integer, integer, integer, integer, integer, integer, integer) to authenticated;
revoke all on function private.save_employee_payment_day(uuid, uuid, date, integer, integer, integer, integer, integer, integer, integer) from public, anon, authenticated, service_role;
grant execute on function private.save_employee_payment_day(uuid, uuid, date, integer, integer, integer, integer, integer, integer, integer) to postgres;
revoke all on function public.save_employee_payment_day(uuid, uuid, date, integer, integer, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.save_employee_payment_day(uuid, uuid, date, integer, integer, integer, integer, integer, integer, integer) to authenticated;
revoke all on function private.resolve_employee_payment_rates(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.resolve_employee_payment_rates(uuid, uuid) to postgres;
revoke all on function public.resolve_employee_payment_rates(uuid, uuid) from public, anon;
grant execute on function public.resolve_employee_payment_rates(uuid, uuid) to authenticated;

grant select on public.department_payment_settings to service_role;
grant select on private.employee_registration_counters to service_role;

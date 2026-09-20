create table public.absence_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check (length(trim(name)) between 1 and 120),
  abones_hours boolean not null default true,
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, id),
  unique(company_id, name)
);

create table public.day_justifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  local_date date not null,
  absence_category_id uuid not null,
  note text check (note is null or length(trim(note)) between 1 and 500),
  created_by uuid not null default auth.uid() references public.users(id),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, id),
  unique(company_id, employee_id, local_date),
  foreign key(company_id, employee_id) references public.employees(company_id, id),
  foreign key(company_id, absence_category_id) references public.absence_categories(company_id, id)
);

create index absence_categories_company_active_idx on public.absence_categories(company_id, active, name);
create index day_justifications_employee_date_idx on public.day_justifications(company_id, employee_id, local_date);

alter table public.absence_categories enable row level security;
alter table public.day_justifications enable row level security;

revoke all on public.absence_categories, public.day_justifications from public, anon, authenticated;
grant select on public.absence_categories, public.day_justifications to authenticated;
grant select on public.absence_categories, public.day_justifications to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.absence_categories, public.day_justifications to postgres;
grant maintain, references, trigger, truncate on public.absence_categories, public.day_justifications to service_role;

create policy absence_categories_read on public.absence_categories for select to authenticated
  using(private.can_manage(company_id));
create policy day_justifications_read on public.day_justifications for select to authenticated
  using(private.can_manage(company_id));

create function private.seed_absence_categories(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.absence_categories(company_id, name, abones_hours)
  values
    (p_company, 'Atestado', true),
    (p_company, 'Folga', true),
    (p_company, 'Licença paternidade', true)
  on conflict(company_id, name) do nothing;
end
$$;

create function private.seed_absence_categories_for_company()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.active then perform private.seed_absence_categories(new.id); end if;
  return new;
end
$$;

create trigger seed_absence_categories_after_company_insert
  after insert on public.companies
  for each row execute function private.seed_absence_categories_for_company();

insert into public.absence_categories(company_id, name, abones_hours)
select id, category.name, category.abones_hours
from public.companies
cross join (values
  ('Atestado'::text, true),
  ('Folga'::text, true),
  ('Licença paternidade'::text, true)
) as category(name, abones_hours)
where companies.active
on conflict(company_id, name) do nothing;

create trigger audit_absence_categories
  after insert or update on public.absence_categories
  for each row execute function private.audit_change();

create trigger audit_day_justifications
  after insert or update on public.day_justifications
  for each row execute function private.audit_change();

create function private.audit_day_justification_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, old_value)
  values(old.company_id, auth.uid(), 'DELETE', 'day_justifications', old.id::text, to_jsonb(old));
  return old;
end
$$;

create trigger audit_day_justification_delete
  after delete on public.day_justifications
  for each row execute function private.audit_day_justification_delete();

create function private.create_day_justification(
  p_company uuid,
  p_employee uuid,
  p_local_date date,
  p_absence_category uuid,
  p_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_category public.absence_categories;
  target_company public.companies;
  saved public.day_justifications;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if p_local_date is null or length(trim(coalesce(p_note, ''))) > 500 then
    raise exception 'Invalid day justification' using errcode = '23514';
  end if;

  select * into target_company from public.companies where id = p_company and active;
  if target_company.id is null then raise exception 'Active company not found' using errcode = '23503'; end if;
  perform 1 from public.employees where id = p_employee and company_id = p_company;
  if not found then raise exception 'Employee not found' using errcode = '23503'; end if;
  select * into target_category from public.absence_categories
    where id = p_absence_category and company_id = p_company and active;
  if target_category.id is null then raise exception 'Active absence category not found' using errcode = '23503'; end if;

  insert into public.day_justifications(company_id, employee_id, local_date, absence_category_id, note, created_by)
  values(p_company, p_employee, p_local_date, p_absence_category, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  on conflict(company_id, employee_id, local_date) do update set
    absence_category_id = excluded.absence_category_id,
    note = excluded.note,
    version = public.day_justifications.version + 1,
    updated_at = now()
  returning * into saved;

  perform private.enqueue_attendance_recalculation_range(
    p_company,
    p_employee,
    p_local_date::timestamp at time zone target_company.timezone,
    (p_local_date + 1)::timestamp at time zone target_company.timezone
  );

  return jsonb_build_object(
    'id', saved.id,
    'company_id', saved.company_id,
    'employee_id', saved.employee_id,
    'local_date', saved.local_date,
    'absence_category_id', saved.absence_category_id,
    'note', saved.note,
    'version', saved.version,
    'created_at', saved.created_at,
    'updated_at', saved.updated_at
  );
end
$$;

create function public.create_day_justification(
  p_company uuid,
  p_employee uuid,
  p_local_date date,
  p_absence_category uuid,
  p_note text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.create_day_justification(p_company, p_employee, p_local_date, p_absence_category, p_note)
$$;

create function private.delete_day_justification(
  p_company uuid,
  p_justification uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  existing public.day_justifications;
  target_company public.companies;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;

  select * into existing from public.day_justifications
    where id = p_justification and company_id = p_company for update;
  if existing.id is null then raise exception 'Day justification not found' using errcode = '23503'; end if;
  select * into target_company from public.companies where id = p_company and active;
  if target_company.id is null then raise exception 'Active company not found' using errcode = '23503'; end if;

  delete from public.day_justifications where id = existing.id and company_id = p_company;
  perform private.enqueue_attendance_recalculation_range(
    p_company,
    existing.employee_id,
    existing.local_date::timestamp at time zone target_company.timezone,
    (existing.local_date + 1)::timestamp at time zone target_company.timezone
  );

  return jsonb_build_object('id', existing.id, 'employee_id', existing.employee_id, 'local_date', existing.local_date);
end
$$;

create function public.delete_day_justification(
  p_company uuid,
  p_justification uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.delete_day_justification(p_company, p_justification)
$$;

revoke all on function private.seed_absence_categories(uuid),
  private.seed_absence_categories_for_company(),
  private.audit_day_justification_delete(),
  private.create_day_justification(uuid,uuid,date,uuid,text),
  private.delete_day_justification(uuid,uuid)
  from public, anon, authenticated;
grant execute on function private.seed_absence_categories(uuid),
  private.seed_absence_categories_for_company(),
  private.audit_day_justification_delete()
  to postgres;
revoke all on function public.create_day_justification(uuid,uuid,date,uuid,text),
  public.delete_day_justification(uuid,uuid)
  from public, anon;
grant execute on function public.create_day_justification(uuid,uuid,date,uuid,text),
  public.delete_day_justification(uuid,uuid)
  to authenticated;

alter table public.attendance_calculations
  add column regular_minutes integer check(regular_minutes >= 0),
  add column justified_minutes integer not null default 0 check(justified_minutes >= 0),
  add column missing_minutes integer check(missing_minutes >= 0);

create or replace function private.record_attendance_calculation(
  p_company uuid,
  p_employee uuid,
  p_schedule_version uuid,
  p_journey_start timestamptz,
  p_journey_end timestamptz,
  p_local_date date,
  p_timezone text,
  p_result jsonb,
  p_input_sha256 text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_day public.work_days;
  previous public.attendance_calculations;
  calculation public.attendance_calculations;
  prior_entry public.bank_hours;
  next_revision integer;
  next_state public.attendance_state;
  item jsonb;
begin
  if current_setting('role', true) <> 'service_role' and (auth.uid() is null or not private.can_manage(p_company)) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if p_journey_end <= p_journey_start or p_input_sha256 !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_result) <> 'object' or jsonb_typeof(p_result->'occurrences') <> 'array'
    or jsonb_typeof(p_result->'classifications') <> 'array' then
    raise exception 'Invalid attendance calculation' using errcode = '23514';
  end if;

  insert into public.work_days(company_id, employee_id, schedule_version_id, journey_start, journey_end, local_date, timezone)
  values(p_company, p_employee, p_schedule_version, p_journey_start, p_journey_end, p_local_date, p_timezone)
  on conflict(company_id, employee_id, journey_start) do nothing;
  select * into target_day from public.work_days where company_id = p_company and employee_id = p_employee
    and journey_start = p_journey_start;
  if target_day.schedule_version_id <> p_schedule_version or target_day.journey_end <> p_journey_end
    or target_day.local_date <> p_local_date or target_day.timezone <> p_timezone then
    raise exception 'Work day identity conflict' using errcode = '23514';
  end if;

  perform 1 from public.work_days where id = target_day.id for update;
  select * into previous from public.attendance_calculations
    where company_id = p_company and work_day_id = target_day.id and state in ('provisional', 'final')
    for update;
  next_revision := coalesce(previous.revision, 0) + 1;
  next_state := case when coalesce((p_result->>'provisional')::boolean, false) or p_result->>'net_balance_minutes' is null
    then 'provisional' else 'final' end::public.attendance_state;

  if previous.id is not null then
    update public.attendance_calculations set state = 'superseded' where id = previous.id;
  end if;

  insert into public.attendance_calculations(
    company_id, work_day_id, revision, engine_version, rules_version, state, planned_minutes, worked_minutes,
    regular_minutes, justified_minutes, missing_minutes, late_minutes, late_after_tolerance_minutes,
    early_departure_minutes, break_minutes, gross_overtime_minutes, overtime_after_tolerance_minutes,
    net_balance_minutes, classifications, input_hash
  ) values(
    p_company, target_day.id, next_revision, (p_result->>'engine_version')::integer, (p_result->>'rules_version')::integer,
    next_state, (p_result->>'planned_minutes')::integer, (p_result->>'worked_minutes')::integer,
    (p_result->>'regular_minutes')::integer, coalesce((p_result->>'justified_minutes')::integer, 0),
    (p_result->>'missing_minutes')::integer, (p_result->>'late_minutes')::integer,
    (p_result->>'late_after_tolerance_minutes')::integer, (p_result->>'early_departure_minutes')::integer,
    (p_result->>'break_minutes')::integer, (p_result->>'gross_overtime_minutes')::integer,
    (p_result->>'overtime_after_tolerance_minutes')::integer, (p_result->>'net_balance_minutes')::integer,
    p_result->'classifications', decode(p_input_sha256, 'hex')
  ) returning * into calculation;

  for item in select value from jsonb_array_elements(p_result->'occurrences') loop
    insert into public.attendance_occurrences(company_id, work_day_id, calculation_id, employee_id, severity, type, details)
    values(p_company, target_day.id, calculation.id, p_employee,
      coalesce(item->>'severity', 'warning')::public.occurrence_severity, item->>'code', item-'code'-'severity');
  end loop;

  if previous.id is not null then
    select * into prior_entry from public.bank_hours
      where company_id = p_company and calculation_id = previous.id and reversal_of is null;
    if prior_entry.id is not null then
      insert into public.bank_hours(company_id, employee_id, work_day_id, calculation_id, revision, delta_minutes, reason, reversal_of)
      values(p_company, p_employee, target_day.id, calculation.id, next_revision, -prior_entry.delta_minutes,
        'Estorno automático da revisão anterior', prior_entry.id);
    end if;
  end if;
  if next_state = 'final' then
    insert into public.bank_hours(company_id, employee_id, work_day_id, calculation_id, revision, delta_minutes, reason)
    values(p_company, p_employee, target_day.id, calculation.id, next_revision, calculation.net_balance_minutes,
      'Cálculo final da jornada');
  end if;

  return jsonb_build_object('work_day_id', target_day.id, 'calculation_id', calculation.id,
    'revision', calculation.revision, 'state', calculation.state);
end
$$;

grant execute on function private.record_attendance_calculation(uuid,uuid,uuid,timestamptz,timestamptz,date,text,jsonb,text) to service_role;
grant execute on function public.record_attendance_calculation(uuid,uuid,uuid,timestamptz,timestamptz,date,text,jsonb,text) to service_role;
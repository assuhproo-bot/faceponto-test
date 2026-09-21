-- A cargo can define the normal journey for new employees. Individual
-- assignments always take precedence and are never overwritten by this rule.
create table public.department_schedule_defaults (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  department_id uuid not null,
  schedule_version_id uuid not null,
  valid_from date not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, id),
  unique(company_id, department_id),
  foreign key(company_id, department_id) references public.departments(company_id, id),
  foreign key(company_id, schedule_version_id) references public.schedule_versions(company_id, id)
);

create index department_schedule_defaults_company_idx
  on public.department_schedule_defaults(company_id, department_id);

alter table public.department_schedule_defaults enable row level security;
revoke all on public.department_schedule_defaults from public, anon, authenticated;
grant select on public.department_schedule_defaults to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on public.department_schedule_defaults to postgres;
grant maintain, references, trigger, truncate on public.department_schedule_defaults to service_role;
create policy department_schedule_defaults_read on public.department_schedule_defaults
  for select to authenticated using(private.can_manage(company_id));

create trigger audit_department_schedule_defaults
after insert or update on public.department_schedule_defaults
for each row execute function private.audit_change();

create function private.audit_department_schedule_default_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, old_value)
  values(old.company_id, auth.uid(), 'DELETE', 'department_schedule_defaults', old.id::text, to_jsonb(old));
  return old;
end $$;

create trigger audit_department_schedule_default_delete
after delete on public.department_schedule_defaults
for each row execute function private.audit_department_schedule_default_delete();

create function private.bump_department_schedule_default_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.schedule_version_id is distinct from old.schedule_version_id
    or new.valid_from is distinct from old.valid_from then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger department_schedule_default_version
before update on public.department_schedule_defaults
for each row execute function private.bump_department_schedule_default_version();

create function private.apply_department_schedule_default()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_default public.department_schedule_defaults;
  target_timezone text;
  effective_from date;
begin
  if new.department_id is null
    or (tg_op = 'UPDATE' and new.department_id is not distinct from old.department_id) then
    return new;
  end if;

  select * into target_default
  from public.department_schedule_defaults
  where company_id = new.company_id and department_id = new.department_id;
  if target_default.id is null then return new; end if;

  select timezone into target_timezone from public.companies where id = new.company_id;
  effective_from := greatest(target_default.valid_from, (now() at time zone target_timezone)::date);

  -- A present or future individual assignment is an intentional exception.
  if exists (
    select 1 from public.schedule_assignments
    where company_id = new.company_id and employee_id = new.id
      and (valid_to is null or valid_to > effective_from)
  ) then return new; end if;

  insert into public.schedule_assignments(company_id, employee_id, schedule_version_id, valid_from)
  values(new.company_id, new.id, target_default.schedule_version_id, effective_from);
  return new;
end $$;

create trigger employee_department_default_schedule
after insert or update of department_id on public.employees
for each row execute function private.apply_department_schedule_default();

create function private.save_department_schedule_default(
  p_company uuid,
  p_department uuid,
  p_schedule_version uuid,
  p_valid_from date,
  p_expected_version integer default null,
  p_apply_to_unassigned boolean default true
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  existing public.department_schedule_defaults;
  saved public.department_schedule_defaults;
  target_company public.companies;
  assigned_count integer := 0;
  employee_record record;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if p_valid_from is null then raise exception 'Default schedule start date is required' using errcode = '23514'; end if;

  select * into target_company from public.companies where id = p_company and active;
  if target_company.id is null then raise exception 'Active company not found' using errcode = '23503'; end if;
  if not exists (select 1 from public.departments where company_id = p_company and id = p_department and active) then
    raise exception 'Active department not found' using errcode = '23503';
  end if;
  if not exists (
    select 1 from public.schedule_versions version
    join public.work_schedules schedule on schedule.id = version.schedule_id and schedule.company_id = version.company_id
    where version.company_id = p_company and version.id = p_schedule_version and schedule.active
  ) then raise exception 'Active schedule version not found' using errcode = '23503'; end if;

  select * into existing from public.department_schedule_defaults
  where company_id = p_company and department_id = p_department for update;
  if existing.id is null then
    if p_expected_version is not null then raise exception 'Department schedule default changed or unavailable' using errcode = '40001'; end if;
    insert into public.department_schedule_defaults(company_id, department_id, schedule_version_id, valid_from)
    values(p_company, p_department, p_schedule_version, p_valid_from)
    returning * into saved;
  else
    if p_expected_version is null or existing.version <> p_expected_version then
      raise exception 'Department schedule default changed or unavailable' using errcode = '40001';
    end if;
    update public.department_schedule_defaults
    set schedule_version_id = p_schedule_version, valid_from = p_valid_from
    where id = existing.id
    returning * into saved;
  end if;

  if p_apply_to_unassigned then
    for employee_record in
      select employee.id
      from public.employees employee
      where employee.company_id = p_company and employee.department_id = p_department and employee.active
        and not exists (
          select 1 from public.schedule_assignments assignment
          where assignment.company_id = p_company and assignment.employee_id = employee.id
            and (assignment.valid_to is null or assignment.valid_to > p_valid_from)
        )
    loop
      insert into public.schedule_assignments(company_id, employee_id, schedule_version_id, valid_from)
      values(p_company, employee_record.id, p_schedule_version, p_valid_from);
      assigned_count := assigned_count + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'id', saved.id, 'company_id', saved.company_id, 'department_id', saved.department_id,
    'schedule_version_id', saved.schedule_version_id, 'valid_from', saved.valid_from,
    'version', saved.version, 'created_at', saved.created_at, 'updated_at', saved.updated_at,
    'assigned_count', assigned_count
  );
end $$;

create function public.save_department_schedule_default(
  p_company uuid, p_department uuid, p_schedule_version uuid, p_valid_from date,
  p_expected_version integer default null, p_apply_to_unassigned boolean default true
) returns jsonb language sql security definer set search_path = '' as $$
  select private.save_department_schedule_default(
    p_company, p_department, p_schedule_version, p_valid_from, p_expected_version, p_apply_to_unassigned
  )
$$;

create function private.clear_department_schedule_default(
  p_company uuid, p_department uuid, p_expected_version integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing public.department_schedule_defaults;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  select * into existing from public.department_schedule_defaults
  where company_id = p_company and department_id = p_department for update;
  if existing.id is null or existing.version <> p_expected_version then
    raise exception 'Department schedule default changed or unavailable' using errcode = '40001';
  end if;
  delete from public.department_schedule_defaults where id = existing.id;
  return jsonb_build_object('id', existing.id, 'department_id', existing.department_id);
end $$;

create function public.clear_department_schedule_default(
  p_company uuid, p_department uuid, p_expected_version integer
) returns jsonb language sql security definer set search_path = '' as $$
  select private.clear_department_schedule_default(p_company, p_department, p_expected_version)
$$;

revoke all on function private.audit_department_schedule_default_delete(),
  private.bump_department_schedule_default_version(), private.apply_department_schedule_default(),
  private.save_department_schedule_default(uuid,uuid,uuid,date,integer,boolean),
  private.clear_department_schedule_default(uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function private.audit_department_schedule_default_delete(),
  private.bump_department_schedule_default_version(), private.apply_department_schedule_default(),
  private.save_department_schedule_default(uuid,uuid,uuid,date,integer,boolean),
  private.clear_department_schedule_default(uuid,uuid,integer)
  to postgres;
revoke all on function public.save_department_schedule_default(uuid,uuid,uuid,date,integer,boolean),
  public.clear_department_schedule_default(uuid,uuid,integer) from public, anon;
grant execute on function public.save_department_schedule_default(uuid,uuid,uuid,date,integer,boolean),
  public.clear_department_schedule_default(uuid,uuid,integer) to authenticated;

create table public.employee_schedule_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  local_date date not null,
  schedule_version_id uuid not null,
  active boolean not null default true,
  version integer not null default 1 check(version > 0),
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,employee_id,local_date),
  foreign key(company_id,employee_id) references public.employees(company_id,id),
  foreign key(company_id,schedule_version_id) references public.schedule_versions(company_id,id),
  foreign key(created_by) references public.users(id),
  foreign key(updated_by) references public.users(id)
);
create index employee_schedule_plans_calendar_idx on public.employee_schedule_plans(company_id,local_date,employee_id) where active;

alter table public.employee_schedule_plans enable row level security;
revoke all on public.employee_schedule_plans from public,anon,authenticated;
grant select on public.employee_schedule_plans to authenticated,service_role;
create policy employee_schedule_plans_read on public.employee_schedule_plans for select to authenticated
  using(private.can_access_employee(company_id,employee_id));

create trigger audit_employee_schedule_plans after insert or update on public.employee_schedule_plans
  for each row execute function private.audit_change();

create function private.assert_employee_schedule_plan_editable(p_company uuid,p_employee uuid,p_local_date date)
returns void language plpgsql security definer set search_path='' as $$
declare company_timezone text;
begin
  select timezone into company_timezone from public.companies where id=p_company and active;
  if company_timezone is null then raise exception 'Active company not found' using errcode='23514'; end if;
  if p_local_date < (now() at time zone company_timezone)::date then
    raise exception 'Past daily plans are immutable' using errcode='23514';
  end if;
  if exists(
    select 1 from public.time_punches
    where company_id=p_company and employee_id=p_employee and sync_status='accepted'
      and ("timestamp" at time zone company_timezone)::date=p_local_date
  ) then
    raise exception 'Daily plan cannot change after a punch' using errcode='23514';
  end if;
end $$;

create function private.set_employee_schedule_plan(
  p_company uuid,p_employee uuid,p_local_date date,p_schedule_version uuid,p_expected_version integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.employee_schedule_plans; target public.employee_schedule_plans;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode='42501';
  end if;
  perform private.assert_employee_schedule_plan_editable(p_company,p_employee,p_local_date);
  if not exists(
    select 1 from public.employees e where e.company_id=p_company and e.id=p_employee and e.active
  ) then raise exception 'Active employee not found' using errcode='23514'; end if;
  if not exists(
    select 1 from public.schedule_versions v join public.work_schedules s on s.company_id=v.company_id and s.id=v.schedule_id
    where v.company_id=p_company and v.id=p_schedule_version and s.active
  ) then raise exception 'Active schedule version not found' using errcode='23514'; end if;
  select * into existing from public.employee_schedule_plans
    where company_id=p_company and employee_id=p_employee and local_date=p_local_date for update;
  if existing.id is null then
    if p_expected_version is not null then raise exception 'Version conflict' using errcode='40001'; end if;
    insert into public.employee_schedule_plans(company_id,employee_id,local_date,schedule_version_id,created_by,updated_by)
      values(p_company,p_employee,p_local_date,p_schedule_version,auth.uid(),auth.uid()) returning * into target;
  else
    if p_expected_version is null or existing.version <> p_expected_version then raise exception 'Version conflict' using errcode='40001'; end if;
    update public.employee_schedule_plans set schedule_version_id=p_schedule_version,active=true,version=version+1,
      updated_by=auth.uid(),updated_at=now() where id=existing.id returning * into target;
  end if;
  return jsonb_build_object('id',target.id,'company_id',target.company_id,'employee_id',target.employee_id,
    'local_date',target.local_date,'schedule_version_id',target.schedule_version_id,'active',target.active,'version',target.version);
end $$;

create function private.clear_employee_schedule_plan(p_company uuid,p_plan uuid,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.employee_schedule_plans; target public.employee_schedule_plans;
begin
  if auth.uid() is null or not private.can_manage(p_company) then raise exception 'Managerial role required' using errcode='42501'; end if;
  select * into existing from public.employee_schedule_plans where company_id=p_company and id=p_plan for update;
  if existing.id is null or not existing.active then raise exception 'Active daily plan not found' using errcode='23514'; end if;
  if existing.version <> p_expected_version then raise exception 'Version conflict' using errcode='40001'; end if;
  perform private.assert_employee_schedule_plan_editable(p_company,existing.employee_id,existing.local_date);
  update public.employee_schedule_plans set active=false,version=version+1,updated_by=auth.uid(),updated_at=now()
    where id=existing.id returning * into target;
  return jsonb_build_object('id',target.id,'active',target.active,'version',target.version);
end $$;

create function public.set_employee_schedule_plan(
  p_company uuid,p_employee uuid,p_local_date date,p_schedule_version uuid,p_expected_version integer default null
) returns jsonb language sql security invoker set search_path='' as $$
  select private.set_employee_schedule_plan(p_company,p_employee,p_local_date,p_schedule_version,p_expected_version)
$$;
create function public.clear_employee_schedule_plan(p_company uuid,p_plan uuid,p_expected_version integer)
returns jsonb language sql security invoker set search_path='' as $$
  select private.clear_employee_schedule_plan(p_company,p_plan,p_expected_version)
$$;

revoke all on function private.assert_employee_schedule_plan_editable(uuid,uuid,date),
  private.set_employee_schedule_plan(uuid,uuid,date,uuid,integer),private.clear_employee_schedule_plan(uuid,uuid,integer)
  from public,anon,authenticated;
grant execute on function private.assert_employee_schedule_plan_editable(uuid,uuid,date),
  private.set_employee_schedule_plan(uuid,uuid,date,uuid,integer),private.clear_employee_schedule_plan(uuid,uuid,integer) to postgres;
revoke all on function public.set_employee_schedule_plan(uuid,uuid,date,uuid,integer),
  public.clear_employee_schedule_plan(uuid,uuid,integer) from public,anon;
grant execute on function public.set_employee_schedule_plan(uuid,uuid,date,uuid,integer),
  public.clear_employee_schedule_plan(uuid,uuid,integer) to authenticated;

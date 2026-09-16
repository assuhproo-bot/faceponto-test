create table public.employee_payment_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  regular_hour_cents integer not null default 0 check(regular_hour_cents between 0 and 10000000),
  overtime_hour_cents integer not null default 0 check(overtime_hour_cents between 0 and 10000000),
  meal_cents integer not null default 0 check(meal_cents between 0 and 10000000),
  dinner_cents integer not null default 0 check(dinner_cents between 0 and 10000000),
  daily_allowance_cents integer not null default 0 check(daily_allowance_cents between 0 and 10000000),
  night_shift_cents integer not null default 0 check(night_shift_cents between 0 and 10000000),
  saturday_cents integer not null default 0 check(saturday_cents between 0 and 10000000),
  version integer not null default 1 check(version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, employee_id),
  foreign key(company_id,employee_id) references public.employees(company_id,id)
);
create index employee_payment_settings_company_employee_idx on public.employee_payment_settings(company_id,employee_id);
alter table public.employee_payment_settings enable row level security;
revoke all on public.employee_payment_settings from public,anon,authenticated;
grant select on public.employee_payment_settings to authenticated;
create policy employee_payment_settings_read on public.employee_payment_settings for select to authenticated
  using(private.can_access_employee(company_id,employee_id));

create table public.employee_payment_days (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  local_date date not null,
  meal_units integer not null default 0 check(meal_units between 0 and 10),
  dinner_units integer not null default 0 check(dinner_units between 0 and 10),
  daily_allowance_units integer not null default 0 check(daily_allowance_units between 0 and 10),
  night_shift_units integer not null default 0 check(night_shift_units between 0 and 10),
  saturday_units integer not null default 0 check(saturday_units between 0 and 10),
  version integer not null default 1 check(version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,employee_id,local_date),
  foreign key(company_id,employee_id) references public.employees(company_id,id)
);
create index employee_payment_days_company_employee_date_idx on public.employee_payment_days(company_id,employee_id,local_date desc);
alter table public.employee_payment_days enable row level security;
revoke all on public.employee_payment_days from public,anon,authenticated;
grant select on public.employee_payment_days to authenticated;
create policy employee_payment_days_read on public.employee_payment_days for select to authenticated
  using(private.can_access_employee(company_id,employee_id));

create function private.save_employee_payment_settings(
  p_company uuid,p_employee uuid,p_regular_hour_cents integer,p_overtime_hour_cents integer,
  p_meal_cents integer,p_dinner_cents integer,p_daily_allowance_cents integer,
  p_night_shift_cents integer,p_saturday_cents integer,p_expected_version integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.employees; saved public.employee_payment_settings;
begin
  if auth.uid() is null or not private.can_manage(p_company) then raise exception 'Managerial role required' using errcode='42501'; end if;
  if p_regular_hour_cents not between 0 and 10000000 or p_overtime_hour_cents not between 0 and 10000000
    or p_meal_cents not between 0 and 10000000 or p_dinner_cents not between 0 and 10000000
    or p_daily_allowance_cents not between 0 and 10000000 or p_night_shift_cents not between 0 and 10000000
    or p_saturday_cents not between 0 and 10000000 then raise exception 'Invalid payment value' using errcode='23514'; end if;
  select * into target from public.employees where company_id=p_company and id=p_employee;
  if target.id is null then raise exception 'Employee not found' using errcode='23503'; end if;
  select * into saved from public.employee_payment_settings where company_id=p_company and employee_id=p_employee for update;
  if saved.id is null then
    if p_expected_version is not null then raise exception 'Payment settings changed' using errcode='40001'; end if;
    insert into public.employee_payment_settings(company_id,employee_id,regular_hour_cents,overtime_hour_cents,meal_cents,dinner_cents,daily_allowance_cents,night_shift_cents,saturday_cents)
      values(p_company,p_employee,p_regular_hour_cents,p_overtime_hour_cents,p_meal_cents,p_dinner_cents,p_daily_allowance_cents,p_night_shift_cents,p_saturday_cents) returning * into saved;
  else
    if p_expected_version is distinct from saved.version then raise exception 'Payment settings changed' using errcode='40001'; end if;
    update public.employee_payment_settings set regular_hour_cents=p_regular_hour_cents,overtime_hour_cents=p_overtime_hour_cents,
      meal_cents=p_meal_cents,dinner_cents=p_dinner_cents,daily_allowance_cents=p_daily_allowance_cents,
      night_shift_cents=p_night_shift_cents,saturday_cents=p_saturday_cents,version=version+1,updated_at=now()
      where id=saved.id returning * into saved;
  end if;
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,new_value)
    values(p_company,auth.uid(),'PAYMENT_SETTINGS_SAVED','employee_payment_settings',saved.id::text,
      jsonb_build_object('employee_id',p_employee,'regular_hour_cents',p_regular_hour_cents,'overtime_hour_cents',p_overtime_hour_cents,'meal_cents',p_meal_cents,'dinner_cents',p_dinner_cents,'daily_allowance_cents',p_daily_allowance_cents,'night_shift_cents',p_night_shift_cents,'saturday_cents',p_saturday_cents));
  return jsonb_build_object('id',saved.id,'employee_id',saved.employee_id,'regular_hour_cents',saved.regular_hour_cents,'overtime_hour_cents',saved.overtime_hour_cents,'meal_cents',saved.meal_cents,'dinner_cents',saved.dinner_cents,'daily_allowance_cents',saved.daily_allowance_cents,'night_shift_cents',saved.night_shift_cents,'saturday_cents',saved.saturday_cents,'version',saved.version);
end $$;

create function public.save_employee_payment_settings(
  p_company uuid,p_employee uuid,p_regular_hour_cents integer,p_overtime_hour_cents integer,
  p_meal_cents integer,p_dinner_cents integer,p_daily_allowance_cents integer,
  p_night_shift_cents integer,p_saturday_cents integer,p_expected_version integer default null
) returns jsonb language sql security invoker set search_path='' as $$
  select private.save_employee_payment_settings(p_company,p_employee,p_regular_hour_cents,p_overtime_hour_cents,p_meal_cents,p_dinner_cents,p_daily_allowance_cents,p_night_shift_cents,p_saturday_cents,p_expected_version)
$$;

revoke all on function private.save_employee_payment_settings(uuid,uuid,integer,integer,integer,integer,integer,integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.save_employee_payment_settings(uuid,uuid,integer,integer,integer,integer,integer,integer,integer,integer) to authenticated;
revoke all on function public.save_employee_payment_settings(uuid,uuid,integer,integer,integer,integer,integer,integer,integer,integer) from public,anon;
grant execute on function public.save_employee_payment_settings(uuid,uuid,integer,integer,integer,integer,integer,integer,integer,integer) to authenticated;
grant select on public.employee_payment_settings,public.employee_payment_days to service_role;

create function private.save_employee_payment_day(
  p_company uuid,p_employee uuid,p_local_date date,p_meal_units integer,p_dinner_units integer,
  p_daily_allowance_units integer,p_night_shift_units integer,p_saturday_units integer,p_expected_version integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.employees; saved public.employee_payment_days;
begin
  if auth.uid() is null or not private.can_manage(p_company) then raise exception 'Managerial role required' using errcode='42501'; end if;
  if p_meal_units not between 0 and 10 or p_dinner_units not between 0 and 10 or p_daily_allowance_units not between 0 and 10
    or p_night_shift_units not between 0 and 10 or p_saturday_units not between 0 and 10 then raise exception 'Invalid payment units' using errcode='23514'; end if;
  select * into target from public.employees where company_id=p_company and id=p_employee;
  if target.id is null then raise exception 'Employee not found' using errcode='23503'; end if;
  select * into saved from public.employee_payment_days where company_id=p_company and employee_id=p_employee and local_date=p_local_date for update;
  if saved.id is null then
    if p_expected_version is not null then raise exception 'Payment day changed' using errcode='40001'; end if;
    insert into public.employee_payment_days(company_id,employee_id,local_date,meal_units,dinner_units,daily_allowance_units,night_shift_units,saturday_units)
      values(p_company,p_employee,p_local_date,p_meal_units,p_dinner_units,p_daily_allowance_units,p_night_shift_units,p_saturday_units) returning * into saved;
  else
    if p_expected_version is distinct from saved.version then raise exception 'Payment day changed' using errcode='40001'; end if;
    update public.employee_payment_days set meal_units=p_meal_units,dinner_units=p_dinner_units,daily_allowance_units=p_daily_allowance_units,
      night_shift_units=p_night_shift_units,saturday_units=p_saturday_units,version=version+1,updated_at=now()
      where id=saved.id returning * into saved;
  end if;
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,new_value)
    values(p_company,auth.uid(),'PAYMENT_DAY_SAVED','employee_payment_day',saved.id::text,
      jsonb_build_object('employee_id',p_employee,'local_date',p_local_date,'meal_units',p_meal_units,'dinner_units',p_dinner_units,'daily_allowance_units',p_daily_allowance_units,'night_shift_units',p_night_shift_units,'saturday_units',p_saturday_units));
  return jsonb_build_object('id',saved.id,'employee_id',saved.employee_id,'local_date',saved.local_date,'meal_units',saved.meal_units,'dinner_units',saved.dinner_units,'daily_allowance_units',saved.daily_allowance_units,'night_shift_units',saved.night_shift_units,'saturday_units',saved.saturday_units,'version',saved.version);
end $$;

create function public.save_employee_payment_day(
  p_company uuid,p_employee uuid,p_local_date date,p_meal_units integer,p_dinner_units integer,
  p_daily_allowance_units integer,p_night_shift_units integer,p_saturday_units integer,p_expected_version integer default null
) returns jsonb language sql security invoker set search_path='' as $$
  select private.save_employee_payment_day(p_company,p_employee,p_local_date,p_meal_units,p_dinner_units,p_daily_allowance_units,p_night_shift_units,p_saturday_units,p_expected_version)
$$;
revoke all on function private.save_employee_payment_day(uuid,uuid,date,integer,integer,integer,integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.save_employee_payment_day(uuid,uuid,date,integer,integer,integer,integer,integer,integer) to authenticated;
revoke all on function public.save_employee_payment_day(uuid,uuid,date,integer,integer,integer,integer,integer,integer) from public,anon;
grant execute on function public.save_employee_payment_day(uuid,uuid,date,integer,integer,integer,integer,integer,integer) to authenticated;

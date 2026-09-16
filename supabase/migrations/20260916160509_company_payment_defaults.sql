create table public.company_payment_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id),
  regular_hour_cents integer not null default 0 check(regular_hour_cents between 0 and 10000000),
  overtime_hour_cents integer not null default 0 check(overtime_hour_cents between 0 and 10000000),
  meal_cents integer not null default 0 check(meal_cents between 0 and 10000000),
  dinner_cents integer not null default 0 check(dinner_cents between 0 and 10000000),
  daily_allowance_cents integer not null default 0 check(daily_allowance_cents between 0 and 10000000),
  night_shift_cents integer not null default 0 check(night_shift_cents between 0 and 10000000),
  saturday_cents integer not null default 0 check(saturday_cents between 0 and 10000000),
  version integer not null default 1 check(version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.company_payment_settings enable row level security;
revoke all on public.company_payment_settings from public,anon,authenticated;
grant select on public.company_payment_settings to authenticated;
create policy company_payment_settings_read on public.company_payment_settings for select to authenticated
  using(private.can_manage(company_id));

alter table public.employee_payment_settings add column use_company_defaults boolean not null default true;

create function private.save_company_payment_settings(
  p_company uuid,p_regular_hour_cents integer,p_overtime_hour_cents integer,p_meal_cents integer,p_dinner_cents integer,
  p_daily_allowance_cents integer,p_night_shift_cents integer,p_saturday_cents integer,p_expected_version integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.company_payment_settings;
begin
  if auth.uid() is null or not private.can_manage(p_company) then raise exception 'Managerial role required' using errcode='42501'; end if;
  if p_regular_hour_cents not between 0 and 10000000 or p_overtime_hour_cents not between 0 and 10000000 or p_meal_cents not between 0 and 10000000 or p_dinner_cents not between 0 and 10000000 or p_daily_allowance_cents not between 0 and 10000000 or p_night_shift_cents not between 0 and 10000000 or p_saturday_cents not between 0 and 10000000 then raise exception 'Invalid payment value' using errcode='23514'; end if;
  select * into saved from public.company_payment_settings where company_id=p_company for update;
  if saved.id is null then
    if p_expected_version is not null then raise exception 'Payment settings changed' using errcode='40001'; end if;
    insert into public.company_payment_settings(company_id,regular_hour_cents,overtime_hour_cents,meal_cents,dinner_cents,daily_allowance_cents,night_shift_cents,saturday_cents) values(p_company,p_regular_hour_cents,p_overtime_hour_cents,p_meal_cents,p_dinner_cents,p_daily_allowance_cents,p_night_shift_cents,p_saturday_cents) returning * into saved;
  else
    if p_expected_version is distinct from saved.version then raise exception 'Payment settings changed' using errcode='40001'; end if;
    update public.company_payment_settings set regular_hour_cents=p_regular_hour_cents,overtime_hour_cents=p_overtime_hour_cents,meal_cents=p_meal_cents,dinner_cents=p_dinner_cents,daily_allowance_cents=p_daily_allowance_cents,night_shift_cents=p_night_shift_cents,saturday_cents=p_saturday_cents,version=version+1,updated_at=now() where id=saved.id returning * into saved;
  end if;
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,new_value) values(p_company,auth.uid(),'COMPANY_PAYMENT_SETTINGS_SAVED','company_payment_settings',saved.id::text,jsonb_build_object('regular_hour_cents',p_regular_hour_cents,'overtime_hour_cents',p_overtime_hour_cents,'meal_cents',p_meal_cents,'dinner_cents',p_dinner_cents,'daily_allowance_cents',p_daily_allowance_cents,'night_shift_cents',p_night_shift_cents,'saturday_cents',p_saturday_cents));
  return jsonb_build_object('id',saved.id,'company_id',saved.company_id,'regular_hour_cents',saved.regular_hour_cents,'overtime_hour_cents',saved.overtime_hour_cents,'meal_cents',saved.meal_cents,'dinner_cents',saved.dinner_cents,'daily_allowance_cents',saved.daily_allowance_cents,'night_shift_cents',saved.night_shift_cents,'saturday_cents',saved.saturday_cents,'version',saved.version);
end $$;
create function public.save_company_payment_settings(p_company uuid,p_regular_hour_cents integer,p_overtime_hour_cents integer,p_meal_cents integer,p_dinner_cents integer,p_daily_allowance_cents integer,p_night_shift_cents integer,p_saturday_cents integer,p_expected_version integer default null) returns jsonb language sql security invoker set search_path='' as $$ select private.save_company_payment_settings(p_company,p_regular_hour_cents,p_overtime_hour_cents,p_meal_cents,p_dinner_cents,p_daily_allowance_cents,p_night_shift_cents,p_saturday_cents,p_expected_version) $$;
revoke all on function private.save_company_payment_settings(uuid,integer,integer,integer,integer,integer,integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.save_company_payment_settings(uuid,integer,integer,integer,integer,integer,integer,integer,integer) to authenticated;
revoke all on function public.save_company_payment_settings(uuid,integer,integer,integer,integer,integer,integer,integer,integer) from public,anon;
grant execute on function public.save_company_payment_settings(uuid,integer,integer,integer,integer,integer,integer,integer,integer) to authenticated;
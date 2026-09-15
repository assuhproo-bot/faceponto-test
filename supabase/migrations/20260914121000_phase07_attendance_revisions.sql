alter table public.bank_hours drop constraint bank_hours_company_id_calculation_id_key;
create unique index bank_hours_calculation_once_idx on public.bank_hours(company_id,calculation_id)
  where reversal_of is null;
create unique index bank_hours_reversal_once_idx on public.bank_hours(company_id,reversal_of)
  where reversal_of is not null;

create function private.record_attendance_calculation(
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
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode='42501';
  end if;
  if p_journey_end <= p_journey_start or p_input_sha256 !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_result) <> 'object' or jsonb_typeof(p_result->'occurrences') <> 'array'
    or jsonb_typeof(p_result->'classifications') <> 'array' then
    raise exception 'Invalid attendance calculation' using errcode='23514';
  end if;

  insert into public.work_days(company_id,employee_id,schedule_version_id,journey_start,journey_end,local_date,timezone)
  values(p_company,p_employee,p_schedule_version,p_journey_start,p_journey_end,p_local_date,p_timezone)
  on conflict(company_id,employee_id,journey_start) do nothing;
  select * into target_day from public.work_days where company_id=p_company and employee_id=p_employee
    and journey_start=p_journey_start;
  if target_day.schedule_version_id <> p_schedule_version or target_day.journey_end <> p_journey_end
    or target_day.local_date <> p_local_date or target_day.timezone <> p_timezone then
    raise exception 'Work day identity conflict' using errcode='23514';
  end if;

  perform 1 from public.work_days where id=target_day.id for update;
  select * into previous from public.attendance_calculations
    where company_id=p_company and work_day_id=target_day.id and state in ('provisional','final')
    for update;
  next_revision := coalesce(previous.revision,0)+1;
  next_state := case when coalesce((p_result->>'provisional')::boolean,false) then 'provisional' else 'final' end;

  if previous.id is not null then
    update public.attendance_calculations set state='superseded' where id=previous.id;
  end if;

  insert into public.attendance_calculations(
    company_id,work_day_id,revision,engine_version,rules_version,state,planned_minutes,worked_minutes,
    late_minutes,late_after_tolerance_minutes,early_departure_minutes,break_minutes,gross_overtime_minutes,
    overtime_after_tolerance_minutes,net_balance_minutes,classifications,input_hash
  ) values(
    p_company,target_day.id,next_revision,(p_result->>'engine_version')::integer,(p_result->>'rules_version')::integer,
    next_state,(p_result->>'planned_minutes')::integer,(p_result->>'worked_minutes')::integer,
    (p_result->>'late_minutes')::integer,(p_result->>'late_after_tolerance_minutes')::integer,
    (p_result->>'early_departure_minutes')::integer,(p_result->>'break_minutes')::integer,
    (p_result->>'gross_overtime_minutes')::integer,(p_result->>'overtime_after_tolerance_minutes')::integer,
    (p_result->>'net_balance_minutes')::integer,p_result->'classifications',decode(p_input_sha256,'hex')
  ) returning * into calculation;

  for item in select value from jsonb_array_elements(p_result->'occurrences') loop
    insert into public.attendance_occurrences(company_id,work_day_id,calculation_id,employee_id,severity,type,details)
    values(p_company,target_day.id,calculation.id,p_employee,
      coalesce(item->>'severity','warning')::public.occurrence_severity,item->>'code',item-'code'-'severity');
  end loop;

  if previous.id is not null then
    select * into prior_entry from public.bank_hours
      where company_id=p_company and calculation_id=previous.id and reversal_of is null;
    if prior_entry.id is not null then
      insert into public.bank_hours(company_id,employee_id,work_day_id,calculation_id,revision,delta_minutes,reason,reversal_of)
      values(p_company,p_employee,target_day.id,calculation.id,next_revision,-prior_entry.delta_minutes,
        'Estorno automático da revisão anterior',prior_entry.id);
    end if;
  end if;
  if next_state='final' then
    insert into public.bank_hours(company_id,employee_id,work_day_id,calculation_id,revision,delta_minutes,reason)
    values(p_company,p_employee,target_day.id,calculation.id,next_revision,calculation.net_balance_minutes,
      'Cálculo final da jornada');
  end if;

  return jsonb_build_object('work_day_id',target_day.id,'calculation_id',calculation.id,
    'revision',calculation.revision,'state',calculation.state);
end
$$;

create function public.record_attendance_calculation(
  p_company uuid,p_employee uuid,p_schedule_version uuid,p_journey_start timestamptz,p_journey_end timestamptz,
  p_local_date date,p_timezone text,p_result jsonb,p_input_sha256 text
) returns jsonb language sql security invoker set search_path='' as $$
  select private.record_attendance_calculation(p_company,p_employee,p_schedule_version,p_journey_start,p_journey_end,
    p_local_date,p_timezone,p_result,p_input_sha256)
$$;

revoke all on function private.record_attendance_calculation(uuid,uuid,uuid,timestamptz,timestamptz,date,text,jsonb,text) from public,anon,authenticated;
grant execute on function private.record_attendance_calculation(uuid,uuid,uuid,timestamptz,timestamptz,date,text,jsonb,text) to authenticated;
revoke all on function public.record_attendance_calculation(uuid,uuid,uuid,timestamptz,timestamptz,date,text,jsonb,text) from public,anon;
grant execute on function public.record_attendance_calculation(uuid,uuid,uuid,timestamptz,timestamptz,date,text,jsonb,text) to authenticated;

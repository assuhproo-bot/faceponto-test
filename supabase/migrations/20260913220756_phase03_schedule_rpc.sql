create function private.create_schedule(
  p_company uuid,
  p_name text,
  p_timezone text,
  p_rules jsonb,
  p_weekdays smallint[],
  p_segments jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  schedule_id uuid;
  version_id uuid;
  segment jsonb;
  weekday smallint;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if coalesce(array_length(p_weekdays, 1), 0) = 0
    or jsonb_typeof(p_segments) is distinct from 'array'
    or jsonb_array_length(p_segments) = 0 then
    raise exception 'Schedule needs weekdays and segments' using errcode = '23514';
  end if;
  insert into public.work_schedules(company_id, name)
    values(p_company, p_name) returning id into schedule_id;
  insert into public.schedule_versions(company_id, schedule_id, version, timezone, rules)
    values(p_company, schedule_id, 1, p_timezone, p_rules) returning id into version_id;
  foreach weekday in array p_weekdays loop
    insert into public.schedule_weekdays(company_id, schedule_version_id, iso_weekday)
      values(p_company, version_id, weekday);
  end loop;
  for segment in select value from jsonb_array_elements(p_segments) loop
    insert into public.schedule_segments(company_id, schedule_version_id, ordinal, start_minute, end_minute)
      values(p_company, version_id, (segment->>'ordinal')::smallint,
        (segment->>'start_minute')::integer, (segment->>'end_minute')::integer);
  end loop;
  return schedule_id;
end
$$;

create function public.create_schedule(
  p_company uuid,
  p_name text,
  p_timezone text,
  p_rules jsonb,
  p_weekdays smallint[],
  p_segments jsonb
) returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_schedule(p_company, p_name, p_timezone, p_rules, p_weekdays, p_segments)
$$;

revoke all on function private.create_schedule(uuid,text,text,jsonb,smallint[],jsonb) from public, anon, authenticated;
grant execute on function private.create_schedule(uuid,text,text,jsonb,smallint[],jsonb) to authenticated;
revoke all on function public.create_schedule(uuid,text,text,jsonb,smallint[],jsonb) from public, anon;
grant execute on function public.create_schedule(uuid,text,text,jsonb,smallint[],jsonb) to authenticated;

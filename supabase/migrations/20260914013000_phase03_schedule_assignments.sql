create function private.assign_schedule(
  p_company uuid,
  p_employee uuid,
  p_schedule_version uuid,
  p_valid_from timestamptz,
  p_valid_to timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare result uuid;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  insert into public.schedule_assignments(company_id, employee_id, schedule_version_id, valid_from, valid_to)
    values(p_company, p_employee, p_schedule_version, p_valid_from, p_valid_to)
    returning id into result;
  return result;
end
$$;

create function public.assign_schedule(
  p_company uuid,
  p_employee uuid,
  p_schedule_version uuid,
  p_valid_from timestamptz,
  p_valid_to timestamptz default null
) returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.assign_schedule(p_company, p_employee, p_schedule_version, p_valid_from, p_valid_to)
$$;

create function private.close_schedule_assignment(
  p_company uuid,
  p_assignment uuid,
  p_valid_to timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare result uuid;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  update public.schedule_assignments
    set valid_to = p_valid_to
    where company_id = p_company and id = p_assignment and valid_to is null and p_valid_to > valid_from
    returning id into result;
  if result is null then
    raise exception 'Open schedule assignment not found or invalid end' using errcode = '23514';
  end if;
  return result;
end
$$;

create function public.close_schedule_assignment(
  p_company uuid,
  p_assignment uuid,
  p_valid_to timestamptz
) returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.close_schedule_assignment(p_company, p_assignment, p_valid_to)
$$;

revoke all on function private.assign_schedule(uuid,uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function private.assign_schedule(uuid,uuid,uuid,timestamptz,timestamptz) to authenticated;
revoke all on function public.assign_schedule(uuid,uuid,uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.assign_schedule(uuid,uuid,uuid,timestamptz,timestamptz) to authenticated;

revoke all on function private.close_schedule_assignment(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function private.close_schedule_assignment(uuid,uuid,timestamptz) to authenticated;
revoke all on function public.close_schedule_assignment(uuid,uuid,timestamptz) from public, anon;
grant execute on function public.close_schedule_assignment(uuid,uuid,timestamptz) to authenticated;

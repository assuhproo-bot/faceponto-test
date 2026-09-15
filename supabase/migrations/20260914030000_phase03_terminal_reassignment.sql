create or replace function private.bump_terminal_version() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.name is distinct from new.name or old.active is distinct from new.active or old.location_id is distinct from new.location_id then
    new.version := old.version + 1;
  end if;
  return new;
end $$;

create function private.reassign_terminal(
  p_company uuid,
  p_terminal uuid,
  p_new_location uuid,
  p_expected_version integer,
  p_effective_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  terminal_row public.terminals;
  current_assignment public.terminal_location_assignments;
  new_assignment public.terminal_location_assignments;
begin
  if auth.uid() is null or private.company_role(p_company) is distinct from 'administrator' then
    raise exception 'Administrator required' using errcode='42501';
  end if;
  select * into terminal_row from public.terminals
    where company_id=p_company and id=p_terminal for update;
  if terminal_row.id is null or terminal_row.version <> p_expected_version then
    raise exception 'Version conflict' using errcode='40001';
  end if;
  if terminal_row.location_id = p_new_location then
    raise exception 'Terminal already belongs to location' using errcode='23514';
  end if;
  if not exists(select 1 from public.locations where company_id=p_company and id=p_new_location and active) then
    raise exception 'Active company location required' using errcode='23514';
  end if;
  select * into current_assignment from public.terminal_location_assignments
    where company_id=p_company and terminal_id=p_terminal and valid_to is null for update;
  if current_assignment.id is null or p_effective_at <= current_assignment.valid_from then
    raise exception 'Open assignment or valid effective time required' using errcode='23514';
  end if;
  if abs(extract(epoch from (p_effective_at - clock_timestamp()))) > 30 then
    raise exception 'Reassignment must be immediate' using errcode='23514';
  end if;
  update public.terminal_location_assignments set valid_to=p_effective_at where id=current_assignment.id;
  insert into public.terminal_location_assignments(company_id,terminal_id,location_id,version,valid_from)
    values(p_company,p_terminal,p_new_location,current_assignment.version+1,p_effective_at)
    returning * into new_assignment;
  update public.terminals set location_id=p_new_location where id=p_terminal returning * into terminal_row;
  return jsonb_build_object(
    'terminal_id',terminal_row.id,'location_id',terminal_row.location_id,'terminal_version',terminal_row.version,
    'assignment_id',new_assignment.id,'assignment_version',new_assignment.version,'effective_at',new_assignment.valid_from
  );
end $$;

create function public.reassign_terminal(p_company uuid,p_terminal uuid,p_new_location uuid,p_expected_version integer,p_effective_at timestamptz)
returns jsonb language sql security invoker set search_path='' as $$
  select private.reassign_terminal(p_company,p_terminal,p_new_location,p_expected_version,p_effective_at)
$$;

revoke all on function private.reassign_terminal(uuid,uuid,uuid,integer,timestamptz) from public,anon,authenticated;
grant execute on function private.reassign_terminal(uuid,uuid,uuid,integer,timestamptz) to authenticated;
revoke all on function public.reassign_terminal(uuid,uuid,uuid,integer,timestamptz) from public,anon;
grant execute on function public.reassign_terminal(uuid,uuid,uuid,integer,timestamptz) to authenticated;

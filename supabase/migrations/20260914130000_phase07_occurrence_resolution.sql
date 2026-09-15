create function private.resolve_attendance_occurrence(p_company uuid,p_occurrence uuid,p_resolution text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare resolved public.attendance_occurrences;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode='42501';
  end if;
  if length(trim(p_resolution)) not between 1 and 500 then
    raise exception 'Resolution is required' using errcode='23514';
  end if;
  update public.attendance_occurrences set status='resolved',resolution=trim(p_resolution),
    resolved_by=auth.uid(),resolved_at=now()
    where company_id=p_company and id=p_occurrence and status='open'
    returning * into resolved;
  if resolved.id is null then
    raise exception 'Open occurrence not found' using errcode='23514';
  end if;
  return jsonb_build_object('id',resolved.id,'status',resolved.status,'resolution',resolved.resolution,
    'resolved_by',resolved.resolved_by,'resolved_at',resolved.resolved_at);
end $$;

create function public.resolve_attendance_occurrence(p_company uuid,p_occurrence uuid,p_resolution text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.resolve_attendance_occurrence(p_company,p_occurrence,p_resolution)
$$;
revoke all on function private.resolve_attendance_occurrence(uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.resolve_attendance_occurrence(uuid,uuid,text) to authenticated;
revoke all on function public.resolve_attendance_occurrence(uuid,uuid,text) from public,anon;
grant execute on function public.resolve_attendance_occurrence(uuid,uuid,text) to authenticated;

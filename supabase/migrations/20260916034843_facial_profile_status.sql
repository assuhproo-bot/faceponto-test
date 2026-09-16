create function private.list_facial_profile_status(p_company uuid)
returns table(employee_id uuid, profile_version integer, prepared_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode='42501';
  end if;

  return query
    select profile.employee_id, profile.version, profile.created_at
    from private.facial_profiles profile
    where profile.company_id=p_company and profile.active
    order by profile.created_at desc;
end $$;

create function public.list_facial_profile_status(p_company uuid)
returns table(employee_id uuid, profile_version integer, prepared_at timestamptz)
language sql security invoker set search_path='' as $$
  select * from private.list_facial_profile_status(p_company)
$$;

revoke all on function private.list_facial_profile_status(uuid) from public,anon,authenticated,service_role;
grant execute on function private.list_facial_profile_status(uuid) to authenticated;
revoke all on function public.list_facial_profile_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_facial_profile_status(uuid) to authenticated;

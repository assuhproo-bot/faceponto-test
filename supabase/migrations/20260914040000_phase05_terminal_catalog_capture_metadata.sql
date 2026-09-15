create or replace function private.terminal_catalog()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  target public.terminals;
  assignment public.terminal_location_assignments;
  employees jsonb;
begin
  select * into target from public.terminals where auth_user_id=auth.uid() and active;
  if target.id is null then raise exception 'Active terminal required' using errcode='42501'; end if;
  select * into assignment from public.terminal_location_assignments
    where company_id=target.company_id and terminal_id=target.id and valid_from<=now() and (valid_to is null or valid_to>now())
    order by version desc limit 1;
  if assignment.id is null then raise exception 'Active terminal assignment required' using errcode='23514'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'name',e.name,'version',e.version,
    'profile_id',fp.id,'profile_version',fp.version,
    'recognition_model_sha256',fp.recognition_model_sha256,
    'liveness_model_sha256',fp.liveness_model_sha256,'policy_version',fp.policy_version
  ) order by e.id),'[]'::jsonb) into employees
  from public.employees e
  left join lateral (
    select p.id,p.version,p.recognition_model_sha256,p.liveness_model_sha256,p.policy_version
    from private.facial_profiles p where p.company_id=e.company_id and p.employee_id=e.id and p.active
    order by p.version desc limit 1
  ) fp on true
  where e.company_id=target.company_id and e.active and (
    e.home_location_id=target.location_id or exists(
      select 1 from public.employee_locations el where el.company_id=e.company_id and el.employee_id=e.id
        and el.location_id=target.location_id and el.valid_from<=now() and (el.valid_to is null or el.valid_to>now())
    ));
  return jsonb_build_object('terminal_id',target.id,'company_id',target.company_id,'location_id',target.location_id,
    'terminal_assignment_id',assignment.id,'terminal_assignment_version',assignment.version,'generated_at',now(),'employees',employees);
end $$;

-- The debug-only MiniFAS PAD implementation identifies policy version 2 by
-- this descriptor hash. The server stores policy metadata only; no image,
-- embedding, frame, score, or liveness output is persisted.
create or replace function private.provision_facial_profile(p_company uuid,p_employee uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare employee public.employees; next_version integer; profile private.facial_profiles;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode='42501';
  end if;
  select * into employee from public.employees
    where id=p_employee and company_id=p_company and active for update;
  if employee.id is null then raise exception 'Active employee not found' using errcode='23514'; end if;
  select coalesce(max(version),0)+1 into next_version from private.facial_profiles
    where company_id=p_company and employee_id=p_employee;
  update private.facial_profiles set active=false
    where company_id=p_company and employee_id=p_employee and active;
  insert into private.facial_profiles(
    id,company_id,employee_id,version,recognition_model_sha256,liveness_model_sha256,policy_version,active
  ) values (
    gen_random_uuid(),p_company,p_employee,next_version,
    '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
    '1f1ff7268858f92ff9777f6860cdd38a13a0cc2552f9514c427f7c9deb7200f2',2,true
  ) returning * into profile;
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,new_value)
    values(p_company,auth.uid(),'FACIAL_PROFILE_PROVISIONED','facial_profile',profile.id::text,
      jsonb_build_object('employee_id',p_employee,'version',profile.version,'storage','terminal_local_only'));
  return jsonb_build_object('id',profile.id,'employee_id',profile.employee_id,'version',profile.version,
    'recognition_model_sha256',profile.recognition_model_sha256,'liveness_model_sha256',profile.liveness_model_sha256,
    'policy_version',profile.policy_version);
end $$;

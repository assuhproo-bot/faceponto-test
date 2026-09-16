create table public.manual_punches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  location_id uuid not null,
  "timestamp" timestamptz not null,
  reason text not null check(length(trim(reason)) between 1 and 500),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,employee_id) references public.employees(company_id,id),
  foreign key(company_id,location_id) references public.locations(company_id,id),
  foreign key(actor_id) references public.users(id)
);
create index manual_punches_employee_timestamp_idx on public.manual_punches(company_id,employee_id,"timestamp" desc);
create index manual_punches_location_timestamp_idx on public.manual_punches(company_id,location_id,"timestamp" desc);
alter table public.manual_punches enable row level security;
revoke all on public.manual_punches from public,anon,authenticated;
grant select on public.manual_punches to authenticated;
create policy manual_punches_read on public.manual_punches for select to authenticated
  using(private.can_access_employee(company_id,employee_id));

create function private.create_manual_punch(
  p_company uuid,p_employee uuid,p_location uuid,p_timestamp timestamptz,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare employee public.employees; location public.locations; created public.manual_punches;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode='42501';
  end if;
  if p_timestamp is null or length(trim(coalesce(p_reason,''))) not between 1 and 500 then
    raise exception 'Invalid manual punch' using errcode='23514';
  end if;
  select * into employee from public.employees where id=p_employee and company_id=p_company and active;
  if employee.id is null then raise exception 'Active employee not found' using errcode='23503'; end if;
  select * into location from public.locations where id=p_location and company_id=p_company and active;
  if location.id is null then raise exception 'Active location not found' using errcode='23503'; end if;
  if not (employee.home_location_id=location.id or exists(
    select 1 from public.employee_locations el where el.company_id=p_company and el.employee_id=p_employee and el.location_id=p_location
      and el.valid_from<=p_timestamp and (el.valid_to is null or el.valid_to>p_timestamp)
  )) then raise exception 'Employee not authorized for location' using errcode='23514'; end if;

  insert into public.manual_punches(company_id,employee_id,location_id,"timestamp",reason,actor_id)
    values(p_company,p_employee,p_location,p_timestamp,trim(p_reason),auth.uid()) returning * into created;
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,new_value)
    values(p_company,auth.uid(),'MANUAL_PUNCH_CREATED','manual_punch',created.id::text,
      jsonb_build_object('employee_id',p_employee,'location_id',p_location,'timestamp',p_timestamp,'reason',trim(p_reason)));
  perform private.enqueue_attendance_recalculation(p_company,p_employee,p_timestamp);
  return jsonb_build_object('id',created.id,'employee_id',created.employee_id,'location_id',created.location_id,
    'timestamp',created."timestamp",'reason',created.reason,'created_at',created.created_at);
end $$;

create function public.create_manual_punch(p_company uuid,p_employee uuid,p_location uuid,p_timestamp timestamptz,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.create_manual_punch(p_company,p_employee,p_location,p_timestamp,p_reason)
$$;

revoke all on function private.create_manual_punch(uuid,uuid,uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function private.create_manual_punch(uuid,uuid,uuid,timestamptz,text) to authenticated;
revoke all on function public.create_manual_punch(uuid,uuid,uuid,timestamptz,text) from public,anon;
grant execute on function public.create_manual_punch(uuid,uuid,uuid,timestamptz,text) to authenticated;
grant select on public.manual_punches to service_role;

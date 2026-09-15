alter table private.attendance_recalculation_queue add column lease_token uuid;
alter table private.attendance_recalculation_queue add constraint attendance_recalculation_lease_check
  check((lease_until is null and lease_token is null) or (lease_until is not null and lease_token is not null));

create or replace function private.queue_attendance_recalculation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.attendance_recalculation_queue(company_id,employee_id,affected_from,affected_to)
  values(new.company_id,new.employee_id,new."timestamp"-interval '36 hours',new."timestamp"+interval '36 hours')
  on conflict(company_id,employee_id) do update set
    affected_from=least(private.attendance_recalculation_queue.affected_from,excluded.affected_from),
    affected_to=greatest(private.attendance_recalculation_queue.affected_to,excluded.affected_to),
    requested_at=now(),next_attempt_at=now(),lease_until=null,lease_token=null,last_error=null;
  return new;
end $$;

create function private.claim_attendance_recalculation(p_lease_seconds integer default 60)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target private.attendance_recalculation_queue; token uuid := gen_random_uuid();
begin
  if current_setting('role',true) <> 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if p_lease_seconds not between 10 and 600 then raise exception 'Invalid lease' using errcode='23514'; end if;
  select * into target from private.attendance_recalculation_queue
    where next_attempt_at <= now() and (lease_until is null or lease_until < now())
    order by requested_at for update skip locked limit 1;
  if target.company_id is null then return null; end if;
  update private.attendance_recalculation_queue set attempts=attempts+1,
    lease_until=now()+make_interval(secs=>p_lease_seconds),lease_token=token
    where company_id=target.company_id and employee_id=target.employee_id;
  return jsonb_build_object('company_id',target.company_id,'employee_id',target.employee_id,
    'affected_from',target.affected_from,'affected_to',target.affected_to,
    'requested_at',target.requested_at,'lease_token',token,'attempt',target.attempts+1);
end $$;

create function private.complete_attendance_recalculation(p_company uuid,p_employee uuid,p_lease_token uuid,p_requested_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
  if current_setting('role',true) <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  delete from private.attendance_recalculation_queue where company_id=p_company and employee_id=p_employee
    and lease_token=p_lease_token and requested_at=p_requested_at;
  get diagnostics removed = row_count;
  return removed=1;
end $$;

create function private.fail_attendance_recalculation(p_company uuid,p_employee uuid,p_lease_token uuid,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  if current_setting('role',true) <> 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
  update private.attendance_recalculation_queue set lease_until=null,lease_token=null,
    next_attempt_at=now()+least(interval '15 minutes',make_interval(secs=>power(2,least(attempts,9))::integer)),
    last_error=left(coalesce(nullif(trim(p_error),''),'processing failed'),500)
    where company_id=p_company and employee_id=p_employee and lease_token=p_lease_token;
  get diagnostics changed = row_count;
  return changed=1;
end $$;

create function public.claim_attendance_recalculation(p_lease_seconds integer default 60)
returns jsonb language sql security invoker set search_path='' as $$ select private.claim_attendance_recalculation(p_lease_seconds) $$;
create function public.complete_attendance_recalculation(p_company uuid,p_employee uuid,p_lease_token uuid,p_requested_at timestamptz)
returns boolean language sql security invoker set search_path='' as $$ select private.complete_attendance_recalculation(p_company,p_employee,p_lease_token,p_requested_at) $$;
create function public.fail_attendance_recalculation(p_company uuid,p_employee uuid,p_lease_token uuid,p_error text)
returns boolean language sql security invoker set search_path='' as $$ select private.fail_attendance_recalculation(p_company,p_employee,p_lease_token,p_error) $$;

revoke all on function private.claim_attendance_recalculation(integer),private.complete_attendance_recalculation(uuid,uuid,uuid,timestamptz),private.fail_attendance_recalculation(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.claim_attendance_recalculation(integer),private.complete_attendance_recalculation(uuid,uuid,uuid,timestamptz),private.fail_attendance_recalculation(uuid,uuid,uuid,text) to service_role;
revoke all on function public.claim_attendance_recalculation(integer),public.complete_attendance_recalculation(uuid,uuid,uuid,timestamptz),public.fail_attendance_recalculation(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_attendance_recalculation(integer),public.complete_attendance_recalculation(uuid,uuid,uuid,timestamptz),public.fail_attendance_recalculation(uuid,uuid,uuid,text) to service_role;

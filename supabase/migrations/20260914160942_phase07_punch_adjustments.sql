create table public.punch_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  original_time_punch_id uuid not null,
  original_value jsonb not null check(jsonb_typeof(original_value)='object'),
  new_value jsonb not null check(jsonb_typeof(new_value)='object'),
  corrected_timestamp timestamptz not null,
  reason text not null check(length(trim(reason)) between 1 and 500),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,employee_id) references public.employees(company_id,id),
  foreign key(company_id,original_time_punch_id) references public.time_punches(company_id,id),
  foreign key(actor_id) references public.users(id)
);
create index punch_adjustments_employee_timestamp_idx
  on public.punch_adjustments(company_id,employee_id,corrected_timestamp,created_at desc);
create index punch_adjustments_original_idx
  on public.punch_adjustments(company_id,original_time_punch_id,created_at desc);

alter table public.punch_adjustments enable row level security;
revoke all on public.punch_adjustments from public,anon,authenticated;
grant select on public.punch_adjustments to authenticated;
create policy punch_adjustments_read on public.punch_adjustments for select to authenticated
  using(private.can_access_employee(company_id,employee_id));

create function private.enqueue_attendance_recalculation(p_company uuid,p_employee uuid,p_timestamp timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into private.attendance_recalculation_queue(company_id,employee_id,affected_from,affected_to)
  values(p_company,p_employee,p_timestamp-interval '36 hours',p_timestamp+interval '36 hours')
  on conflict(company_id,employee_id) do update set
    affected_from=least(private.attendance_recalculation_queue.affected_from,excluded.affected_from),
    affected_to=greatest(private.attendance_recalculation_queue.affected_to,excluded.affected_to),
    requested_at=now(),next_attempt_at=now(),lease_until=null,lease_token=null,last_error=null;
end $$;

create or replace function private.queue_attendance_recalculation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform private.enqueue_attendance_recalculation(new.company_id,new.employee_id,new."timestamp");
  return new;
end $$;

create function private.create_punch_adjustment(
  p_company uuid,p_time_punch uuid,p_corrected_timestamp timestamptz,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.time_punches; adjustment public.punch_adjustments;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode='42501';
  end if;
  if p_corrected_timestamp is null or length(trim(coalesce(p_reason,''))) not between 1 and 500 then
    raise exception 'Invalid adjustment' using errcode='23514';
  end if;
  select * into target from public.time_punches
    where company_id=p_company and id=p_time_punch and sync_status='accepted';
  if target.id is null then raise exception 'Accepted punch not found' using errcode='23503'; end if;

  insert into public.punch_adjustments(
    company_id,employee_id,original_time_punch_id,original_value,new_value,corrected_timestamp,reason,actor_id
  ) values (
    p_company,target.employee_id,target.id,
    jsonb_build_object('id',target.id,'timestamp',target."timestamp",'location_id',target.location_id,
      'terminal_id',target.terminal_id,'receipt_id',target.receipt_id),
    jsonb_build_object('timestamp',p_corrected_timestamp,'source','administrative_adjustment'),
    p_corrected_timestamp,trim(p_reason),auth.uid()
  ) returning * into adjustment;
  perform private.enqueue_attendance_recalculation(p_company,target.employee_id,target."timestamp");
  perform private.enqueue_attendance_recalculation(p_company,target.employee_id,p_corrected_timestamp);
  return jsonb_build_object('id',adjustment.id,'employee_id',adjustment.employee_id,
    'original_time_punch_id',adjustment.original_time_punch_id,'corrected_timestamp',adjustment.corrected_timestamp,
    'created_at',adjustment.created_at);
end $$;

create function public.create_punch_adjustment(
  p_company uuid,p_time_punch uuid,p_corrected_timestamp timestamptz,p_reason text
) returns jsonb language sql security invoker set search_path='' as $$
  select private.create_punch_adjustment(p_company,p_time_punch,p_corrected_timestamp,p_reason)
$$;

create function private.guard_punch_adjustment_immutable()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'Punch adjustments are immutable' using errcode='55000';
end $$;

create trigger guard_punch_adjustments before update or delete on public.punch_adjustments
  for each row execute function private.guard_punch_adjustment_immutable();
create trigger audit_punch_adjustments after insert on public.punch_adjustments
  for each row execute function private.audit_change();

revoke all on function private.enqueue_attendance_recalculation(uuid,uuid,timestamptz),
  private.queue_attendance_recalculation(),private.create_punch_adjustment(uuid,uuid,timestamptz,text),
  private.guard_punch_adjustment_immutable() from public,anon,authenticated;
grant execute on function private.enqueue_attendance_recalculation(uuid,uuid,timestamptz),
  private.queue_attendance_recalculation(),private.guard_punch_adjustment_immutable() to postgres;
revoke all on function public.create_punch_adjustment(uuid,uuid,timestamptz,text) from public,anon;
grant execute on function public.create_punch_adjustment(uuid,uuid,timestamptz,text) to authenticated;
grant select on public.punch_adjustments to service_role;

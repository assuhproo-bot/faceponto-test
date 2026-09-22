create table public.manual_punch_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  original_manual_punch_id uuid not null,
  original_value jsonb not null check(jsonb_typeof(original_value) = 'object'),
  new_value jsonb not null check(jsonb_typeof(new_value) = 'object'),
  corrected_timestamp timestamptz not null,
  reason text not null check(length(trim(reason)) between 1 and 500),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  unique(company_id, id),
  foreign key(company_id, employee_id) references public.employees(company_id, id),
  foreign key(company_id, original_manual_punch_id) references public.manual_punches(company_id, id),
  foreign key(actor_id) references public.users(id)
);

create index manual_punch_adjustments_employee_timestamp_idx
  on public.manual_punch_adjustments(company_id, employee_id, corrected_timestamp, created_at desc);
create index manual_punch_adjustments_original_idx
  on public.manual_punch_adjustments(company_id, original_manual_punch_id, created_at desc);

alter table public.manual_punch_adjustments enable row level security;
revoke all on public.manual_punch_adjustments from public, anon, authenticated;
grant select on public.manual_punch_adjustments to authenticated;
create policy manual_punch_adjustments_read on public.manual_punch_adjustments for select to authenticated
  using(private.can_access_employee(company_id, employee_id));

create function private.create_manual_punch_adjustment(
  p_company uuid, p_manual_punch uuid, p_corrected_timestamp timestamptz, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target public.manual_punches;
  adjustment public.manual_punch_adjustments;
  prior_adjustment public.manual_punch_adjustments;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if p_corrected_timestamp is null or length(trim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'Invalid adjustment' using errcode = '23514';
  end if;

  select * into target from public.manual_punches
    where company_id = p_company and id = p_manual_punch
    for update;
  if target.id is null then
    raise exception 'Manual punch not found' using errcode = '23503';
  end if;
  select * into prior_adjustment from public.manual_punch_adjustments
    where company_id = p_company and original_manual_punch_id = target.id
    order by created_at desc, id desc limit 1;

  insert into public.manual_punch_adjustments(
    company_id, employee_id, original_manual_punch_id, original_value, new_value,
    corrected_timestamp, reason, actor_id
  ) values (
    p_company, target.employee_id, target.id,
    jsonb_build_object('id', target.id, 'timestamp', target."timestamp", 'location_id', target.location_id),
    jsonb_build_object('timestamp', p_corrected_timestamp, 'source', 'administrative_adjustment'),
    p_corrected_timestamp, trim(p_reason), auth.uid()
  ) returning * into adjustment;

  perform private.enqueue_attendance_recalculation(p_company, target.employee_id, target."timestamp");
  if prior_adjustment.id is not null then
    perform private.enqueue_attendance_recalculation(p_company, target.employee_id, prior_adjustment.corrected_timestamp);
  end if;
  perform private.enqueue_attendance_recalculation(p_company, target.employee_id, p_corrected_timestamp);

  return jsonb_build_object(
    'id', adjustment.id,
    'employee_id', adjustment.employee_id,
    'original_manual_punch_id', adjustment.original_manual_punch_id,
    'corrected_timestamp', adjustment.corrected_timestamp,
    'created_at', adjustment.created_at
  );
end $$;

create function public.create_manual_punch_adjustment(
  p_company uuid, p_manual_punch uuid, p_corrected_timestamp timestamptz, p_reason text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.create_manual_punch_adjustment(p_company, p_manual_punch, p_corrected_timestamp, p_reason)
$$;

create function private.guard_manual_punch_adjustment_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Manual punch adjustments are immutable' using errcode = '55000';
end $$;

create trigger guard_manual_punch_adjustments before update or delete on public.manual_punch_adjustments
  for each row execute function private.guard_manual_punch_adjustment_immutable();
create trigger audit_manual_punch_adjustments after insert on public.manual_punch_adjustments
  for each row execute function private.audit_change();

revoke all on function private.create_manual_punch_adjustment(uuid, uuid, timestamptz, text),
  private.guard_manual_punch_adjustment_immutable() from public, anon, authenticated;
grant execute on function private.create_manual_punch_adjustment(uuid, uuid, timestamptz, text) to authenticated;
grant execute on function private.guard_manual_punch_adjustment_immutable() to postgres;
revoke all on function public.create_manual_punch_adjustment(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.create_manual_punch_adjustment(uuid, uuid, timestamptz, text) to authenticated;
grant select on public.manual_punch_adjustments to service_role;

-- A second correction replaces the first effective timestamp.  Queue the prior
-- effective value too, otherwise a journey on that earlier day could remain
-- calculated with a punch that no longer belongs to it.
create or replace function private.create_punch_adjustment(
  p_company uuid, p_time_punch uuid, p_corrected_timestamp timestamptz, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target public.time_punches;
  adjustment public.punch_adjustments;
  prior_adjustment public.punch_adjustments;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if p_corrected_timestamp is null or length(trim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'Invalid adjustment' using errcode = '23514';
  end if;

  select * into target from public.time_punches
    where company_id = p_company and id = p_time_punch and sync_status = 'accepted'
    for update;
  if target.id is null then
    raise exception 'Accepted punch not found' using errcode = '23503';
  end if;
  select * into prior_adjustment from public.punch_adjustments
    where company_id = p_company and original_time_punch_id = target.id
    order by created_at desc, id desc limit 1;

  insert into public.punch_adjustments(
    company_id, employee_id, original_time_punch_id, original_value, new_value,
    corrected_timestamp, reason, actor_id
  ) values (
    p_company, target.employee_id, target.id,
    jsonb_build_object('id', target.id, 'timestamp', target."timestamp", 'location_id', target.location_id,
      'terminal_id', target.terminal_id, 'receipt_id', target.receipt_id),
    jsonb_build_object('timestamp', p_corrected_timestamp, 'source', 'administrative_adjustment'),
    p_corrected_timestamp, trim(p_reason), auth.uid()
  ) returning * into adjustment;

  perform private.enqueue_attendance_recalculation(p_company, target.employee_id, target."timestamp");
  if prior_adjustment.id is not null then
    perform private.enqueue_attendance_recalculation(p_company, target.employee_id, prior_adjustment.corrected_timestamp);
  end if;
  perform private.enqueue_attendance_recalculation(p_company, target.employee_id, p_corrected_timestamp);
  return jsonb_build_object(
    'id', adjustment.id,
    'employee_id', adjustment.employee_id,
    'original_time_punch_id', adjustment.original_time_punch_id,
    'corrected_timestamp', adjustment.corrected_timestamp,
    'created_at', adjustment.created_at
  );
end $$;

create table private.attendance_recalculation_queue (
  company_id uuid not null,
  employee_id uuid not null,
  affected_from timestamptz not null,
  affected_to timestamptz not null,
  requested_at timestamptz not null default now(),
  attempts integer not null default 0 check(attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  primary key(company_id,employee_id),
  foreign key(company_id,employee_id) references public.employees(company_id,id),
  check(affected_to > affected_from),
  check(last_error is null or length(last_error) <= 500)
);
alter table private.attendance_recalculation_queue enable row level security;
revoke all on private.attendance_recalculation_queue from public,anon,authenticated;
create policy attendance_recalculation_queue_deny_clients on private.attendance_recalculation_queue
  for all to anon,authenticated using(false) with check(false);

create function private.queue_attendance_recalculation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.attendance_recalculation_queue(company_id,employee_id,affected_from,affected_to)
  values(new.company_id,new.employee_id,new."timestamp"-interval '36 hours',new."timestamp"+interval '36 hours')
  on conflict(company_id,employee_id) do update set
    affected_from=least(private.attendance_recalculation_queue.affected_from,excluded.affected_from),
    affected_to=greatest(private.attendance_recalculation_queue.affected_to,excluded.affected_to),
    requested_at=now(),next_attempt_at=now(),lease_until=null,last_error=null;
  return new;
end $$;
revoke all on function private.queue_attendance_recalculation() from public,anon,authenticated;

create trigger queue_attendance_recalculation after insert on public.time_punches
  for each row execute function private.queue_attendance_recalculation();

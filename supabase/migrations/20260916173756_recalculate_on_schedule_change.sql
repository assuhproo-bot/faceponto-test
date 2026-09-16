create or replace function private.enqueue_attendance_recalculation_range(
  p_company uuid,p_employee uuid,p_from timestamptz,p_to timestamptz
) returns void language plpgsql security definer set search_path='' as $$
begin
  insert into private.attendance_recalculation_queue(company_id,employee_id,affected_from,affected_to)
  values(p_company,p_employee,least(p_from,p_to),greatest(p_from,p_to))
  on conflict(company_id,employee_id) do update set
    affected_from=least(private.attendance_recalculation_queue.affected_from,excluded.affected_from),
    affected_to=greatest(private.attendance_recalculation_queue.affected_to,excluded.affected_to),
    requested_at=now(),next_attempt_at=now(),lease_until=null,lease_token=null,last_error=null;
end $$;

create or replace function private.queue_recalculation_for_schedule_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op = 'DELETE' then
    perform private.enqueue_attendance_recalculation_range(old.company_id,old.employee_id,old.valid_from,coalesce(old.valid_to,now()));
    return old;
  end if;
  perform private.enqueue_attendance_recalculation_range(new.company_id,new.employee_id,new.valid_from,coalesce(new.valid_to,now()));
  return new;
end $$;

create or replace function private.queue_recalculation_for_daily_schedule_plan()
returns trigger language plpgsql security definer set search_path='' as $$
declare target_date date; target_company uuid; target_employee uuid;
begin
  if tg_op = 'DELETE' then
    target_date := old.local_date; target_company := old.company_id; target_employee := old.employee_id;
  else
    target_date := new.local_date; target_company := new.company_id; target_employee := new.employee_id;
  end if;
  perform private.enqueue_attendance_recalculation_range(
    target_company,target_employee,
    target_date::timestamp at time zone 'America/Fortaleza',
    (target_date + 1)::timestamp at time zone 'America/Fortaleza'
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists queue_recalculation_on_schedule_assignment on public.schedule_assignments;
create trigger queue_recalculation_on_schedule_assignment
  after insert or update or delete on public.schedule_assignments
  for each row execute function private.queue_recalculation_for_schedule_assignment();

drop trigger if exists queue_recalculation_on_daily_schedule_plan on public.employee_schedule_plans;
create trigger queue_recalculation_on_daily_schedule_plan
  after insert or update or delete on public.employee_schedule_plans
  for each row execute function private.queue_recalculation_for_daily_schedule_plan();

insert into private.attendance_recalculation_queue(company_id,employee_id,affected_from,affected_to)
select company_id,employee_id,min(valid_from),now()
from public.schedule_assignments
where valid_from <= now()
group by company_id,employee_id
on conflict(company_id,employee_id) do update set
  affected_from=least(private.attendance_recalculation_queue.affected_from,excluded.affected_from),
  affected_to=greatest(private.attendance_recalculation_queue.affected_to,excluded.affected_to),
  requested_at=now(),next_attempt_at=now(),lease_until=null,lease_token=null,last_error=null;

revoke all on function private.enqueue_attendance_recalculation_range(uuid,uuid,timestamptz,timestamptz),
  private.queue_recalculation_for_schedule_assignment(),private.queue_recalculation_for_daily_schedule_plan()
  from public,anon,authenticated;
grant execute on function private.enqueue_attendance_recalculation_range(uuid,uuid,timestamptz,timestamptz),
  private.queue_recalculation_for_schedule_assignment(),private.queue_recalculation_for_daily_schedule_plan() to postgres;
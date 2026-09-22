-- Requeue only journeys that were left provisional by an older attendance
-- rule.  The worker will write a new final revision with the current engine.
insert into private.attendance_recalculation_queue(company_id, employee_id, affected_from, affected_to, requested_at, lease_until, lease_token)
select
  day.company_id,
  day.employee_id,
  min(day.journey_start),
  max(day.journey_end),
  now(),
  null,
  null
from public.work_days as day
join public.attendance_calculations as calculation on calculation.work_day_id = day.id
where calculation.state = 'provisional'
group by day.company_id, day.employee_id
on conflict (company_id, employee_id) do update
set
  affected_from = least(private.attendance_recalculation_queue.affected_from, excluded.affected_from),
  affected_to = greatest(private.attendance_recalculation_queue.affected_to, excluded.affected_to),
  requested_at = excluded.requested_at,
  lease_until = null,
  lease_token = null,
  last_error = null;

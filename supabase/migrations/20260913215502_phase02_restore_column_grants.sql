-- pg-delta emits table-level REVOKE after column-level GRANT in the foundation
-- migration. Restore the intentionally narrow mutation privileges last.
grant update(name, timezone) on public.companies to authenticated;
grant insert(company_id, registration, name, job_title, department_id, home_location_id),
  update(registration, name, job_title, department_id, home_location_id, active)
  on public.employees to authenticated;
grant insert(company_id, name, active), update(name, active)
  on public.locations, public.work_schedules to authenticated;
grant insert(company_id, name), update(name)
  on public.departments to authenticated;
grant insert(company_id, employee_id, location_id, valid_from, valid_to)
  on public.employee_locations to authenticated;
grant insert(company_id, schedule_id, version, timezone, rules)
  on public.schedule_versions to authenticated;
grant insert(company_id, schedule_version_id, iso_weekday)
  on public.schedule_weekdays to authenticated;
grant insert(company_id, schedule_version_id, ordinal, start_minute, end_minute)
  on public.schedule_segments to authenticated;
grant insert(company_id, employee_id, schedule_version_id, valid_from, valid_to)
  on public.schedule_assignments to authenticated;
grant update(name, active) on public.terminals to authenticated;

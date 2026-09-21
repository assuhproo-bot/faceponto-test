-- A justification keeps its own paid/unpaid decision. Editing a category is a
-- rule for future records and must never rewrite historical calculations.
alter table public.day_justifications
  add column if not exists abones_hours boolean;

update public.day_justifications as justification
set abones_hours = category.abones_hours
from public.absence_categories as category
where category.id = justification.absence_category_id
  and category.company_id = justification.company_id
  and justification.abones_hours is null;

alter table public.day_justifications
  alter column abones_hours set default true,
  alter column abones_hours set not null;

create or replace function private.bump_absence_category_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.name is distinct from new.name
    or old.abones_hours is distinct from new.abones_hours
    or old.active is distinct from new.active then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists absence_category_version on public.absence_categories;
create trigger absence_category_version
before update on public.absence_categories
for each row
execute function private.bump_absence_category_version();

create or replace function private.audit_absence_category_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, old_value)
  values(old.company_id, auth.uid(), 'DELETE', 'absence_categories', old.id::text, to_jsonb(old));
  return old;
end
$$;

drop trigger if exists audit_absence_category_delete on public.absence_categories;
create trigger audit_absence_category_delete
after delete on public.absence_categories
for each row
execute function private.audit_absence_category_delete();

create or replace function private.create_absence_category(
  p_company uuid,
  p_name text,
  p_abones_hours boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.absence_categories;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120 then
    raise exception 'Invalid absence category name' using errcode = '23514';
  end if;
  if not exists (select 1 from public.companies where id = p_company and active) then
    raise exception 'Active company not found' using errcode = '23503';
  end if;

  insert into public.absence_categories(company_id, name, abones_hours)
  values(p_company, btrim(p_name), coalesce(p_abones_hours, true))
  returning * into saved;

  return jsonb_build_object(
    'id', saved.id,
    'company_id', saved.company_id,
    'name', saved.name,
    'abones_hours', saved.abones_hours,
    'active', saved.active,
    'version', saved.version,
    'created_at', saved.created_at,
    'updated_at', saved.updated_at
  );
end
$$;

create or replace function public.create_absence_category(
  p_company uuid,
  p_name text,
  p_abones_hours boolean
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.create_absence_category(p_company, p_name, p_abones_hours)
$$;

create or replace function private.update_absence_category(
  p_company uuid,
  p_category uuid,
  p_expected_version integer,
  p_name text default null,
  p_abones_hours boolean default null,
  p_active boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.absence_categories;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'Expected version is required' using errcode = '23514';
  end if;
  if p_name is null and p_abones_hours is null and p_active is null then
    raise exception 'No absence category changes supplied' using errcode = '23514';
  end if;
  if p_name is not null and length(btrim(p_name)) not between 1 and 120 then
    raise exception 'Invalid absence category name' using errcode = '23514';
  end if;

  update public.absence_categories
  set
    name = coalesce(btrim(p_name), name),
    abones_hours = coalesce(p_abones_hours, abones_hours),
    active = coalesce(p_active, active)
  where id = p_category
    and company_id = p_company
    and version = p_expected_version
  returning * into saved;

  if saved.id is null then
    raise exception 'Absence category changed or unavailable' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'id', saved.id,
    'company_id', saved.company_id,
    'name', saved.name,
    'abones_hours', saved.abones_hours,
    'active', saved.active,
    'version', saved.version,
    'created_at', saved.created_at,
    'updated_at', saved.updated_at
  );
end
$$;

create or replace function public.update_absence_category(
  p_company uuid,
  p_category uuid,
  p_expected_version integer,
  p_name text default null,
  p_abones_hours boolean default null,
  p_active boolean default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.update_absence_category(
    p_company, p_category, p_expected_version, p_name, p_abones_hours, p_active
  )
$$;

create or replace function private.delete_absence_category(
  p_company uuid,
  p_category uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.absence_categories;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'Expected version is required' using errcode = '23514';
  end if;

  select * into existing
  from public.absence_categories
  where id = p_category and company_id = p_company
  for update;
  if existing.id is null or existing.version <> p_expected_version then
    raise exception 'Absence category changed or unavailable' using errcode = '40001';
  end if;
  if exists (
    select 1
    from public.day_justifications
    where company_id = p_company and absence_category_id = existing.id
  ) then
    raise exception 'ABSENCE_CATEGORY_IN_USE' using errcode = 'P0001';
  end if;

  delete from public.absence_categories
  where id = existing.id and company_id = p_company;

  return jsonb_build_object(
    'id', existing.id,
    'company_id', existing.company_id,
    'name', existing.name
  );
end
$$;

create or replace function public.delete_absence_category(
  p_company uuid,
  p_category uuid,
  p_expected_version integer
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.delete_absence_category(p_company, p_category, p_expected_version)
$$;

create or replace function private.create_day_justification(
  p_company uuid,
  p_employee uuid,
  p_local_date date,
  p_absence_category uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_category public.absence_categories;
  target_company public.companies;
  saved public.day_justifications;
begin
  if auth.uid() is null or not private.can_manage(p_company) then
    raise exception 'Managerial role required' using errcode = '42501';
  end if;
  if p_local_date is null or length(trim(coalesce(p_note, ''))) > 500 then
    raise exception 'Invalid day justification' using errcode = '23514';
  end if;

  select * into target_company from public.companies where id = p_company and active;
  if target_company.id is null then raise exception 'Active company not found' using errcode = '23503'; end if;
  perform 1 from public.employees where id = p_employee and company_id = p_company;
  if not found then raise exception 'Employee not found' using errcode = '23503'; end if;
  select * into target_category from public.absence_categories
    where id = p_absence_category and company_id = p_company and active;
  if target_category.id is null then raise exception 'Active absence category not found' using errcode = '23503'; end if;

  insert into public.day_justifications(
    company_id, employee_id, local_date, absence_category_id, abones_hours, note, created_by
  )
  values(
    p_company, p_employee, p_local_date, p_absence_category, target_category.abones_hours,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  )
  on conflict(company_id, employee_id, local_date) do update set
    absence_category_id = excluded.absence_category_id,
    abones_hours = excluded.abones_hours,
    note = excluded.note,
    version = public.day_justifications.version + 1,
    updated_at = now()
  returning * into saved;

  perform private.enqueue_attendance_recalculation_range(
    p_company,
    p_employee,
    p_local_date::timestamp at time zone target_company.timezone,
    (p_local_date + 1)::timestamp at time zone target_company.timezone
  );

  return jsonb_build_object(
    'id', saved.id,
    'company_id', saved.company_id,
    'employee_id', saved.employee_id,
    'local_date', saved.local_date,
    'absence_category_id', saved.absence_category_id,
    'abones_hours', saved.abones_hours,
    'note', saved.note,
    'version', saved.version,
    'created_at', saved.created_at,
    'updated_at', saved.updated_at
  );
end
$$;

revoke all on function private.bump_absence_category_version() from public, anon, authenticated, service_role;
grant execute on function private.bump_absence_category_version() to postgres;
revoke all on function private.audit_absence_category_delete() from public, anon, authenticated, service_role;
grant execute on function private.audit_absence_category_delete() to postgres;
revoke all on function private.create_absence_category(uuid, text, boolean) from public, anon, authenticated, service_role;
grant execute on function private.create_absence_category(uuid, text, boolean) to postgres;
revoke all on function public.create_absence_category(uuid, text, boolean) from public, anon;
grant execute on function public.create_absence_category(uuid, text, boolean) to authenticated;
revoke all on function private.update_absence_category(uuid, uuid, integer, text, boolean, boolean) from public, anon, authenticated, service_role;
grant execute on function private.update_absence_category(uuid, uuid, integer, text, boolean, boolean) to postgres;
revoke all on function public.update_absence_category(uuid, uuid, integer, text, boolean, boolean) from public, anon;
grant execute on function public.update_absence_category(uuid, uuid, integer, text, boolean, boolean) to authenticated;
revoke all on function private.delete_absence_category(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function private.delete_absence_category(uuid, uuid, integer) to postgres;
revoke all on function public.delete_absence_category(uuid, uuid, integer) from public, anon;
grant execute on function public.delete_absence_category(uuid, uuid, integer) to authenticated;

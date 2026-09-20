create or replace function public.create_day_justification(
  p_company uuid,
  p_employee uuid,
  p_local_date date,
  p_absence_category uuid,
  p_note text
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.create_day_justification(p_company, p_employee, p_local_date, p_absence_category, p_note)
$$;

create or replace function public.delete_day_justification(
  p_company uuid,
  p_justification uuid
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.delete_day_justification(p_company, p_justification)
$$;

revoke all on function public.create_day_justification(uuid,uuid,date,uuid,text),
  public.delete_day_justification(uuid,uuid)
  from public, anon;
grant execute on function public.create_day_justification(uuid,uuid,date,uuid,text),
  public.delete_day_justification(uuid,uuid)
  to authenticated;

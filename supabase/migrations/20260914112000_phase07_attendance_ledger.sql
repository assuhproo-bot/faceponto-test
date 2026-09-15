create type public.attendance_state as enum ('provisional','final','superseded');
create type public.occurrence_severity as enum ('warning','error');
create type public.occurrence_status as enum ('open','resolved');

create table public.work_days (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  schedule_version_id uuid not null,
  journey_start timestamptz not null,
  journey_end timestamptz not null,
  local_date date not null,
  timezone text not null,
  created_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,employee_id,journey_start),
  foreign key(company_id,employee_id) references public.employees(company_id,id),
  foreign key(company_id,schedule_version_id) references public.schedule_versions(company_id,id),
  check(journey_end > journey_start),
  check(length(trim(timezone)) between 1 and 80)
);
create index work_days_employee_date_idx on public.work_days(company_id,employee_id,local_date desc);

create table public.attendance_calculations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  work_day_id uuid not null,
  revision integer not null check(revision > 0),
  engine_version integer not null check(engine_version > 0),
  rules_version integer not null check(rules_version > 0),
  state public.attendance_state not null,
  planned_minutes integer not null check(planned_minutes >= 0),
  worked_minutes integer check(worked_minutes >= 0),
  late_minutes integer check(late_minutes >= 0),
  late_after_tolerance_minutes integer check(late_after_tolerance_minutes >= 0),
  early_departure_minutes integer check(early_departure_minutes >= 0),
  break_minutes integer check(break_minutes >= 0),
  gross_overtime_minutes integer check(gross_overtime_minutes >= 0),
  overtime_after_tolerance_minutes integer check(overtime_after_tolerance_minutes >= 0),
  net_balance_minutes integer,
  classifications jsonb not null default '[]'::jsonb check(jsonb_typeof(classifications)='array'),
  input_hash bytea not null,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,work_day_id,revision),
  foreign key(company_id,work_day_id) references public.work_days(company_id,id),
  check(
    (state='provisional' and net_balance_minutes is null)
    or (state in ('final','superseded') and worked_minutes is not null and net_balance_minutes is not null)
  )
);
create unique index attendance_one_current_idx on public.attendance_calculations(work_day_id)
  where state in ('provisional','final');
create index attendance_calculations_work_day_idx on public.attendance_calculations(company_id,work_day_id,revision desc);

create table public.attendance_occurrences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  work_day_id uuid not null,
  calculation_id uuid not null,
  employee_id uuid not null,
  severity public.occurrence_severity not null,
  type text not null check(length(trim(type)) between 1 and 80),
  details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
  status public.occurrence_status not null default 'open',
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,work_day_id) references public.work_days(company_id,id),
  foreign key(company_id,calculation_id) references public.attendance_calculations(company_id,id),
  foreign key(company_id,employee_id) references public.employees(company_id,id),
  foreign key(resolved_by) references public.users(id),
  check(
    (status='open' and resolution is null and resolved_by is null and resolved_at is null)
    or (status='resolved' and length(trim(resolution)) between 1 and 500 and resolved_by is not null and resolved_at is not null)
  )
);
create index attendance_occurrences_open_idx on public.attendance_occurrences(company_id,status,created_at desc);

create table public.bank_hours (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  employee_id uuid not null,
  work_day_id uuid not null,
  calculation_id uuid not null,
  revision integer not null check(revision > 0),
  delta_minutes integer not null,
  reason text not null check(length(trim(reason)) between 1 and 160),
  reversal_of uuid,
  created_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,calculation_id),
  foreign key(company_id,employee_id) references public.employees(company_id,id),
  foreign key(company_id,work_day_id) references public.work_days(company_id,id),
  foreign key(company_id,calculation_id) references public.attendance_calculations(company_id,id),
  foreign key(company_id,reversal_of) references public.bank_hours(company_id,id),
  check(reversal_of is null or delta_minutes <> 0)
);
create index bank_hours_employee_idx on public.bank_hours(company_id,employee_id,created_at,id);

alter table public.work_days enable row level security;
alter table public.attendance_calculations enable row level security;
alter table public.attendance_occurrences enable row level security;
alter table public.bank_hours enable row level security;

revoke all on public.work_days, public.attendance_calculations, public.attendance_occurrences, public.bank_hours from public,anon,authenticated;
grant select on public.work_days, public.attendance_calculations, public.attendance_occurrences, public.bank_hours to authenticated;

create policy work_days_read on public.work_days for select to authenticated
  using(private.can_access_employee(company_id,employee_id));
create policy attendance_calculations_read on public.attendance_calculations for select to authenticated
  using(exists(select 1 from public.work_days d where d.company_id=attendance_calculations.company_id
    and d.id=attendance_calculations.work_day_id and private.can_access_employee(d.company_id,d.employee_id)));
create policy attendance_occurrences_read on public.attendance_occurrences for select to authenticated
  using(private.can_access_employee(company_id,employee_id));
create policy bank_hours_read on public.bank_hours for select to authenticated
  using(private.can_access_employee(company_id,employee_id));

create trigger audit_attendance_occurrences after update on public.attendance_occurrences
  for each row execute function private.audit_change();

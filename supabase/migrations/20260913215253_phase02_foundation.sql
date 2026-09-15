SET local check_function_bodies = off;

CREATE SCHEMA "private";

CREATE EXTENSION "btree_gist" SCHEMA "extensions";

CREATE TABLE "private"."employee_documents" (
  "company_id"     uuid                     NOT NULL,
  "employee_id"    uuid                     NOT NULL,
  "cpf_ciphertext" bytea                    NOT NULL,
  "key_version"    integer                  NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "employee_documents_key_version_check" CHECK ((key_version > 0)),
  CONSTRAINT "employee_documents_pkey" PRIMARY KEY (company_id, employee_id)
);

ALTER TABLE "private"."employee_documents"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."audit_logs" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "company_id"  uuid                     NOT NULL,
  "actor_id"    uuid,
  "action"      text                     NOT NULL,
  "entity_type" text                     NOT NULL,
  "entity_id"   text                     NOT NULL,
  "old_value"   jsonb,
  "new_value"   jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."audit_logs"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."companies" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"       text                     NOT NULL,
  "timezone"   text                     NOT NULL DEFAULT 'America/Fortaleza'::text,
  "active"     boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "companies_name_check" CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 160))),
  CONSTRAINT "companies_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."companies"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."company_memberships" (
  "company_id" uuid                     NOT NULL,
  "user_id"    uuid                     NOT NULL,
  "active"     boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "company_memberships_pkey" PRIMARY KEY (company_id, user_id)
);

ALTER TABLE "public"."company_memberships"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."departments" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "departments_company_id_id_key" UNIQUE (company_id, id),
  CONSTRAINT "departments_company_id_name_key" UNIQUE (company_id, name),
  CONSTRAINT "departments_name_check" CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 120))),
  CONSTRAINT "departments_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."departments"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."employee_locations" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "company_id"  uuid                     NOT NULL,
  "employee_id" uuid                     NOT NULL,
  "location_id" uuid                     NOT NULL,
  "valid_from"  timestamp with time zone NOT NULL,
  "valid_to"    timestamp with time zone,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "employee_locations_check" CHECK (((valid_to IS NULL) OR (valid_to > valid_from))),
  CONSTRAINT "employee_locations_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."employee_locations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."employees" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "company_id"       uuid                     NOT NULL,
  "registration"     text                     NOT NULL,
  "name"             text                     NOT NULL,
  "job_title"        text                     NOT NULL DEFAULT ''::text,
  "department_id"    uuid,
  "home_location_id" uuid                     NOT NULL,
  "active"           boolean                  NOT NULL DEFAULT true,
  "version"          integer                  NOT NULL DEFAULT 1,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "employees_company_id_id_key" UNIQUE (company_id, id),
  CONSTRAINT "employees_company_id_registration_key" UNIQUE (company_id, registration),
  CONSTRAINT "employees_name_check" CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 160))),
  CONSTRAINT "employees_pkey" PRIMARY KEY (id),
  CONSTRAINT "employees_registration_check" CHECK (((length(TRIM(BOTH FROM registration)) >= 1) AND (length(TRIM(BOTH FROM registration)) <= 40))),
  CONSTRAINT "employees_version_check" CHECK ((version > 0))
);

ALTER TABLE "public"."employees"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."locations" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "active"     boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "locations_company_id_id_key" UNIQUE (company_id, id),
  CONSTRAINT "locations_company_id_name_key" UNIQUE (company_id, name),
  CONSTRAINT "locations_name_check" CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 160))),
  CONSTRAINT "locations_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."locations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."member_locations" (
  "company_id"  uuid                     NOT NULL,
  "user_id"     uuid                     NOT NULL,
  "location_id" uuid                     NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "member_locations_pkey" PRIMARY KEY (company_id, user_id, location_id)
);

ALTER TABLE "public"."member_locations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."schedule_assignments" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "company_id"          uuid                     NOT NULL,
  "employee_id"         uuid                     NOT NULL,
  "schedule_version_id" uuid                     NOT NULL,
  "valid_from"          date                     NOT NULL,
  "valid_to"            date,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "schedule_assignments_check" CHECK (((valid_to IS NULL) OR (valid_to > valid_from))),
  CONSTRAINT "schedule_assignments_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."schedule_assignments"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."schedule_segments" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "company_id"          uuid                     NOT NULL,
  "schedule_version_id" uuid                     NOT NULL,
  "ordinal"             smallint                 NOT NULL,
  "start_minute"        integer                  NOT NULL,
  "end_minute"          integer                  NOT NULL,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "schedule_segments_check" CHECK ((end_minute > start_minute)),
  CONSTRAINT "schedule_segments_company_id_schedule_version_id_ordinal_key" UNIQUE (company_id, schedule_version_id, ordinal),
  CONSTRAINT "schedule_segments_end_minute_check" CHECK (((end_minute > 0) AND (end_minute <= 2880))),
  CONSTRAINT "schedule_segments_ordinal_check" CHECK (((ordinal >= 1) AND (ordinal <= 12))),
  CONSTRAINT "schedule_segments_pkey" PRIMARY KEY (id),
  CONSTRAINT "schedule_segments_start_minute_check" CHECK (((start_minute >= 0) AND (start_minute < 2880)))
);

ALTER TABLE "public"."schedule_segments"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."schedule_versions" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "company_id"  uuid                     NOT NULL,
  "schedule_id" uuid                     NOT NULL,
  "version"     integer                  NOT NULL,
  "timezone"    text                     NOT NULL DEFAULT 'America/Fortaleza'::text,
  "rules"       jsonb                    NOT NULL DEFAULT '{"late_tolerance_minutes": 0, "overtime_tolerance_minutes": 0, "missing_punch_grace_minutes": 60}'::jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "schedule_versions_company_id_id_key" UNIQUE (company_id, id),
  CONSTRAINT "schedule_versions_company_id_schedule_id_version_key" UNIQUE (company_id, schedule_id, VERSION),
  CONSTRAINT "schedule_versions_pkey" PRIMARY KEY (id),
  CONSTRAINT "schedule_versions_rules_check1" CHECK ((rules ?& ARRAY['late_tolerance_minutes'::text, 'overtime_tolerance_minutes'::text, 'missing_punch_grace_minutes'::text])),
  CONSTRAINT "schedule_versions_rules_check2"
    CHECK (((jsonb_typeof((rules -> 'late_tolerance_minutes'::text)) = 'number'::text) AND ((rules ->> 'late_tolerance_minutes'::text) ~ '^[0-9]{1,4}$'::text))),
  CONSTRAINT "schedule_versions_rules_check3"
    CHECK (((jsonb_typeof((rules -> 'overtime_tolerance_minutes'::text)) = 'number'::text) AND ((rules ->> 'overtime_tolerance_minutes'::text) ~ '^[0-9]{1,4}$'::text))),
  CONSTRAINT "schedule_versions_rules_check4"
    CHECK (((jsonb_typeof((rules -> 'missing_punch_grace_minutes'::text)) = 'number'::text) AND ((rules ->> 'missing_punch_grace_minutes'::text) ~ '^[0-9]{1,4}$'::text))),
  CONSTRAINT "schedule_versions_rules_check" CHECK ((jsonb_typeof(rules) = 'object'::text)),
  CONSTRAINT "schedule_versions_version_check" CHECK ((version > 0))
);

ALTER TABLE "public"."schedule_versions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."schedule_weekdays" (
  "company_id"          uuid                     NOT NULL,
  "schedule_version_id" uuid                     NOT NULL,
  "iso_weekday"         smallint                 NOT NULL,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "schedule_weekdays_iso_weekday_check" CHECK (((iso_weekday >= 1) AND (iso_weekday <= 7))),
  CONSTRAINT "schedule_weekdays_pkey" PRIMARY KEY (company_id, schedule_version_id, iso_weekday)
);

ALTER TABLE "public"."schedule_weekdays"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."terminal_location_assignments" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "company_id"  uuid                     NOT NULL,
  "terminal_id" uuid                     NOT NULL,
  "location_id" uuid                     NOT NULL,
  "version"     integer                  NOT NULL,
  "valid_from"  timestamp with time zone NOT NULL DEFAULT now(),
  "valid_to"    timestamp with time zone,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "terminal_location_assignments_check" CHECK (((valid_to IS NULL) OR (valid_to > valid_from))),
  CONSTRAINT "terminal_location_assignments_company_id_id_key" UNIQUE (company_id, id),
  CONSTRAINT "terminal_location_assignments_company_id_terminal_id_versio_key" UNIQUE (company_id, terminal_id, VERSION),
  CONSTRAINT "terminal_location_assignments_pkey" PRIMARY KEY (id),
  CONSTRAINT "terminal_location_assignments_version_check" CHECK ((version > 0))
);

ALTER TABLE "public"."terminal_location_assignments"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."terminals" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "company_id"        uuid                     NOT NULL,
  "location_id"       uuid                     NOT NULL,
  "auth_user_id"      uuid,
  "code"              text                     NOT NULL,
  "name"              text                     NOT NULL,
  "active"            boolean                  NOT NULL DEFAULT true,
  "last_heartbeat_at" timestamp with time zone,
  "last_sync_at"      timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "terminals_auth_user_id_key" UNIQUE (auth_user_id),
  CONSTRAINT "terminals_code_check" CHECK (((length(TRIM(BOTH FROM code)) >= 1) AND (length(TRIM(BOTH FROM code)) <= 40))),
  CONSTRAINT "terminals_company_id_code_key" UNIQUE (company_id, code),
  CONSTRAINT "terminals_company_id_id_key" UNIQUE (company_id, id),
  CONSTRAINT "terminals_name_check" CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 160))),
  CONSTRAINT "terminals_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."terminals"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."users" (
  "id"           uuid                     NOT NULL,
  "display_name" text                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "users_display_name_check" CHECK (((length(TRIM(BOTH FROM display_name)) >= 1) AND (length(TRIM(BOTH FROM display_name)) <= 160))),
  CONSTRAINT "users_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."users"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."work_schedules" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "company_id" uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "active"     boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "work_schedules_company_id_id_key" UNIQUE (company_id, id),
  CONSTRAINT "work_schedules_company_id_name_key" UNIQUE (company_id, name),
  CONSTRAINT "work_schedules_name_check" CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 120))),
  CONSTRAINT "work_schedules_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."work_schedules"
  ENABLE ROW LEVEL SECURITY;

CREATE TYPE "public"."member_role" AS ENUM (
  'administrator',
  'manager',
  'hr',
  'operator'
);

ALTER TABLE "public"."company_memberships"
  ADD COLUMN "role" public.member_role NOT NULL;

CREATE OR REPLACE FUNCTION private.audit_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare row_data jsonb; prior jsonb;
begin
  -- Trigger only: caller cannot invoke it as a regular function or set the author.
  row_data := to_jsonb(new);
  if tg_op = 'UPDATE' then prior := to_jsonb(old); end if;
  insert into public.audit_logs(company_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (case when tg_table_name = 'companies' then (row_data->>'id')::uuid else (row_data->>'company_id')::uuid end,
    auth.uid(), tg_op, tg_table_name,
    coalesce(row_data->>'id', row_data->>'user_id', row_data->>'schedule_version_id'),
    prior - 'auth_user_id', row_data - 'auth_user_id');
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.bump_employee_version()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin new.version := old.version + 1; return new; end $function$;

CREATE OR REPLACE FUNCTION private.can_access_employee (
  p_company  uuid,
  p_employee uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select (select auth.uid()) is not null and exists (
    select 1 from public.employees e where e.company_id = p_company and e.id = p_employee
      and private.can_access_location(e.company_id, e.home_location_id)
  )
$function$;

CREATE OR REPLACE FUNCTION private.can_access_location (
  p_company  uuid,
  p_location uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select (select auth.uid()) is not null and (
    private.can_manage(p_company) or (
      private.company_role(p_company) = 'manager' and exists (
        select 1 from public.member_locations ml where ml.company_id = p_company
          and ml.location_id = p_location and ml.user_id = (select auth.uid())
      )
    )
  )
$function$;

CREATE OR REPLACE FUNCTION private.can_manage (
  p_company uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce(private.company_role(p_company) in ('administrator','hr'), false)
$function$;

CREATE OR REPLACE FUNCTION private.company_role (
  p_company uuid
)
  RETURNS public.member_role
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select m.role from public.company_memberships m
  join public.companies c on c.id = m.company_id and c.active
  join auth.users u on u.id = m.user_id and u.deleted_at is null
  where (select auth.uid()) is not null and m.user_id = (select auth.uid())
    and m.company_id = p_company and m.active
$function$;

CREATE OR REPLACE FUNCTION private.create_company (
  p_name         text,
  p_display_name text,
  p_timezone     text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare caller uuid := auth.uid(); result uuid;
begin
  if caller is null or not exists(select 1 from auth.users where id = caller and deleted_at is null and not is_anonymous)
    or exists(select 1 from public.terminals where auth_user_id = caller) then
    raise exception 'Administrative identity required' using errcode = '42501';
  end if;
  insert into public.users(id, display_name) values(caller, p_display_name) on conflict(id) do nothing;
  insert into public.companies(name, timezone) values(p_name, p_timezone) returning id into result;
  insert into public.company_memberships(company_id, user_id, role) values(result, caller, 'administrator');
  return result;
end $function$;

CREATE OR REPLACE FUNCTION private.guard_record()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if tg_op = 'DELETE' then raise exception 'Records cannot be deleted' using errcode = '42501'; end if;
  if (to_jsonb(old)->'id') is distinct from (to_jsonb(new)->'id')
    or (to_jsonb(old)->'company_id') is distinct from (to_jsonb(new)->'company_id')
    or old.created_at is distinct from new.created_at then
    raise exception 'Record identity is immutable' using errcode = '42501';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.guard_schedule_definition()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null and current_setting('role',true) = 'authenticated' then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  perform 1 from public.schedule_versions where company_id=new.company_id and id=new.schedule_version_id for update;
  if exists(select 1 from public.schedule_assignments where company_id=new.company_id and schedule_version_id=new.schedule_version_id) then
    raise exception 'Assigned schedule definition is immutable' using errcode='23514';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.register_terminal (
  p_company  uuid,
  p_location uuid,
  p_code     text,
  p_name     text
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare result uuid;
begin
  if auth.uid() is null or private.company_role(p_company) is distinct from 'administrator' then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if not exists(select 1 from public.locations where company_id=p_company and id=p_location and active) then
    raise exception 'Active company location required' using errcode = '23514';
  end if;
  insert into public.terminals(company_id,location_id,code,name)
    values(p_company,p_location,p_code,p_name) returning id into result;
  insert into public.terminal_location_assignments(company_id,terminal_id,location_id,version)
    values(p_company,result,p_location,1);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION private.validate_schedule_assignment()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if auth.uid() is null and current_setting('role',true) = 'authenticated' then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  perform 1 from public.schedule_versions where company_id=new.company_id and id=new.schedule_version_id for update;
  if not exists(select 1 from public.schedule_segments where company_id=new.company_id and schedule_version_id=new.schedule_version_id)
    or not exists(select 1 from public.schedule_weekdays where company_id=new.company_id and schedule_version_id=new.schedule_version_id) then
    raise exception 'Schedule needs segments and weekdays' using errcode='23514';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.validate_timezone()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown IANA timezone' using errcode = '23514';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.create_company (
  p_name         text,
  p_display_name text,
  p_timezone     text DEFAULT 'America/Fortaleza'::text
)
  RETURNS uuid
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  select private.create_company(p_name, p_display_name, p_timezone)
$function$;

CREATE OR REPLACE FUNCTION public.register_terminal (
  p_company  uuid,
  p_location uuid,
  p_code     text,
  p_name     text
)
  RETURNS uuid
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  select private.register_terminal(p_company,p_location,p_code,p_name)
$function$;

ALTER TABLE "public"."audit_logs"
  ADD CONSTRAINT "audit_logs_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.companies(id);

ALTER TABLE "public"."company_memberships"
  ADD CONSTRAINT "company_memberships_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.companies(id);

ALTER TABLE "public"."company_memberships"
  ADD CONSTRAINT "company_memberships_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE "public"."departments"
  ADD CONSTRAINT "departments_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.companies(id);

ALTER TABLE "public"."employee_locations"
  ADD CONSTRAINT "employee_locations_company_id_employee_id_location_id_tstz_excl" EXCLUDE USING gist (company_id WITH =, employee_id WITH =, location_id
    WITH =, tstzrange(valid_from, valid_to, '[)'::text) WITH &&);

ALTER TABLE "public"."employees"
  ADD CONSTRAINT "employees_company_id_department_id_fkey" FOREIGN KEY (company_id, department_id) REFERENCES public.departments(company_id, id);

ALTER TABLE "public"."employees"
  ADD CONSTRAINT "employees_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.companies(id);

ALTER TABLE "private"."employee_documents"
  ADD CONSTRAINT "employee_documents_company_id_employee_id_fkey" FOREIGN KEY (company_id, employee_id) REFERENCES public.employees(company_id, id);

ALTER TABLE "public"."employee_locations"
  ADD CONSTRAINT "employee_locations_company_id_employee_id_fkey" FOREIGN KEY (company_id, employee_id) REFERENCES public.employees(company_id, id);

ALTER TABLE "public"."locations"
  ADD CONSTRAINT "locations_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.companies(id);

ALTER TABLE "public"."employee_locations"
  ADD CONSTRAINT "employee_locations_company_id_location_id_fkey" FOREIGN KEY (company_id, location_id) REFERENCES public.locations(company_id, id);

ALTER TABLE "public"."employees"
  ADD CONSTRAINT "employees_company_id_home_location_id_fkey" FOREIGN KEY (company_id, home_location_id) REFERENCES public.locations(company_id, id);

ALTER TABLE "public"."member_locations"
  ADD CONSTRAINT "member_locations_company_id_location_id_fkey" FOREIGN KEY (company_id, location_id) REFERENCES public.locations(company_id, id);

ALTER TABLE "public"."member_locations"
  ADD CONSTRAINT "member_locations_company_id_user_id_fkey" FOREIGN KEY (company_id, user_id) REFERENCES public.company_memberships(company_id, user_id);

ALTER TABLE "public"."schedule_assignments"
  ADD CONSTRAINT "schedule_assignments_company_id_employee_id_daterange_excl" EXCLUDE USING gist (company_id WITH =, employee_id WITH =, daterange(valid_from, valid_to, '[)'::text)
    WITH &&);

ALTER TABLE "public"."schedule_assignments"
  ADD CONSTRAINT "schedule_assignments_company_id_employee_id_fkey" FOREIGN KEY (company_id, employee_id) REFERENCES public.employees(company_id, id);

ALTER TABLE "public"."schedule_segments"
  ADD CONSTRAINT "schedule_segments_company_id_schedule_version_id_int4range_excl" EXCLUDE USING gist (company_id WITH =, schedule_version_id
    WITH =, int4range(start_minute, end_minute, '[)'::text) WITH &&);

ALTER TABLE "public"."schedule_assignments"
  ADD CONSTRAINT "schedule_assignments_company_id_schedule_version_id_fkey" FOREIGN KEY (company_id, schedule_version_id) REFERENCES public.schedule_versions(company_id, id);

ALTER TABLE "public"."schedule_segments"
  ADD CONSTRAINT "schedule_segments_company_id_schedule_version_id_fkey" FOREIGN KEY (company_id, schedule_version_id) REFERENCES public.schedule_versions(company_id, id);

ALTER TABLE "public"."schedule_weekdays"
  ADD CONSTRAINT "schedule_weekdays_company_id_schedule_version_id_fkey" FOREIGN KEY (company_id, schedule_version_id) REFERENCES public.schedule_versions(company_id, id);

ALTER TABLE "public"."terminal_location_assignments"
  ADD CONSTRAINT "terminal_location_assignments_company_id_location_id_fkey" FOREIGN KEY (company_id, location_id) REFERENCES public.locations(company_id, id);

ALTER TABLE "public"."terminal_location_assignments"
  ADD CONSTRAINT "terminal_location_assignments_company_id_terminal_id_tstzr_excl" EXCLUDE USING gist (company_id WITH =, terminal_id
    WITH =, tstzrange(valid_from, valid_to, '[)'::text) WITH &&);

ALTER TABLE "public"."terminals"
  ADD CONSTRAINT "terminals_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id);

ALTER TABLE "public"."terminals"
  ADD CONSTRAINT "terminals_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.companies(id);

ALTER TABLE "public"."terminal_location_assignments"
  ADD CONSTRAINT "terminal_location_assignments_company_id_terminal_id_fkey" FOREIGN KEY (company_id, terminal_id) REFERENCES public.terminals(company_id, id);

ALTER TABLE "public"."terminals"
  ADD CONSTRAINT "terminals_company_id_location_id_fkey" FOREIGN KEY (company_id, location_id) REFERENCES public.locations(company_id, id);

ALTER TABLE "public"."users"
  ADD CONSTRAINT "users_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE "public"."work_schedules"
  ADD CONSTRAINT "work_schedules_company_id_fkey" FOREIGN KEY (company_id) REFERENCES public.companies(id);

ALTER TABLE "public"."schedule_versions"
  ADD CONSTRAINT "schedule_versions_company_id_schedule_id_fkey" FOREIGN KEY (company_id, schedule_id) REFERENCES public.work_schedules(company_id, id);

CREATE INDEX audit_logs_company_time_idx ON public.audit_logs USING btree (company_id, created_at DESC);

CREATE INDEX employee_locations_employee_idx ON public.employee_locations USING btree (company_id, employee_id);

CREATE INDEX employee_locations_location_idx ON public.employee_locations USING btree (company_id, location_id);

CREATE INDEX employees_department_idx ON public.employees USING btree (company_id, department_id);

CREATE INDEX employees_location_idx ON public.employees USING btree (company_id, home_location_id);

CREATE INDEX member_locations_location_idx ON public.member_locations USING btree (company_id, location_id);

CREATE INDEX memberships_user_idx ON public.company_memberships USING btree (user_id, company_id)
  WHERE active;

CREATE INDEX schedule_assignments_employee_idx ON public.schedule_assignments USING btree (company_id, employee_id);

CREATE INDEX schedule_assignments_version_idx ON public.schedule_assignments USING btree (company_id, schedule_version_id);

CREATE INDEX terminal_assignments_location_idx ON public.terminal_location_assignments USING btree (company_id, location_id);

CREATE INDEX terminals_location_idx ON public.terminals USING btree (company_id, location_id);

CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_change();

CREATE TRIGGER company_timezone
  BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_timezone();

CREATE TRIGGER guard_record
  BEFORE DELETE OR UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record();

CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE ON public.company_memberships
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_change();

CREATE TRIGGER guard_record
  BEFORE DELETE OR UPDATE ON public.company_memberships
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record();

CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE ON public.departments
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_change();

CREATE TRIGGER guard_record
  BEFORE DELETE OR UPDATE ON public.departments
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record();

CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE ON public.employee_locations
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_change();

CREATE TRIGGER guard_record
  BEFORE DELETE OR UPDATE ON public.employee_locations
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record();

CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_change();

CREATE TRIGGER employee_version
  BEFORE UPDATE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION private.bump_employee_version();

CREATE TRIGGER guard_record
  BEFORE DELETE OR UPDATE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record();

CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_change();

CREATE TRIGGER guard_record
  BEFORE DELETE OR UPDATE ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record();

CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE ON public.member_locations
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_change();

CREATE TRIGGER guard_record
  BEFORE DELETE OR UPDATE ON public.member_locations
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record();

CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE ON public.schedule_assignments
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_change();

CREATE TRIGGER guard_record
  BEFORE DELETE OR UPDATE ON public.schedule_assignments
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record();

CREATE TRIGGER schedule_assignment_complete
  BEFORE INSERT ON public.schedule_assignments
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_schedule_assignment();

CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE ON public.schedule_segments
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_change();

CREATE TRIGGER guard_record
  BEFORE DELETE OR UPDATE ON public.schedule_segments
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record();

CREATE TRIGGER schedule_segments_immutable
  BEFORE INSERT ON public.schedule_segments
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_schedule_definition();

CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE ON public.schedule_versions
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_change();

CREATE TRIGGER guard_record
  BEFORE DELETE OR UPDATE ON public.schedule_versions
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record();

CREATE TRIGGER schedule_timezone
  BEFORE INSERT OR UPDATE ON public.schedule_versions
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_timezone();

CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE ON public.schedule_weekdays
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_change();

CREATE TRIGGER guard_record
  BEFORE DELETE OR UPDATE ON public.schedule_weekdays
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record();

CREATE TRIGGER schedule_weekdays_immutable
  BEFORE INSERT ON public.schedule_weekdays
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_schedule_definition();

CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE ON public.terminal_location_assignments
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_change();

CREATE TRIGGER guard_record
  BEFORE DELETE OR UPDATE ON public.terminal_location_assignments
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record();

CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE ON public.terminals
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_change();

CREATE TRIGGER guard_record
  BEFORE DELETE OR UPDATE ON public.terminals
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record();

CREATE TRIGGER audit_change
  AFTER INSERT OR UPDATE ON public.work_schedules
  FOR EACH ROW
  EXECUTE FUNCTION private.audit_change();

CREATE TRIGGER guard_record
  BEFORE DELETE OR UPDATE ON public.work_schedules
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_record();

CREATE POLICY "employee_documents_deny_clients" ON "private"."employee_documents"
  FOR ALL
  TO "anon", "authenticated"
  USING (false)
  WITH CHECK (false);

CREATE POLICY "audit_logs_read" ON "public"."audit_logs"
  FOR SELECT
  TO "authenticated"
  USING (private.can_manage(company_id));

CREATE POLICY "companies_read" ON "public"."companies"
  FOR SELECT
  TO "authenticated"
  USING ((private.company_role(id) IS NOT NULL));

CREATE POLICY "companies_update" ON "public"."companies"
  FOR UPDATE
  TO "authenticated"
  USING ((private.company_role(id) = 'administrator'::public.member_role))
  WITH CHECK ((private.company_role(id) = 'administrator'::public.member_role));

CREATE POLICY "memberships_read" ON "public"."company_memberships"
  FOR SELECT
  TO "authenticated"
  USING (((private.company_role(company_id) = 'administrator'::public.member_role) OR ((user_id = ( SELECT auth.uid() AS uid)) AND active AND (private.company_role(company_id) IS
    NOT NULL))));

CREATE POLICY "departments_read" ON "public"."departments"
  FOR SELECT
  TO "authenticated"
  USING ((private.company_role(company_id) = ANY (ARRAY['administrator'::public.member_role, 'hr'::public.member_role, 'manager'::public.member_role])));

CREATE POLICY "managed_insert" ON "public"."departments"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (private.can_manage(company_id));

CREATE POLICY "managed_update" ON "public"."departments"
  FOR UPDATE
  TO "authenticated"
  USING (private.can_manage(company_id))
  WITH CHECK (private.can_manage(company_id));

CREATE POLICY "employee_locations_read" ON "public"."employee_locations"
  FOR SELECT
  TO "authenticated"
  USING (private.can_access_employee(company_id, employee_id));

CREATE POLICY "managed_insert" ON "public"."employee_locations"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (private.can_manage(company_id));

CREATE POLICY "employees_insert" ON "public"."employees"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (private.can_access_location(company_id, home_location_id));

CREATE POLICY "employees_read" ON "public"."employees"
  FOR SELECT
  TO "authenticated"
  USING (private.can_access_location(company_id, home_location_id));

CREATE POLICY "employees_update" ON "public"."employees"
  FOR UPDATE
  TO "authenticated"
  USING (private.can_access_location(company_id, home_location_id))
  WITH CHECK (private.can_access_location(company_id, home_location_id));

CREATE POLICY "locations_read" ON "public"."locations"
  FOR SELECT
  TO "authenticated"
  USING ((private.can_access_location(company_id, id) OR (private.company_role(company_id) = 'operator'::public.member_role)));

CREATE POLICY "managed_insert" ON "public"."locations"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (private.can_manage(company_id));

CREATE POLICY "managed_update" ON "public"."locations"
  FOR UPDATE
  TO "authenticated"
  USING (private.can_manage(company_id))
  WITH CHECK (private.can_manage(company_id));

CREATE POLICY "member_locations_read" ON "public"."member_locations"
  FOR SELECT
  TO "authenticated"
  USING (((private.company_role(company_id) = 'administrator'::public.member_role) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (private.company_role(company_id) IS NOT NULL))));

CREATE POLICY "managed_insert" ON "public"."schedule_assignments"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (private.can_manage(company_id));

CREATE POLICY "schedule_assignments_read" ON "public"."schedule_assignments"
  FOR SELECT
  TO "authenticated"
  USING (private.can_access_employee(company_id, employee_id));

CREATE POLICY "managed_insert" ON "public"."schedule_segments"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (private.can_manage(company_id));

CREATE POLICY "tenant_read" ON "public"."schedule_segments"
  FOR SELECT
  TO "authenticated"
  USING ((private.company_role(company_id) = ANY (ARRAY['administrator'::public.member_role, 'hr'::public.member_role, 'manager'::public.member_role])));

CREATE POLICY "managed_insert" ON "public"."schedule_versions"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (private.can_manage(company_id));

CREATE POLICY "tenant_read" ON "public"."schedule_versions"
  FOR SELECT
  TO "authenticated"
  USING ((private.company_role(company_id) = ANY (ARRAY['administrator'::public.member_role, 'hr'::public.member_role, 'manager'::public.member_role])));

CREATE POLICY "managed_insert" ON "public"."schedule_weekdays"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (private.can_manage(company_id));

CREATE POLICY "tenant_read" ON "public"."schedule_weekdays"
  FOR SELECT
  TO "authenticated"
  USING ((private.company_role(company_id) = ANY (ARRAY['administrator'::public.member_role, 'hr'::public.member_role, 'manager'::public.member_role])));

CREATE POLICY "terminal_assignments_read" ON "public"."terminal_location_assignments"
  FOR SELECT
  TO "authenticated"
  USING ((private.can_access_location(company_id, location_id) OR (private.company_role(company_id) = 'operator'::public.member_role)));

CREATE POLICY "terminals_read" ON "public"."terminals"
  FOR SELECT
  TO "authenticated"
  USING ((private.can_access_location(company_id, location_id) OR (private.company_role(company_id) = 'operator'::public.member_role)));

CREATE POLICY "terminals_update" ON "public"."terminals"
  FOR UPDATE
  TO "authenticated"
  USING ((private.company_role(company_id) = 'administrator'::public.member_role))
  WITH CHECK ((private.company_role(company_id) = 'administrator'::public.member_role));

CREATE POLICY "users_self" ON "public"."users"
  FOR SELECT
  TO "authenticated"
  USING ((id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "managed_insert" ON "public"."work_schedules"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (private.can_manage(company_id));

CREATE POLICY "managed_update" ON "public"."work_schedules"
  FOR UPDATE
  TO "authenticated"
  USING (private.can_manage(company_id))
  WITH CHECK (private.can_manage(company_id));

CREATE POLICY "tenant_read" ON "public"."work_schedules"
  FOR SELECT
  TO "authenticated"
  USING ((private.company_role(company_id) = ANY (ARRAY['administrator'::public.member_role, 'hr'::public.member_role, 'manager'::public.member_role])));

COMMENT ON EXTENSION "btree_gist" IS 'support for indexing common datatypes in GiST';

REVOKE ALL ON FUNCTION "private"."audit_change"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."audit_change"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."bump_employee_version"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."bump_employee_version"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."can_access_employee"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_access_employee"(uuid, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "private"."can_access_location"(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_access_location"(uuid, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "private"."can_manage"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_manage"(uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "private"."company_role"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."company_role"(uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "private"."create_company"(text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."create_company"(text, text, text) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "private"."guard_record"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."guard_record"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."guard_schedule_definition"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."guard_schedule_definition"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."register_terminal"(uuid, uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."register_terminal"(uuid, uuid, text, text) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "private"."validate_schedule_assignment"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."validate_schedule_assignment"() TO "postgres";

REVOKE ALL ON FUNCTION "private"."validate_timezone"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."validate_timezone"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."create_company"(text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_company"(text, text, text) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."register_terminal"(uuid, uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."register_terminal"(uuid, uuid, text, text) TO "authenticated", "postgres";

GRANT USAGE ON SCHEMA "private" TO "authenticated";

GRANT CREATE, USAGE ON SCHEMA "private" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "private"."employee_documents" TO "postgres";

REVOKE ALL ON TABLE "public"."audit_logs" FROM "authenticated";

GRANT SELECT ON TABLE "public"."audit_logs" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_logs" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."audit_logs" TO "service_role";

REVOKE ALL ("name") ON TABLE "public"."companies" FROM "authenticated";

GRANT UPDATE ("name") ON TABLE "public"."companies" TO "authenticated";

REVOKE ALL ("timezone") ON TABLE "public"."companies" FROM "authenticated";

GRANT UPDATE ("timezone") ON TABLE "public"."companies" TO "authenticated";

REVOKE ALL ON TABLE "public"."companies" FROM "authenticated";

GRANT SELECT ON TABLE "public"."companies" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."companies" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."companies" TO "service_role";

REVOKE ALL ON TABLE "public"."company_memberships" FROM "authenticated";

GRANT SELECT ON TABLE "public"."company_memberships" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."company_memberships" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."company_memberships" TO "service_role";

REVOKE ALL ("company_id") ON TABLE "public"."departments" FROM "authenticated";

GRANT INSERT ("company_id") ON TABLE "public"."departments" TO "authenticated";

REVOKE ALL ("name") ON TABLE "public"."departments" FROM "authenticated";

GRANT INSERT ("name"), UPDATE ("name") ON TABLE "public"."departments" TO "authenticated";

REVOKE ALL ON TABLE "public"."departments" FROM "authenticated";

GRANT SELECT ON TABLE "public"."departments" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."departments" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."departments" TO "service_role";

REVOKE ALL ("company_id") ON TABLE "public"."employee_locations" FROM "authenticated";

GRANT INSERT ("company_id") ON TABLE "public"."employee_locations" TO "authenticated";

REVOKE ALL ("employee_id") ON TABLE "public"."employee_locations" FROM "authenticated";

GRANT INSERT ("employee_id") ON TABLE "public"."employee_locations" TO "authenticated";

REVOKE ALL ("location_id") ON TABLE "public"."employee_locations" FROM "authenticated";

GRANT INSERT ("location_id") ON TABLE "public"."employee_locations" TO "authenticated";

REVOKE ALL ("valid_from") ON TABLE "public"."employee_locations" FROM "authenticated";

GRANT INSERT ("valid_from") ON TABLE "public"."employee_locations" TO "authenticated";

REVOKE ALL ("valid_to") ON TABLE "public"."employee_locations" FROM "authenticated";

GRANT INSERT ("valid_to") ON TABLE "public"."employee_locations" TO "authenticated";

REVOKE ALL ON TABLE "public"."employee_locations" FROM "authenticated";

GRANT SELECT ON TABLE "public"."employee_locations" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."employee_locations" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."employee_locations" TO "service_role";

REVOKE ALL ("active") ON TABLE "public"."employees" FROM "authenticated";

GRANT UPDATE ("active") ON TABLE "public"."employees" TO "authenticated";

REVOKE ALL ("company_id") ON TABLE "public"."employees" FROM "authenticated";

GRANT INSERT ("company_id") ON TABLE "public"."employees" TO "authenticated";

REVOKE ALL ("department_id") ON TABLE "public"."employees" FROM "authenticated";

GRANT INSERT ("department_id"), UPDATE ("department_id") ON TABLE "public"."employees" TO "authenticated";

REVOKE ALL ("home_location_id") ON TABLE "public"."employees" FROM "authenticated";

GRANT INSERT ("home_location_id"), UPDATE ("home_location_id") ON TABLE "public"."employees" TO "authenticated";

REVOKE ALL ("job_title") ON TABLE "public"."employees" FROM "authenticated";

GRANT INSERT ("job_title"), UPDATE ("job_title") ON TABLE "public"."employees" TO "authenticated";

REVOKE ALL ("name") ON TABLE "public"."employees" FROM "authenticated";

GRANT INSERT ("name"), UPDATE ("name") ON TABLE "public"."employees" TO "authenticated";

REVOKE ALL ("registration") ON TABLE "public"."employees" FROM "authenticated";

GRANT INSERT ("registration"), UPDATE ("registration") ON TABLE "public"."employees" TO "authenticated";

REVOKE ALL ON TABLE "public"."employees" FROM "authenticated";

GRANT SELECT ON TABLE "public"."employees" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."employees" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."employees" TO "service_role";

REVOKE ALL ("active") ON TABLE "public"."locations" FROM "authenticated";

GRANT INSERT ("active"), UPDATE ("active") ON TABLE "public"."locations" TO "authenticated";

REVOKE ALL ("company_id") ON TABLE "public"."locations" FROM "authenticated";

GRANT INSERT ("company_id") ON TABLE "public"."locations" TO "authenticated";

REVOKE ALL ("name") ON TABLE "public"."locations" FROM "authenticated";

GRANT INSERT ("name"), UPDATE ("name") ON TABLE "public"."locations" TO "authenticated";

REVOKE ALL ON TABLE "public"."locations" FROM "authenticated";

GRANT SELECT ON TABLE "public"."locations" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."locations" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."locations" TO "service_role";

REVOKE ALL ON TABLE "public"."member_locations" FROM "authenticated";

GRANT SELECT ON TABLE "public"."member_locations" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."member_locations" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."member_locations" TO "service_role";

REVOKE ALL ("company_id") ON TABLE "public"."schedule_assignments" FROM "authenticated";

GRANT INSERT ("company_id") ON TABLE "public"."schedule_assignments" TO "authenticated";

REVOKE ALL ("employee_id") ON TABLE "public"."schedule_assignments" FROM "authenticated";

GRANT INSERT ("employee_id") ON TABLE "public"."schedule_assignments" TO "authenticated";

REVOKE ALL ("schedule_version_id") ON TABLE "public"."schedule_assignments" FROM "authenticated";

GRANT INSERT ("schedule_version_id") ON TABLE "public"."schedule_assignments" TO "authenticated";

REVOKE ALL ("valid_from") ON TABLE "public"."schedule_assignments" FROM "authenticated";

GRANT INSERT ("valid_from") ON TABLE "public"."schedule_assignments" TO "authenticated";

REVOKE ALL ("valid_to") ON TABLE "public"."schedule_assignments" FROM "authenticated";

GRANT INSERT ("valid_to") ON TABLE "public"."schedule_assignments" TO "authenticated";

REVOKE ALL ON TABLE "public"."schedule_assignments" FROM "authenticated";

GRANT SELECT ON TABLE "public"."schedule_assignments" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."schedule_assignments" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."schedule_assignments" TO "service_role";

REVOKE ALL ("company_id") ON TABLE "public"."schedule_segments" FROM "authenticated";

GRANT INSERT ("company_id") ON TABLE "public"."schedule_segments" TO "authenticated";

REVOKE ALL ("end_minute") ON TABLE "public"."schedule_segments" FROM "authenticated";

GRANT INSERT ("end_minute") ON TABLE "public"."schedule_segments" TO "authenticated";

REVOKE ALL ("ordinal") ON TABLE "public"."schedule_segments" FROM "authenticated";

GRANT INSERT ("ordinal") ON TABLE "public"."schedule_segments" TO "authenticated";

REVOKE ALL ("schedule_version_id") ON TABLE "public"."schedule_segments" FROM "authenticated";

GRANT INSERT ("schedule_version_id") ON TABLE "public"."schedule_segments" TO "authenticated";

REVOKE ALL ("start_minute") ON TABLE "public"."schedule_segments" FROM "authenticated";

GRANT INSERT ("start_minute") ON TABLE "public"."schedule_segments" TO "authenticated";

REVOKE ALL ON TABLE "public"."schedule_segments" FROM "authenticated";

GRANT SELECT ON TABLE "public"."schedule_segments" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."schedule_segments" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."schedule_segments" TO "service_role";

REVOKE ALL ("company_id") ON TABLE "public"."schedule_versions" FROM "authenticated";

GRANT INSERT ("company_id") ON TABLE "public"."schedule_versions" TO "authenticated";

REVOKE ALL ("rules") ON TABLE "public"."schedule_versions" FROM "authenticated";

GRANT INSERT ("rules") ON TABLE "public"."schedule_versions" TO "authenticated";

REVOKE ALL ("schedule_id") ON TABLE "public"."schedule_versions" FROM "authenticated";

GRANT INSERT ("schedule_id") ON TABLE "public"."schedule_versions" TO "authenticated";

REVOKE ALL ("timezone") ON TABLE "public"."schedule_versions" FROM "authenticated";

GRANT INSERT ("timezone") ON TABLE "public"."schedule_versions" TO "authenticated";

REVOKE ALL ("version") ON TABLE "public"."schedule_versions" FROM "authenticated";

GRANT INSERT ("version") ON TABLE "public"."schedule_versions" TO "authenticated";

REVOKE ALL ON TABLE "public"."schedule_versions" FROM "authenticated";

GRANT SELECT ON TABLE "public"."schedule_versions" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."schedule_versions" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."schedule_versions" TO "service_role";

REVOKE ALL ("company_id") ON TABLE "public"."schedule_weekdays" FROM "authenticated";

GRANT INSERT ("company_id") ON TABLE "public"."schedule_weekdays" TO "authenticated";

REVOKE ALL ("iso_weekday") ON TABLE "public"."schedule_weekdays" FROM "authenticated";

GRANT INSERT ("iso_weekday") ON TABLE "public"."schedule_weekdays" TO "authenticated";

REVOKE ALL ("schedule_version_id") ON TABLE "public"."schedule_weekdays" FROM "authenticated";

GRANT INSERT ("schedule_version_id") ON TABLE "public"."schedule_weekdays" TO "authenticated";

REVOKE ALL ON TABLE "public"."schedule_weekdays" FROM "authenticated";

GRANT SELECT ON TABLE "public"."schedule_weekdays" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."schedule_weekdays" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."schedule_weekdays" TO "service_role";

REVOKE ALL ON TABLE "public"."terminal_location_assignments" FROM "authenticated";

GRANT SELECT ON TABLE "public"."terminal_location_assignments" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."terminal_location_assignments" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."terminal_location_assignments" TO "service_role";

REVOKE ALL ("active") ON TABLE "public"."terminals" FROM "authenticated";

GRANT UPDATE ("active") ON TABLE "public"."terminals" TO "authenticated";

REVOKE ALL ("name") ON TABLE "public"."terminals" FROM "authenticated";

GRANT UPDATE ("name") ON TABLE "public"."terminals" TO "authenticated";

REVOKE ALL ON TABLE "public"."terminals" FROM "authenticated";

GRANT SELECT ON TABLE "public"."terminals" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."terminals" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."terminals" TO "service_role";

REVOKE ALL ON TABLE "public"."users" FROM "authenticated";

GRANT SELECT ON TABLE "public"."users" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."users" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."users" TO "service_role";

REVOKE ALL ("active") ON TABLE "public"."work_schedules" FROM "authenticated";

GRANT INSERT ("active"), UPDATE ("active") ON TABLE "public"."work_schedules" TO "authenticated";

REVOKE ALL ("company_id") ON TABLE "public"."work_schedules" FROM "authenticated";

GRANT INSERT ("company_id") ON TABLE "public"."work_schedules" TO "authenticated";

REVOKE ALL ("name") ON TABLE "public"."work_schedules" FROM "authenticated";

GRANT INSERT ("name"), UPDATE ("name") ON TABLE "public"."work_schedules" TO "authenticated";

REVOKE ALL ON TABLE "public"."work_schedules" FROM "authenticated";

GRANT SELECT ON TABLE "public"."work_schedules" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."work_schedules" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."work_schedules" TO "service_role";

GRANT USAGE ON TYPE "public"."member_role" TO "postgres";


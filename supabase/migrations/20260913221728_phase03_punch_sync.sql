create type public.punch_type as enum ('unclassified','entry','break_start','break_end','exit');
create type public.punch_sync_status as enum ('accepted','quarantined');
create type public.clock_status as enum ('verified','unverified','inconsistent');

create table private.facial_profiles (
  id uuid primary key,
  company_id uuid not null,
  employee_id uuid not null,
  version integer not null check(version>0),
  recognition_model_sha256 text not null check(recognition_model_sha256 ~ '^[a-f0-9]{64}$'),
  liveness_model_sha256 text not null check(liveness_model_sha256 ~ '^[a-f0-9]{64}$'),
  policy_version integer not null check(policy_version>0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(company_id,id), unique(company_id,employee_id,version),
  foreign key(company_id,employee_id) references public.employees(company_id,id)
);
alter table private.facial_profiles enable row level security;
revoke all on private.facial_profiles from public,anon,authenticated;
create policy facial_profiles_deny_clients on private.facial_profiles for all to anon,authenticated using(false) with check(false);

create table private.clock_anchors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  terminal_id uuid not null,
  boot_id uuid not null,
  server_time timestamptz not null default now(),
  device_elapsed_ms bigint not null check(device_elapsed_ms>=0),
  uncertainty_ms integer not null check(uncertainty_ms between 0 and 60000),
  expires_at timestamptz not null,
  unique(company_id,id),
  foreign key(company_id,terminal_id) references public.terminals(company_id,id)
);
create index clock_anchors_terminal_idx on private.clock_anchors(company_id,terminal_id,expires_at desc);
alter table private.clock_anchors enable row level security;
revoke all on private.clock_anchors from public,anon,authenticated;
create policy clock_anchors_deny_clients on private.clock_anchors for all to anon,authenticated using(false) with check(false);

create table public.time_punches (
  id uuid primary key,
  company_id uuid not null,
  employee_id uuid not null,
  location_id uuid not null,
  terminal_id uuid not null,
  terminal_assignment_id uuid not null,
  "timestamp" timestamptz not null,
  device_timestamp timestamptz not null,
  server_timestamp timestamptz not null default now(),
  punch_type public.punch_type not null default 'unclassified',
  source text not null check(source='face'),
  sync_status public.punch_sync_status not null,
  clock_status public.clock_status not null,
  result_code text,
  boot_id uuid not null,
  device_elapsed_ms bigint not null check(device_elapsed_ms>=0),
  clock_anchor_id uuid,
  recognition jsonb not null check(jsonb_typeof(recognition)='object'),
  payload_hash bytea not null,
  receipt_id uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique(company_id,id),
  foreign key(company_id,employee_id) references public.employees(company_id,id),
  foreign key(company_id,location_id) references public.locations(company_id,id),
  foreign key(company_id,terminal_id) references public.terminals(company_id,id),
  foreign key(company_id,terminal_assignment_id) references public.terminal_location_assignments(company_id,id),
  foreign key(company_id,clock_anchor_id) references private.clock_anchors(company_id,id),
  check((sync_status='accepted' and clock_status='verified' and result_code is null)
    or (sync_status='quarantined' and result_code is not null))
);
create index time_punches_employee_time_idx on public.time_punches(company_id,employee_id,"timestamp" desc);
create index time_punches_location_time_idx on public.time_punches(company_id,location_id,"timestamp" desc);
create index time_punches_terminal_time_idx on public.time_punches(company_id,terminal_id,"timestamp" desc);
alter table public.time_punches enable row level security;
revoke all on public.time_punches from public,anon,authenticated;
grant select on public.time_punches to authenticated;
create policy time_punches_read on public.time_punches for select to authenticated
using(private.can_access_location(company_id,location_id));

create function private.terminal_clock_anchor(p_boot_id uuid,p_device_elapsed_ms bigint,p_uncertainty_ms integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.terminals; anchor private.clock_anchors;
begin
  select * into target from public.terminals where auth_user_id=auth.uid() and active;
  if target.id is null then raise exception 'Active terminal required' using errcode='42501'; end if;
  if p_device_elapsed_ms<0 or p_uncertainty_ms not between 0 and 60000 then
    raise exception 'Invalid clock anchor' using errcode='23514';
  end if;
  insert into private.clock_anchors(company_id,terminal_id,boot_id,device_elapsed_ms,uncertainty_ms,expires_at)
    values(target.company_id,target.id,p_boot_id,p_device_elapsed_ms,p_uncertainty_ms,now()+interval '24 hours') returning * into anchor;
  return jsonb_build_object('id',anchor.id,'server_timestamp',anchor.server_time,'expires_at',anchor.expires_at);
end $$;

create function public.terminal_clock_anchor(p_boot_id uuid,p_device_elapsed_ms bigint,p_uncertainty_ms integer)
returns jsonb language sql security invoker set search_path='' as $$
  select private.terminal_clock_anchor(p_boot_id,p_device_elapsed_ms,p_uncertainty_ms)
$$;

create function private.ingest_punch(p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target public.terminals; assignment public.terminal_location_assignments; employee public.employees;
  profile private.facial_profiles; anchor private.clock_anchors; existing public.time_punches;
  event_id uuid; v_employee_id uuid; assignment_id uuid; profile_id uuid; anchor_id uuid;
  device_time timestamptz; boot uuid; event_elapsed bigint; calculated timestamptz; hash bytea;
  status public.punch_sync_status; clock_state public.clock_status; code text; receipt uuid;
begin
  select * into target from public.terminals where auth_user_id=auth.uid() and active;
  if target.id is null then raise exception 'Active terminal required' using errcode='42501'; end if;
  event_id := (p_event->>'id')::uuid; v_employee_id := (p_event->>'employee_id')::uuid;
  assignment_id := (p_event->>'terminal_assignment_id')::uuid; device_time := (p_event->>'device_timestamp')::timestamptz;
  boot := (p_event->>'boot_id')::uuid; event_elapsed := (p_event->>'device_elapsed_ms')::bigint;
  profile_id := (p_event->'recognition'->>'profile_id')::uuid;
  anchor_id := nullif(p_event->>'clock_anchor_id','')::uuid;
  hash := extensions.digest(convert_to(p_event::text,'UTF8'),'sha256');
  perform pg_advisory_xact_lock(hashtextextended(event_id::text,0));
  select * into existing from public.time_punches where id=event_id;
  if existing.id is not null then
    if existing.terminal_id<>target.id or existing.payload_hash<>hash then
      return jsonb_build_object('id',event_id,'status','rejected','code','IDEMPOTENCY_CONFLICT');
    end if;
    if existing.sync_status='accepted' then
      return jsonb_build_object('id',event_id,'status','already_received','receipt_id',existing.receipt_id,'punch_type',existing.punch_type);
    end if;
    return jsonb_build_object('id',event_id,'status','quarantined','receipt_id',existing.receipt_id,'code',existing.result_code);
  end if;
  select * into assignment from public.terminal_location_assignments where id=assignment_id
    and company_id=target.company_id and terminal_id=target.id and valid_from<=device_time
    and (valid_to is null or valid_to>device_time);
  if assignment.id is null then return jsonb_build_object('id',event_id,'status','rejected','code','INVALID_ASSIGNMENT'); end if;
  select * into employee from public.employees where id=v_employee_id and company_id=target.company_id and active;
  if employee.id is null or not (employee.home_location_id=assignment.location_id or exists(
    select 1 from public.employee_locations el where el.company_id=target.company_id and el.employee_id=v_employee_id
      and el.location_id=assignment.location_id and el.valid_from<=device_time and (el.valid_to is null or el.valid_to>device_time))) then
    return jsonb_build_object('id',event_id,'status','rejected','code','EMPLOYEE_NOT_AUTHORIZED');
  end if;
  select * into profile from private.facial_profiles where id=profile_id and company_id=target.company_id
    and private.facial_profiles.employee_id=v_employee_id and version=(p_event->'recognition'->>'profile_version')::integer and active
    and recognition_model_sha256=p_event->'recognition'->>'recognition_model_sha256'
    and liveness_model_sha256=p_event->'recognition'->>'liveness_model_sha256'
    and policy_version=(p_event->'recognition'->>'policy_version')::integer;
  if profile.id is null or p_event->'recognition'->>'liveness_result'<>'passed' then
    return jsonb_build_object('id',event_id,'status','rejected','code','INVALID_RECOGNITION_EVIDENCE');
  end if;
  if anchor_id is null then status:='quarantined'; clock_state:='unverified'; code:='CLOCK_UNVERIFIED';
  else
    select * into anchor from private.clock_anchors where id=anchor_id and company_id=target.company_id
      and terminal_id=target.id and boot_id=boot and expires_at>=device_time and event_elapsed>=private.clock_anchors.device_elapsed_ms;
    if anchor.id is null then return jsonb_build_object('id',event_id,'status','rejected','code','INVALID_CLOCK_ANCHOR'); end if;
    calculated := anchor.server_time + ((event_elapsed-anchor.device_elapsed_ms)::text||' milliseconds')::interval;
    if abs(extract(epoch from (device_time-calculated)))>300 then
      status:='quarantined'; clock_state:='inconsistent'; code:='CLOCK_INCONSISTENCY';
    else status:='accepted'; clock_state:='verified'; code:=null; end if;
  end if;
  insert into public.time_punches(id,company_id,employee_id,location_id,terminal_id,terminal_assignment_id,
    "timestamp",device_timestamp,sync_status,clock_status,result_code,boot_id,device_elapsed_ms,clock_anchor_id,source,recognition,payload_hash)
  values(event_id,target.company_id,v_employee_id,assignment.location_id,target.id,assignment.id,device_time,device_time,
    status,clock_state,code,boot,event_elapsed,anchor_id,'face',p_event->'recognition',hash) returning receipt_id into receipt;
  update public.terminal_status set last_sync_at=now(),updated_at=now() where company_id=target.company_id and terminal_id=target.id;
  if status='accepted' then return jsonb_build_object('id',event_id,'status','accepted','receipt_id',receipt,'punch_type','unclassified'); end if;
  return jsonb_build_object('id',event_id,'status','quarantined','receipt_id',receipt,'code',code);
exception when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
  raise exception 'Invalid punch payload' using errcode='22023';
end $$;

create function public.ingest_punch(p_event jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.ingest_punch(p_event) $$;

revoke all on function private.terminal_clock_anchor(uuid,bigint,integer),private.ingest_punch(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.terminal_clock_anchor(uuid,bigint,integer),private.ingest_punch(jsonb) to authenticated;
revoke all on function public.terminal_clock_anchor(uuid,bigint,integer),public.ingest_punch(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.terminal_clock_anchor(uuid,bigint,integer),public.ingest_punch(jsonb) to authenticated;

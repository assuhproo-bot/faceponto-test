create or replace function private.ingest_punch(p_event jsonb)
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
  if status='accepted' then
    perform pg_advisory_xact_lock(hashtextextended(v_employee_id::text,1));
    if exists (
      select 1 from public.time_punches prior
      where prior.company_id=target.company_id and prior.employee_id=v_employee_id and prior.sync_status='accepted'
        and abs(extract(epoch from (prior."timestamp"-device_time))) < 300
    ) then
      return jsonb_build_object('id',event_id,'status','rejected','code','PUNCH_ALREADY_REGISTERED');
    end if;
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

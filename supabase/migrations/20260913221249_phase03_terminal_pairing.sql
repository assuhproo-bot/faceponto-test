create table private.terminal_pairings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  terminal_id uuid not null,
  code_hash bytea not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check(expires_at > created_at),
  foreign key(company_id, terminal_id) references public.terminals(company_id, id)
);
grant usage on schema private to service_role;
alter table private.terminal_pairings enable row level security;
revoke all on private.terminal_pairings from public, anon, authenticated;
create policy terminal_pairings_deny_clients on private.terminal_pairings
for all to anon, authenticated using(false) with check(false);
create index terminal_pairings_pending_idx on private.terminal_pairings(expires_at)
where consumed_at is null;

create table public.terminal_status (
  company_id uuid not null,
  terminal_id uuid not null,
  last_heartbeat_at timestamptz not null,
  last_sync_at timestamptz,
  pending_count integer not null default 0 check(pending_count >= 0),
  app_version text not null check(length(app_version) between 1 and 40),
  updated_at timestamptz not null default now(),
  primary key(company_id, terminal_id),
  foreign key(company_id, terminal_id) references public.terminals(company_id, id)
);
alter table public.terminal_status enable row level security;
revoke all on public.terminal_status from public, anon, authenticated;
grant select on public.terminal_status to authenticated;
create policy terminal_status_read on public.terminal_status for select to authenticated
using(exists(
  select 1 from public.terminals t where t.company_id=terminal_status.company_id
    and t.id=terminal_status.terminal_id
    and (private.can_access_location(t.company_id,t.location_id) or private.company_role(t.company_id)='operator')
));

create function private.create_terminal_pairing(p_terminal uuid)
returns text language plpgsql security definer set search_path='' as $$
declare result text; target public.terminals;
begin
  select * into target from public.terminals where id=p_terminal for update;
  if target.id is null or auth.uid() is null or private.company_role(target.company_id) is distinct from 'administrator' then
    raise exception 'Administrator required' using errcode='42501';
  end if;
  if not target.active or target.auth_user_id is not null then
    raise exception 'Terminal is not available for pairing' using errcode='23514';
  end if;
  update private.terminal_pairings set consumed_at=now()
    where terminal_id=p_terminal and consumed_at is null;
  result := translate(pg_catalog.encode(extensions.gen_random_bytes(32),'base64'), E'+/=\n', '-_');
  insert into private.terminal_pairings(company_id,terminal_id,code_hash,expires_at,created_by)
    values(target.company_id,target.id,extensions.digest(result,'sha256'),now()+interval '10 minutes',auth.uid());
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,new_value)
    values(target.company_id,auth.uid(),'PAIRING_CREATED','terminals',target.id::text,
      jsonb_build_object('expires_in_seconds',600));
  return result;
end $$;

create function public.create_terminal_pairing(p_terminal uuid)
returns text language sql security invoker set search_path='' as $$
  select private.create_terminal_pairing(p_terminal)
$$;

create function private.consume_terminal_pairing(p_code text,p_auth_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pairing private.terminal_pairings; target public.terminals;
begin
  if p_auth_user is null or not exists(select 1 from auth.users where id=p_auth_user and deleted_at is null) then
    raise exception 'Invalid terminal identity' using errcode='42501';
  end if;
  select * into pairing from private.terminal_pairings
    where code_hash=extensions.digest(p_code,'sha256') and consumed_at is null and expires_at>now()
    for update;
  if pairing.id is null then raise exception 'Invalid or expired pairing' using errcode='42501'; end if;
  select * into target from public.terminals where id=pairing.terminal_id for update;
  if target.id is null or not target.active or target.auth_user_id is not null then
    raise exception 'Terminal is not available for pairing' using errcode='23514';
  end if;
  update public.terminals set auth_user_id=p_auth_user where id=target.id;
  update private.terminal_pairings set consumed_at=now() where id=pairing.id;
  insert into public.audit_logs(company_id,actor_id,action,entity_type,entity_id,new_value)
    values(target.company_id,p_auth_user,'TERMINAL_PAIRED','terminals',target.id::text,
      jsonb_build_object('auth_user_id',p_auth_user));
  return jsonb_build_object('terminal_id',target.id,'company_id',target.company_id,'location_id',target.location_id);
end $$;

create function public.consume_terminal_pairing(p_code text,p_auth_user uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.consume_terminal_pairing(p_code,p_auth_user)
$$;

create function private.terminal_heartbeat(p_pending_count integer,p_app_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.terminals;
begin
  select * into target from public.terminals where auth_user_id=auth.uid() and active for update;
  if target.id is null then raise exception 'Active terminal required' using errcode='42501'; end if;
  if p_pending_count < 0 or length(p_app_version) not between 1 and 40 then
    raise exception 'Invalid heartbeat' using errcode='23514';
  end if;
  insert into public.terminal_status(company_id,terminal_id,last_heartbeat_at,pending_count,app_version,updated_at)
    values(target.company_id,target.id,now(),p_pending_count,p_app_version,now())
  on conflict(company_id,terminal_id) do update set last_heartbeat_at=excluded.last_heartbeat_at,
    pending_count=excluded.pending_count,app_version=excluded.app_version,updated_at=excluded.updated_at;
  return jsonb_build_object('terminal_id',target.id,'server_timestamp',now());
end $$;

create function public.terminal_heartbeat(p_pending_count integer,p_app_version text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.terminal_heartbeat(p_pending_count,p_app_version)
$$;

create function private.terminal_catalog()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target public.terminals; employees jsonb;
begin
  select * into target from public.terminals where auth_user_id=auth.uid() and active;
  if target.id is null then raise exception 'Active terminal required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'version',e.version)
    order by e.id),'[]'::jsonb) into employees
  from public.employees e where e.company_id=target.company_id and e.active and (
    e.home_location_id=target.location_id or exists(
      select 1 from public.employee_locations el where el.company_id=e.company_id and el.employee_id=e.id
        and el.location_id=target.location_id and el.valid_from<=now() and (el.valid_to is null or el.valid_to>now())
    ));
  return jsonb_build_object('terminal_id',target.id,'company_id',target.company_id,
    'location_id',target.location_id,'generated_at',now(),'employees',employees);
end $$;

create function public.terminal_catalog()
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.terminal_catalog()
$$;

revoke all on function private.create_terminal_pairing(uuid),private.consume_terminal_pairing(text,uuid),
  private.terminal_heartbeat(integer,text),private.terminal_catalog() from public,anon,authenticated,service_role;
grant execute on function private.create_terminal_pairing(uuid),private.terminal_heartbeat(integer,text),private.terminal_catalog() to authenticated;
grant execute on function private.consume_terminal_pairing(text,uuid) to service_role;
revoke all on function public.create_terminal_pairing(uuid),public.consume_terminal_pairing(text,uuid),
  public.terminal_heartbeat(integer,text),public.terminal_catalog() from public,anon,authenticated,service_role;
grant execute on function public.create_terminal_pairing(uuid),public.terminal_heartbeat(integer,text),public.terminal_catalog() to authenticated;
grant execute on function public.consume_terminal_pairing(text,uuid) to service_role;

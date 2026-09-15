alter table public.companies add column version integer not null default 1 check (version > 0);
alter table public.locations add column version integer not null default 1 check (version > 0);
alter table public.terminals add column version integer not null default 1 check (version > 0);

create function private.bump_company_version() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.name is distinct from new.name or old.timezone is distinct from new.timezone or old.active is distinct from new.active then
    new.version := old.version + 1;
  end if;
  return new;
end $$;
create trigger company_version before update on public.companies for each row execute function private.bump_company_version();

create function private.bump_location_version() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.name is distinct from new.name or old.active is distinct from new.active then new.version := old.version + 1; end if;
  return new;
end $$;
create trigger location_version before update on public.locations for each row execute function private.bump_location_version();

create function private.bump_terminal_version() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.name is distinct from new.name or old.active is distinct from new.active then new.version := old.version + 1; end if;
  return new;
end $$;
create trigger terminal_version before update on public.terminals for each row execute function private.bump_terminal_version();

create function private.update_company(p_company uuid, p_expected_version integer, p_name text, p_timezone text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare changed public.companies;
begin
  if auth.uid() is null or private.company_role(p_company) is distinct from 'administrator' then
    raise exception 'Administrator required' using errcode='42501';
  end if;
  update public.companies set name=coalesce(p_name,name), timezone=coalesce(p_timezone,timezone), active=coalesce(p_active,active)
    where id=p_company and version=p_expected_version returning * into changed;
  if changed.id is null then raise exception 'Version conflict' using errcode='40001'; end if;
  return jsonb_build_object('id',changed.id,'name',changed.name,'timezone',changed.timezone,'active',changed.active,'version',changed.version,'created_at',changed.created_at);
end $$;

create function private.update_location(p_company uuid, p_location uuid, p_expected_version integer, p_name text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare changed public.locations;
begin
  if auth.uid() is null or not private.can_manage(p_company) then raise exception 'Managerial role required' using errcode='42501'; end if;
  update public.locations set name=coalesce(p_name,name), active=coalesce(p_active,active)
    where company_id=p_company and id=p_location and version=p_expected_version returning * into changed;
  if changed.id is null then raise exception 'Version conflict' using errcode='40001'; end if;
  return to_jsonb(changed);
end $$;

create function private.update_terminal(p_company uuid, p_terminal uuid, p_expected_version integer, p_name text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare changed public.terminals;
begin
  if auth.uid() is null or not private.can_manage(p_company) then raise exception 'Managerial role required' using errcode='42501'; end if;
  update public.terminals set name=coalesce(p_name,name), active=coalesce(p_active,active)
    where company_id=p_company and id=p_terminal and version=p_expected_version returning * into changed;
  if changed.id is null then raise exception 'Version conflict' using errcode='40001'; end if;
  return jsonb_build_object('id',changed.id,'company_id',changed.company_id,'location_id',changed.location_id,'code',changed.code,'name',changed.name,'active',changed.active,'version',changed.version,'last_heartbeat_at',changed.last_heartbeat_at,'last_sync_at',changed.last_sync_at,'created_at',changed.created_at);
end $$;

create function public.update_company(p_company uuid,p_expected_version integer,p_name text default null,p_timezone text default null,p_active boolean default null) returns jsonb language sql security invoker set search_path='' as $$ select private.update_company(p_company,p_expected_version,p_name,p_timezone,p_active) $$;
create function public.update_location(p_company uuid,p_location uuid,p_expected_version integer,p_name text default null,p_active boolean default null) returns jsonb language sql security invoker set search_path='' as $$ select private.update_location(p_company,p_location,p_expected_version,p_name,p_active) $$;
create function public.update_terminal(p_company uuid,p_terminal uuid,p_expected_version integer,p_name text default null,p_active boolean default null) returns jsonb language sql security invoker set search_path='' as $$ select private.update_terminal(p_company,p_terminal,p_expected_version,p_name,p_active) $$;

revoke all on function private.bump_company_version(), private.bump_location_version(), private.bump_terminal_version() from public;
grant execute on function private.bump_company_version(), private.bump_location_version(), private.bump_terminal_version() to postgres;
revoke all on function private.update_company(uuid,integer,text,text,boolean), private.update_location(uuid,uuid,integer,text,boolean), private.update_terminal(uuid,uuid,integer,text,boolean) from public,anon,authenticated;
grant execute on function private.update_company(uuid,integer,text,text,boolean), private.update_location(uuid,uuid,integer,text,boolean), private.update_terminal(uuid,uuid,integer,text,boolean) to authenticated;
revoke all on function public.update_company(uuid,integer,text,text,boolean), public.update_location(uuid,uuid,integer,text,boolean), public.update_terminal(uuid,uuid,integer,text,boolean) from public,anon;
grant execute on function public.update_company(uuid,integer,text,text,boolean), public.update_location(uuid,uuid,integer,text,boolean), public.update_terminal(uuid,uuid,integer,text,boolean) to authenticated;

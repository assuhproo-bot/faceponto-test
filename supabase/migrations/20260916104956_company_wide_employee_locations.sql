create function private.grant_company_location_access_for_employee()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.active then
    insert into public.employee_locations(company_id,employee_id,location_id,valid_from)
      select new.company_id,new.id,location.id,now()
      from public.locations location
      where location.company_id=new.company_id and location.active and location.id<>new.home_location_id
        and not exists (
          select 1 from public.employee_locations existing where existing.company_id=new.company_id and existing.employee_id=new.id
            and existing.location_id=location.id and existing.valid_from<=now() and (existing.valid_to is null or existing.valid_to>now())
        );
  end if;
  return new;
end $$;

create function private.grant_company_location_access_for_location()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.active then
    insert into public.employee_locations(company_id,employee_id,location_id,valid_from)
      select new.company_id,employee.id,new.id,now()
      from public.employees employee
      where employee.company_id=new.company_id and employee.active and employee.home_location_id<>new.id
        and not exists (
          select 1 from public.employee_locations existing where existing.company_id=new.company_id and existing.employee_id=employee.id
            and existing.location_id=new.id and existing.valid_from<=now() and (existing.valid_to is null or existing.valid_to>now())
        );
  end if;
  return new;
end $$;

create trigger grant_company_location_access_employee
  after insert or update of active,home_location_id on public.employees
  for each row execute function private.grant_company_location_access_for_employee();
create trigger grant_company_location_access_location
  after insert or update of active on public.locations
  for each row execute function private.grant_company_location_access_for_location();

insert into public.employee_locations(company_id,employee_id,location_id,valid_from)
  select employee.company_id,employee.id,location.id,now()
  from public.employees employee join public.locations location on location.company_id=employee.company_id
  where employee.active and location.active and employee.home_location_id<>location.id
    and not exists (
      select 1 from public.employee_locations existing where existing.company_id=employee.company_id and existing.employee_id=employee.id
        and existing.location_id=location.id and existing.valid_from<=now() and (existing.valid_to is null or existing.valid_to>now())
    );

revoke all on function private.grant_company_location_access_for_employee(),private.grant_company_location_access_for_location()
  from public,anon,authenticated,service_role;
grant execute on function private.grant_company_location_access_for_employee(),private.grant_company_location_access_for_location() to postgres;

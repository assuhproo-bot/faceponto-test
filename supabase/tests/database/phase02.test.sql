begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

-- Synthetic identities exist only inside this rolled-back transaction.
insert into auth.users(id, email) values
 ('10000000-0000-4000-8000-000000000001','admin-a@faceponto.test'),
 ('10000000-0000-4000-8000-000000000002','admin-b@faceponto.test'),
 ('10000000-0000-4000-8000-000000000003','manager-a@faceponto.test'),
 ('10000000-0000-4000-8000-000000000004','operator-a@faceponto.test'),
 ('10000000-0000-4000-8000-000000000005','terminal-a@faceponto.test'),
 ('10000000-0000-4000-8000-000000000006','hr-a@faceponto.test');
insert into public.companies(id,name) values
 ('20000000-0000-4000-8000-000000000001','Empresa A'),
 ('20000000-0000-4000-8000-000000000002','Empresa B');
insert into public.company_memberships(company_id,user_id,role) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','administrator'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','administrator'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','manager'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','operator'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000006','hr');
insert into public.locations(id,company_id,name) values
 ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Ponto de Açúcar'),
 ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Santa Cruz'),
 ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','Local B');
insert into public.member_locations(company_id,user_id,location_id) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001');
insert into public.employees(id,company_id,registration,name,home_location_id) values
 ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','A01','Pessoa A1','30000000-0000-4000-8000-000000000001'),
 ('40000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','A02','Pessoa A2','30000000-0000-4000-8000-000000000002'),
 ('40000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','B01','Pessoa B','30000000-0000-4000-8000-000000000003');
insert into public.terminals(id,company_id,location_id,auth_user_id,code,name) values
 ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','T001','Tablet 1');

select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity),0::bigint,'All public application tables have RLS');
select ok(not has_table_privilege('anon','public.employees','SELECT'),'Anonymous users have no employee grant');
select ok(not has_table_privilege('authenticated','private.employee_documents','SELECT'),'CPF documents are not exposed to authenticated clients');
select ok(not has_function_privilege('anon','public.create_company(text,text,text)','EXECUTE'),'Anonymous bootstrap denied');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.companies),1::bigint,'Admin A sees only company A');
select is((select count(*) from public.employees),2::bigint,'Admin A sees both authorized locations');
select throws_ok($$insert into public.employees(company_id,registration,name,home_location_id) values('20000000-0000-4000-8000-000000000002','X','Intruder','30000000-0000-4000-8000-000000000003')$$,'42501',null,'Cannot insert an employee in company B');
with changed as (update public.employees set name='Forbidden' where id='40000000-0000-4000-8000-000000000003' returning id)
select is(count(*),0::bigint,'Cannot update company B rows') from changed;
select throws_ok($$insert into public.employees(company_id,registration,name,home_location_id) values('20000000-0000-4000-8000-000000000001','X','Cross tenant','30000000-0000-4000-8000-000000000003')$$,'23503',null,'Composite FK rejects foreign location even for admin');
select throws_ok($$update public.employees set company_id='20000000-0000-4000-8000-000000000002' where id='40000000-0000-4000-8000-000000000001'$$,'42501',null,'Company identity cannot be rewritten');
select lives_ok($$update public.employees set name='Pessoa revisada' where id='40000000-0000-4000-8000-000000000001'$$,'Authorized employee update succeeds');
select is((select version from public.employees where id='40000000-0000-4000-8000-000000000001'),2,'Employee version increments');
select ok(exists(select 1 from public.audit_logs where entity_id='40000000-0000-4000-8000-000000000001' and action='UPDATE' and actor_id='10000000-0000-4000-8000-000000000001' and old_value->>'name'='Pessoa A1' and new_value->>'name'='Pessoa revisada'),'Update creates audit with old/new values and actor');
select throws_ok($$delete from public.audit_logs$$,'42501',null,'Audit cannot be deleted by admin');
select throws_ok($$update public.audit_logs set action='FAKE'$$,'42501',null,'Audit cannot be rewritten by admin');
select throws_ok($$delete from public.employees$$,'42501',null,'Employees cannot be silently deleted');
select throws_ok($$update public.company_memberships set role='administrator'$$,'42501',null,'Membership mutation requires dedicated administrative operation');
select lives_ok($$select public.register_terminal('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','T002','Tablet 2')$$,'Admin registers second terminal');
select is((select count(*) from public.terminal_location_assignments),1::bigint,'Terminal registration creates its location history atomically');
select lives_ok($$update public.terminals set active=false where code='T002'$$,'Admin can deactivate a terminal without deleting it');
select ok(exists(select 1 from public.audit_logs where entity_type='terminals' and action='UPDATE' and new_value->>'active'='false'),'Terminal deactivation is audited');
select throws_ok($$select public.register_terminal('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003','X','Wrong location')$$,'23514',null,'Terminal cannot be linked to foreign company location');

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.employees),1::bigint,'Manager sees only assigned location');
select throws_ok($$update public.employees set home_location_id='30000000-0000-4000-8000-000000000002' where id='40000000-0000-4000-8000-000000000001'$$,'42501',null,'Manager cannot move employee beyond scope');
select is((select count(*) from public.audit_logs),0::bigint,'Manager cannot read company-wide audit');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
select is((select count(*) from public.employees),0::bigint,'Operator cannot list employee personal data');
select is((select count(*) from public.terminals),2::bigint,'Operator can monitor company terminals');
select throws_ok($$select public.register_terminal('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','X','Unauthorized')$$,'42501',null,'Operator cannot register terminal');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
select is((select count(*) from public.employees),0::bigint,'Terminal cannot list employees directly');
select throws_ok($$select public.create_company('Attack','Terminal')$$,'42501',null,'Terminal cannot bootstrap an administrative company');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',true);
select is((select count(*) from public.employees),2::bigint,'HR sees employees in both company locations');
select set_config('request.jwt.claim.sub','',true);
select is((select count(*) from public.employees),0::bigint,'Authenticated SQL role with no identity has no access');
reset role;

update public.company_memberships set active=false where user_id='10000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.employees),0::bigint,'Revocation is immediate without refreshing JWT');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.create_company('Nova empresa','Administrador')$$,'Authenticated bootstrap creates company and membership atomically');
select is((select count(*) from public.companies),2::bigint,'Creator can access the bootstrapped company');
select throws_ok($$select public.create_company('Invalid zone','Admin','Invalid/Zone')$$,'23514',null,'Unknown timezone is rejected');
reset role;

insert into public.work_schedules(id,company_id,name) values('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Noturna');
select throws_ok($$insert into public.schedule_versions(company_id,schedule_id,version,rules) values('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',9,'{}')$$,'23514',null,'Schedule rules require explicit tolerance configuration');
select throws_ok($$insert into public.schedule_versions(company_id,schedule_id,version,rules) values('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',9,'{"late_tolerance_minutes":-1,"overtime_tolerance_minutes":0,"missing_punch_grace_minutes":60}')$$,'23514',null,'Negative tolerance is rejected');
insert into public.schedule_versions(id,company_id,schedule_id,version) values('70000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',1);
insert into public.schedule_segments(company_id,schedule_version_id,ordinal,start_minute,end_minute) values('20000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',1,1320,1800);
select is((select end_minute-start_minute from public.schedule_segments where schedule_version_id='70000000-0000-4000-8000-000000000001'),480,'Night schedule spans midnight without negative duration');
select throws_ok($$insert into public.schedule_segments(company_id,schedule_version_id,ordinal,start_minute,end_minute) values('20000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',2,1700,1850)$$,'23P01',null,'Overlapping segments rejected');
select throws_ok($$insert into public.schedule_assignments(company_id,employee_id,schedule_version_id,valid_from) values('20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','2026-09-01')$$,'23514',null,'Incomplete schedule cannot be assigned');
insert into public.schedule_weekdays(company_id,schedule_version_id,iso_weekday) values('20000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',1);
insert into public.schedule_assignments(company_id,employee_id,schedule_version_id,valid_from) values('20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','2026-09-01');
select throws_ok($$insert into public.schedule_assignments(company_id,employee_id,schedule_version_id,valid_from) values('20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','2026-09-10')$$,'23P01',null,'Employee cannot have overlapping schedule assignments');
select throws_ok($$insert into public.schedule_weekdays(company_id,schedule_version_id,iso_weekday) values('20000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',2)$$,'23514',null,'Assigned schedule is immutable');
select throws_ok($$update public.employees set company_id='20000000-0000-4000-8000-000000000002' where id='40000000-0000-4000-8000-000000000001'$$,'42501',null,'Identity guard also protects privileged accidental updates');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.record_attendance_calculation(
  '20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',
  '2026-09-07 00:00:00-03','2026-09-08 06:00:00-03','2026-09-07','America/Fortaleza',
  '{"engine_version":1,"rules_version":1,"provisional":false,"planned_minutes":480,"worked_minutes":515,"late_minutes":5,"late_after_tolerance_minutes":0,"early_departure_minutes":0,"break_minutes":0,"gross_overtime_minutes":40,"overtime_after_tolerance_minutes":40,"net_balance_minutes":35,"classifications":[],"occurrences":[]}',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,'First final attendance revision is recorded');
select lives_ok($$select public.record_attendance_calculation(
  '20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',
  '2026-09-07 00:00:00-03','2026-09-08 06:00:00-03','2026-09-07','America/Fortaleza',
  '{"engine_version":1,"rules_version":1,"provisional":false,"planned_minutes":480,"worked_minutes":460,"late_minutes":20,"late_after_tolerance_minutes":20,"early_departure_minutes":0,"break_minutes":0,"gross_overtime_minutes":0,"overtime_after_tolerance_minutes":0,"net_balance_minutes":-20,"classifications":[],"occurrences":[]}',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')$$,'Recalculation creates a second revision');
select is((select count(*) from public.attendance_calculations),2::bigint,'Attendance history keeps both revisions');
select is((select count(*) from public.attendance_calculations where state='final'),1::bigint,'Exactly one calculation remains current');
select is((select sum(delta_minutes) from public.bank_hours),-20::bigint,'Recalculation reverses the prior ledger entry before posting the new balance');
select is((select count(*) from public.bank_hours where reversal_of is not null),1::bigint,'Prior bank entry is reversed exactly once');
select throws_ok($$select public.record_attendance_calculation(
  '20000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000001',
  '2026-09-07 00:00:00-03','2026-09-08 06:00:00-03','2026-09-07','America/Fortaleza',
  '{"engine_version":1,"rules_version":1,"provisional":true,"planned_minutes":480,"worked_minutes":null,"late_minutes":null,"late_after_tolerance_minutes":null,"early_departure_minutes":null,"break_minutes":null,"gross_overtime_minutes":null,"overtime_after_tolerance_minutes":null,"net_balance_minutes":null,"classifications":[],"occurrences":[]}',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')$$,'42501',null,'Attendance calculation cannot cross tenants');
reset role;
select * from finish();
rollback;

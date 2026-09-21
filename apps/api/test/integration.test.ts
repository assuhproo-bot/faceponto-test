import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { strFromU8, unzipSync } from 'fflate';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { startAttendanceWorker } from '../src/attendance-worker.js';
import { loadConfig } from '../src/config.js';

const url = process.env.SUPABASE_URL!;
const publishable = process.env.SUPABASE_PUBLISHABLE_KEY!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const databaseUrl = process.env.TEST_DATABASE_URL!;
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = `FacePonto-${stamp}-Aa9!`;
const emails = [`admin-a-${stamp}@faceponto.test`, `admin-b-${stamp}@faceponto.test`];
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = new pg.Client({ connectionString: databaseUrl });
const config = loadConfig();
const app = buildApp(config);
let tokenA = '';
let tokenB = '';
let companyA = '';
let companyB = '';
let locationA = '';
let locationB = '';
let locationExtraA = '';
let employeeId = '';
let terminalId = '';
let terminalToken = '';
let scheduleVersionId = '';
let scheduleAssignmentId = '';
let acceptedPunchId = '';
let acceptedPunchTimestamp = '';
let facialProfileId = '';
let livenessModelHash = '';
let recognitionPolicyVersion = 0;

async function signUpAndLogin(email: string) {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(created.error);
  const client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await client.auth.signInWithPassword({ email, password });
  assert.ifError(signed.error);
  return signed.data.session!.access_token;
}
async function request(method: string, path: string, token?: string, payload?: unknown): Promise<Awaited<ReturnType<typeof app.inject>>> {
  return await app.inject({ method, url: path, headers: token ? { authorization: `Bearer ${token}` } : {}, payload } as never);
}
async function drainAttendanceQueue(companyId: string, targetEmployeeId: string, message: string) {
  const stopWorker = startAttendanceWorker({ ...config, ENABLE_ATTENDANCE_WORKER: true });
  try {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const remaining = await sql.query(
        'select count(*)::int as count from private.attendance_recalculation_queue where company_id=$1 and employee_id=$2',
        [companyId, targetEmployeeId],
      );
      if (remaining.rows[0].count === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.fail(message);
  } finally {
    stopWorker();
  }
}
async function replaceAttendanceQueue(companyId: string, targetEmployeeId: string, affectedFrom: string, affectedTo: string) {
  await sql.query('delete from private.attendance_recalculation_queue where company_id=$1 and employee_id=$2', [companyId, targetEmployeeId]);
  await sql.query(
    `insert into private.attendance_recalculation_queue(company_id,employee_id,affected_from,affected_to)
     values($1,$2,$3,$4)`,
    [companyId, targetEmployeeId, affectedFrom, affectedTo],
  );
}
async function insertAcceptedPunch(companyId: string, targetEmployeeId: string, timestamp: string) {
  const assignment = await sql.query(
    `select id,location_id from public.terminal_location_assignments
      where company_id=$1 and terminal_id=$2 order by valid_from desc limit 1`,
    [companyId, terminalId],
  );
  assert.equal(assignment.rowCount, 1, 'the test terminal must have a location assignment');
  const id = randomUUID();
  await sql.query(
    `insert into public.time_punches(
       id,company_id,employee_id,location_id,terminal_id,terminal_assignment_id,
       "timestamp",device_timestamp,server_timestamp,source,sync_status,clock_status,
       result_code,boot_id,device_elapsed_ms,clock_anchor_id,recognition,payload_hash
     ) values($1,$2,$3,$4,$5,$6,$7,$7,$7,'face','accepted','verified',null,$8,1,null,$9::jsonb,$10)`,
    [id, companyId, targetEmployeeId, assignment.rows[0].location_id, terminalId, assignment.rows[0].id,
      timestamp, randomUUID(), JSON.stringify({ test: 'worker-window' }), Buffer.from(randomUUID())],
  );
  return id;
}
async function insertManualPunch(companyId: string, targetEmployeeId: string, timestamp: string) {
  const membership = await sql.query(
    'select user_id from public.company_memberships where company_id=$1 and active order by user_id limit 1', [companyId],
  );
  assert.equal(membership.rowCount, 1, 'the test company must have an active administrator');
  const id = randomUUID();
  await sql.query(
    `insert into public.manual_punches(id,company_id,employee_id,location_id,"timestamp",reason,actor_id)
     values($1,$2,$3,$4,$5,'Teste de cálculo do worker',$6)`,
    [id, companyId, targetEmployeeId, locationA, timestamp, membership.rows[0].user_id],
  );
  return id;
}

before(async () => {
  await sql.connect();
  tokenA = await signUpAndLogin(emails[0]!);
  tokenB = await signUpAndLogin(emails[1]!);
});
after(async () => {
  await app.close();
  const companies = [companyA, companyB].filter(Boolean);
  await sql.query('begin');
  try {
    // Disable audit/immutability triggers only in this test cleanup transaction.
    await sql.query('set local session_replication_role = replica');
    for (const table of [
      'public.audit_logs', 'private.attendance_recalculation_queue', 'public.bank_hours',
      'public.attendance_occurrences', 'public.attendance_calculations', 'public.work_days',
      'public.punch_adjustments',
      'public.manual_punches',
      'public.time_punches', 'private.clock_anchors', 'private.facial_profiles',
      'private.terminal_pairings', 'public.terminal_status', 'public.employee_schedule_plans', 'public.schedule_assignments',
      'public.schedule_segments', 'public.schedule_weekdays', 'public.schedule_versions',
      'public.work_schedules', 'public.terminal_location_assignments', 'public.employee_locations',
      'private.employee_documents', 'public.day_justifications', 'public.employee_payment_days',
      'public.employee_payment_settings', 'public.department_payment_settings', 'public.company_payment_settings',
      'public.department_schedule_defaults', 'private.employee_registration_counters', 'public.employees', 'public.departments',
      'public.absence_categories', 'public.member_locations',
      'public.terminals', 'public.locations', 'public.company_memberships',
    ]) await sql.query(`delete from ${table} where company_id = any($1)`, [companies]);
    await sql.query('delete from public.companies where id = any($1)', [companies]);
    await sql.query('delete from auth.users where email = any($1)', [emails]);
    await sql.query('commit');
  } catch (cause) {
    await sql.query('rollback');
    throw cause;
  }
  await sql.end();
});

test('health is public, business endpoints require a real Supabase token', async () => {
  assert.equal((await request('GET', '/health')).statusCode, 200);
  const denied = await request('GET', '/v1/me');
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.json().code, 'UNAUTHORIZED');
  assert.equal((await request('GET', '/v1/me', 'invalid')).statusCode, 401);
});

test('two administrators bootstrap isolated companies', async () => {
  const a = await request('POST', '/v1/companies', tokenA, { name: 'Empresa A', display_name: 'Admin A' });
  const b = await request('POST', '/v1/companies', tokenB, { name: 'Empresa B', display_name: 'Admin B' });
  assert.equal(a.statusCode, 201, a.body);
  assert.equal(b.statusCode, 201, b.body);
  companyA = a.json().id;
  companyB = b.json().id;
  const me = await request('GET', '/v1/me', tokenA);
  assert.equal(me.statusCode, 200, me.body);
  assert.deepEqual(me.json().memberships.map((item: { company_id: string }) => item.company_id), [companyA]);
});

test('employee API obeys RLS and does not disclose another tenant', async () => {
  const insertA = await request('POST', '/v1/locations', tokenA, { company_id: companyA, name: 'Ponto de Açúcar' });
  const insertB = await request('POST', '/v1/locations', tokenB, { company_id: companyB, name: 'Local B' });
  assert.equal(insertA.statusCode, 201, insertA.body); assert.equal(insertB.statusCode, 201, insertB.body);
  locationA = insertA.json().id; locationB = insertB.json().id;
  const created = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, registration: 'A01', name: 'Pessoa de Teste', home_location_id: locationA,
  });
  assert.equal(created.statusCode, 201, created.body);
  employeeId = created.json().id;
  assert.equal(created.json().version, 1);
  const list = await request('GET', `/v1/employees?company_id=${companyA}&active=true`, tokenA);
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().data.length, 1);
  const foreignList = await request('GET', `/v1/employees?company_id=${companyA}`, tokenB);
  assert.equal(foreignList.statusCode, 200, foreignList.body);
  assert.deepEqual(foreignList.json().data, []);
  const forbidden = await request('POST', '/v1/employees', tokenA, {
    company_id: companyB, registration: 'X01', name: 'Tentativa cruzada', home_location_id: locationB,
  });
  assert.equal(forbidden.statusCode, 403, forbidden.body);
  assert.equal(forbidden.json().code, 'FORBIDDEN');
});

test('employee creation assigns consecutive numeric registrations on the server', async () => {
  const [first, second] = await Promise.all([
    request('POST', '/v1/employees', tokenA, {
      company_id: companyA, name: 'Cadastro automático um', home_location_id: locationA,
    }),
    request('POST', '/v1/employees', tokenA, {
      company_id: companyA, name: 'Cadastro automático dois', home_location_id: locationA,
    }),
  ]);
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(second.statusCode, 201, second.body);
  const registrations = [Number(first.json().registration), Number(second.json().registration)].sort((a, b) => a - b);
  assert.deepEqual(registrations, [1, 2]);

  const supplied = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, registration: '25', name: 'Matrícula manual', home_location_id: locationA,
  });
  assert.equal(supplied.statusCode, 201, supplied.body);
  const afterManual = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, name: 'Após matrícula manual', home_location_id: locationA,
  });
  assert.equal(afterManual.statusCode, 201, afterManual.body);
  assert.equal(afterManual.json().registration, '26');

  const legacy = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, registration: 'LEGADO-A', name: 'Matrícula legada', home_location_id: locationA,
  });
  assert.equal(legacy.statusCode, 201, legacy.body);
  const afterLegacy = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, name: 'Após matrícula legada', home_location_id: locationA,
  });
  assert.equal(afterLegacy.statusCode, 201, afterLegacy.body);
  assert.equal(afterLegacy.json().registration, '27');
  const corrected = await request('PATCH', `/v1/employees/${afterLegacy.json().id}`, tokenA, {
    company_id: companyA, expected_version: afterLegacy.json().version, registration: '40',
  });
  assert.equal(corrected.statusCode, 200, corrected.body);
  const afterCorrection = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, name: 'Após correção manual', home_location_id: locationA,
  });
  assert.equal(afterCorrection.statusCode, 201, afterCorrection.body);
  assert.equal(afterCorrection.json().registration, '41');

  const foreign = await request('POST', '/v1/employees', tokenA, {
    company_id: companyB, name: 'Tentativa automática cruzada', home_location_id: locationB,
  });
  assert.equal(foreign.statusCode, 403, foreign.body);
});

test('cargo rates inherit every missing field from employee to cargo then company', async () => {
  const cargos = await request('GET', `/v1/departments?company_id=${companyA}`, tokenA);
  assert.equal(cargos.statusCode, 200, cargos.body);
  assert.deepEqual(cargos.json().data.map((item: { name: string }) => item.name), ['Administrativo', 'Chapa']);
  const administrativo = cargos.json().data.find((item: { name: string }) => item.name === 'Administrativo');
  assert.ok(administrativo);
  const createdCargo = await request('POST', '/v1/departments', tokenA, {
    company_id: companyA, name: 'Motorista',
  });
  assert.equal(createdCargo.statusCode, 201, createdCargo.body);
  const renamedCargo = await request('PATCH', `/v1/departments/${createdCargo.json().id}`, tokenA, {
    company_id: companyA, expected_version: createdCargo.json().version, name: 'Motorista de apoio',
  });
  assert.equal(renamedCargo.statusCode, 200, renamedCargo.body);
  assert.equal(renamedCargo.json().version, createdCargo.json().version + 1);

  const employee = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, name: 'Pessoa com cargo', department_id: administrativo.id, home_location_id: locationA,
  });
  assert.equal(employee.statusCode, 201, employee.body);

  const companyRates = await request('POST', '/v1/company-payment-settings', tokenA, {
    company_id: companyA, regular_hour_cents: 1100, overtime_hour_cents: 1500, meal_cents: 1000,
    dinner_cents: 1200, daily_allowance_cents: 5000, night_shift_cents: 2000, saturday_cents: 2200,
    serao_cents: 3000,
  });
  assert.equal(companyRates.statusCode, 201, companyRates.body);

  const cargoRates = await request('POST', '/v1/department-payment-settings', tokenA, {
    company_id: companyA, department_id: administrativo.id, regular_hour_cents: null, overtime_hour_cents: 1800,
    meal_cents: 1500, dinner_cents: null, daily_allowance_cents: null, night_shift_cents: 2500,
    saturday_cents: null, serao_cents: 3500,
  });
  assert.equal(cargoRates.statusCode, 201, cargoRates.body);

  const employeeRates = await request('POST', '/v1/payment-settings', tokenA, {
    company_id: companyA, employee_id: employee.json().id, regular_hour_cents: 1250, overtime_hour_cents: null,
    meal_cents: null, dinner_cents: 1400, daily_allowance_cents: null, night_shift_cents: null,
    saturday_cents: null, serao_cents: null,
  });
  assert.equal(employeeRates.statusCode, 201, employeeRates.body);

  const resolved = await request('GET', `/v1/payment-rates?company_id=${companyA}&employee_id=${employee.json().id}`, tokenA);
  assert.equal(resolved.statusCode, 200, resolved.body);
  assert.deepEqual(resolved.json().data, {
    regular_hour_cents: { cents: 1250, source: 'employee' },
    overtime_hour_cents: { cents: 1800, source: 'department' },
    meal_cents: { cents: 1500, source: 'department' },
    dinner_cents: { cents: 1400, source: 'employee' },
    daily_allowance_cents: { cents: 5000, source: 'company' },
    night_shift_cents: { cents: 2500, source: 'department' },
    saturday_cents: { cents: 2200, source: 'company' },
    serao_cents: { cents: 3500, source: 'department' },
  });

  const savedDay = await request('POST', '/v1/payment-days', tokenA, {
    company_id: companyA, employee_id: employee.json().id, local_date: '2026-10-01',
    meal_units: 0, dinner_units: 1, daily_allowance_units: 0, night_shift_units: 0, saturday_units: 0, serao_units: 1,
  });
  assert.equal(savedDay.statusCode, 201, savedDay.body);
  assert.equal(savedDay.json().serao_units, 1);

  const disabled = await request('PATCH', `/v1/departments/${administrativo.id}`, tokenA, {
    company_id: companyA, expected_version: administrativo.version, active: false,
  });
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal(disabled.json().active, false);
  const remaining = await request('GET', `/v1/employees?company_id=${companyA}`, tokenA);
  assert.equal(remaining.json().data.some((item: { id: string; department_id: string }) => item.id === employee.json().id && item.department_id === administrativo.id), true);
  const afterDisabling = await request('GET', `/v1/payment-rates?company_id=${companyA}&employee_id=${employee.json().id}`, tokenA);
  assert.equal(afterDisabling.statusCode, 200, afterDisabling.body);
  assert.deepEqual(afterDisabling.json().data.night_shift_cents, { cents: 2500, source: 'department' });
  const withoutCargo = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, name: 'Sem cargo ativo', home_location_id: locationA,
  });
  assert.equal(withoutCargo.statusCode, 201, withoutCargo.body);
  const rejectedAssignment = await request('PATCH', `/v1/employees/${withoutCargo.json().id}`, tokenA, {
    company_id: companyA, expected_version: withoutCargo.json().version, department_id: administrativo.id,
  });
  assert.equal(rejectedAssignment.statusCode, 422, rejectedAssignment.body);

  const foreign = await request('GET', `/v1/payment-rates?company_id=${companyA}&employee_id=${employee.json().id}`, tokenB);
  assert.equal(foreign.statusCode, 403, foreign.body);
});

test('employee updates are versioned, auditable and never overwrite stale data', async () => {
  const updated = await request('PATCH', `/v1/employees/${employeeId}`, tokenA, {
    company_id: companyA, expected_version: 1, job_title: 'Analista', name: 'Pessoa de Teste Atualizada',
  });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().version, 2);
  assert.equal(updated.json().job_title, 'Analista');

  const stale = await request('PATCH', `/v1/employees/${employeeId}`, tokenA, {
    company_id: companyA, expected_version: 1, active: false,
  });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(stale.json().code, 'VERSION_CONFLICT');

  const foreign = await request('PATCH', `/v1/employees/${employeeId}`, tokenB, {
    company_id: companyA, expected_version: 2, active: false,
  });
  assert.equal(foreign.statusCode, 409, foreign.body);
  const unchanged = await request('GET', `/v1/employees?company_id=${companyA}`, tokenA);
  assert.equal(unchanged.json().data[0].active, true);

  const audit = await sql.query(
    "select action from public.audit_logs where company_id=$1 and entity_type='employees' and entity_id=$2 order by created_at desc limit 1",
    [companyA, employeeId],
  );
  assert.equal(audit.rows[0].action, 'UPDATE');
});

test('locations, terminals and schedules are exposed through tenant-scoped API', async () => {
  const locations = await request('GET', `/v1/locations?company_id=${companyA}`, tokenA);
  assert.equal(locations.statusCode, 200, locations.body);
  assert.deepEqual(locations.json().data.map((item: { id: string }) => item.id), [locationA]);
  const extraLocation = await request('POST', '/v1/locations', tokenA, { company_id: companyA, name: 'Filial' });
  assert.equal(extraLocation.statusCode, 201, extraLocation.body);
  locationExtraA = extraLocation.json().id;
  const terminal = await request('POST', '/v1/terminals', tokenA, {
    company_id: companyA, location_id: locationA, code: 'T001', name: 'Tablet principal',
  });
  assert.equal(terminal.statusCode, 201, terminal.body);
  terminalId = terminal.json().id;
  const terminalList = await request('GET', `/v1/terminals?company_id=${companyA}`, tokenA);
  assert.equal(terminalList.statusCode, 200, terminalList.body);
  assert.equal(terminalList.json().data[0].code, 'T001');
  const deniedTerminal = await request('POST', '/v1/terminals', tokenB, {
    company_id: companyA, location_id: locationA, code: 'X001', name: 'Invasor',
  });
  assert.equal(deniedTerminal.statusCode, 403, deniedTerminal.body);
  const clock = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Fortaleza', hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const currentMinute = Number(clock.hour === '24' ? '0' : clock.hour) * 60 + Number(clock.minute);
  const scheduleStart = Math.max(0, Math.min(1440 - 480, currentMinute - 240));
  const scheduleEnd = scheduleStart + 480;
  const schedule = await request('POST', '/v1/schedules', tokenA, {
    // This integration schedule must cover the current instant on every day so
    // the later clock-anchor test is independent from the day and hour it runs.
    company_id: companyA, name: 'Noturna', timezone: 'America/Fortaleza', weekdays: [1, 2, 3, 4, 5, 6, 7],
    rules: { late_tolerance_minutes: 5, overtime_tolerance_minutes: 5, missing_punch_grace_minutes: 60 },
    segments: [{ ordinal: 1, start_minute: scheduleStart, end_minute: scheduleEnd }],
  });
  assert.equal(schedule.statusCode, 201, schedule.body);
  const schedules = await request('GET', `/v1/schedules?company_id=${companyA}`, tokenA);
  assert.equal(schedules.statusCode, 200, schedules.body);
  assert.equal(schedules.json().data[0].schedule_versions[0].schedule_segments[0].end_minute, scheduleEnd);
  scheduleVersionId = schedules.json().data[0].schedule_versions[0].id;
  const invalid = await request('POST', '/v1/schedules', tokenA, {
    company_id: companyA, name: 'Inválida', weekdays: [1],
    rules: { late_tolerance_minutes: 0, overtime_tolerance_minutes: 0, missing_punch_grace_minutes: 60 },
    segments: [{ ordinal: 1, start_minute: 100, end_minute: 200 }, { ordinal: 2, start_minute: 150, end_minute: 250 }],
  });
  assert.equal(invalid.statusCode, 422, invalid.body);
});

test('employee additional locations are tenant-scoped and authorize another workplace', async () => {
  const listed = await request('GET', `/v1/employee-locations?company_id=${companyA}&employee_id=${employeeId}`, tokenA);
  assert.equal(listed.statusCode, 200, listed.body);
  assert.deepEqual(listed.json().data.map((item: { location_id: string }) => item.location_id), [locationExtraA]);
  const foreign = await request('POST', '/v1/employee-locations', tokenB, {
    company_id: companyA, employee_id: employeeId, location_id: locationExtraA, valid_from: '2027-01-01T00:00:00-03:00',
  });
  assert.equal(foreign.statusCode, 403, foreign.body);
  const foreignList = await request('GET', `/v1/employee-locations?company_id=${companyA}`, tokenB);
  assert.equal(foreignList.statusCode, 200, foreignList.body);
  assert.deepEqual(foreignList.json().data, []);
});

test('company, location and terminal administrative updates use optimistic versions', async () => {
  const company = await request('PATCH', `/v1/companies/${companyA}`, tokenA, {
    expected_version: 1, name: 'Empresa A Atualizada', timezone: 'America/Sao_Paulo',
  });
  assert.equal(company.statusCode, 200, company.body);
  assert.equal(company.json().version, 2);

  const location = await request('PATCH', `/v1/locations/${locationA}`, tokenA, {
    company_id: companyA, expected_version: 1, name: 'Matriz Atualizada',
  });
  assert.equal(location.statusCode, 200, location.body);
  assert.equal(location.json().version, 2);

  const terminal = await request('PATCH', `/v1/terminals/${terminalId}`, tokenA, {
    company_id: companyA, expected_version: 1, name: 'Tablet Atualizado',
  });
  assert.equal(terminal.statusCode, 200, terminal.body);
  assert.equal(terminal.json().version, 2);

  const stale = await request('PATCH', `/v1/terminals/${terminalId}`, tokenA, {
    company_id: companyA, expected_version: 1, active: false,
  });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(stale.json().code, 'VERSION_CONFLICT');
  const foreign = await request('PATCH', `/v1/locations/${locationA}`, tokenB, {
    company_id: companyA, expected_version: 2, active: false,
  });
  assert.equal(foreign.statusCode, 403, foreign.body);
});

test('schedule assignments preserve history, reject overlaps and obey tenant isolation', async () => {
  const validFrom = '2026-10-01T00:00:00-03:00';
  const validTo = '2026-11-01T00:00:00-03:00';
  const current = await request('POST', '/v1/schedule-assignments', tokenA, {
    company_id: companyA, employee_id: employeeId, schedule_version_id: scheduleVersionId,
    valid_from: '2026-09-01T00:00:00-03:00', valid_to: validFrom,
  });
  assert.equal(current.statusCode, 201, current.body);
  const created = await request('POST', '/v1/schedule-assignments', tokenA, {
    company_id: companyA, employee_id: employeeId, schedule_version_id: scheduleVersionId, valid_from: validFrom,
  });
  assert.equal(created.statusCode, 201, created.body);
  scheduleAssignmentId = created.json().id;

  const listed = await request('GET', `/v1/schedule-assignments?company_id=${companyA}&employee_id=${employeeId}`, tokenA);
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json().data[0].id, scheduleAssignmentId);
  assert.equal(listed.json().data[0].schedule_versions.work_schedules.name, 'Noturna');

  const overlap = await request('POST', '/v1/schedule-assignments', tokenA, {
    company_id: companyA, employee_id: employeeId, schedule_version_id: scheduleVersionId,
    valid_from: '2026-10-15T00:00:00-03:00',
  });
  assert.equal(overlap.statusCode, 422, overlap.body);

  const foreignList = await request('GET', `/v1/schedule-assignments?company_id=${companyA}`, tokenB);
  assert.equal(foreignList.statusCode, 200, foreignList.body);
  assert.deepEqual(foreignList.json().data, []);
  const foreignCreate = await request('POST', '/v1/schedule-assignments', tokenB, {
    company_id: companyA, employee_id: employeeId, schedule_version_id: scheduleVersionId, valid_from: validFrom,
  });
  assert.equal(foreignCreate.statusCode, 403, foreignCreate.body);

  const closed = await request('PATCH', `/v1/schedule-assignments/${scheduleAssignmentId}/close`, tokenA, {
    company_id: companyA, valid_to: validTo,
  });
  assert.equal(closed.statusCode, 200, closed.body);
  assert.equal(closed.json().valid_to, validTo);

  const replacement = await request('POST', '/v1/schedule-assignments', tokenA, {
    company_id: companyA, employee_id: employeeId, schedule_version_id: scheduleVersionId, valid_from: validTo,
  });
  assert.equal(replacement.statusCode, 201, replacement.body);
  const secondClose = await request('PATCH', `/v1/schedule-assignments/${scheduleAssignmentId}/close`, tokenA, {
    company_id: companyA, valid_to: '2026-12-01T00:00:00-03:00',
  });
  assert.equal(secondClose.statusCode, 422, secondClose.body);
});

test('a cargo default assigns its scale to existing unscheduled employees and future hires', async () => {
  const cargos = await request('GET', `/v1/departments?company_id=${companyA}`, tokenA);
  const chapa = cargos.json().data.find((item: { name: string }) => item.name === 'Chapa');
  assert.ok(chapa);
  const existing = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, name: 'Chapa sem escala individual', department_id: chapa.id, home_location_id: locationA,
  });
  assert.equal(existing.statusCode, 201, existing.body);

  const saved = await request('POST', '/v1/department-schedule-defaults', tokenA, {
    company_id: companyA, department_id: chapa.id, schedule_version_id: scheduleVersionId,
    valid_from: '2026-12-10', apply_to_unassigned: true,
  });
  assert.equal(saved.statusCode, 201, saved.body);
  assert.equal(saved.json().assigned_count, 1);
  const defaults = await request('GET', `/v1/department-schedule-defaults?company_id=${companyA}`, tokenA);
  assert.equal(defaults.statusCode, 200, defaults.body);
  assert.equal(defaults.json().data[0].department_id, chapa.id);

  const existingAssignments = await request('GET', `/v1/schedule-assignments?company_id=${companyA}&employee_id=${existing.json().id}`, tokenA);
  assert.equal(existingAssignments.statusCode, 200, existingAssignments.body);
  assert.equal(existingAssignments.json().data[0].schedule_version_id, scheduleVersionId);
  assert.equal(existingAssignments.json().data[0].valid_from, '2026-12-10');

  const hire = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, name: 'Novo chapa com padrão', department_id: chapa.id, home_location_id: locationA,
  });
  assert.equal(hire.statusCode, 201, hire.body);
  const hireAssignments = await request('GET', `/v1/schedule-assignments?company_id=${companyA}&employee_id=${hire.json().id}`, tokenA);
  assert.equal(hireAssignments.statusCode, 200, hireAssignments.body);
  assert.equal(hireAssignments.json().data[0].schedule_version_id, scheduleVersionId);
  assert.equal(hireAssignments.json().data[0].valid_from, '2026-12-10');

  const removed = await request('DELETE', `/v1/department-schedule-defaults/${chapa.id}`, tokenA, {
    company_id: companyA, expected_version: saved.json().version,
  });
  assert.equal(removed.statusCode, 200, removed.body);
  const retained = await request('GET', `/v1/schedule-assignments?company_id=${companyA}&employee_id=${hire.json().id}`, tokenA);
  assert.equal(retained.json().data.length, 1, 'removing the cargo default must preserve individual history');

  const foreign = await request('GET', `/v1/department-schedule-defaults?company_id=${companyA}`, tokenB);
  assert.equal(foreign.statusCode, 200, foreign.body);
  assert.deepEqual(foreign.json().data, []);
});

test('daily schedule plans override only the selected date and remain tenant-scoped', async () => {
  const localDate = '2026-12-02';
  const created = await request('POST', '/v1/employee-schedule-plans', tokenA, {
    company_id: companyA, employee_id: employeeId, local_date: localDate, schedule_version_id: scheduleVersionId,
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().active, true);
  assert.equal(created.json().version, 1);
  const listed = await request('GET', `/v1/employee-schedule-plans?company_id=${companyA}&employee_id=${employeeId}`, tokenA);
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json().data[0].local_date, localDate);
  assert.equal(listed.json().data[0].schedule_versions.work_schedules.name, 'Noturna');
  const foreignList = await request('GET', `/v1/employee-schedule-plans?company_id=${companyA}`, tokenB);
  assert.equal(foreignList.statusCode, 200, foreignList.body);
  assert.deepEqual(foreignList.json().data, []);
  const foreignCreate = await request('POST', '/v1/employee-schedule-plans', tokenB, {
    company_id: companyA, employee_id: employeeId, local_date: '2026-12-03', schedule_version_id: scheduleVersionId,
  });
  assert.equal(foreignCreate.statusCode, 403, foreignCreate.body);
  const updated = await request('POST', '/v1/employee-schedule-plans', tokenA, {
    company_id: companyA, employee_id: employeeId, local_date: localDate, schedule_version_id: scheduleVersionId, expected_version: 1,
  });
  assert.equal(updated.statusCode, 201, updated.body);
  assert.equal(updated.json().version, 2);
  const cleared = await request('DELETE', `/v1/employee-schedule-plans/${created.json().id}`, tokenA, {
    company_id: companyA, expected_version: 2,
  });
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal(cleared.json().active, false);
});

test('one-time pairing gives the tablet its own identity, heartbeat and scoped catalog', async () => {
  const pairing = await request('POST', `/v1/terminals/${terminalId}/pairing`, tokenA);
  assert.equal(pairing.statusCode, 201, pairing.body);
  assert.ok(pairing.json().code.length >= 32);
  const paired = await request('POST', '/v1/terminal/pair', undefined, { code: pairing.json().code });
  assert.equal(paired.statusCode, 201, paired.body);
  terminalToken = paired.json().access_token;
  assert.equal(paired.json().terminal_id, terminalId);
  const identity = await admin.auth.getUser(terminalToken);
  assert.ifError(identity.error);
  emails.push(identity.data.user!.email!);
  const refreshed = await request('POST', '/v1/terminal/refresh', undefined, { refresh_token: paired.json().refresh_token });
  assert.equal(refreshed.statusCode, 200, refreshed.body);
  assert.ok(refreshed.json().access_token);
  assert.ok(refreshed.json().refresh_token);
  terminalToken = refreshed.json().access_token;
  const reused = await request('POST', '/v1/terminal/pair', undefined, { code: pairing.json().code });
  assert.equal(reused.statusCode, 401, reused.body);
  const heartbeat = await request('POST', '/v1/terminal/heartbeat', terminalToken, { pending_count: 3, app_version: '0.1.0' });
  assert.equal(heartbeat.statusCode, 200, heartbeat.body);
  assert.equal(heartbeat.json().terminal_id, terminalId);
  const catalog = await request('GET', '/v1/terminal/catalog', terminalToken);
  assert.equal(catalog.statusCode, 200, catalog.body);
  assert.equal(catalog.json().location_id, locationA);
  assert.equal(catalog.json().employees.some((employee: { id: string; name: string }) => employee.id === employeeId && employee.name === 'Pessoa de Teste Atualizada'), true);
  const status = await sql.query('select pending_count,app_version from public.terminal_status where terminal_id=$1', [terminalId]);
  assert.deepEqual(status.rows[0], { pending_count: 3, app_version: '0.1.0' });
  assert.equal((await sql.query('select version from public.terminals where id=$1', [terminalId])).rows[0].version, 2);
  assert.equal((await request('GET', '/v1/employees?company_id=' + companyA, terminalToken)).json().data.length, 0);
});

test('manager provisions versioned facial profile metadata without exposing biometrics', async () => {
  const forbidden = await request('POST', '/v1/facial-profiles', tokenB, { company_id: companyA, employee_id: employeeId });
  assert.equal(forbidden.statusCode, 403, forbidden.body);
  const provisioned = await request('POST', '/v1/facial-profiles', tokenA, { company_id: companyA, employee_id: employeeId });
  assert.equal(provisioned.statusCode, 201, provisioned.body);
  facialProfileId = provisioned.json().id;
  assert.equal(provisioned.json().version, 1);
  assert.equal(provisioned.json().recognition_model_sha256, '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79');
  livenessModelHash = provisioned.json().liveness_model_sha256;
  recognitionPolicyVersion = provisioned.json().policy_version;
  assert.match(livenessModelHash, /^[a-f0-9]{64}$/);
  assert.ok(recognitionPolicyVersion >= 1);
  const catalog = await request('GET', '/v1/terminal/catalog', terminalToken);
  assert.equal(catalog.statusCode, 200, catalog.body);
  const profiled = catalog.json().employees.find((employee: { id: string }) => employee.id === employeeId);
  assert.ok(profiled);
  assert.deepEqual(profiled.profile_id, facialProfileId);
  assert.equal(profiled.profile_version, 1);
  const stored = await sql.query('select count(*)::int as count from private.facial_profiles where id=$1', [facialProfileId]);
  assert.equal(stored.rows[0].count, 1);
});

test('terminal sync verifies clock evidence and is idempotent', async () => {
  const bootId = randomUUID();
  const modelHash = '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79';
  const assignment = await sql.query(
    'select id from public.terminal_location_assignments where terminal_id=$1 and valid_to is null', [terminalId],
  );
  assert.equal(assignment.rowCount, 1);

  const anchor = await request('POST', '/v1/terminal/clock-anchors', terminalToken, {
    boot_id: bootId, device_elapsed_ms: 1000, uncertainty_ms: 50,
  });
  assert.equal(anchor.statusCode, 201, anchor.body);
  const deviceTimestamp = new Date(new Date(anchor.json().server_timestamp).getTime() + 100).toISOString();
  const event = {
    id: randomUUID(), employee_id: employeeId, terminal_assignment_id: assignment.rows[0].id,
    device_timestamp: deviceTimestamp, device_elapsed_ms: 1100, boot_id: bootId,
    clock_anchor_id: anchor.json().id, source: 'face',
    recognition: {
      profile_id: facialProfileId, profile_version: 1, recognition_model_sha256: modelHash,
      liveness_model_sha256: livenessModelHash, policy_version: recognitionPolicyVersion,
      liveness_session_id: randomUUID(), liveness_result: 'passed',
    },
  };
  const first = await request('POST', '/v1/terminal/sync', terminalToken, { protocol_version: 1, events: [event] });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().results[0].status, 'accepted');
  acceptedPunchId = event.id;
  acceptedPunchTimestamp = deviceTimestamp;
  const receiptId = first.json().results[0].receipt_id;
  const queued = await sql.query('select affected_from,affected_to from private.attendance_recalculation_queue where company_id=$1 and employee_id=$2', [companyA, employeeId]);
  assert.equal(queued.rowCount, 1);
  assert.ok(queued.rows[0].affected_from < new Date(deviceTimestamp));
  assert.ok(queued.rows[0].affected_to > new Date(deviceTimestamp));
  const stopWorker = startAttendanceWorker({ ...config, ENABLE_ATTENDANCE_WORKER: true });
  const deadline = Date.now() + 15_000;
  let processed = false;
  while (Date.now() < deadline) {
    const remaining = await sql.query('select count(*)::int as count from private.attendance_recalculation_queue where company_id=$1 and employee_id=$2', [companyA, employeeId]);
    if (remaining.rows[0].count === 0) { processed = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stopWorker();
  assert.equal(processed, true, 'attendance worker should drain the durable job');
  const calculated = await sql.query('select count(*)::int as count from public.attendance_calculations where company_id=$1', [companyA]);
  assert.ok(calculated.rows[0].count >= 1);

  const retry = await request('POST', '/v1/terminal/sync', terminalToken, { protocol_version: 1, events: [event] });
  assert.equal(retry.statusCode, 200, retry.body);
  assert.equal(retry.json().results[0].status, 'already_received');
  assert.equal(retry.json().results[0].receipt_id, receiptId);

  const conflict = await request('POST', '/v1/terminal/sync', terminalToken, {
    protocol_version: 1, events: [{ ...event, device_elapsed_ms: 1101 }],
  });
  assert.equal(conflict.statusCode, 200, conflict.body);
  assert.deepEqual(conflict.json().results[0], { id: event.id, status: 'rejected', code: 'IDEMPOTENCY_CONFLICT' });

  const unverified = { ...event, id: randomUUID(), clock_anchor_id: null, recognition: { ...event.recognition, liveness_session_id: randomUUID() } };
  const quarantine = await request('POST', '/v1/terminal/sync', terminalToken, { protocol_version: 1, events: [unverified] });
  assert.equal(quarantine.statusCode, 200, quarantine.body);
  assert.equal(quarantine.json().results[0].status, 'quarantined');
  assert.equal(quarantine.json().results[0].code, 'CLOCK_UNVERIFIED');

  const punches = await request('GET', `/v1/punches?company_id=${companyA}`, tokenA);
  assert.equal(punches.statusCode, 200, punches.body);
  assert.equal(punches.json().data.length, 2);
  const foreignPunches = await request('GET', `/v1/punches?company_id=${companyA}`, tokenB);
  assert.equal(foreignPunches.statusCode, 200, foreignPunches.body);
  assert.deepEqual(foreignPunches.json().data, []);
});

test('attendance reports export the same tenant-scoped journey data as XLSX and PDF', async () => {
  const prefix = `/v1/reports/attendance?company_id=${companyA}&date_from=2026-01-01&date_to=2026-12-31`;
  const xlsx = await request('GET', `${prefix}&format=xlsx`, tokenA);
  assert.equal(xlsx.statusCode, 200, xlsx.body);
  assert.match(xlsx.headers['content-type'] ?? '', /spreadsheetml/);
  assert.match(xlsx.headers['content-disposition'] ?? '', /faceponto-jornadas-2026-01-01_2026-12-31\.xlsx/);
  assert.deepEqual(xlsx.rawPayload.subarray(0, 2), Buffer.from('PK'));
  const pdf = await request('GET', `${prefix}&format=pdf`, tokenA);
  assert.equal(pdf.statusCode, 200, pdf.body);
  assert.match(pdf.headers['content-type'] ?? '', /application\/pdf/);
  assert.deepEqual(pdf.rawPayload.subarray(0, 4), Buffer.from('%PDF'));
  const foreign = await request('GET', `${prefix}&format=pdf`, tokenB);
  assert.equal(foreign.statusCode, 403, foreign.body);
  assert.equal(foreign.json().code, 'FORBIDDEN');
});

test('financial attendance resolves the same filtered days used by XLSX and PDF', async () => {
  const paymentDay = await request('POST', '/v1/payment-days', tokenA, {
    company_id: companyA, employee_id: employeeId, local_date: '2026-10-02',
    meal_units: 0, dinner_units: 1, daily_allowance_units: 0, night_shift_units: 0, saturday_units: 0, serao_units: 0,
  });
  assert.equal(paymentDay.statusCode, 201, paymentDay.body);

  const prefix = `/v1/financial-attendance?company_id=${companyA}&employee_id=${employeeId}&date_from=2026-10-02&date_to=2026-10-02`;
  const financial = await request('GET', prefix, tokenA);
  assert.equal(financial.statusCode, 200, financial.body);
  const row = financial.json().data.find((item: { date: string }) => item.date === '2026-10-02');
  assert.ok(row);
  assert.equal(row.financial.allowanceCents, 1200);
  assert.equal(financial.json().totals.allowanceCents, 1200);
  assert.equal(financial.json().totals.totalCents, 1200);

  const xlsx = await request('GET', `${prefix.replace('/v1/financial-attendance', '/v1/reports/attendance')}&format=xlsx`, tokenA);
  assert.equal(xlsx.statusCode, 200, xlsx.body);
  const entries = unzipSync(xlsx.rawPayload);
  const sheet = strFromU8(entries['xl/worksheets/sheet1.xml']!);
  assert.match(sheet, /Financeiro/);
  assert.match(sheet, /12,00/);
  const pdf = await request('GET', `${prefix.replace('/v1/financial-attendance', '/v1/reports/attendance')}&format=pdf`, tokenA);
  assert.equal(pdf.statusCode, 200, pdf.body);
  assert.deepEqual(pdf.rawPayload.subarray(0, 4), Buffer.from('%PDF'));

  const foreign = await request('GET', prefix, tokenB);
  assert.equal(foreign.statusCode, 403, foreign.body);
});

test('administrative punch corrections keep the original and trigger an auditable recalculation', async () => {
  const correctedTimestamp = new Date(new Date(acceptedPunchTimestamp).getTime() + 60_000).toISOString();
  const before = await sql.query(
    'select max(revision)::int as revision from public.attendance_calculations where company_id=$1', [companyA],
  );
  const created = await request('POST', `/v1/punches/${acceptedPunchId}/adjustments`, tokenA, {
    company_id: companyA, corrected_timestamp: correctedTimestamp, reason: 'Horário conferido pelo RH',
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().original_time_punch_id, acceptedPunchId);
  const foreign = await request('POST', `/v1/punches/${acceptedPunchId}/adjustments`, tokenB, {
    company_id: companyA, corrected_timestamp: correctedTimestamp, reason: 'Tentativa cruzada',
  });
  assert.equal(foreign.statusCode, 403, foreign.body);
  const original = await sql.query('select timestamp from public.time_punches where id=$1', [acceptedPunchId]);
  assert.equal(original.rows[0].timestamp.toISOString(), acceptedPunchTimestamp);
  const adjustment = await sql.query(
    'select original_value,new_value,actor_id from public.punch_adjustments where id=$1', [created.json().id],
  );
  assert.equal(adjustment.rowCount, 1);
  assert.equal(new Date(adjustment.rows[0].original_value.timestamp).toISOString(), acceptedPunchTimestamp);
  assert.equal(new Date(adjustment.rows[0].new_value.timestamp).toISOString(), correctedTimestamp);
  assert.ok(adjustment.rows[0].actor_id);
  const effectivePunches = await request('GET', `/v1/punches?company_id=${companyA}&employee_id=${employeeId}`, tokenA);
  assert.equal(effectivePunches.statusCode, 200, effectivePunches.body);
  const effectivePunch = effectivePunches.json().data.find((item: { id: string }) => item.id === created.json().id);
  assert.ok(effectivePunch);
  assert.equal(effectivePunch.original_time_punch_id, acceptedPunchId);
  assert.equal(new Date(effectivePunch.timestamp).toISOString(), correctedTimestamp);
  assert.equal(effectivePunches.json().data.some((item: { id: string }) => item.id === acceptedPunchId), false);
  const listed = await request('GET', `/v1/punch-adjustments?company_id=${companyA}`, tokenA);
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json().data.length, 1);
  const foreignList = await request('GET', `/v1/punch-adjustments?company_id=${companyA}`, tokenB);
  assert.equal(foreignList.statusCode, 200, foreignList.body);
  assert.deepEqual(foreignList.json().data, []);
  const queued = await sql.query('select count(*)::int as count from private.attendance_recalculation_queue where company_id=$1 and employee_id=$2', [companyA, employeeId]);
  assert.equal(queued.rows[0].count, 1);
  const stopWorker = startAttendanceWorker({ ...config, ENABLE_ATTENDANCE_WORKER: true });
  const deadline = Date.now() + 15_000;
  let processed = false;
  while (Date.now() < deadline) {
    const remaining = await sql.query('select count(*)::int as count from private.attendance_recalculation_queue where company_id=$1 and employee_id=$2', [companyA, employeeId]);
    if (remaining.rows[0].count === 0) { processed = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stopWorker();
  assert.equal(processed, true, 'correction should be recalculated from the durable queue');
  const after = await sql.query('select max(revision)::int as revision from public.attendance_calculations where company_id=$1', [companyA]);
  assert.ok(after.rows[0].revision > before.rows[0].revision);
  const audit = await sql.query(
    "select action from public.audit_logs where company_id=$1 and entity_type='punch_adjustments' and entity_id=$2", [companyA, created.json().id],
  );
  assert.equal(audit.rows[0].action, 'INSERT');
});

test('terminal reassignment is atomic and preserves queue status and assignment history', async () => {
  const newLocation = await request('POST', '/v1/locations', tokenA, { company_id: companyA, name: 'Filial B' });
  assert.equal(newLocation.statusCode, 201, newLocation.body);
  const effectiveAt = new Date().toISOString();
  const foreign = await request('POST', `/v1/terminals/${terminalId}/reassign`, tokenB, {
    company_id: companyA, new_location_id: newLocation.json().id, expected_version: 2, effective_at: effectiveAt,
  });
  assert.equal(foreign.statusCode, 403, foreign.body);

  const moved = await request('POST', `/v1/terminals/${terminalId}/reassign`, tokenA, {
    company_id: companyA, new_location_id: newLocation.json().id, expected_version: 2, effective_at: effectiveAt,
  });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal(moved.json().terminal_version, 3);
  assert.equal(moved.json().assignment_version, 2);

  const history = await sql.query(
    'select location_id,version,valid_from,valid_to from public.terminal_location_assignments where terminal_id=$1 order by version', [terminalId],
  );
  assert.equal(history.rowCount, 2);
  assert.equal(history.rows[0].valid_to.toISOString(), history.rows[1].valid_from.toISOString());
  assert.equal(history.rows[1].location_id, newLocation.json().id);
  const status = await sql.query('select pending_count,app_version from public.terminal_status where terminal_id=$1', [terminalId]);
  assert.deepEqual(status.rows[0], { pending_count: 3, app_version: '0.1.0' });

  const stale = await request('POST', `/v1/terminals/${terminalId}/reassign`, tokenA, {
    company_id: companyA, new_location_id: locationA, expected_version: 2, effective_at: new Date().toISOString(),
  });
  assert.equal(stale.statusCode, 409, stale.body);
});

test('attendance, occurrences and bank-hour queries obey tenant isolation', async () => {
  for (const path of ['/v1/attendance', '/v1/occurrences', '/v1/bank-hours']) {
    const own = await request('GET', `${path}?company_id=${companyA}`, tokenA);
    assert.equal(own.statusCode, 200, own.body);
    assert.ok(Array.isArray(own.json().data));
    assert.ok(own.json().data.length >= 1);
    const foreign = await request('GET', `${path}?company_id=${companyA}`, tokenB);
    assert.equal(foreign.statusCode, 200, foreign.body);
    assert.deepEqual(foreign.json().data, []);
  }
  const bank = await request('GET', `/v1/bank-hours?company_id=${companyA}`, tokenA);
  assert.equal(typeof bank.json().balance_minutes, 'number');
  const invalidRange = await request('GET', `/v1/attendance?company_id=${companyA}&date_from=2026-09-30&date_to=2026-09-01`, tokenA);
  assert.equal(invalidRange.statusCode, 400);
  const missingOccurrence = await request('POST', `/v1/occurrences/${randomUUID()}/resolution`, tokenA, {
    company_id: companyA, resolution: 'Conferido pelo RH',
  });
  assert.equal(missingOccurrence.statusCode, 422);
});

test('invalid input is rejected before the database', async () => {
  const response = await request('POST', '/v1/employees', tokenA, { company_id: companyA, name: '' });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'INVALID_REQUEST');
  assert.ok(response.json().request_id);
});

test('justificativas de dia são isoladas por empresa e solicitam recálculo', async () => {
  const localDate = '2026-09-15';
  const categories = await request('GET', `/v1/absence-categories?company_id=${companyA}`, tokenA);
  assert.equal(categories.statusCode, 200, categories.body);
  assert.deepEqual(categories.json().data.map((item: { name: string }) => item.name), ['Atestado', 'Folga', 'Licença paternidade']);

  const atestado = categories.json().data.find((item: { name: string }) => item.name === 'Atestado');
  const created = await request('POST', '/v1/day-justifications', tokenA, {
    company_id: companyA, employee_id: employeeId, local_date: localDate,
    absence_category_id: atestado.id, note: 'Atestado médico',
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().local_date, localDate);

  const pendingFinancial = await request('GET', `/v1/financial-attendance?company_id=${companyA}&employee_id=${employeeId}&date_from=${localDate}&date_to=${localDate}`, tokenA);
  assert.equal(pendingFinancial.statusCode, 200, pendingFinancial.body);
  assert.equal(pendingFinancial.json().data.find((item: { date: string }) => item.date === localDate)?.financialPending, true);

  const forbiddenCreate = await request('POST', '/v1/day-justifications', tokenB, {
    company_id: companyA, employee_id: employeeId, local_date: '2026-09-16',
    absence_category_id: atestado.id, note: 'Tentativa cruzada',
  });
  assert.equal(forbiddenCreate.statusCode, 403, forbiddenCreate.body);

  const listed = await request('GET', `/v1/day-justifications?company_id=${companyA}&employee_id=${employeeId}`, tokenA);
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json().data.length, 1);
  assert.equal(listed.json().data[0].absence_categories.name, 'Atestado');

  const queued = await sql.query(
    'select count(*)::int as count from private.attendance_recalculation_queue where company_id=$1 and employee_id=$2',
    [companyA, employeeId],
  );
  assert.ok(queued.rows[0].count >= 1);
  await drainAttendanceQueue(companyA, employeeId, 'justified day should be recalculated from the durable queue');

  const paidCalculation = await sql.query(
    `select c.regular_minutes,c.justified_minutes,c.missing_minutes,c.net_balance_minutes
       from public.attendance_calculations c
       join public.work_days d on d.id=c.work_day_id
      where d.company_id=$1 and d.employee_id=$2 and d.local_date=$3 and c.state='final'
      order by c.revision desc limit 1`,
    [companyA, employeeId, localDate],
  );
  assert.deepEqual(paidCalculation.rows[0], {
    regular_minutes: 0, justified_minutes: 480, missing_minutes: 0, net_balance_minutes: 0,
  });

  const unpaidCategory = await sql.query(
    `insert into public.absence_categories(company_id,name,abones_hours)
     values($1,'Licença sem abono',false)
     returning id`,
    [companyA],
  );
  const unpaid = await request('POST', '/v1/day-justifications', tokenA, {
    company_id: companyA, employee_id: employeeId, local_date: '2026-09-16',
    absence_category_id: unpaidCategory.rows[0].id, note: 'Ausência sem abono',
  });
  assert.equal(unpaid.statusCode, 201, unpaid.body);
  await drainAttendanceQueue(companyA, employeeId, 'unpaid justified day should be recalculated from the durable queue');
  const unpaidCalculation = await sql.query(
    `select c.regular_minutes,c.justified_minutes,c.missing_minutes,c.net_balance_minutes
       from public.attendance_calculations c
       join public.work_days d on d.id=c.work_day_id
      where d.company_id=$1 and d.employee_id=$2 and d.local_date=$3 and c.state='final'
      order by c.revision desc limit 1`,
    [companyA, employeeId, '2026-09-16'],
  );
  assert.deepEqual(unpaidCalculation.rows[0], {
    regular_minutes: 0, justified_minutes: 0, missing_minutes: 480, net_balance_minutes: -480,
  });

  const foreign = await request('GET', `/v1/day-justifications?company_id=${companyA}`, tokenB);
  assert.equal(foreign.statusCode, 200, foreign.body);
  assert.deepEqual(foreign.json().data, []);

  const removed = await request('DELETE', `/v1/day-justifications/${created.json().id}`, tokenA, { company_id: companyA });
  assert.equal(removed.statusCode, 200, removed.body);
  const removedUnpaid = await request('DELETE', `/v1/day-justifications/${unpaid.json().id}`, tokenA, { company_id: companyA });
  assert.equal(removedUnpaid.statusCode, 200, removedUnpaid.body);
  await drainAttendanceQueue(companyA, employeeId, 'removing a justification should recalculate the day');
  const afterRemoval = await sql.query(
    `select c.regular_minutes,c.justified_minutes,c.missing_minutes,c.net_balance_minutes
       from public.attendance_calculations c
       join public.work_days d on d.id=c.work_day_id
      where d.company_id=$1 and d.employee_id=$2 and d.local_date=$3 and c.state='final'
      order by c.revision desc limit 1`,
    [companyA, employeeId, localDate],
  );
  assert.deepEqual(afterRemoval.rows[0], {
    regular_minutes: 0, justified_minutes: 0, missing_minutes: 480, net_balance_minutes: -480,
  });
});

test('categorias de ausência preservam o abono das justificativas e só são excluídas sem histórico', async () => {
  const created = await request('POST', '/v1/absence-categories', tokenA, {
    company_id: companyA, name: `Afastamento pago ${stamp}`, abones_hours: true,
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().abones_hours, true);

  const foreignCreate = await request('POST', '/v1/absence-categories', tokenB, {
    company_id: companyA, name: `Tentativa cruzada ${stamp}`, abones_hours: false,
  });
  assert.equal(foreignCreate.statusCode, 403, foreignCreate.body);

  const localDate = '2026-09-17';
  const justification = await request('POST', '/v1/day-justifications', tokenA, {
    company_id: companyA, employee_id: employeeId, local_date: localDate,
    absence_category_id: created.json().id, note: 'Afastamento aprovado',
  });
  assert.equal(justification.statusCode, 201, justification.body);
  await drainAttendanceQueue(companyA, employeeId, 'a new justification should calculate before its category changes');

  const changed = await request('PATCH', `/v1/absence-categories/${created.json().id}`, tokenA, {
    company_id: companyA, expected_version: created.json().version,
    name: `Afastamento sem abono ${stamp}`, abones_hours: false, active: false,
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(changed.json().version, created.json().version + 1);
  assert.equal(changed.json().abones_hours, false);
  assert.equal(changed.json().active, false);

  const snapshot = await sql.query(
    'select abones_hours from public.day_justifications where id=$1', [justification.json().id],
  );
  assert.equal(snapshot.rows[0].abones_hours, true);

  const listed = await request('GET', `/v1/day-justifications?company_id=${companyA}&employee_id=${employeeId}&date_from=${localDate}&date_to=${localDate}`, tokenA);
  assert.equal(listed.statusCode, 200, listed.body);
  assert.equal(listed.json().data[0].abones_hours, true);

  const financial = await request('GET', `/v1/financial-attendance?company_id=${companyA}&employee_id=${employeeId}&date_from=${localDate}&date_to=${localDate}`, tokenA);
  assert.equal(financial.statusCode, 200, financial.body);
  const financialRow = financial.json().data.find((item: { date: string }) => item.date === localDate);
  assert.ok(financialRow);
  assert.ok(financialRow.financial.justifiedCents > 0);

  const cannotRemove = await request('DELETE', `/v1/absence-categories/${created.json().id}`, tokenA, {
    company_id: companyA, expected_version: changed.json().version,
  });
  assert.equal(cannotRemove.statusCode, 409, cannotRemove.body);
  assert.equal(cannotRemove.json().code, 'ABSENCE_CATEGORY_IN_USE');

  const foreignUpdate = await request('PATCH', `/v1/absence-categories/${created.json().id}`, tokenB, {
    company_id: companyA, expected_version: changed.json().version, active: true,
  });
  assert.equal(foreignUpdate.statusCode, 403, foreignUpdate.body);

  const removedJustification = await request('DELETE', `/v1/day-justifications/${justification.json().id}`, tokenA, { company_id: companyA });
  assert.equal(removedJustification.statusCode, 200, removedJustification.body);
  const removedCategory = await request('DELETE', `/v1/absence-categories/${created.json().id}`, tokenA, {
    company_id: companyA, expected_version: changed.json().version,
  });
  assert.equal(removedCategory.statusCode, 200, removedCategory.body);

  const deletedAudit = await sql.query(
    "select action from public.audit_logs where company_id=$1 and entity_type='absence_categories' and entity_id=$2 order by created_at desc limit 1",
    [companyA, created.json().id],
  );
  assert.equal(deletedAudit.rows[0].action, 'DELETE');
});

test('worker usa datas locais no primeiro dia e na troca de escala', async () => {
  const boundaryEmployee = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, registration: `B-${stamp}`, name: 'Pessoa de Fronteira', home_location_id: locationA,
  });
  assert.equal(boundaryEmployee.statusCode, 201, boundaryEmployee.body);
  const earlySchedule = await request('POST', '/v1/schedules', tokenA, {
    company_id: companyA, name: `Manhã curta ${stamp}`, timezone: 'America/Fortaleza', weekdays: [2],
    rules: { late_tolerance_minutes: 0, overtime_tolerance_minutes: 0, missing_punch_grace_minutes: 60 },
    segments: [{ ordinal: 1, start_minute: 480, end_minute: 600 }],
  });
  const replacementSchedule = await request('POST', '/v1/schedules', tokenA, {
    company_id: companyA, name: `Tarde longa ${stamp}`, timezone: 'America/Fortaleza', weekdays: [2],
    rules: { late_tolerance_minutes: 0, overtime_tolerance_minutes: 0, missing_punch_grace_minutes: 60 },
    segments: [{ ordinal: 1, start_minute: 840, end_minute: 1200 }],
  });
  assert.equal(earlySchedule.statusCode, 201, earlySchedule.body);
  assert.equal(replacementSchedule.statusCode, 201, replacementSchedule.body);

  const versions = await sql.query(
    'select id,schedule_id from public.schedule_versions where company_id=$1 and schedule_id = any($2)',
    [companyA, [earlySchedule.json().id, replacementSchedule.json().id]],
  );
  const earlyVersion = versions.rows.find((item) => item.schedule_id === earlySchedule.json().id)?.id;
  const replacementVersion = versions.rows.find((item) => item.schedule_id === replacementSchedule.json().id)?.id;
  assert.ok(earlyVersion);
  assert.ok(replacementVersion);

  const first = await request('POST', '/v1/schedule-assignments', tokenA, {
    company_id: companyA, employee_id: boundaryEmployee.json().id, schedule_version_id: earlyVersion,
    valid_from: '2026-09-01T00:00:00-03:00', valid_to: '2026-09-08T00:00:00-03:00',
  });
  const replacement = await request('POST', '/v1/schedule-assignments', tokenA, {
    company_id: companyA, employee_id: boundaryEmployee.json().id, schedule_version_id: replacementVersion,
    valid_from: '2026-09-08T00:00:00-03:00',
  });
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(replacement.statusCode, 201, replacement.body);

  const categories = await request('GET', `/v1/absence-categories?company_id=${companyA}`, tokenA);
  const atestado = categories.json().data.find((item: { name: string }) => item.name === 'Atestado');
  for (const localDate of ['2026-09-01', '2026-09-08']) {
    const justification = await request('POST', '/v1/day-justifications', tokenA, {
      company_id: companyA, employee_id: boundaryEmployee.json().id, local_date: localDate,
      absence_category_id: atestado.id, note: 'Cobertura de fronteira',
    });
    assert.equal(justification.statusCode, 201, justification.body);
  }
  await drainAttendanceQueue(companyA, boundaryEmployee.json().id, 'schedule boundaries should be recalculated by local date');

  const calculated = await sql.query(
    `select d.local_date::text as local_date,d.schedule_version_id,c.planned_minutes,c.justified_minutes
       from public.work_days d
       join public.attendance_calculations c on c.work_day_id=d.id
      where d.company_id=$1 and d.employee_id=$2 and d.local_date = any($3) and c.state='final'
      order by d.local_date`,
    [companyA, boundaryEmployee.json().id, ['2026-09-01', '2026-09-08']],
  );
  assert.deepEqual(calculated.rows, [
    { local_date: '2026-09-01', schedule_version_id: earlyVersion, planned_minutes: 120, justified_minutes: 120 },
    { local_date: '2026-09-08', schedule_version_id: replacementVersion, planned_minutes: 360, justified_minutes: 360 },
  ]);
});

test('worker revisa uma jornada já calculada quando a escala muda no mesmo dia', async () => {
  const employee = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, registration: `R-${stamp}`, name: 'Pessoa com escala corrigida', home_location_id: locationA,
  });
  assert.equal(employee.statusCode, 201, employee.body);
  const firstSchedule = await request('POST', '/v1/schedules', tokenA, {
    company_id: companyA, name: `Primeira escala ${stamp}`, timezone: 'America/Fortaleza', weekdays: [1],
    rules: { late_tolerance_minutes: 0, overtime_tolerance_minutes: 0, missing_punch_grace_minutes: 0 },
    segments: [{ ordinal: 1, start_minute: 480, end_minute: 720 }],
  });
  const correctedSchedule = await request('POST', '/v1/schedules', tokenA, {
    company_id: companyA, name: `Escala corrigida ${stamp}`, timezone: 'America/Fortaleza', weekdays: [1],
    rules: { late_tolerance_minutes: 0, overtime_tolerance_minutes: 0, missing_punch_grace_minutes: 0 },
    segments: [{ ordinal: 1, start_minute: 480, end_minute: 780 }],
  });
  assert.equal(firstSchedule.statusCode, 201, firstSchedule.body);
  assert.equal(correctedSchedule.statusCode, 201, correctedSchedule.body);
  const versions = await sql.query(
    'select id,schedule_id from public.schedule_versions where company_id=$1 and schedule_id = any($2)',
    [companyA, [firstSchedule.json().id, correctedSchedule.json().id]],
  );
  const firstVersion = versions.rows.find((item) => item.schedule_id === firstSchedule.json().id)?.id;
  const correctedVersion = versions.rows.find((item) => item.schedule_id === correctedSchedule.json().id)?.id;
  assert.ok(firstVersion); assert.ok(correctedVersion);
  const firstAssignment = await request('POST', '/v1/schedule-assignments', tokenA, {
    company_id: companyA, employee_id: employee.json().id, schedule_version_id: firstVersion,
    valid_from: '2026-09-01T00:00:00-03:00',
  });
  assert.equal(firstAssignment.statusCode, 201, firstAssignment.body);
  await insertManualPunch(companyA, employee.json().id, '2026-09-14T08:00:00-03:00');
  await insertManualPunch(companyA, employee.json().id, '2026-09-14T12:00:00-03:00');
  await replaceAttendanceQueue(companyA, employee.json().id, '2026-09-14T00:00:00-03:00', '2026-09-15T00:00:00-03:00');
  await drainAttendanceQueue(companyA, employee.json().id, 'the initial work day should be calculated');

  const closed = await request('PATCH', `/v1/schedule-assignments/${firstAssignment.json().id}/close`, tokenA, {
    company_id: companyA, valid_to: '2026-09-14T00:00:00-03:00',
  });
  assert.equal(closed.statusCode, 200, closed.body);
  const replacement = await request('POST', '/v1/schedule-assignments', tokenA, {
    company_id: companyA, employee_id: employee.json().id, schedule_version_id: correctedVersion,
    valid_from: '2026-09-14T00:00:00-03:00',
  });
  assert.equal(replacement.statusCode, 201, replacement.body);
  await replaceAttendanceQueue(companyA, employee.json().id, '2026-09-14T00:00:00-03:00', '2026-09-15T00:00:00-03:00');
  await drainAttendanceQueue(companyA, employee.json().id, 'the corrected schedule must replace the pending calculation');

  const calculated = await sql.query(
    `select d.schedule_version_id,c.revision,c.planned_minutes,c.state
       from public.work_days d join public.attendance_calculations c on c.work_day_id=d.id
      where d.company_id=$1 and d.employee_id=$2 and d.local_date='2026-09-14' and c.state='final'
      order by c.revision desc limit 1`,
    [companyA, employee.json().id],
  );
  assert.deepEqual(calculated.rows[0], {
    schedule_version_id: correctedVersion, revision: 2, planned_minutes: 300, state: 'final',
  });
});

test('worker inclui a saída de um turno que atravessa a meia-noite além da janela da fila', async () => {
  const employee = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, registration: `N-${stamp}`, name: 'Pessoa do turno noturno', home_location_id: locationA,
  });
  assert.equal(employee.statusCode, 201, employee.body);
  const schedule = await request('POST', '/v1/schedules', tokenA, {
    company_id: companyA, name: `Turno noturno ${stamp}`, timezone: 'America/Fortaleza', weekdays: [1],
    rules: { late_tolerance_minutes: 0, overtime_tolerance_minutes: 0, missing_punch_grace_minutes: 0 },
    segments: [{ ordinal: 1, start_minute: 1320, end_minute: 1560 }],
  });
  assert.equal(schedule.statusCode, 201, schedule.body);
  const version = await sql.query('select id from public.schedule_versions where company_id=$1 and schedule_id=$2', [companyA, schedule.json().id]);
  assert.equal(version.rowCount, 1);
  const assigned = await request('POST', '/v1/schedule-assignments', tokenA, {
    company_id: companyA, employee_id: employee.json().id, schedule_version_id: version.rows[0].id,
    valid_from: '2026-09-01T00:00:00-03:00',
  });
  assert.equal(assigned.statusCode, 201, assigned.body);

  await insertManualPunch(companyA, employee.json().id, '2026-09-14T22:00:00-03:00');
  await insertManualPunch(companyA, employee.json().id, '2026-09-15T02:00:00-03:00');
  await replaceAttendanceQueue(
    companyA, employee.json().id,
    '2026-09-14T21:00:00-03:00',
    '2026-09-15T00:00:00-03:00',
  );
  await drainAttendanceQueue(companyA, employee.json().id, 'the after-midnight exit must be included in the overnight journey');

  const calculated = await sql.query(
    `select c.state,c.worked_minutes,c.missing_minutes,c.net_balance_minutes
       from public.work_days d join public.attendance_calculations c on c.work_day_id=d.id
      where d.company_id=$1 and d.employee_id=$2 and d.local_date='2026-09-14' and c.state='final'
      order by c.revision desc limit 1`,
    [companyA, employee.json().id],
  );
  assert.deepEqual(calculated.rows[0], {
    state: 'final', worked_minutes: 240, missing_minutes: 0, net_balance_minutes: 0,
  });
});

test('worker aplica ajustes que removem uma batida da janela e os que a movem para dentro dela', async () => {
  const schedule = await request('POST', '/v1/schedules', tokenA, {
    company_id: companyA, name: `Turno de ajuste ${stamp}`, timezone: 'America/Fortaleza', weekdays: [5],
    rules: { late_tolerance_minutes: 0, overtime_tolerance_minutes: 0, missing_punch_grace_minutes: 0 },
    segments: [{ ordinal: 1, start_minute: 480, end_minute: 720 }],
  });
  assert.equal(schedule.statusCode, 201, schedule.body);
  const version = await sql.query('select id from public.schedule_versions where company_id=$1 and schedule_id=$2', [companyA, schedule.json().id]);
  assert.equal(version.rowCount, 1);

  const movedOutEmployee = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, registration: `AO-${stamp}`, name: 'Pessoa com ajuste para fora', home_location_id: locationA,
  });
  assert.equal(movedOutEmployee.statusCode, 201, movedOutEmployee.body);
  const movedOutAssignment = await request('POST', '/v1/schedule-assignments', tokenA, {
    company_id: companyA, employee_id: movedOutEmployee.json().id, schedule_version_id: version.rows[0].id,
    valid_from: '2026-09-01T00:00:00-03:00',
  });
  assert.equal(movedOutAssignment.statusCode, 201, movedOutAssignment.body);
  const originalEntry = await insertAcceptedPunch(companyA, movedOutEmployee.json().id, '2026-09-11T08:00:00-03:00');
  await insertAcceptedPunch(companyA, movedOutEmployee.json().id, '2026-09-11T12:00:00-03:00');
  const movedOut = await request('POST', `/v1/punches/${originalEntry}/adjustments`, tokenA, {
    company_id: companyA, corrected_timestamp: '2026-09-11T20:00:00-03:00', reason: 'Entrada conferida fora da jornada',
  });
  assert.equal(movedOut.statusCode, 201, movedOut.body);
  await replaceAttendanceQueue(
    companyA, movedOutEmployee.json().id,
    '2026-09-11T07:00:00-03:00',
    '2026-09-11T13:00:00-03:00',
  );
  await drainAttendanceQueue(companyA, movedOutEmployee.json().id, 'an adjusted original punch must not remain in its original window');
  const movedOutCalculation = await sql.query(
    `select c.state,c.worked_minutes
       from public.work_days d join public.attendance_calculations c on c.work_day_id=d.id
      where d.company_id=$1 and d.employee_id=$2 and d.local_date='2026-09-11'
      order by c.revision desc limit 1`,
    [companyA, movedOutEmployee.json().id],
  );
  assert.deepEqual(movedOutCalculation.rows[0], { state: 'provisional', worked_minutes: null });

  const movedInEmployee = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, registration: `AI-${stamp}`, name: 'Pessoa com ajuste para dentro', home_location_id: locationA,
  });
  assert.equal(movedInEmployee.statusCode, 201, movedInEmployee.body);
  const movedInAssignment = await request('POST', '/v1/schedule-assignments', tokenA, {
    company_id: companyA, employee_id: movedInEmployee.json().id, schedule_version_id: version.rows[0].id,
    valid_from: '2026-09-01T00:00:00-03:00',
  });
  assert.equal(movedInAssignment.statusCode, 201, movedInAssignment.body);
  const originalOutside = await insertAcceptedPunch(companyA, movedInEmployee.json().id, '2026-09-11T20:00:00-03:00');
  await insertAcceptedPunch(companyA, movedInEmployee.json().id, '2026-09-11T12:00:00-03:00');
  const movedIn = await request('POST', `/v1/punches/${originalOutside}/adjustments`, tokenA, {
    company_id: companyA, corrected_timestamp: '2026-09-11T08:00:00-03:00', reason: 'Entrada conferida dentro da jornada',
  });
  assert.equal(movedIn.statusCode, 201, movedIn.body);
  await replaceAttendanceQueue(
    companyA, movedInEmployee.json().id,
    '2026-09-11T00:00:00-03:00',
    '2026-09-11T02:00:00-03:00',
  );
  await drainAttendanceQueue(companyA, movedInEmployee.json().id, 'an adjustment moved into the candidate window must be counted');
  const movedInCalculation = await sql.query(
    `select c.state,c.worked_minutes,c.missing_minutes,c.net_balance_minutes
       from public.work_days d join public.attendance_calculations c on c.work_day_id=d.id
      where d.company_id=$1 and d.employee_id=$2 and d.local_date='2026-09-11' and c.state='final'
      order by c.revision desc limit 1`,
    [companyA, movedInEmployee.json().id],
  );
  assert.deepEqual(movedInCalculation.rows[0], {
    state: 'final', worked_minutes: 240, missing_minutes: 0, net_balance_minutes: 0,
  });

  const movedBackOut = await request('POST', `/v1/punches/${originalOutside}/adjustments`, tokenA, {
    company_id: companyA, corrected_timestamp: '2026-09-11T20:00:00-03:00', reason: 'Correção mais recente fora da jornada',
  });
  assert.equal(movedBackOut.statusCode, 201, movedBackOut.body);
  await replaceAttendanceQueue(
    companyA, movedInEmployee.json().id,
    '2026-09-11T00:00:00-03:00',
    '2026-09-11T02:00:00-03:00',
  );
  await drainAttendanceQueue(companyA, movedInEmployee.json().id, 'the newest adjustment must replace an older adjustment moved into the candidate window');
  const newestAdjustmentCalculation = await sql.query(
    `select c.state,c.worked_minutes
       from public.work_days d join public.attendance_calculations c on c.work_day_id=d.id
      where d.company_id=$1 and d.employee_id=$2 and d.local_date='2026-09-11'
      order by c.revision desc limit 1`,
    [companyA, movedInEmployee.json().id],
  );
  assert.deepEqual(newestAdjustmentCalculation.rows[0], { state: 'provisional', worked_minutes: null });
});

test('worker pagina batidas acima do limite do PostgREST sem perder as batidas da jornada', async () => {
  const employee = await request('POST', '/v1/employees', tokenA, {
    company_id: companyA, registration: `P-${stamp}`, name: 'Pessoa com histórico extenso', home_location_id: locationA,
  });
  assert.equal(employee.statusCode, 201, employee.body);
  const schedule = await request('POST', '/v1/schedules', tokenA, {
    company_id: companyA, name: `Turno paginado ${stamp}`, timezone: 'America/Fortaleza', weekdays: [1],
    rules: { late_tolerance_minutes: 0, overtime_tolerance_minutes: 0, missing_punch_grace_minutes: 0 },
    segments: [{ ordinal: 1, start_minute: 480, end_minute: 720 }],
  });
  assert.equal(schedule.statusCode, 201, schedule.body);
  const version = await sql.query('select id from public.schedule_versions where company_id=$1 and schedule_id=$2', [companyA, schedule.json().id]);
  assert.equal(version.rowCount, 1);
  const assignment = await request('POST', '/v1/schedule-assignments', tokenA, {
    company_id: companyA, employee_id: employee.json().id, schedule_version_id: version.rows[0].id,
    valid_from: '2026-09-01T00:00:00-03:00',
  });
  assert.equal(assignment.statusCode, 201, assignment.body);

  const membership = await sql.query(
    'select user_id from public.company_memberships where company_id=$1 and active order by user_id limit 1', [companyA],
  );
  assert.equal(membership.rowCount, 1);
  await sql.query(
    `insert into public.manual_punches(company_id,employee_id,location_id,"timestamp",reason,actor_id)
     select $1,$2,$3,$4::timestamptz + (series * interval '1 microsecond'),'Evento fora da jornada',$5
       from generate_series(1,1000) as series`,
    [companyA, employee.json().id, locationA, '2026-09-13T12:00:00-03:00', membership.rows[0].user_id],
  );
  await insertManualPunch(companyA, employee.json().id, '2026-09-14T08:00:00-03:00');
  await insertManualPunch(companyA, employee.json().id, '2026-09-14T12:00:00-03:00');
  await replaceAttendanceQueue(
    companyA, employee.json().id,
    '2026-09-13T00:00:00-03:00',
    '2026-09-14T13:00:00-03:00',
  );
  await drainAttendanceQueue(companyA, employee.json().id, 'the worker must read the second page containing the valid punches');

  const calculated = await sql.query(
    `select c.state,c.worked_minutes,c.missing_minutes,c.net_balance_minutes
       from public.work_days d join public.attendance_calculations c on c.work_day_id=d.id
      where d.company_id=$1 and d.employee_id=$2 and d.local_date='2026-09-14' and c.state='final'
      order by c.revision desc limit 1`,
    [companyA, employee.json().id],
  );
  assert.deepEqual(calculated.rows[0], {
    state: 'final', worked_minutes: 240, missing_minutes: 0, net_balance_minutes: 0,
  });
});

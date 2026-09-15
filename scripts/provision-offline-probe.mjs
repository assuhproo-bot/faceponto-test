import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const terminalId = process.argv[2] ?? '161bc4b9-7151-4dc6-ae8a-25e9698b5e1b';
const status = spawnSync(process.execPath, ['scripts/supabase.mjs', 'status', '-o', 'json'], { encoding: 'utf8', windowsHide: true });
if (status.status !== 0) throw new Error('Supabase local indisponível');
const local = JSON.parse(status.stdout.slice(status.stdout.indexOf('{')));
const database = new pg.Client({ connectionString: local.DB_URL });
await database.connect();
await database.query('begin');
try {
  const terminal = await database.query('select company_id,location_id from public.terminals where id=$1', [terminalId]);
  if (terminal.rowCount !== 1) throw new Error('Terminal de teste não encontrado');
  const { company_id: companyId, location_id: locationId } = terminal.rows[0];
  const employee = await database.query(`insert into public.employees(company_id,registration,name,home_location_id)
    values($1,'OFFLINE-PROBE','Sonda offline sintética',$2)
    on conflict(company_id,registration) do update set active=true,home_location_id=excluded.home_location_id
    returning id`, [companyId, locationId]);
  const employeeId = employee.rows[0].id;
  const existing = await database.query('select id from private.facial_profiles where company_id=$1 and employee_id=$2 and version=1', [companyId, employeeId]);
  const profileId = existing.rows[0]?.id ?? randomUUID();
  if (existing.rowCount === 0) await database.query(`insert into private.facial_profiles
    (id,company_id,employee_id,version,recognition_model_sha256,liveness_model_sha256,policy_version)
    values($1,$2,$3,1,$4,$5,999)`, [profileId, companyId, employeeId, 'd'.repeat(64), 'e'.repeat(64)]);
  await database.query('commit');
  console.log(JSON.stringify({ terminal_id: terminalId, employee_id: employeeId, profile_id: profileId, synthetic: true }));
} catch (cause) {
  await database.query('rollback');
  throw cause;
} finally { await database.end(); }

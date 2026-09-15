import { spawnSync } from 'node:child_process';
import pg from 'pg';

const status = spawnSync(process.execPath, ['scripts/supabase.mjs', 'status', '-o', 'json'], { encoding: 'utf8', windowsHide: true });
if (status.status !== 0) throw new Error('Supabase local indisponível');
const local = JSON.parse(status.stdout.slice(status.stdout.indexOf('{')));
const database = new pg.Client({ connectionString: local.DB_URL });
await database.connect();
await database.query('begin');
try {
  const employees = await database.query("select id,company_id from public.employees where registration='OFFLINE-PROBE' and name='Sonda offline sintética'");
  await database.query('set local session_replication_role=replica');
  for (const employee of employees.rows) {
    await database.query('delete from public.time_punches where company_id=$1 and employee_id=$2', [employee.company_id, employee.id]);
    await database.query('delete from private.facial_profiles where company_id=$1 and employee_id=$2', [employee.company_id, employee.id]);
    await database.query('delete from public.employees where company_id=$1 and id=$2', [employee.company_id, employee.id]);
  }
  await database.query('commit');
  console.log(JSON.stringify({ synthetic_employees_removed: employees.rowCount }));
} catch (cause) { await database.query('rollback'); throw cause; }
finally { await database.end(); }

import { spawnSync } from 'node:child_process';
import pg from 'pg';

const eventId = process.argv[2];
if (!eventId) throw new Error('Informe o UUID do evento sintético');
const status = spawnSync(process.execPath, ['scripts/supabase.mjs', 'status', '-o', 'json'], { encoding: 'utf8', windowsHide: true });
if (status.status !== 0) throw new Error('Supabase local indisponível');
const local = JSON.parse(status.stdout.slice(status.stdout.indexOf('{')));
const database = new pg.Client({ connectionString: local.DB_URL });
await database.connect();
try {
  const result = await database.query(`select p.sync_status,p.clock_status,p.result_code,(p.receipt_id is not null) receipt_persisted,e.registration
    from public.time_punches p join public.employees e on e.id=p.employee_id and e.company_id=p.company_id
    where p.id=$1`, [eventId]);
  if (result.rowCount !== 1 || result.rows[0].registration !== 'OFFLINE-PROBE') throw new Error('Evento sintético não encontrado');
  console.log(JSON.stringify(result.rows[0]));
} finally { await database.end(); }

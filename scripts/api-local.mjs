import { spawn, spawnSync } from 'node:child_process';

const status = spawnSync(process.execPath, ['scripts/supabase.mjs', 'status', '-o', 'json'], {
  encoding: 'utf8', windowsHide: true,
});
if (status.status !== 0) {
  process.stderr.write(status.stderr || 'Supabase local indisponível.\n');
  process.exit(status.status ?? 1);
}
const start = status.stdout.indexOf('{');
if (start < 0) throw new Error('Status local do Supabase inválido');
const local = JSON.parse(status.stdout.slice(start));
const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'apps/api/src/server.ts'], {
  stdio: 'inherit', windowsHide: true,
  env: {
    ...process.env,
    SUPABASE_URL: local.API_URL,
    SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: local.SECRET_KEY,
    ENABLE_TEST_FAULTS: process.argv.includes('--enable-test-faults') ? 'true' : 'false',
    ENABLE_ATTENDANCE_WORKER: 'true',
  },
});
child.on('error', (cause) => { console.error(`API local: ${cause.message}`); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });

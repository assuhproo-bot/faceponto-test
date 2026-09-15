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
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/admin/vite.config.ts'], {
  stdio: 'inherit', windowsHide: true,
  env: {
    ...process.env,
    VITE_SUPABASE_URL: local.API_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
    VITE_API_URL: '',
    ADMIN_API_PROXY: 'http://127.0.0.1:3001',
  },
});
child.on('error', (cause) => { console.error(`Painel local: ${cause.message}`); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });

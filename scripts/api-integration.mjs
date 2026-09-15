import { spawnSync } from 'node:child_process';

const status = spawnSync(process.execPath, ['scripts/supabase.mjs', 'status', '-o', 'json'], {
  encoding: 'utf8', windowsHide: true,
});
if (status.status !== 0) {
  process.stderr.write(status.stderr || status.stdout);
  process.exit(status.status ?? 1);
}
const start = status.stdout.indexOf('{');
if (start < 0) throw new Error('Supabase status did not return JSON');
const local = JSON.parse(status.stdout.slice(start));
const child = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--test', 'apps/api/test/integration.test.ts'], {
  stdio: 'inherit', windowsHide: true,
  env: {
    ...process.env,
    SUPABASE_URL: local.API_URL,
    SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: local.SECRET_KEY,
    TEST_DATABASE_URL: local.DB_URL,
  },
});
if (child.error) console.error(child.error);
process.exitCode = child.status ?? 1;

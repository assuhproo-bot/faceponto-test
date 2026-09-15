import { existsSync } from 'node:fs';
import { dirname, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const env = { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' };
if (process.platform === 'win32') {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const candidates = [
    join(pf, 'Rancher Desktop', 'resources', 'resources', 'win32', 'bin', 'docker.exe'),
    join(pf, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
  ];
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'Programs', 'Rancher Desktop', 'resources', 'resources', 'win32', 'bin', 'docker.exe'));
  const docker = candidates.find(existsSync);
  if (docker) {
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
    env[pathKey] = `${dirname(docker)}${delimiter}${env[pathKey] || ''}`;
  }
}
const child = spawn(process.execPath, [join(projectRoot, 'node_modules', 'supabase', 'dist', 'supabase.js'), ...process.argv.slice(2)], {
  cwd: projectRoot, env, stdio: 'inherit', windowsHide: true,
});
child.on('error', (error) => { console.error(`Supabase CLI: ${error.message}`); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });

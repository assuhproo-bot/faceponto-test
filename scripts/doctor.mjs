import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const missing = [];
console.log('FacePonto — diagnóstico local (não altera o sistema)');
console.log(`Node: ${process.version}`);
if (Number(process.versions.node.split('.')[0]) !== 24) missing.push('Node.js 24');

const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
const localAppData = process.env.LOCALAPPDATA;
const candidates = [
  'docker',
  join(programFiles, 'Rancher Desktop', 'resources', 'resources', 'win32', 'bin', 'docker.exe'),
  join(programFiles, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'),
];
if (localAppData) {
  candidates.push(join(localAppData, 'Programs', 'Rancher Desktop', 'resources', 'resources', 'win32', 'bin', 'docker.exe'));
}
let runtimeFound = false;
for (const candidate of candidates) {
  if (candidate !== 'docker' && !existsSync(candidate)) continue;
  const result = spawnSync(candidate, ['info', '--format', '{{.ServerVersion}}'], {
    encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  if (result.error?.code === 'ENOENT') continue;
  runtimeFound = true;
  if (result.status === 0) console.log(`Runtime acessível: ${result.stdout.trim()}`);
  else missing.push(`Runtime não acessível (${result.error?.code || `saída ${result.status}`}); verificar daemon/permissões`);
  break;
}
if (!runtimeFound) missing.push('Runtime de contêineres: Rancher Desktop com Moby ou outro compatível com Docker');

const javaPath = process.env.JAVA_HOME
  ? join(process.env.JAVA_HOME, 'bin', 'java.exe')
  : join(programFiles, 'Android', 'Android Studio', 'jbr', 'bin', 'java.exe');
console.log(existsSync(javaPath) ? `JDK localizado: ${javaPath}` : 'JDK ainda não localizado; necessário na fase 04.');
const sdkPath = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  || (localAppData && join(localAppData, 'Android', 'Sdk'));
console.log(sdkPath && existsSync(sdkPath) ? `Android SDK: ${sdkPath}` : 'Android SDK não localizado; necessário na fase 04.');

if (missing.length) {
  console.log('Pendências para o banco local:');
  for (const item of missing) console.log(`- ${item}`);
  console.log('Consulte docs/local-development.md. Banco ainda não validado.');
  process.exitCode = 1;
} else {
  console.log('Runtime acessível. Próximo comando: npm.cmd run db:start');
}

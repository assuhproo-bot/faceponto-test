import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const status = spawnSync(process.execPath, ['scripts/supabase.mjs', 'status', '-o', 'json'], { encoding: 'utf8', windowsHide: true });
if (status.status !== 0) throw new Error('Supabase local indisponível');
const local = JSON.parse(status.stdout.slice(status.stdout.indexOf('{')));
const admin = createClient(local.API_URL, local.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = Date.now();
const email = `android-admin-${stamp}@faceponto.test`;
const password = `FacePonto-${stamp}-Aa9!`;
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) throw created.error;
const browser = createClient(local.API_URL, local.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const signed = await browser.auth.signInWithPassword({ email, password });
if (signed.error) throw signed.error;
const token = signed.data.session.access_token;
async function api(path, body) {
  const response = await fetch(`http://127.0.0.1:3001${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${result.code ?? response.status}`);
  return result;
}
const company = await api('/v1/companies', { name: 'FacePonto Android Teste', display_name: 'Administrador de teste' });
const location = await api('/v1/locations', { company_id: company.id, name: 'Dispositivo de teste' });
const terminal = await api('/v1/terminals', { company_id: company.id, location_id: location.id, code: `PHONE-${stamp}`, name: 'Samsung de teste' });
const pairing = await api(`/v1/terminals/${terminal.id}/pairing`, {});
process.stdout.write(JSON.stringify({ code: pairing.code, terminal_id: terminal.id, company_id: company.id, location_id: location.id, admin_user_id: created.data.user.id }));

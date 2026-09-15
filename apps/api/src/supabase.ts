import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { ApiConfig } from './config.js';

export type AuthContext = { user: User; db: SupabaseClient };

export function client(config: ApiConfig, authorization?: string): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
    ...(authorization ? { global: { headers: { Authorization: authorization } } } : {}),
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function tokenFromHeader(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^Bearer ([^\s]+)$/i.exec(value);
  return match?.[1] ?? null;
}

export async function authenticate(config: ApiConfig, authorization: string | undefined): Promise<AuthContext | null> {
  const token = tokenFromHeader(authorization);
  if (!token) return null;
  const verifier = client(config);
  const { data, error } = await verifier.auth.getUser(token);
  if (error || !data.user || data.user.is_anonymous) return null;
  const db = client(config, `Bearer ${token}`);
  return { user: data.user, db };
}

export type CompanyMembership = {
  company_id: string;
  role: string;
  active: boolean;
  companies: { id: string; name: string; timezone: string; active: boolean } | null;
};
export type Me = { user: { id: string; email: string | null }; memberships: CompanyMembership[] };
export type Punch = {
  id: string; employee_id: string; timestamp: string; punch_type: string; sync_status: string; clock_status: string;
  source: string; reason?: string; location_name: string | null; employee_name: string | null; employee_registration: string | null;
};
export type FacialProfileStatus = { employee_id: string; profile_version: number; prepared_at: string };
export type EmployeePaymentSettings = {
  id: string; company_id: string; employee_id: string; regular_hour_cents: number; overtime_hour_cents: number;
  meal_cents: number; dinner_cents: number; daily_allowance_cents: number; night_shift_cents: number; saturday_cents: number; version: number;
};
export type WorkDay = {
  id: string; employee_id: string; local_date: string; timezone: string;
  attendance_calculations: Array<{
    id: string; revision: number; state: string; planned_minutes: number; worked_minutes: number | null;
    late_minutes: number | null; gross_overtime_minutes: number | null; net_balance_minutes: number | null;
    classifications: Array<{ event_id: string; type: string }>;
  }>;
};
export type Occurrence = {
  id: string; employee_id: string; severity: 'warning' | 'error'; type: string; status: 'open' | 'resolved';
  resolution: string | null; created_at: string;
};
export type BankEntry = { id: string; employee_id: string; delta_minutes: number; reason: string; created_at: string };
export type PunchAdjustment = {
  id: string; employee_id: string; original_time_punch_id: string; corrected_timestamp: string; reason: string; created_at: string;
};
export type Employee = {
  id: string; registration: string; name: string; job_title: string; home_location_id: string; active: boolean; version: number;
};
export type Location = { id: string; name: string; active: boolean; version: number };
export type EmployeeLocation = { id: string; employee_id: string; location_id: string; valid_from: string; valid_to: string | null };
export type Schedule = {
  id: string; name: string;
  schedule_versions: Array<{ id: string; version: number; timezone: string; schedule_segments: Array<{ start_minute: number; end_minute: number }> }>;
};
export type ScheduleAssignment = {
  id: string; employee_id: string; schedule_version_id: string; valid_from: string; valid_to: string | null;
  schedule_versions: {
    id: string; version: number; timezone: string;
    work_schedules: { id: string; name: string; active: boolean } | null;
  } | null;
};
export type EmployeeSchedulePlan = {
  id: string; employee_id: string; local_date: string; schedule_version_id: string; active: boolean; version: number;
  schedule_versions: {
    id: string; version: number; timezone: string;
    work_schedules: { id: string; name: string; active: boolean } | null;
  } | null;
};
export type Terminal = {
  id: string; company_id: string; location_id: string; code: string; name: string; active: boolean; version: number;
  last_heartbeat_at: string | null; last_sync_at: string | null; created_at: string;
};
export type EmployeeRegistrationRequest = {
  id: string; company_id: string; name: string; registration: string | null; contact: string | null; note: string | null;
  status: 'pending' | 'reviewed' | 'declined'; created_at: string; reviewed_at: string | null;
};

const baseUrl = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export async function api<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
      ? body.message : 'Não foi possível concluir a operação.';
    throw new ApiError(response.status, message);
  }
  return body as T;
}

export function withQuery(path: string, values: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

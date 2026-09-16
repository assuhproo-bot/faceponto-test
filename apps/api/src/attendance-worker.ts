import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { evaluateAttendance, type AttendanceResult } from '../../../packages/attendance/index.mjs';
import type { ApiConfig } from './config.js';

type Job = {
  company_id: string; employee_id: string; affected_from: string; affected_to: string;
  requested_at: string; lease_token: string; attempt: number;
};
type ScheduleVersion = {
  id: string; version: number; timezone: string; rules: Record<string, number>;
  schedule_weekdays: Array<{ iso_weekday: number }>;
  schedule_segments: Array<{ ordinal: number; start_minute: number; end_minute: number }>;
};
type Assignment = { valid_from: string; valid_to: string | null; schedule_versions: ScheduleVersion };
type DailyPlan = { local_date: string; schedule_versions: ScheduleVersion };
type Candidate = {
  schedule: ScheduleVersion; localDate: string; originMs: number; endMs: number;
  punches: Array<{ id: string; timestamp: string }>; ambiguous: string[];
};
type Adjustment = { id: string; original_time_punch_id: string; corrected_timestamp: string; created_at: string };

function localDate(instant: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(instant));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function datesBetween(first: string, last: string) {
  const result: string[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) result.push(date);
  return result;
}
function isoWeekday(date: string) { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return day || 7; }
function zonedMidnight(date: string, timeZone: string) {
  const desired = Date.parse(`${date}T00:00:00Z`); let guess = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(guess));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const hour = values.hour === '24' ? '00' : values.hour;
    const shown = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(hour), Number(values.minute), Number(values.second));
    guess -= shown - desired;
  }
  return guess;
}
function distanceTo(candidate: Candidate, instant: number) {
  if (instant < candidate.originMs) return candidate.originMs - instant;
  if (instant > candidate.endMs) return instant - candidate.endMs;
  return 0;
}

export function startAttendanceWorker(config: ApiConfig) {
  if (!config.ENABLE_ATTENDANCE_WORKER || !config.SUPABASE_SECRET_KEY) return () => {};
  const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let stopped = false; let running = false;

  const processOne = async () => {
    if (stopped || running) return; running = true;
    let job: Job | null = null;
    try {
      const claimed = await admin.rpc('claim_attendance_recalculation', { p_lease_seconds: 120 });
      if (claimed.error) throw claimed.error;
      job = claimed.data as Job | null;
      if (!job) return;
      const company = await admin.from('companies').select('timezone').eq('id', job.company_id).single();
      if (company.error) throw company.error;
      const timeZone = company.data.timezone as string;
      const firstDate = localDate(job.affected_from, timeZone);
      const affectedLastDate = localDate(job.affected_to, timeZone);
      const today = localDate(new Date().toISOString(), timeZone);
      const lastDate = affectedLastDate < today ? affectedLastDate : today;
      const assignments = await admin.from('schedule_assignments')
        .select('valid_from,valid_to,schedule_versions(id,version,timezone,rules,schedule_weekdays(iso_weekday),schedule_segments(ordinal,start_minute,end_minute))')
        .eq('company_id', job.company_id).eq('employee_id', job.employee_id).lte('valid_from', lastDate)
        .or(`valid_to.is.null,valid_to.gte.${firstDate}`);
      if (assignments.error) throw assignments.error;
      const plans = await admin.from('employee_schedule_plans')
        .select('local_date,schedule_versions(id,version,timezone,rules,schedule_weekdays(iso_weekday),schedule_segments(ordinal,start_minute,end_minute))')
        .eq('company_id', job.company_id).eq('employee_id', job.employee_id).eq('active', true)
        .gte('local_date', firstDate).lte('local_date', lastDate);
      if (plans.error) throw plans.error;
      const dailyPlans = plans.data as unknown as DailyPlan[];
      const plannedDates = new Set(dailyPlans.map((plan) => plan.local_date));
      const candidates: Candidate[] = [];
      for (const assignment of assignments.data as unknown as Assignment[]) {
        const version = assignment.schedule_versions;
        const allowed = new Set(version.schedule_weekdays.map((item) => item.iso_weekday));
        const segments = [...version.schedule_segments].sort((a, b) => a.ordinal - b.ordinal);
        for (const date of datesBetween(firstDate, lastDate)) {
          if (plannedDates.has(date) || date < assignment.valid_from || (assignment.valid_to && date >= assignment.valid_to) || !allowed.has(isoWeekday(date))) continue;
          const originMs = zonedMidnight(date, version.timezone);
          candidates.push({ schedule: version, localDate: date, originMs, endMs: originMs + Math.max(...segments.map((item) => item.end_minute)) * 60_000, punches: [], ambiguous: [] });
        }
      }
      for (const plan of dailyPlans) {
        const version = plan.schedule_versions;
        const segments = [...version.schedule_segments].sort((a, b) => a.ordinal - b.ordinal);
        const originMs = zonedMidnight(plan.local_date, version.timezone);
        candidates.push({ schedule: version, localDate: plan.local_date, originMs, endMs: originMs + Math.max(...segments.map((item) => item.end_minute)) * 60_000, punches: [], ambiguous: [] });
      }
      const punches = await admin.from('time_punches').select('id,timestamp').eq('company_id', job.company_id)
        .eq('employee_id', job.employee_id).eq('sync_status', 'accepted').gte('timestamp', job.affected_from).lte('timestamp', job.affected_to)
        .order('timestamp').order('id');
      if (punches.error) throw punches.error;
      const adjustments = await admin.from('punch_adjustments').select('id,original_time_punch_id,corrected_timestamp,created_at')
        .eq('company_id', job.company_id).eq('employee_id', job.employee_id)
        .gte('corrected_timestamp', job.affected_from).lte('corrected_timestamp', job.affected_to)
        .order('created_at', { ascending: false }).order('id', { ascending: false });
      if (adjustments.error) throw adjustments.error;
      const manualPunches = await admin.from('manual_punches').select('id,timestamp')
        .eq('company_id', job.company_id).eq('employee_id', job.employee_id)
        .gte('timestamp', job.affected_from).lte('timestamp', job.affected_to).order('timestamp').order('id');
      if (manualPunches.error) throw manualPunches.error;
      const currentAdjustments = new Map<string, Adjustment>();
      for (const adjustment of adjustments.data as Adjustment[]) {
        if (!currentAdjustments.has(adjustment.original_time_punch_id)) currentAdjustments.set(adjustment.original_time_punch_id, adjustment);
      }
      const effectivePunches = [
        ...(punches.data.filter((punch) => !currentAdjustments.has(punch.id))),
        ...[...currentAdjustments.values()].map((adjustment) => ({ id: adjustment.id, timestamp: adjustment.corrected_timestamp })),
        ...(manualPunches.data ?? []).map((punch) => ({ id: punch.id, timestamp: punch.timestamp })),
      ].sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
      for (const punch of effectivePunches) {
        const instant = Date.parse(punch.timestamp); const eligible = candidates
          .filter((candidate) => instant >= candidate.originMs - 4 * 3_600_000 && instant <= candidate.endMs + 4 * 3_600_000)
          .map((candidate) => ({ candidate, distance: distanceTo(candidate, instant) })).sort((a, b) => a.distance - b.distance);
        if (!eligible.length) continue;
        if (eligible[1]?.distance === eligible[0]?.distance) eligible.filter((item) => item.distance === eligible[0]?.distance).forEach((item) => item.candidate.ambiguous.push(punch.id));
        else eligible[0]!.candidate.punches.push(punch);
      }
      for (const candidate of candidates) {
        const version = candidate.schedule;
        const engineInput = { journey_start: new Date(candidate.originMs).toISOString(), evaluated_at: new Date().toISOString(),
          schedule_version: version.version, rules_version: version.version, rules: version.rules,
          segments: version.schedule_segments, punches: candidate.punches };
        const result: AttendanceResult = evaluateAttendance(engineInput);
        for (const eventId of candidate.ambiguous) result.occurrences.push({ code: 'AMBIGUOUS_JOURNEY', severity: 'error', definitive: true, event_id: eventId });
        const inputHash = createHash('sha256').update(JSON.stringify(engineInput)).digest('hex');
        const recorded = await admin.rpc('record_attendance_calculation', {
          p_company: job.company_id, p_employee: job.employee_id, p_schedule_version: version.id,
          p_journey_start: new Date(candidate.originMs).toISOString(), p_journey_end: new Date(candidate.endMs).toISOString(),
          p_local_date: candidate.localDate, p_timezone: version.timezone, p_result: result, p_input_sha256: inputHash,
        });
        if (recorded.error) throw recorded.error;
      }
      const completed = await admin.rpc('complete_attendance_recalculation', {
        p_company: job.company_id, p_employee: job.employee_id, p_lease_token: job.lease_token, p_requested_at: job.requested_at,
      });
      if (completed.error) throw completed.error;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message
        : cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string'
          ? cause.message : 'processing failed';
      console.error(`Attendance worker failed: ${message}`);
      if (job) await admin.rpc('fail_attendance_recalculation', {
        p_company: job.company_id, p_employee: job.employee_id, p_lease_token: job.lease_token,
        p_error: message,
      });
    } finally { running = false; }
  };
  const timer = setInterval(() => void processOne(), 5_000); timer.unref(); void processOne();
  return () => { stopped = true; clearInterval(timer); };
}

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
type ManualAdjustment = { id: string; original_manual_punch_id: string; corrected_timestamp: string; created_at: string };
type Justification = { local_date: string; abones_hours: boolean; absence_categories: { name: string } | null };

const WORKER_PAGE_SIZE = 1_000;
const CANDIDATE_PUNCH_GRACE_MS = 4 * 3_600_000;

/**
 * PostgREST enforces a maximum response size. Attendance jobs may cover more
 * than that limit when a terminal has retried events, so every worker read
 * must advance through stable, ordered pages instead of silently truncating.
 */
async function readAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += WORKER_PAGE_SIZE) {
    const page = await fetchPage(from, from + WORKER_PAGE_SIZE - 1);
    if (page.error) throw page.error;
    const batch = (page.data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < WORKER_PAGE_SIZE) return rows;
  }
}

function timestampWindow(job: Job, candidates: Candidate[]) {
  const affectedFrom = Date.parse(job.affected_from);
  const affectedTo = Date.parse(job.affected_to);
  if (!Number.isFinite(affectedFrom) || !Number.isFinite(affectedTo)) throw new Error('Invalid attendance recalculation window');
  const candidateFrom = candidates.length
    ? Math.min(...candidates.map((candidate) => candidate.originMs - CANDIDATE_PUNCH_GRACE_MS)) : affectedFrom;
  const candidateTo = candidates.length
    ? Math.max(...candidates.map((candidate) => candidate.endMs + CANDIDATE_PUNCH_GRACE_MS)) : affectedTo;
  return {
    from: new Date(Math.min(affectedFrom, candidateFrom)).toISOString(),
    to: new Date(Math.max(affectedTo, candidateTo)).toISOString(),
  };
}

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

  const processOne = async (): Promise<boolean> => {
    if (stopped || running) return false; running = true;
    let job: Job | null = null;
    try {
      const claimed = await admin.rpc('claim_attendance_recalculation', { p_lease_seconds: 120 });
      if (claimed.error) throw claimed.error;
      job = claimed.data as Job | null;
      if (!job) return false;
      const activeJob = job;
      const company = await admin.from('companies').select('timezone').eq('id', activeJob.company_id).single();
      if (company.error) throw company.error;
      const timeZone = company.data.timezone as string;
      const firstDate = localDate(activeJob.affected_from, timeZone);
      const affectedLastDate = localDate(activeJob.affected_to, timeZone);
      const today = localDate(new Date().toISOString(), timeZone);
      const lastDate = affectedLastDate < today ? affectedLastDate : today;
      const assignments = await readAll<Assignment>((from, to) => admin.from('schedule_assignments')
        .select('valid_from,valid_to,schedule_versions(id,version,timezone,rules,schedule_weekdays(iso_weekday),schedule_segments(ordinal,start_minute,end_minute))')
        .eq('company_id', activeJob.company_id).eq('employee_id', activeJob.employee_id).lte('valid_from', lastDate)
        .or(`valid_to.is.null,valid_to.gte.${firstDate}`).order('valid_from').order('id').range(from, to));
      const dailyPlans = await readAll<DailyPlan>((from, to) => admin.from('employee_schedule_plans')
        .select('local_date,schedule_versions(id,version,timezone,rules,schedule_weekdays(iso_weekday),schedule_segments(ordinal,start_minute,end_minute))')
        .eq('company_id', activeJob.company_id).eq('employee_id', activeJob.employee_id).eq('active', true)
        .gte('local_date', firstDate).lte('local_date', lastDate).order('local_date').order('id').range(from, to));
      const justifications = await readAll<Justification>((from, to) => admin.from('day_justifications')
        .select('local_date,abones_hours,absence_categories(name)')
        .eq('company_id', activeJob.company_id).eq('employee_id', activeJob.employee_id)
        .gte('local_date', firstDate).lte('local_date', lastDate).order('local_date').order('id').range(from, to));
      const justificationsByDate = new Map(justifications
        .flatMap((item) => item.absence_categories
          ? [[item.local_date, { abones_hours: item.abones_hours, name: item.absence_categories.name }] as const]
          : []));
      const plannedDates = new Set(dailyPlans.map((plan) => plan.local_date));
      const candidates: Candidate[] = [];
      for (const assignment of assignments) {
        const version = assignment.schedule_versions;
        const allowed = new Set(version.schedule_weekdays.map((item) => item.iso_weekday));
        const segments = [...version.schedule_segments].sort((a, b) => a.ordinal - b.ordinal);
        for (const date of datesBetween(firstDate, lastDate)) {
          const assignmentFrom = localDate(assignment.valid_from, version.timezone);
          const assignmentTo = assignment.valid_to ? localDate(assignment.valid_to, version.timezone) : null;
          if (plannedDates.has(date) || date < assignmentFrom || (assignmentTo && date >= assignmentTo) || !allowed.has(isoWeekday(date))) continue;
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
      const punchWindow = timestampWindow(activeJob, candidates);
      const punches = await readAll<{ id: string; timestamp: string }>((from, to) => admin.from('time_punches').select('id,timestamp')
        .eq('company_id', activeJob.company_id).eq('employee_id', activeJob.employee_id).eq('sync_status', 'accepted')
        .gte('timestamp', punchWindow.from).lte('timestamp', punchWindow.to).order('timestamp').order('id').range(from, to));
      const adjustmentsMovedIntoWindow = await readAll<Adjustment>((from, to) => admin.from('punch_adjustments')
        .select('id,original_time_punch_id,corrected_timestamp,created_at')
        .eq('company_id', activeJob.company_id).eq('employee_id', activeJob.employee_id)
        .gte('corrected_timestamp', punchWindow.from).lte('corrected_timestamp', punchWindow.to)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to));
      const adjustmentOriginalIds = [...new Set([
        ...punches.map((punch) => punch.id),
        ...adjustmentsMovedIntoWindow.map((adjustment) => adjustment.original_time_punch_id),
      ])];
      const adjustmentsForOriginals: Adjustment[] = [];
      for (let index = 0; index < adjustmentOriginalIds.length; index += 200) {
        const originalIds = adjustmentOriginalIds.slice(index, index + 200);
        adjustmentsForOriginals.push(...await readAll<Adjustment>((from, to) => admin.from('punch_adjustments')
          .select('id,original_time_punch_id,corrected_timestamp,created_at')
          .eq('company_id', activeJob.company_id).eq('employee_id', activeJob.employee_id).in('original_time_punch_id', originalIds)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)));
      }
      const manualPunches = await readAll<{ id: string; timestamp: string }>((from, to) => admin.from('manual_punches').select('id,timestamp')
        .eq('company_id', activeJob.company_id).eq('employee_id', activeJob.employee_id)
        .gte('timestamp', punchWindow.from).lte('timestamp', punchWindow.to).order('timestamp').order('id').range(from, to));
      const manualAdjustmentsMovedIntoWindow = await readAll<ManualAdjustment>((from, to) => admin.from('manual_punch_adjustments')
        .select('id,original_manual_punch_id,corrected_timestamp,created_at')
        .eq('company_id', activeJob.company_id).eq('employee_id', activeJob.employee_id)
        .gte('corrected_timestamp', punchWindow.from).lte('corrected_timestamp', punchWindow.to)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to));
      const manualAdjustmentOriginalIds = [...new Set([
        ...manualPunches.map((punch) => punch.id),
        ...manualAdjustmentsMovedIntoWindow.map((adjustment) => adjustment.original_manual_punch_id),
      ])];
      const manualAdjustmentsForOriginals: ManualAdjustment[] = [];
      for (let index = 0; index < manualAdjustmentOriginalIds.length; index += 200) {
        const originalIds = manualAdjustmentOriginalIds.slice(index, index + 200);
        manualAdjustmentsForOriginals.push(...await readAll<ManualAdjustment>((from, to) => admin.from('manual_punch_adjustments')
          .select('id,original_manual_punch_id,corrected_timestamp,created_at')
          .eq('company_id', activeJob.company_id).eq('employee_id', activeJob.employee_id).in('original_manual_punch_id', originalIds)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)));
      }
      const adjustments = [...new Map([...adjustmentsMovedIntoWindow, ...adjustmentsForOriginals]
        .map((adjustment) => [adjustment.id, adjustment])).values()]
        .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
      const currentAdjustments = new Map<string, Adjustment>();
      for (const adjustment of adjustments) {
        if (!currentAdjustments.has(adjustment.original_time_punch_id)) currentAdjustments.set(adjustment.original_time_punch_id, adjustment);
      }
      const manualAdjustments = [...new Map([...manualAdjustmentsMovedIntoWindow, ...manualAdjustmentsForOriginals]
        .map((adjustment) => [adjustment.id, adjustment])).values()]
        .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
      const currentManualAdjustments = new Map<string, ManualAdjustment>();
      for (const adjustment of manualAdjustments) {
        if (!currentManualAdjustments.has(adjustment.original_manual_punch_id)) currentManualAdjustments.set(adjustment.original_manual_punch_id, adjustment);
      }
      const effectivePunches = [
        ...punches.filter((punch) => !currentAdjustments.has(punch.id)),
        ...[...currentAdjustments.values()].map((adjustment) => ({ id: adjustment.id, timestamp: adjustment.corrected_timestamp })),
        ...manualPunches.filter((punch) => !currentManualAdjustments.has(punch.id)),
        ...[...currentManualAdjustments.values()].map((adjustment) => ({ id: adjustment.id, timestamp: adjustment.corrected_timestamp })),
      ].sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
      for (const punch of effectivePunches) {
        const instant = Date.parse(punch.timestamp); const eligible = candidates
          .filter((candidate) => instant >= candidate.originMs - CANDIDATE_PUNCH_GRACE_MS && instant <= candidate.endMs + CANDIDATE_PUNCH_GRACE_MS)
          .map((candidate) => ({ candidate, distance: distanceTo(candidate, instant) })).sort((a, b) => a.distance - b.distance);
        if (!eligible.length) continue;
        if (eligible[1]?.distance === eligible[0]?.distance) eligible.filter((item) => item.distance === eligible[0]?.distance).forEach((item) => item.candidate.ambiguous.push(punch.id));
        else eligible[0]!.candidate.punches.push(punch);
      }
      const recordCandidate = async (candidate: Candidate) => {
        const version = candidate.schedule;
        const justification = justificationsByDate.get(candidate.localDate);
        const engineInput = { journey_start: new Date(candidate.originMs).toISOString(), evaluated_at: new Date().toISOString(),
          schedule_version: version.version, rules_version: version.version, rules: version.rules,
          segments: version.schedule_segments, punches: candidate.punches,
          justification: justification ? { abones_hours: justification.abones_hours, category_name: justification.name } : undefined,
        };
        const result: AttendanceResult = evaluateAttendance(engineInput);
        for (const eventId of candidate.ambiguous) result.occurrences.push({ code: 'AMBIGUOUS_JOURNEY', severity: 'error', definitive: true, event_id: eventId });
        const inputHash = createHash('sha256').update(JSON.stringify(engineInput)).digest('hex');
        const recorded = await admin.rpc('record_attendance_calculation', {
          p_company: activeJob.company_id, p_employee: activeJob.employee_id, p_schedule_version: version.id,
          p_journey_start: new Date(candidate.originMs).toISOString(), p_journey_end: new Date(candidate.endMs).toISOString(),
          p_local_date: candidate.localDate, p_timezone: version.timezone, p_result: result, p_input_sha256: inputHash,
        });
        if (recorded.error) throw recorded.error;
      };
      // Work days are independent. Small batches reduce network round trips without overloading the database.
      for (let index = 0; index < candidates.length; index += 6) {
        await Promise.all(candidates.slice(index, index + 6).map(recordCandidate));
      }
      const completed = await admin.rpc('complete_attendance_recalculation', {
        p_company: activeJob.company_id, p_employee: activeJob.employee_id, p_lease_token: activeJob.lease_token, p_requested_at: activeJob.requested_at,
      });
      if (completed.error) throw completed.error;
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message
        : cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string'
          ? cause.message : 'processing failed';
      console.error(`Attendance worker failed: ${message}`);
      if (job) await admin.rpc('fail_attendance_recalculation', {
        p_company: job.company_id, p_employee: job.employee_id, p_lease_token: job.lease_token,
        p_error: message,
      });
      return false;
    } finally { running = false; }
  };
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    while (!stopped) {
      const processed = await processOne();
      // A short pause avoids a busy loop only when the queue is empty or a retry is needed.
      if (!processed) await new Promise<void>((resolve) => { retryTimer = setTimeout(resolve, 750); });
    }
  };
  void run();
  return () => { stopped = true; if (retryTimer) clearTimeout(retryTimer); };
}

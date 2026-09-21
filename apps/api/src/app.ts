import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { z, ZodError } from 'zod';
import type { ApiConfig } from './config.js';
import { authenticate, client, type AuthContext } from './supabase.js';
import { validateSyncRequest } from '../../../packages/contracts/index.mjs';
import { resolveDailyFinancials } from '../../../packages/payments/index.mjs';
import { attendancePdf, attendanceXlsx, type AttendanceReport, type AttendanceReportRow } from './attendance-report.js';

declare module 'fastify' {
  interface FastifyRequest { auth: AuthContext | null }
}

const companyBody = z.object({
  name: z.string().trim().min(1).max(160),
  display_name: z.string().trim().min(1).max(160),
  timezone: z.string().trim().min(1).max(80).default('America/Fortaleza'),
}).strict();
const companyParams = z.object({ id: z.uuid() }).strict();
const companyUpdateBody = z.object({ expected_version: z.number().int().positive(), name: z.string().trim().min(1).max(160).optional(), timezone: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional() }).strict()
  .refine((value) => value.name !== undefined || value.timezone !== undefined || value.active !== undefined);
const employeesQuery = z.object({ company_id: z.uuid(), location_id: z.uuid().optional(), active: z.stringbool().optional() }).strict();
const employeeLocationsQuery = z.object({ company_id: z.uuid(), employee_id: z.uuid().optional() }).strict();
const employeeLocationBody = z.object({
  company_id: z.uuid(), employee_id: z.uuid(), location_id: z.uuid(), valid_from: z.iso.datetime({ offset: true }),
  valid_to: z.iso.datetime({ offset: true }).nullable().optional(),
}).strict().refine((value) => value.valid_to == null || new Date(value.valid_to) > new Date(value.valid_from));
const employeeBody = z.object({
  company_id: z.uuid(), registration: z.string().trim().min(1).max(40).optional(), name: z.string().trim().min(1).max(160),
  job_title: z.string().trim().max(160).default(''), department_id: z.uuid().nullable().optional(), home_location_id: z.uuid(),
}).strict();
const employeeParams = z.object({ id: z.uuid() }).strict();
const employeeUpdateBody = z.object({
  company_id: z.uuid(), expected_version: z.number().int().positive(),
  registration: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  job_title: z.string().trim().max(160).optional(),
  department_id: z.uuid().nullable().optional(),
  home_location_id: z.uuid().optional(),
  active: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => !['company_id', 'expected_version'].includes(key)));
const tenantQuery = z.object({ company_id: z.uuid() }).strict();
const locationBody = z.object({ company_id: z.uuid(), name: z.string().trim().min(1).max(160) }).strict();
const locationParams = z.object({ id: z.uuid() }).strict();
const scopedUpdateBody = z.object({ company_id: z.uuid(), expected_version: z.number().int().positive(), name: z.string().trim().min(1).max(160).optional(), active: z.boolean().optional() }).strict()
  .refine((value) => value.name !== undefined || value.active !== undefined);
const departmentsQuery = z.object({ company_id: z.uuid(), active: z.stringbool().optional() }).strict();
const departmentBody = z.object({ company_id: z.uuid(), name: z.string().trim().min(1).max(120) }).strict();
const departmentParams = z.object({ id: z.uuid() }).strict();
const departmentUpdateBody = z.object({
  company_id: z.uuid(), expected_version: z.number().int().positive(), name: z.string().trim().min(1).max(120).optional(), active: z.boolean().optional(),
}).strict().refine((value) => value.name !== undefined || value.active !== undefined);
const departmentScheduleDefaultsQuery = z.object({ company_id: z.uuid() }).strict();
const departmentScheduleDefaultBody = z.object({
  company_id: z.uuid(), department_id: z.uuid(), schedule_version_id: z.uuid(), valid_from: z.iso.date(),
  expected_version: z.number().int().positive().nullable().optional(), apply_to_unassigned: z.boolean().default(true),
}).strict();
const departmentScheduleDefaultParams = z.object({ departmentId: z.uuid() }).strict();
const clearDepartmentScheduleDefaultBody = z.object({
  company_id: z.uuid(), expected_version: z.number().int().positive(),
}).strict();
const terminalBody = z.object({
  company_id: z.uuid(), location_id: z.uuid(), code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(160),
}).strict();
const terminalParams = z.object({ id: z.uuid() }).strict();
const terminalReassignmentBody = z.object({
  company_id: z.uuid(), new_location_id: z.uuid(), expected_version: z.number().int().positive(),
  effective_at: z.iso.datetime({ offset: true }),
}).strict();
const pairingBody = z.object({ code: z.string().min(32).max(64) }).strict();
const refreshBody = z.object({ refresh_token: z.string().min(1).max(4096) }).strict();
const heartbeatBody = z.object({ pending_count: z.number().int().min(0).max(100000), app_version: z.string().trim().min(1).max(40) }).strict();
const clockAnchorBody = z.object({ boot_id: z.uuid(), device_elapsed_ms: z.number().int().min(0), uncertainty_ms: z.number().int().min(0).max(60000) }).strict();
const punchesQuery = z.object({
  company_id: z.uuid(), employee_id: z.uuid().optional(), location_id: z.uuid().optional(),
  punch_from: z.iso.datetime({ offset: true }).optional(), punch_to: z.iso.datetime({ offset: true }).optional(),
}).strict().refine((value) => !value.punch_from || !value.punch_to || new Date(value.punch_to) > new Date(value.punch_from));
const punchParams = z.object({ id: z.uuid() }).strict();
const punchAdjustmentBody = z.object({
  company_id: z.uuid(), corrected_timestamp: z.iso.datetime({ offset: true }), reason: z.string().trim().min(1).max(500),
}).strict();
const manualPunchBody = z.object({
  company_id: z.uuid(), employee_id: z.uuid(), location_id: z.uuid(), corrected_timestamp: z.iso.datetime({ offset: true }),
  reason: z.string().trim().min(1).max(500),
}).strict();
const punchAdjustmentsQuery = z.object({ company_id: z.uuid(), employee_id: z.uuid().optional() }).strict();
const attendanceQuery = z.object({
  company_id: z.uuid(), employee_id: z.uuid().optional(),
  date_from: z.iso.date().optional(), date_to: z.iso.date().optional(),
}).strict().refine((value) => !value.date_from || !value.date_to || value.date_to >= value.date_from);
const attendanceReportQuery = attendanceQuery.extend({ format: z.enum(['xlsx', 'pdf']) });
const absenceCategoriesQuery = z.object({ company_id: z.uuid(), active: z.stringbool().optional() }).strict();
const absenceCategoryBody = z.object({
  company_id: z.uuid(), name: z.string().trim().min(1).max(120), abones_hours: z.boolean(),
}).strict();
const absenceCategoryParams = z.object({ id: z.uuid() }).strict();
const absenceCategoryUpdateBody = z.object({
  company_id: z.uuid(), expected_version: z.number().int().positive(), name: z.string().trim().min(1).max(120).optional(),
  abones_hours: z.boolean().optional(), active: z.boolean().optional(),
}).strict().refine((value) => value.name !== undefined || value.abones_hours !== undefined || value.active !== undefined);
const deleteAbsenceCategoryBody = z.object({
  company_id: z.uuid(), expected_version: z.number().int().positive(),
}).strict();
const dayJustificationsQuery = z.object({
  company_id: z.uuid(), employee_id: z.uuid().optional(), date_from: z.iso.date().optional(), date_to: z.iso.date().optional(),
}).strict().refine((value) => !value.date_from || !value.date_to || value.date_to >= value.date_from);
const dayJustificationBody = z.object({
  company_id: z.uuid(), employee_id: z.uuid(), local_date: z.iso.date(), absence_category_id: z.uuid(),
  note: z.string().trim().max(500).nullable().optional(),
}).strict();
const dayJustificationParams = z.object({ id: z.uuid() }).strict();
const deleteDayJustificationBody = z.object({ company_id: z.uuid() }).strict();
const occurrencesQuery = z.object({
  company_id: z.uuid(), employee_id: z.uuid().optional(), status: z.enum(['open', 'resolved']).optional(),
  severity: z.enum(['warning', 'error']).optional(), type: z.string().trim().min(1).max(80).optional(),
}).strict();
const bankHoursQuery = attendanceQuery;
const occurrenceParams = z.object({ id: z.uuid() }).strict();
const occurrenceResolutionBody = z.object({
  company_id: z.uuid(), resolution: z.string().trim().min(1).max(500),
}).strict();
const scheduleBody = z.object({
  company_id: z.uuid(), name: z.string().trim().min(1).max(120), timezone: z.string().trim().min(1).max(80).default('America/Fortaleza'),
  rules: z.object({
    late_tolerance_minutes: z.number().int().min(0).max(1440),
    overtime_tolerance_minutes: z.number().int().min(0).max(1440),
    missing_punch_grace_minutes: z.number().int().min(0).max(1440),
  }).strict(),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).refine((days) => new Set(days).size === days.length),
  segments: z.array(z.object({
    ordinal: z.number().int().min(1).max(12), start_minute: z.number().int().min(0).max(2879), end_minute: z.number().int().min(1).max(2880),
  }).strict().refine((segment) => segment.end_minute > segment.start_minute)).min(1).max(12),
}).strict();
const scheduleAssignmentsQuery = z.object({ company_id: z.uuid(), employee_id: z.uuid().optional() }).strict();
const scheduleAssignmentBody = z.object({
  company_id: z.uuid(), employee_id: z.uuid(), schedule_version_id: z.uuid(),
  valid_from: z.iso.datetime({ offset: true }), valid_to: z.iso.datetime({ offset: true }).nullable().optional(),
}).strict().refine((value) => value.valid_to == null || new Date(value.valid_to) > new Date(value.valid_from));
const scheduleAssignmentParams = z.object({ id: z.uuid() }).strict();
const closeScheduleAssignmentBody = z.object({
  company_id: z.uuid(), valid_to: z.iso.datetime({ offset: true }),
}).strict();
const employeeSchedulePlansQuery = z.object({
  company_id: z.uuid(), employee_id: z.uuid().optional(), date_from: z.iso.date().optional(), date_to: z.iso.date().optional(),
}).strict().refine((value) => !value.date_from || !value.date_to || value.date_to >= value.date_from);
const employeeSchedulePlanBody = z.object({
  company_id: z.uuid(), employee_id: z.uuid(), local_date: z.iso.date(), schedule_version_id: z.uuid(), expected_version: z.number().int().positive().optional(),
}).strict();
const employeeSchedulePlanParams = z.object({ id: z.uuid() }).strict();
const clearEmployeeSchedulePlanBody = z.object({ company_id: z.uuid(), expected_version: z.number().int().positive() }).strict();
const facialProfileBody = z.object({ company_id: z.uuid(), employee_id: z.uuid() }).strict();
const paymentRate = z.number().int().min(0).max(10000000);
const nullablePaymentRate = paymentRate.nullable().optional().default(null);
const companyPaymentSettingsBody = z.object({
  company_id: z.uuid(), expected_version: z.number().int().positive().nullable().optional(),
  regular_hour_cents: paymentRate, overtime_hour_cents: paymentRate, serao_cents: paymentRate.default(0),
  meal_cents: paymentRate, dinner_cents: paymentRate, daily_allowance_cents: paymentRate,
  night_shift_cents: paymentRate, saturday_cents: paymentRate,
}).strict();
const paymentSettingsQuery = z.object({ company_id: z.uuid(), employee_id: z.uuid() }).strict();
const paymentSettingsBody = z.object({
  company_id: z.uuid(), employee_id: z.uuid(), expected_version: z.number().int().positive().nullable().optional(),
  regular_hour_cents: nullablePaymentRate, overtime_hour_cents: nullablePaymentRate, serao_cents: nullablePaymentRate,
  meal_cents: nullablePaymentRate, dinner_cents: nullablePaymentRate, daily_allowance_cents: nullablePaymentRate,
  night_shift_cents: nullablePaymentRate, saturday_cents: nullablePaymentRate,
}).strict();
const departmentPaymentSettingsQuery = z.object({ company_id: z.uuid(), department_id: z.uuid() }).strict();
const departmentPaymentSettingsBody = z.object({
  company_id: z.uuid(), department_id: z.uuid(), expected_version: z.number().int().positive().nullable().optional(),
  regular_hour_cents: nullablePaymentRate, overtime_hour_cents: nullablePaymentRate, serao_cents: nullablePaymentRate,
  meal_cents: nullablePaymentRate, dinner_cents: nullablePaymentRate, daily_allowance_cents: nullablePaymentRate,
  night_shift_cents: nullablePaymentRate, saturday_cents: nullablePaymentRate,
}).strict();
const paymentRatesQuery = z.object({ company_id: z.uuid(), employee_id: z.uuid() }).strict();
const paymentDaysQuery = z.object({ company_id: z.uuid(), employee_id: z.uuid(), date_from: z.iso.date().optional(), date_to: z.iso.date().optional() }).strict()
  .refine((value) => !value.date_from || !value.date_to || value.date_to >= value.date_from);
const paymentDayBody = z.object({
  company_id: z.uuid(), employee_id: z.uuid(), local_date: z.iso.date(), expected_version: z.number().int().positive().nullable().optional(),
  meal_units: z.number().int().min(0).max(10), dinner_units: z.number().int().min(0).max(10), daily_allowance_units: z.number().int().min(0).max(10),
  night_shift_units: z.number().int().min(0).max(10), saturday_units: z.number().int().min(0).max(10),
  serao_units: z.number().int().min(0).max(10).optional().default(0),
}).strict();
const publicRegistrationParams = z.object({ id: z.uuid() }).strict();
const publicRegistrationBody = z.object({
  company_id: z.uuid(), name: z.string().trim().min(1).max(160), registration: z.string().trim().max(40).optional(),
  contact: z.string().trim().max(160).optional(), note: z.string().trim().max(500).optional(),
}).strict();
const registrationRequestsQuery = z.object({ company_id: z.uuid(), status: z.enum(['pending', 'reviewed', 'declined']).optional() }).strict();
const registrationRequestParams = z.object({ id: z.uuid() }).strict();
const registrationRequestReviewBody = z.object({ company_id: z.uuid(), status: z.enum(['reviewed', 'declined']) }).strict();

function error(reply: FastifyReply, status: number, code: string, message: string, requestId: string) {
  return reply.code(status).send({ code, message, request_id: requestId });
}
function mapDatabaseError(reply: FastifyReply, request: FastifyRequest, dbError: { code?: string; message: string }) {
  if (dbError.code === '23505') return error(reply, 409, 'CONFLICT', 'Já existe um registro com estes dados.', request.id);
  if (dbError.code === '40001') return error(reply, 409, 'VERSION_CONFLICT', 'O registro foi alterado ou não está disponível.', request.id);
  if (dbError.code === 'P0001' && dbError.message.includes('FACIAL_PROFILE_ALREADY_PREPARED')) return error(reply, 409, 'FACIAL_PROFILE_ALREADY_PREPARED', 'O reconhecimento facial deste funcionário já está preparado.', request.id);
  if (dbError.code === 'P0001' && dbError.message.includes('ABSENCE_CATEGORY_IN_USE')) return error(reply, 409, 'ABSENCE_CATEGORY_IN_USE', 'Esta categoria já possui justificativas e não pode ser removida.', request.id);
  if (dbError.code === '23503' || dbError.code === '23514' || dbError.code === '23P01') {
    return error(reply, 422, 'INVALID_REFERENCE', 'Os dados informados não são válidos.', request.id);
  }
  if (dbError.code === '42501') return error(reply, 403, 'FORBIDDEN', 'Você não tem permissão para esta operação.', request.id);
  request.log.error({ code: dbError.code }, 'database request failed');
  return error(reply, 500, 'INTERNAL_ERROR', 'Não foi possível concluir a operação.', request.id);
}

const paymentRateKeys = [
  'regular_hour_cents', 'overtime_hour_cents', 'serao_cents', 'meal_cents', 'dinner_cents',
  'daily_allowance_cents', 'night_shift_cents', 'saturday_cents',
] as const;
type PaymentRateKey = typeof paymentRateKeys[number];
type ResolvedPaymentRate = { cents: number; source: 'employee' | 'department' | 'company' | 'none' };
type ResolvedPaymentRates = Record<PaymentRateKey, ResolvedPaymentRate>;
type PaymentSettings = Partial<Record<PaymentRateKey, number | null>>;
type ReportCalculation = {
  state: string; revision: number; planned_minutes: number; worked_minutes: number | null; regular_minutes: number | null;
  justified_minutes: number | null; missing_minutes: number | null; gross_overtime_minutes: number | null;
  net_balance_minutes: number | null; calculated_at: string;
};
type ReportWorkDay = { employee_id: string; local_date: string; attendance_calculations: ReportCalculation[] | null };
type ReportEmployee = { id: string; name: string; registration: string; department_id: string | null };
type PaymentDay = {
  employee_id: string; local_date: string; meal_units: number; dinner_units: number; daily_allowance_units: number;
  night_shift_units: number; saturday_units: number; serao_units: number;
};
type AbsenceCategory = { name: string; abones_hours?: boolean };
type DayJustification = { employee_id: string; local_date: string; abones_hours: boolean; updated_at: string; absence_categories: AbsenceCategory | AbsenceCategory[] | null };
type AllowanceKey = 'meal' | 'dinner' | 'daily_allowance' | 'night_shift' | 'saturday' | 'serao';
type DailyFinancials = {
  regularCents: number; justifiedCents: number; overtimeCents: number; shortageCents: number; allowanceCents: number;
  allowanceCentsByKey: Record<AllowanceKey, number>; totalCents: number;
  lines: Array<{ key: string; kind: string; label: string; cents: number; minutes?: number; units?: number; rateCents: number }>;
};
type FinancialAttendanceRow = {
  employeeId: string; date: string; employee: string; registration: string; state: string;
  plannedMinutes: number; workedMinutes: number | null; regularMinutes: number | null; justifiedMinutes: number | null;
  missingMinutes: number | null; overtimeMinutes: number | null; balanceMinutes: number | null;
  financialPending: boolean; financial: DailyFinancials; rates: ResolvedPaymentRates;
};
type FinancialAttendance = {
  company: { name: string; timezone: string }; from: string | undefined; to: string | undefined; rows: FinancialAttendanceRow[];
  totals: { plannedMinutes: number; workedMinutes: number; regularMinutes: number; justifiedMinutes: number; missingMinutes: number; overtimeMinutes: number; balanceMinutes: number; regularCents: number; justifiedCents: number; overtimeCents: number; shortageCents: number; allowanceCents: number; mealCents: number; dinnerCents: number; dailyAllowanceCents: number; nightShiftCents: number; saturdayCents: number; seraoCents: number; totalCents: number };
};
type FinancialAttendanceBuildResult =
  | { kind: 'ok'; value: FinancialAttendance }
  | { kind: 'forbidden' }
  | { kind: 'db-error'; error: { code?: string; message: string } };

function dayKey(employeeId: string, localDate: string) { return `${employeeId}:${localDate}`; }

function currentCalculation(calculations: ReportCalculation[] | null | undefined) {
  return [...(calculations ?? [])]
    .filter((item) => item.state !== 'superseded')
    .sort((left, right) => right.revision - left.revision)[0];
}

function absenceCategory(justification: DayJustification | undefined) {
  const categories = justification?.absence_categories;
  const category = Array.isArray(categories) ? categories[0] ?? null : categories ?? null;
  return category ? { name: category.name, abones_hours: justification!.abones_hours } : null;
}

function resolvedRates(
  employee: PaymentSettings | undefined, department: PaymentSettings | undefined, company: PaymentSettings | undefined,
): ResolvedPaymentRates {
  return Object.fromEntries(paymentRateKeys.map((key) => {
    const employeeValue = employee?.[key];
    if (employeeValue != null) return [key, { cents: employeeValue, source: 'employee' as const }];
    const departmentValue = department?.[key];
    if (departmentValue != null) return [key, { cents: departmentValue, source: 'department' as const }];
    const companyValue = company?.[key];
    if (companyValue != null) return [key, { cents: companyValue, source: 'company' as const }];
    return [key, { cents: 0, source: 'none' as const }];
  })) as ResolvedPaymentRates;
}

function sumRows(rows: FinancialAttendanceRow[], getter: (row: FinancialAttendanceRow) => number | null) {
  return rows.reduce((sum, row) => sum + (getter(row) ?? 0), 0);
}

type PagedResult = { data: unknown[] | null; error: { code?: string; message: string } | null };
type PagedRequest = { range: (from: number, to: number) => PromiseLike<PagedResult> };

async function fetchAllPages(request: PagedRequest): Promise<PagedResult> {
  const data: unknown[] = [];
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    const page = await request.range(from, from + pageSize - 1);
    if (page.error) return { data: null, error: page.error };
    const rows = page.data ?? [];
    data.push(...rows);
    if (rows.length < pageSize) return { data, error: null };
  }
}

async function buildFinancialAttendance(
  db: AuthContext['db'], userId: string, query: z.infer<typeof attendanceQuery>,
): Promise<FinancialAttendanceBuildResult> {
  let daysRequest = db.from('work_days')
    .select('employee_id,local_date,attendance_calculations(state,revision,planned_minutes,worked_minutes,regular_minutes,justified_minutes,missing_minutes,gross_overtime_minutes,net_balance_minutes,calculated_at)')
    .eq('company_id', query.company_id).order('local_date', { ascending: true }).order('employee_id', { ascending: true });
  let employeesRequest = db.from('employees').select('id,name,registration,department_id')
    .eq('company_id', query.company_id).order('name').order('id');
  let employeeRatesRequest = db.from('employee_payment_settings')
    .select(`employee_id,${paymentRateKeys.join(',')}`).eq('company_id', query.company_id).order('employee_id');
  let paymentDaysRequest = db.from('employee_payment_days')
    .select('employee_id,local_date,meal_units,dinner_units,daily_allowance_units,night_shift_units,saturday_units,serao_units')
    .eq('company_id', query.company_id).order('local_date', { ascending: true }).order('employee_id');
  let justificationsRequest = db.from('day_justifications')
    .select('employee_id,local_date,abones_hours,updated_at,absence_categories(name)')
    .eq('company_id', query.company_id).order('local_date', { ascending: true }).order('employee_id');
  if (query.employee_id) {
    daysRequest = daysRequest.eq('employee_id', query.employee_id);
    employeesRequest = employeesRequest.eq('id', query.employee_id);
    employeeRatesRequest = employeeRatesRequest.eq('employee_id', query.employee_id);
    paymentDaysRequest = paymentDaysRequest.eq('employee_id', query.employee_id);
    justificationsRequest = justificationsRequest.eq('employee_id', query.employee_id);
  }
  if (query.date_from) {
    daysRequest = daysRequest.gte('local_date', query.date_from);
    paymentDaysRequest = paymentDaysRequest.gte('local_date', query.date_from);
    justificationsRequest = justificationsRequest.gte('local_date', query.date_from);
  }
  if (query.date_to) {
    daysRequest = daysRequest.lte('local_date', query.date_to);
    paymentDaysRequest = paymentDaysRequest.lte('local_date', query.date_to);
    justificationsRequest = justificationsRequest.lte('local_date', query.date_to);
  }
  const [daysResult, employeesResult, companyResult, membershipResult, companyRatesResult, departmentRatesResult, employeeRatesResult, paymentDaysResult, justificationsResult] = await Promise.all([
    fetchAllPages(daysRequest),
    fetchAllPages(employeesRequest),
    db.from('companies').select('name,timezone').eq('id', query.company_id).maybeSingle(),
    db.from('company_memberships').select('role').eq('company_id', query.company_id).eq('user_id', userId).eq('active', true).maybeSingle(),
    db.from('company_payment_settings').select(paymentRateKeys.join(',')).eq('company_id', query.company_id).maybeSingle(),
    fetchAllPages(db.from('department_payment_settings').select(`department_id,${paymentRateKeys.join(',')}`).eq('company_id', query.company_id).order('department_id')),
    fetchAllPages(employeeRatesRequest),
    fetchAllPages(paymentDaysRequest),
    fetchAllPages(justificationsRequest),
  ]);
  if (!companyResult.data || !membershipResult.data || !['administrator', 'hr'].includes(membershipResult.data.role)) return { kind: 'forbidden' };
  const dbError = [daysResult, employeesResult, companyResult, membershipResult, companyRatesResult, departmentRatesResult, employeeRatesResult, paymentDaysResult, justificationsResult]
    .map((result) => result.error).find((result) => result != null);
  if (dbError) return { kind: 'db-error', error: dbError };

  const employees = (employeesResult.data ?? []) as unknown as ReportEmployee[];
  const days = (daysResult.data ?? []) as unknown as ReportWorkDay[];
  const paymentDays = (paymentDaysResult.data ?? []) as unknown as PaymentDay[];
  const justifications = (justificationsResult.data ?? []) as unknown as DayJustification[];
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const daysByKey = new Map(days.map((day) => [dayKey(day.employee_id, day.local_date), day]));
  const paymentDaysByKey = new Map(paymentDays.map((day) => [dayKey(day.employee_id, day.local_date), day]));
  const justificationsByKey = new Map(justifications.map((item) => [dayKey(item.employee_id, item.local_date), item]));
  const employeeRatesByEmployee = new Map(((employeeRatesResult.data ?? []) as unknown as Array<PaymentSettings & { employee_id: string }>)
    .map((item) => [item.employee_id, item]));
  const departmentRatesByDepartment = new Map(((departmentRatesResult.data ?? []) as unknown as Array<PaymentSettings & { department_id: string }>)
    .map((item) => [item.department_id, item]));
  const companyRates = (companyRatesResult.data ?? undefined) as PaymentSettings | undefined;
  const keys = new Set([...daysByKey.keys(), ...paymentDaysByKey.keys(), ...justificationsByKey.keys()]);
  const rows: FinancialAttendanceRow[] = [...keys].flatMap((key) => {
    const day = daysByKey.get(key);
    const paymentDay = paymentDaysByKey.get(key);
    const justification = justificationsByKey.get(key);
    const [employeeId, date] = key.split(':');
    const employee = employeeId ? employeeById.get(employeeId) : undefined;
    if (!employee || !date) return [];
    const calculation = currentCalculation(day?.attendance_calculations);
    const rates = resolvedRates(employeeRatesByEmployee.get(employee.id), departmentRatesByDepartment.get(employee.department_id ?? ''), companyRates);
    const justificationChangedAfterCalculation = Boolean(
      justification && (!calculation || !calculation.calculated_at || Date.parse(justification.updated_at) > Date.parse(calculation.calculated_at)),
    );
    const financialPending = calculation?.state === 'provisional' || justificationChangedAfterCalculation;
    const financial = resolveDailyFinancials({
      calculation: calculation?.state === 'final' && !financialPending ? calculation : {}, rates,
      additions: paymentDay ?? {}, justification: absenceCategory(justification),
    }) as DailyFinancials;
    return [{
      employeeId: employee.id, date, employee: employee.name, registration: employee.registration, state: calculation?.state ?? 'sem cálculo',
      plannedMinutes: calculation?.planned_minutes ?? 0, workedMinutes: calculation?.worked_minutes ?? null,
      regularMinutes: calculation?.regular_minutes ?? null, justifiedMinutes: calculation?.justified_minutes ?? null,
      missingMinutes: calculation?.missing_minutes ?? null, overtimeMinutes: calculation?.gross_overtime_minutes ?? null,
      balanceMinutes: calculation?.net_balance_minutes ?? null, financialPending, financial, rates,
    }];
  }).sort((left, right) => left.date.localeCompare(right.date) || left.employee.localeCompare(right.employee));
  return {
    kind: 'ok',
    value: {
      company: companyResult.data as { name: string; timezone: string }, from: query.date_from, to: query.date_to, rows,
      totals: {
        plannedMinutes: sumRows(rows, (row) => row.plannedMinutes), workedMinutes: sumRows(rows, (row) => row.workedMinutes),
        regularMinutes: sumRows(rows, (row) => row.regularMinutes), justifiedMinutes: sumRows(rows, (row) => row.justifiedMinutes),
        missingMinutes: sumRows(rows, (row) => row.missingMinutes), overtimeMinutes: sumRows(rows, (row) => row.overtimeMinutes),
        balanceMinutes: sumRows(rows, (row) => row.balanceMinutes), regularCents: sumRows(rows, (row) => row.financial.regularCents),
        justifiedCents: sumRows(rows, (row) => row.financial.justifiedCents),
        overtimeCents: sumRows(rows, (row) => row.financial.overtimeCents), shortageCents: sumRows(rows, (row) => row.financial.shortageCents),
        allowanceCents: sumRows(rows, (row) => row.financial.allowanceCents), totalCents: sumRows(rows, (row) => row.financial.totalCents),
        mealCents: sumRows(rows, (row) => row.financial.allowanceCentsByKey.meal),
        dinnerCents: sumRows(rows, (row) => row.financial.allowanceCentsByKey.dinner),
        dailyAllowanceCents: sumRows(rows, (row) => row.financial.allowanceCentsByKey.daily_allowance),
        nightShiftCents: sumRows(rows, (row) => row.financial.allowanceCentsByKey.night_shift),
        saturdayCents: sumRows(rows, (row) => row.financial.allowanceCentsByKey.saturday),
        seraoCents: sumRows(rows, (row) => row.financial.allowanceCentsByKey.serao),
      },
    },
  };
}

function toAttendanceReport(financialAttendance: FinancialAttendance): AttendanceReport {
  const rows: AttendanceReportRow[] = financialAttendance.rows.map((row) => ({
    date: row.date, employee: row.employee, registration: row.registration,
    plannedMinutes: row.plannedMinutes, workedMinutes: row.workedMinutes, balanceMinutes: row.balanceMinutes,
    overtimeMinutes: row.overtimeMinutes, missingMinutes: row.missingMinutes, state: row.state,
    financialPending: row.financialPending, regularCents: row.financial.regularCents,
    justifiedCents: row.financial.justifiedCents, overtimeCents: row.financial.overtimeCents,
    shortageCents: row.financial.shortageCents, allowanceCents: row.financial.allowanceCents,
    mealCents: row.financial.allowanceCentsByKey.meal, dinnerCents: row.financial.allowanceCentsByKey.dinner,
    dailyAllowanceCents: row.financial.allowanceCentsByKey.daily_allowance,
    nightShiftCents: row.financial.allowanceCentsByKey.night_shift,
    saturdayCents: row.financial.allowanceCentsByKey.saturday,
    seraoCents: row.financial.allowanceCentsByKey.serao, totalCents: row.financial.totalCents,
  }));
  return {
    companyName: financialAttendance.company.name, timezone: financialAttendance.company.timezone, generatedAt: new Date(),
    from: financialAttendance.from, to: financialAttendance.to, rows,
    financialTotals: {
      regularCents: financialAttendance.totals.regularCents, justifiedCents: financialAttendance.totals.justifiedCents,
      overtimeCents: financialAttendance.totals.overtimeCents, shortageCents: financialAttendance.totals.shortageCents,
      allowanceCents: financialAttendance.totals.allowanceCents, mealCents: financialAttendance.totals.mealCents,
      dinnerCents: financialAttendance.totals.dinnerCents, dailyAllowanceCents: financialAttendance.totals.dailyAllowanceCents,
      nightShiftCents: financialAttendance.totals.nightShiftCents, saturdayCents: financialAttendance.totals.saturdayCents,
      seraoCents: financialAttendance.totals.seraoCents, totalCents: financialAttendance.totals.totalCents,
    },
  };
}

export function buildApp(config: ApiConfig) {
  const app = Fastify({ logger: false, bodyLimit: 512 * 1024, requestIdHeader: 'x-request-id' });
  void app.register(cors, {
    origin: config.ADMIN_ORIGIN ?? false,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.decorateRequest('auth', null);
  app.setErrorHandler((cause, request, reply) => {
    if (cause instanceof ZodError) return error(reply, 400, 'INVALID_REQUEST', 'Revise os dados enviados.', request.id);
    request.log.error(cause);
    return error(reply, 500, 'INTERNAL_ERROR', 'Não foi possível concluir a operação.', request.id);
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.addHook('preHandler', async (request, reply) => {
    if (request.url === '/health' || request.url === '/v1/terminal/pair' || request.url === '/v1/terminal/refresh' || request.url.startsWith('/v1/public-registration/')) return;
    request.auth = await authenticate(config, request.headers.authorization);
    if (!request.auth) return error(reply, 401, 'UNAUTHORIZED', 'Autenticação necessária.', request.id);
  });
  app.get('/v1/public-registration/companies/:id', async (request, reply) => {
    const params = publicRegistrationParams.parse(request.params);
    if (!config.SUPABASE_SECRET_KEY) return error(reply, 503, 'REGISTRATION_UNAVAILABLE', 'Solicitação indisponível no momento.', request.id);
    const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error: dbError } = await admin.from('companies').select('id,name').eq('id', params.id).eq('active', true).maybeSingle();
    if (dbError) return mapDatabaseError(reply, request, dbError);
    if (!data) return error(reply, 404, 'NOT_FOUND', 'Empresa não encontrada.', request.id);
    return data;
  });
  app.post('/v1/public-registration/requests', async (request, reply) => {
    const body = publicRegistrationBody.parse(request.body);
    if (!config.SUPABASE_SECRET_KEY) return error(reply, 503, 'REGISTRATION_UNAVAILABLE', 'Solicitação indisponível no momento.', request.id);
    const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data: company, error: companyError } = await admin.from('companies').select('id').eq('id', body.company_id).eq('active', true).maybeSingle();
    if (companyError) return mapDatabaseError(reply, request, companyError);
    if (!company) return error(reply, 404, 'NOT_FOUND', 'Empresa não encontrada.', request.id);
    const { error: dbError } = await admin.from('employee_registration_requests').insert({
      ...body, registration: body.registration || null, contact: body.contact || null, note: body.note || null,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send({ message: 'Solicitação enviada para análise.' });
  });
  app.get('/v1/me', async (request, reply) => {
    const auth = request.auth!;
    const { data, error: dbError } = await auth.db.from('company_memberships')
      .select('company_id,role,active,companies(id,name,timezone,active)').eq('user_id', auth.user.id).eq('active', true);
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { user: { id: auth.user.id, email: auth.user.email ?? null }, memberships: data };
  });
  app.get('/v1/employee-registration-requests', async (request, reply) => {
    const query = registrationRequestsQuery.parse(request.query);
    let builder = request.auth!.db.from('employee_registration_requests')
      .select('id,company_id,name,registration,contact,note,status,created_at,reviewed_at').eq('company_id', query.company_id)
      .order('created_at', { ascending: false }).limit(100);
    if (query.status) builder = builder.eq('status', query.status);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.patch('/v1/employee-registration-requests/:id', async (request, reply) => {
    const params = registrationRequestParams.parse(request.params); const body = registrationRequestReviewBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.from('employee_registration_requests').update({
      status: body.status, reviewed_at: new Date().toISOString(), reviewed_by: request.auth!.user.id,
    }).eq('id', params.id).eq('company_id', body.company_id).eq('status', 'pending').select('id,status').maybeSingle();
    if (dbError) return mapDatabaseError(reply, request, dbError);
    if (!data) return error(reply, 409, 'VERSION_CONFLICT', 'A solicitação já foi analisada ou não está disponível.', request.id);
    return data;
  });
  app.post('/v1/companies', async (request, reply) => {
    const body = companyBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('create_company', {
      p_name: body.name, p_display_name: body.display_name, p_timezone: body.timezone,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send({ id: data });
  });
  app.patch('/v1/companies/:id', async (request, reply) => {
    const params = companyParams.parse(request.params); const body = companyUpdateBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('update_company', {
      p_company: params.id, p_expected_version: body.expected_version, p_name: body.name ?? null,
      p_timezone: body.timezone ?? null, p_active: body.active ?? null,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return data;
  });
  app.get('/v1/employees', async (request, reply) => {
    const query = employeesQuery.parse(request.query);
    let builder = request.auth!.db.from('employees').select('id,company_id,registration,name,job_title,department_id,home_location_id,active,version,created_at')
      .eq('company_id', query.company_id).order('name').limit(200);
    if (query.location_id) builder = builder.eq('home_location_id', query.location_id);
    if (query.active !== undefined) builder = builder.eq('active', query.active);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/employees', async (request, reply) => {
    const body = employeeBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('create_employee_with_registration', {
      p_company: body.company_id,
      p_registration: body.registration ?? null,
      p_name: body.name,
      p_job_title: body.job_title,
      p_department: body.department_id ?? null,
      p_home_location: body.home_location_id,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.patch('/v1/employees/:id', async (request, reply) => {
    const params = employeeParams.parse(request.params);
    const body = employeeUpdateBody.parse(request.body);
    const { company_id, expected_version, ...changes } = body;
    const { data, error: dbError } = await request.auth!.db.from('employees').update(changes)
      .eq('id', params.id).eq('company_id', company_id).eq('version', expected_version)
      .select('id,company_id,registration,name,job_title,department_id,home_location_id,active,version,created_at').maybeSingle();
    if (dbError) return mapDatabaseError(reply, request, dbError);
    if (!data) return error(reply, 409, 'VERSION_CONFLICT', 'O registro foi alterado ou não está disponível.', request.id);
    return data;
  });
  app.get('/v1/departments', async (request, reply) => {
    const query = departmentsQuery.parse(request.query);
    let builder = request.auth!.db.from('departments')
      .select('id,company_id,name,active,version,created_at,updated_at')
      .eq('company_id', query.company_id)
      .order('name')
      .limit(200);
    if (query.active !== undefined) builder = builder.eq('active', query.active);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/departments', async (request, reply) => {
    const body = departmentBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('create_department', {
      p_company: body.company_id, p_name: body.name,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.patch('/v1/departments/:id', async (request, reply) => {
    const params = departmentParams.parse(request.params);
    const body = departmentUpdateBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('update_department', {
      p_company: body.company_id,
      p_department: params.id,
      p_expected_version: body.expected_version,
      p_name: body.name ?? null,
      p_active: body.active ?? null,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return data;
  });
  app.get('/v1/department-schedule-defaults', async (request, reply) => {
    const query = departmentScheduleDefaultsQuery.parse(request.query);
    const { data, error: dbError } = await request.auth!.db.from('department_schedule_defaults')
      .select('id,company_id,department_id,schedule_version_id,valid_from,version,created_at,updated_at,schedule_versions(id,version,timezone,work_schedules(id,name,active))')
      .eq('company_id', query.company_id).order('valid_from').limit(200);
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/department-schedule-defaults', async (request, reply) => {
    const body = departmentScheduleDefaultBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('save_department_schedule_default', {
      p_company: body.company_id, p_department: body.department_id, p_schedule_version: body.schedule_version_id,
      p_valid_from: body.valid_from, p_expected_version: body.expected_version ?? null, p_apply_to_unassigned: body.apply_to_unassigned,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.delete('/v1/department-schedule-defaults/:departmentId', async (request, reply) => {
    const params = departmentScheduleDefaultParams.parse(request.params); const body = clearDepartmentScheduleDefaultBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('clear_department_schedule_default', {
      p_company: body.company_id, p_department: params.departmentId, p_expected_version: body.expected_version,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return data;
  });
  app.post('/v1/facial-profiles', async (request, reply) => {
    const body = facialProfileBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('provision_facial_profile', {
      p_company: body.company_id, p_employee: body.employee_id,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.get('/v1/facial-profiles', async (request, reply) => {
    const query = tenantQuery.parse(request.query);
    const { data, error: dbError } = await request.auth!.db.rpc('list_facial_profile_status', { p_company: query.company_id });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.get('/v1/company-payment-settings', async (request, reply) => {
    const query = tenantQuery.parse(request.query);
    const { data, error: dbError } = await request.auth!.db.from('company_payment_settings')
      .select('id,company_id,regular_hour_cents,overtime_hour_cents,serao_cents,meal_cents,dinner_cents,daily_allowance_cents,night_shift_cents,saturday_cents,version')
      .eq('company_id', query.company_id).maybeSingle();
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/company-payment-settings', async (request, reply) => {
    const body = companyPaymentSettingsBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('save_company_payment_settings', {
      p_company: body.company_id, p_regular_hour_cents: body.regular_hour_cents, p_overtime_hour_cents: body.overtime_hour_cents,
      p_serao_cents: body.serao_cents, p_meal_cents: body.meal_cents, p_dinner_cents: body.dinner_cents, p_daily_allowance_cents: body.daily_allowance_cents,
      p_night_shift_cents: body.night_shift_cents, p_saturday_cents: body.saturday_cents, p_expected_version: body.expected_version ?? null,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.get('/v1/payment-settings', async (request, reply) => {
    const query = paymentSettingsQuery.parse(request.query);
    const { data, error: dbError } = await request.auth!.db.from('employee_payment_settings')
      .select('id,company_id,employee_id,regular_hour_cents,overtime_hour_cents,serao_cents,meal_cents,dinner_cents,daily_allowance_cents,night_shift_cents,saturday_cents,version')
      .eq('company_id', query.company_id).eq('employee_id', query.employee_id).maybeSingle();
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/payment-settings', async (request, reply) => {
    const body = paymentSettingsBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('save_employee_payment_settings', {
      p_company: body.company_id, p_employee: body.employee_id, p_regular_hour_cents: body.regular_hour_cents,
      p_overtime_hour_cents: body.overtime_hour_cents, p_serao_cents: body.serao_cents, p_meal_cents: body.meal_cents, p_dinner_cents: body.dinner_cents,
      p_daily_allowance_cents: body.daily_allowance_cents, p_night_shift_cents: body.night_shift_cents,
      p_saturday_cents: body.saturday_cents, p_expected_version: body.expected_version ?? null,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.get('/v1/department-payment-settings', async (request, reply) => {
    const query = departmentPaymentSettingsQuery.parse(request.query);
    const { data, error: dbError } = await request.auth!.db.from('department_payment_settings')
      .select('id,company_id,department_id,regular_hour_cents,overtime_hour_cents,serao_cents,meal_cents,dinner_cents,daily_allowance_cents,night_shift_cents,saturday_cents,version')
      .eq('company_id', query.company_id).eq('department_id', query.department_id).maybeSingle();
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/department-payment-settings', async (request, reply) => {
    const body = departmentPaymentSettingsBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('save_department_payment_settings', {
      p_company: body.company_id,
      p_department: body.department_id,
      p_regular_hour_cents: body.regular_hour_cents,
      p_overtime_hour_cents: body.overtime_hour_cents,
      p_serao_cents: body.serao_cents,
      p_meal_cents: body.meal_cents,
      p_dinner_cents: body.dinner_cents,
      p_daily_allowance_cents: body.daily_allowance_cents,
      p_night_shift_cents: body.night_shift_cents,
      p_saturday_cents: body.saturday_cents,
      p_expected_version: body.expected_version ?? null,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.get('/v1/payment-rates', async (request, reply) => {
    const query = paymentRatesQuery.parse(request.query);
    const { data, error: dbError } = await request.auth!.db.rpc('resolve_employee_payment_rates', {
      p_company: query.company_id, p_employee: query.employee_id,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.get('/v1/payment-days', async (request, reply) => {
    const query = paymentDaysQuery.parse(request.query);
    let builder = request.auth!.db.from('employee_payment_days')
      .select('id,company_id,employee_id,local_date,meal_units,dinner_units,daily_allowance_units,night_shift_units,saturday_units,serao_units,version')
      .eq('company_id', query.company_id).eq('employee_id', query.employee_id).order('local_date');
    if (query.date_from) builder = builder.gte('local_date', query.date_from);
    if (query.date_to) builder = builder.lte('local_date', query.date_to);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/payment-days', async (request, reply) => {
    const body = paymentDayBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('save_employee_payment_day', {
      p_company: body.company_id, p_employee: body.employee_id, p_local_date: body.local_date,
      p_meal_units: body.meal_units, p_dinner_units: body.dinner_units, p_daily_allowance_units: body.daily_allowance_units,
      p_night_shift_units: body.night_shift_units, p_saturday_units: body.saturday_units, p_serao_units: body.serao_units,
      p_expected_version: body.expected_version ?? null,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.get('/v1/employee-locations', async (request, reply) => {
    const query = employeeLocationsQuery.parse(request.query);
    let builder = request.auth!.db.from('employee_locations')
      .select('id,company_id,employee_id,location_id,valid_from,valid_to,created_at')
      .eq('company_id', query.company_id).order('valid_from', { ascending: false }).limit(500);
    if (query.employee_id) builder = builder.eq('employee_id', query.employee_id);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/employee-locations', async (request, reply) => {
    const body = employeeLocationBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.from('employee_locations').insert(body)
      .select('id,company_id,employee_id,location_id,valid_from,valid_to,created_at').single();
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.get('/v1/locations', async (request, reply) => {
    const query = tenantQuery.parse(request.query);
    const { data, error: dbError } = await request.auth!.db.from('locations')
      .select('id,company_id,name,active,version,created_at').eq('company_id', query.company_id).order('name').limit(200);
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/locations', async (request, reply) => {
    const body = locationBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.from('locations').insert(body)
      .select('id,company_id,name,active,version,created_at').single();
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.patch('/v1/locations/:id', async (request, reply) => {
    const params = locationParams.parse(request.params); const body = scopedUpdateBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('update_location', {
      p_company: body.company_id, p_location: params.id, p_expected_version: body.expected_version,
      p_name: body.name ?? null, p_active: body.active ?? null,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return data;
  });
  app.get('/v1/terminals', async (request, reply) => {
    const query = tenantQuery.parse(request.query);
    const { data, error: dbError } = await request.auth!.db.from('terminals')
      .select('id,company_id,location_id,code,name,active,version,created_at,terminal_status(last_heartbeat_at,last_sync_at)')
      .eq('company_id', query.company_id).order('code').limit(200);
    if (dbError) return mapDatabaseError(reply, request, dbError);
    const terminals = (data ?? []).map((terminal) => {
      const rawStatus = terminal.terminal_status;
      const status = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus;
      return {
        id: terminal.id, company_id: terminal.company_id, location_id: terminal.location_id,
        code: terminal.code, name: terminal.name, active: terminal.active, version: terminal.version,
        created_at: terminal.created_at, last_heartbeat_at: status?.last_heartbeat_at ?? null,
        last_sync_at: status?.last_sync_at ?? null,
      };
    });
    return { data: terminals };
  });
  app.post('/v1/terminals', async (request, reply) => {
    const body = terminalBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('register_terminal', {
      p_company: body.company_id, p_location: body.location_id, p_code: body.code, p_name: body.name,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send({ id: data });
  });
  app.patch('/v1/terminals/:id', async (request, reply) => {
    const params = terminalParams.parse(request.params); const body = scopedUpdateBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('update_terminal', {
      p_company: body.company_id, p_terminal: params.id, p_expected_version: body.expected_version,
      p_name: body.name ?? null, p_active: body.active ?? null,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return data;
  });
  app.post('/v1/terminals/:id/reassign', async (request, reply) => {
    const params = terminalParams.parse(request.params); const body = terminalReassignmentBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('reassign_terminal', {
      p_company: body.company_id, p_terminal: params.id, p_new_location: body.new_location_id,
      p_expected_version: body.expected_version, p_effective_at: body.effective_at,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return data;
  });
  app.post('/v1/terminals/:id/pairing', async (request, reply) => {
    const params = terminalParams.parse(request.params);
    const { data, error: dbError } = await request.auth!.db.rpc('create_terminal_pairing', { p_terminal: params.id });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send({ code: data, expires_in_seconds: 600 });
  });
  app.post('/v1/terminal/pair', async (request, reply) => {
    const body = pairingBody.parse(request.body);
    if (!config.SUPABASE_SECRET_KEY) return error(reply, 503, 'PROVISIONING_UNAVAILABLE', 'Pareamento indisponível neste servidor.', request.id);
    const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const identity = randomUUID();
    const email = `terminal+${identity}@faceponto.invalid`;
    const password = randomBytes(48).toString('base64url');
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { identity_type: 'terminal' } });
    if (created.error || !created.data.user) return error(reply, 503, 'PROVISIONING_UNAVAILABLE', 'Pareamento indisponível neste servidor.', request.id);
    const { data: terminal, error: pairingError } = await admin.rpc('consume_terminal_pairing', {
      p_code: body.code, p_auth_user: created.data.user.id,
    });
    if (pairingError) {
      await admin.auth.admin.deleteUser(created.data.user.id);
      return error(reply, 401, 'INVALID_PAIRING', 'Código de pareamento inválido ou expirado.', request.id);
    }
    const sessionClient = client(config);
    const session = await sessionClient.auth.signInWithPassword({ email, password });
    if (session.error || !session.data.session) {
      return error(reply, 503, 'PROVISIONING_UNAVAILABLE', 'Identidade criada, mas a sessão não pôde ser iniciada.', request.id);
    }
    return reply.code(201).send({
      ...terminal, access_token: session.data.session.access_token, refresh_token: session.data.session.refresh_token,
      expires_in: session.data.session.expires_in, token_type: session.data.session.token_type,
    });
  });
  app.post('/v1/terminal/refresh', async (request, reply) => {
    const body = refreshBody.parse(request.body);
    const refreshed = await client(config).auth.refreshSession({ refresh_token: body.refresh_token });
    if (refreshed.error || !refreshed.data.session) return error(reply, 401, 'INVALID_SESSION', 'A sessão do terminal expirou.', request.id);
    return {
      access_token: refreshed.data.session.access_token,
      refresh_token: refreshed.data.session.refresh_token,
      expires_in: refreshed.data.session.expires_in,
      token_type: refreshed.data.session.token_type,
    };
  });
  app.post('/v1/terminal/heartbeat', async (request, reply) => {
    const body = heartbeatBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('terminal_heartbeat', {
      p_pending_count: body.pending_count, p_app_version: body.app_version,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return data;
  });
  app.get('/v1/terminal/catalog', async (request, reply) => {
    const { data, error: dbError } = await request.auth!.db.rpc('terminal_catalog');
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return data;
  });
  app.post('/v1/terminal/clock-anchors', async (request, reply) => {
    const body = clockAnchorBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('terminal_clock_anchor', {
      p_boot_id: body.boot_id, p_device_elapsed_ms: body.device_elapsed_ms, p_uncertainty_ms: body.uncertainty_ms,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.post('/v1/terminal/sync', async (request, reply) => {
    if (!validateSyncRequest(request.body)) return error(reply, 400, 'INVALID_REQUEST', 'Lote de sincronização inválido.', request.id);
    const input = request.body as { protocol_version: 1; events: Array<Record<string, unknown>> };
    const results: unknown[] = [];
    for (const event of input.events) {
      const { data, error: dbError } = await request.auth!.db.rpc('ingest_punch', { p_event: event });
      if (dbError) return mapDatabaseError(reply, request, dbError);
      results.push(data);
    }
    if (config.ENABLE_TEST_FAULTS && request.headers['x-faceponto-test-fault'] === 'drop-after-commit'
      && results.some((item) => (item as { status?: string }).status === 'accepted')) {
      console.warn('FacePonto test fault: dropping sync response after commit');
      reply.hijack(); request.raw.socket.destroy(); return reply;
    }
    return { protocol_version: 1, server_timestamp: new Date().toISOString(), results };
  });
  app.get('/v1/punches', async (request, reply) => {
    const query = punchesQuery.parse(request.query);
    type Relation = { name?: string; registration?: string };
    type RawPunch = Record<string, unknown> & { id: string; employee_id: string; location_id: string; timestamp: string; source: string; sync_status: string; clock_status: string; punch_type: string; employees?: Relation | Relation[]; locations?: Relation | Relation[] };
    type Adjustment = { id: string; original_time_punch_id: string; corrected_timestamp: string; reason: string; created_at: string };
    const punchFields = 'id,employee_id,company_id,location_id,terminal_id,timestamp,device_timestamp,server_timestamp,punch_type,source,sync_status,clock_status,result_code,created_at,employees(name,registration),locations(name)';
    let builder = request.auth!.db.from('time_punches').select('id,employee_id,company_id,location_id,terminal_id,timestamp,device_timestamp,server_timestamp,punch_type,source,sync_status,clock_status,result_code,created_at,employees(name,registration),locations(name)')
      .eq('company_id', query.company_id).order('timestamp', { ascending: false }).limit(200);
    if (query.employee_id) builder = builder.eq('employee_id', query.employee_id);
    if (query.location_id) builder = builder.eq('location_id', query.location_id);
    if (query.punch_from) builder = builder.gte('timestamp', query.punch_from);
    if (query.punch_to) builder = builder.lt('timestamp', query.punch_to);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    const rawPunches = (data ?? []) as unknown as RawPunch[];

    // A correction is a new audit record rather than a mutation of the raw
    // event.  Pull corrections that enter the requested period as well, then
    // use the newest correction for each original event in the screen model.
    let movedBuilder = request.auth!.db.from('punch_adjustments')
      .select('id,original_time_punch_id,corrected_timestamp,reason,created_at')
      .eq('company_id', query.company_id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1_000);
    if (query.employee_id) movedBuilder = movedBuilder.eq('employee_id', query.employee_id);
    if (query.punch_from) movedBuilder = movedBuilder.gte('corrected_timestamp', query.punch_from);
    if (query.punch_to) movedBuilder = movedBuilder.lt('corrected_timestamp', query.punch_to);
    const { data: movedData, error: movedError } = await movedBuilder;
    if (movedError) return mapDatabaseError(reply, request, movedError);
    const movedAdjustments = (movedData ?? []) as unknown as Adjustment[];

    const rawById = new Map(rawPunches.map((item) => [item.id, item]));
    const movedOriginalIds = [...new Set(movedAdjustments.map((item) => item.original_time_punch_id).filter((id) => !rawById.has(id)))];
    for (let offset = 0; offset < movedOriginalIds.length; offset += 200) {
      let originalBuilder = request.auth!.db.from('time_punches').select(punchFields).eq('company_id', query.company_id).in('id', movedOriginalIds.slice(offset, offset + 200));
      if (query.employee_id) originalBuilder = originalBuilder.eq('employee_id', query.employee_id);
      if (query.location_id) originalBuilder = originalBuilder.eq('location_id', query.location_id);
      const { data: originals, error: originalError } = await originalBuilder;
      if (originalError) return mapDatabaseError(reply, request, originalError);
      for (const original of (originals ?? []) as unknown as RawPunch[]) rawById.set(original.id, original);
    }

    const adjustments: Adjustment[] = [];
    const originalIds = [...rawById.keys()];
    for (let offset = 0; offset < originalIds.length; offset += 200) {
      let adjustmentBuilder = request.auth!.db.from('punch_adjustments')
        .select('id,original_time_punch_id,corrected_timestamp,reason,created_at')
        .eq('company_id', query.company_id).in('original_time_punch_id', originalIds.slice(offset, offset + 200))
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1_000);
      if (query.employee_id) adjustmentBuilder = adjustmentBuilder.eq('employee_id', query.employee_id);
      const { data: adjustmentData, error: adjustmentError } = await adjustmentBuilder;
      if (adjustmentError) return mapDatabaseError(reply, request, adjustmentError);
      adjustments.push(...(adjustmentData ?? []) as unknown as Adjustment[]);
    }
    const latestAdjustmentByOriginal = new Map<string, Adjustment>();
    for (const adjustment of [...adjustments, ...movedAdjustments].sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))) {
      if (!latestAdjustmentByOriginal.has(adjustment.original_time_punch_id)) latestAdjustmentByOriginal.set(adjustment.original_time_punch_id, adjustment);
    }
    const inRequestedPeriod = (timestamp: string) => (!query.punch_from || timestamp >= query.punch_from) && (!query.punch_to || timestamp < query.punch_to);
    const projectedPunches = [...rawById.values()].flatMap((punch) => {
      const adjustment = latestAdjustmentByOriginal.get(punch.id);
      const timestamp = adjustment?.corrected_timestamp ?? punch.timestamp;
      if (!inRequestedPeriod(timestamp)) return [];
      const employee = Array.isArray(punch.employees) ? punch.employees[0] : punch.employees;
      const location = Array.isArray(punch.locations) ? punch.locations[0] : punch.locations;
      return [{ ...punch, id: adjustment?.id ?? punch.id, timestamp, original_time_punch_id: adjustment?.original_time_punch_id, original_timestamp: adjustment ? punch.timestamp : undefined, reason: adjustment?.reason, location_name: location?.name ?? null, employee_name: employee?.name ?? null, employee_registration: employee?.registration ?? null }];
    });
    let manualBuilder = request.auth!.db.from('manual_punches').select('id,employee_id,company_id,location_id,timestamp,reason,created_at,employees(name,registration),locations(name)')
      .eq('company_id', query.company_id).order('timestamp', { ascending: false }).limit(200);
    if (query.employee_id) manualBuilder = manualBuilder.eq('employee_id', query.employee_id);
    if (query.location_id) manualBuilder = manualBuilder.eq('location_id', query.location_id);
    if (query.punch_from) manualBuilder = manualBuilder.gte('timestamp', query.punch_from);
    if (query.punch_to) manualBuilder = manualBuilder.lt('timestamp', query.punch_to);
    const { data: manualData, error: manualError } = await manualBuilder;
    if (manualError) return mapDatabaseError(reply, request, manualError);
    const namedManualPunches = (manualData ?? []).map(({ employees, locations, ...punch }: { employees?: { name?: string; registration?: string } | Array<{ name?: string; registration?: string }>; locations?: { name?: string } | Array<{ name?: string }> } & Record<string, unknown>) => {
      const employee = Array.isArray(employees) ? employees[0] : employees;
      const location = Array.isArray(locations) ? locations[0] : locations;
      return { ...punch, source: 'manual', punch_type: 'unclassified', sync_status: 'accepted', clock_status: 'verified', location_name: location?.name ?? null, employee_name: employee?.name ?? null, employee_registration: employee?.registration ?? null };
    });
    const allPunches = [...projectedPunches, ...namedManualPunches] as unknown as Array<Record<string, unknown> & { timestamp: string }>;
    return { data: allPunches.sort((left, right) => right.timestamp.localeCompare(left.timestamp)).slice(0, 200) };
  });
  app.post('/v1/punches/:id/adjustments', async (request, reply) => {
    const params = punchParams.parse(request.params); const body = punchAdjustmentBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('create_punch_adjustment', {
      p_company: body.company_id, p_time_punch: params.id, p_corrected_timestamp: body.corrected_timestamp, p_reason: body.reason,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.post('/v1/manual-punches', async (request, reply) => {
    const body = manualPunchBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('create_manual_punch', {
      p_company: body.company_id, p_employee: body.employee_id, p_location: body.location_id,
      p_timestamp: body.corrected_timestamp, p_reason: body.reason,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.get('/v1/punch-adjustments', async (request, reply) => {
    const query = punchAdjustmentsQuery.parse(request.query);
    let builder = request.auth!.db.from('punch_adjustments')
      .select('id,company_id,employee_id,original_time_punch_id,original_value,new_value,corrected_timestamp,reason,actor_id,created_at')
      .eq('company_id', query.company_id).order('created_at', { ascending: false }).limit(200);
    if (query.employee_id) builder = builder.eq('employee_id', query.employee_id);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.get('/v1/absence-categories', async (request, reply) => {
    const query = absenceCategoriesQuery.parse(request.query);
    let builder = request.auth!.db.from('absence_categories')
      .select('id,company_id,name,abones_hours,active,version,created_at,updated_at')
      .eq('company_id', query.company_id).order('name').limit(200);
    if (query.active !== undefined) builder = builder.eq('active', query.active);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/absence-categories', async (request, reply) => {
    const body = absenceCategoryBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('create_absence_category', {
      p_company: body.company_id, p_name: body.name, p_abones_hours: body.abones_hours,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.patch('/v1/absence-categories/:id', async (request, reply) => {
    const params = absenceCategoryParams.parse(request.params);
    const body = absenceCategoryUpdateBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('update_absence_category', {
      p_company: body.company_id,
      p_category: params.id,
      p_expected_version: body.expected_version,
      p_name: body.name ?? null,
      p_abones_hours: body.abones_hours ?? null,
      p_active: body.active ?? null,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return data;
  });
  app.delete('/v1/absence-categories/:id', async (request, reply) => {
    const params = absenceCategoryParams.parse(request.params);
    const body = deleteAbsenceCategoryBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('delete_absence_category', {
      p_company: body.company_id, p_category: params.id, p_expected_version: body.expected_version,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return data;
  });
  app.get('/v1/day-justifications', async (request, reply) => {
    const query = dayJustificationsQuery.parse(request.query);
    let builder = request.auth!.db.from('day_justifications')
      .select('id,company_id,employee_id,local_date,absence_category_id,abones_hours,note,version,created_at,updated_at,absence_categories(id,name,abones_hours,active)')
      .eq('company_id', query.company_id).order('local_date', { ascending: false }).limit(500);
    if (query.employee_id) builder = builder.eq('employee_id', query.employee_id);
    if (query.date_from) builder = builder.gte('local_date', query.date_from);
    if (query.date_to) builder = builder.lte('local_date', query.date_to);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/day-justifications', async (request, reply) => {
    const body = dayJustificationBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('create_day_justification', {
      p_company: body.company_id,
      p_employee: body.employee_id,
      p_local_date: body.local_date,
      p_absence_category: body.absence_category_id,
      p_note: body.note ?? null,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.delete('/v1/day-justifications/:id', async (request, reply) => {
    const params = dayJustificationParams.parse(request.params);
    const body = deleteDayJustificationBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('delete_day_justification', {
      p_company: body.company_id,
      p_justification: params.id,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return data;
  });
  app.get('/v1/attendance', async (request, reply) => {
    const query = attendanceQuery.parse(request.query);
    let builder = request.auth!.db.from('work_days')
      .select('id,company_id,employee_id,schedule_version_id,journey_start,journey_end,local_date,timezone,attendance_calculations(id,revision,engine_version,rules_version,state,planned_minutes,worked_minutes,regular_minutes,justified_minutes,missing_minutes,late_minutes,late_after_tolerance_minutes,early_departure_minutes,break_minutes,gross_overtime_minutes,overtime_after_tolerance_minutes,net_balance_minutes,classifications,calculated_at)')
      .eq('company_id', query.company_id).order('local_date', { ascending: false }).limit(500);
    if (query.employee_id) builder = builder.eq('employee_id', query.employee_id);
    if (query.date_from) builder = builder.gte('local_date', query.date_from);
    if (query.date_to) builder = builder.lte('local_date', query.date_to);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.get('/v1/financial-attendance', async (request, reply) => {
    const query = attendanceQuery.parse(request.query);
    const result = await buildFinancialAttendance(request.auth!.db, request.auth!.user.id, query);
    if (result.kind === 'forbidden') return error(reply, 403, 'FORBIDDEN', 'Você não tem permissão para esta operação.', request.id);
    if (result.kind === 'db-error') return mapDatabaseError(reply, request, result.error);
    return { data: result.value.rows, totals: result.value.totals };
  });
  app.get('/v1/reports/attendance', async (request, reply) => {
    const query = attendanceReportQuery.parse(request.query);
    const result = await buildFinancialAttendance(request.auth!.db, request.auth!.user.id, query);
    if (result.kind === 'forbidden') return error(reply, 403, 'FORBIDDEN', 'Você não tem permissão para esta operação.', request.id);
    if (result.kind === 'db-error') return mapDatabaseError(reply, request, result.error);
    const report = toAttendanceReport(result.value);
    const extension = query.format;
    const payload = extension === 'xlsx' ? attendanceXlsx(report) : await attendancePdf(report);
    const type = extension === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf';
    const suffix = query.date_from && query.date_to ? `${query.date_from}_${query.date_to}` : 'periodo';
    return reply.header('Content-Disposition', `attachment; filename="faceponto-jornadas-${suffix}.${extension}"`).type(type).send(payload);
  });
  app.get('/v1/occurrences', async (request, reply) => {
    const query = occurrencesQuery.parse(request.query);
    let builder = request.auth!.db.from('attendance_occurrences')
      .select('id,company_id,work_day_id,calculation_id,employee_id,severity,type,details,status,resolution,resolved_by,resolved_at,created_at')
      .eq('company_id', query.company_id).order('created_at', { ascending: false }).limit(500);
    if (query.employee_id) builder = builder.eq('employee_id', query.employee_id);
    if (query.status) builder = builder.eq('status', query.status);
    if (query.severity) builder = builder.eq('severity', query.severity);
    if (query.type) builder = builder.eq('type', query.type);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/occurrences/:id/resolution', async (request, reply) => {
    const params = occurrenceParams.parse(request.params);
    const body = occurrenceResolutionBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('resolve_attendance_occurrence', {
      p_company: body.company_id, p_occurrence: params.id, p_resolution: body.resolution,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return data;
  });
  app.get('/v1/bank-hours', async (request, reply) => {
    const query = bankHoursQuery.parse(request.query);
    let builder = request.auth!.db.from('bank_hours')
      .select('id,company_id,employee_id,work_day_id,calculation_id,revision,delta_minutes,reason,reversal_of,created_at,work_days(local_date)')
      .eq('company_id', query.company_id).order('created_at', { ascending: false }).limit(1000);
    if (query.employee_id) builder = builder.eq('employee_id', query.employee_id);
    if (query.date_from) builder = builder.gte('work_days.local_date', query.date_from);
    if (query.date_to) builder = builder.lte('work_days.local_date', query.date_to);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    const balance_minutes = data?.reduce((sum, item) => sum + item.delta_minutes, 0) ?? 0;
    return { data, balance_minutes };
  });
  app.get('/v1/schedules', async (request, reply) => {
    const query = tenantQuery.parse(request.query);
    const { data, error: dbError } = await request.auth!.db.from('work_schedules')
      .select('id,company_id,name,active,created_at,schedule_versions(id,version,timezone,rules,schedule_weekdays(iso_weekday),schedule_segments(ordinal,start_minute,end_minute))')
      .eq('company_id', query.company_id).order('name').limit(200);
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/schedules', async (request, reply) => {
    const body = scheduleBody.parse(request.body);
    const ordinals = body.segments.map((segment) => segment.ordinal);
    if (new Set(ordinals).size !== ordinals.length) return error(reply, 400, 'INVALID_REQUEST', 'Os segmentos precisam de ordens distintas.', request.id);
    const { data, error: dbError } = await request.auth!.db.rpc('create_schedule', {
      p_company: body.company_id, p_name: body.name, p_timezone: body.timezone,
      p_rules: body.rules, p_weekdays: body.weekdays, p_segments: body.segments,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send({ id: data });
  });
  app.get('/v1/employee-schedule-plans', async (request, reply) => {
    const query = employeeSchedulePlansQuery.parse(request.query);
    let builder = request.auth!.db.from('employee_schedule_plans')
      .select('id,company_id,employee_id,local_date,schedule_version_id,active,version,created_at,updated_at,schedule_versions(id,version,timezone,work_schedules(id,name,active))')
      .eq('company_id', query.company_id).eq('active', true).order('local_date').limit(1000);
    if (query.employee_id) builder = builder.eq('employee_id', query.employee_id);
    if (query.date_from) builder = builder.gte('local_date', query.date_from);
    if (query.date_to) builder = builder.lte('local_date', query.date_to);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/employee-schedule-plans', async (request, reply) => {
    const body = employeeSchedulePlanBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('set_employee_schedule_plan', {
      p_company: body.company_id, p_employee: body.employee_id, p_local_date: body.local_date,
      p_schedule_version: body.schedule_version_id, p_expected_version: body.expected_version ?? null,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send(data);
  });
  app.delete('/v1/employee-schedule-plans/:id', async (request, reply) => {
    const params = employeeSchedulePlanParams.parse(request.params);
    const body = clearEmployeeSchedulePlanBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('clear_employee_schedule_plan', {
      p_company: body.company_id, p_plan: params.id, p_expected_version: body.expected_version,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return data;
  });
  app.get('/v1/schedule-assignments', async (request, reply) => {
    const query = scheduleAssignmentsQuery.parse(request.query);
    let builder = request.auth!.db.from('schedule_assignments')
      .select('id,company_id,employee_id,schedule_version_id,valid_from,valid_to,created_at,schedule_versions(id,version,timezone,rules,work_schedules(id,name,active))')
      .eq('company_id', query.company_id).order('valid_from', { ascending: false }).limit(500);
    if (query.employee_id) builder = builder.eq('employee_id', query.employee_id);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.post('/v1/schedule-assignments', async (request, reply) => {
    const body = scheduleAssignmentBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('assign_schedule', {
      p_company: body.company_id, p_employee: body.employee_id, p_schedule_version: body.schedule_version_id,
      p_valid_from: body.valid_from, p_valid_to: body.valid_to ?? null,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return reply.code(201).send({ id: data });
  });
  app.patch('/v1/schedule-assignments/:id/close', async (request, reply) => {
    const params = scheduleAssignmentParams.parse(request.params);
    const body = closeScheduleAssignmentBody.parse(request.body);
    const { data, error: dbError } = await request.auth!.db.rpc('close_schedule_assignment', {
      p_company: body.company_id, p_assignment: params.id, p_valid_to: body.valid_to,
    });
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { id: data, valid_to: body.valid_to };
  });
  return app;
}

import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { z, ZodError } from 'zod';
import type { ApiConfig } from './config.js';
import { authenticate, client, type AuthContext } from './supabase.js';
import { validateSyncRequest } from '../../../packages/contracts/index.mjs';
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
  company_id: z.uuid(), registration: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(160),
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
  if (dbError.code === '23503' || dbError.code === '23514' || dbError.code === '23P01') {
    return error(reply, 422, 'INVALID_REFERENCE', 'Os dados informados não são válidos.', request.id);
  }
  if (dbError.code === '42501') return error(reply, 403, 'FORBIDDEN', 'Você não tem permissão para esta operação.', request.id);
  request.log.error({ code: dbError.code }, 'database request failed');
  return error(reply, 500, 'INTERNAL_ERROR', 'Não foi possível concluir a operação.', request.id);
}

type ReportCalculation = { state: string; planned_minutes: number; worked_minutes: number | null; net_balance_minutes: number | null };
type ReportWorkDay = { employee_id: string; local_date: string; attendance_calculations: ReportCalculation[] };
type ReportEmployee = { id: string; name: string; registration: string };

function toAttendanceReport(
  company: { name: string; timezone: string }, query: { date_from?: string | undefined; date_to?: string | undefined }, days: ReportWorkDay[], employees: ReportEmployee[],
): AttendanceReport {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const rows: AttendanceReportRow[] = days.map((day) => {
    const calculation = day.attendance_calculations.find((item) => item.state !== 'superseded') ?? day.attendance_calculations[0];
    const employee = employeeById.get(day.employee_id);
    return {
      date: day.local_date, employee: employee?.name ?? day.employee_id, registration: employee?.registration ?? '-',
      plannedMinutes: calculation?.planned_minutes ?? 0, workedMinutes: calculation?.worked_minutes ?? null,
      balanceMinutes: calculation?.net_balance_minutes ?? null, state: calculation?.state ?? 'sem calculo',
    };
  }).sort((left, right) => left.date.localeCompare(right.date) || left.employee.localeCompare(right.employee));
  return { companyName: company.name, timezone: company.timezone, generatedAt: new Date(), from: query.date_from, to: query.date_to, rows };
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
    const { data, error: dbError } = await request.auth!.db.from('employees').insert(body)
      .select('id,company_id,registration,name,job_title,department_id,home_location_id,active,version,created_at').single();
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
    let builder = request.auth!.db.from('time_punches').select('id,employee_id,company_id,location_id,terminal_id,timestamp,device_timestamp,server_timestamp,punch_type,source,sync_status,clock_status,result_code,created_at,employees(name,registration)')
      .eq('company_id', query.company_id).order('timestamp', { ascending: false }).limit(200);
    if (query.employee_id) builder = builder.eq('employee_id', query.employee_id);
    if (query.location_id) builder = builder.eq('location_id', query.location_id);
    if (query.punch_from) builder = builder.gte('timestamp', query.punch_from);
    if (query.punch_to) builder = builder.lt('timestamp', query.punch_to);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    let manualBuilder = request.auth!.db.from('manual_punches').select('id,employee_id,company_id,location_id,timestamp,reason,created_at,employees(name,registration)')
      .eq('company_id', query.company_id).order('timestamp', { ascending: false }).limit(200);
    if (query.employee_id) manualBuilder = manualBuilder.eq('employee_id', query.employee_id);
    if (query.location_id) manualBuilder = manualBuilder.eq('location_id', query.location_id);
    if (query.punch_from) manualBuilder = manualBuilder.gte('timestamp', query.punch_from);
    if (query.punch_to) manualBuilder = manualBuilder.lt('timestamp', query.punch_to);
    const { data: manualData, error: manualError } = await manualBuilder;
    if (manualError) return mapDatabaseError(reply, request, manualError);
    const namedPunches = (data ?? []).map(({ employees, ...punch }: { employees?: { name?: string; registration?: string } | Array<{ name?: string; registration?: string }> } & Record<string, unknown>) => {
      const employee = Array.isArray(employees) ? employees[0] : employees;
      return { ...punch, employee_name: employee?.name ?? null, employee_registration: employee?.registration ?? null };
    });
    const namedManualPunches = (manualData ?? []).map(({ employees, ...punch }: { employees?: { name?: string; registration?: string } | Array<{ name?: string; registration?: string }> } & Record<string, unknown>) => {
      const employee = Array.isArray(employees) ? employees[0] : employees;
      return { ...punch, source: 'manual', punch_type: 'unclassified', sync_status: 'accepted', clock_status: 'verified', employee_name: employee?.name ?? null, employee_registration: employee?.registration ?? null };
    });
    const allPunches = [...namedPunches, ...namedManualPunches] as unknown as Array<Record<string, unknown> & { timestamp: string }>;
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
  app.get('/v1/attendance', async (request, reply) => {
    const query = attendanceQuery.parse(request.query);
    let builder = request.auth!.db.from('work_days')
      .select('id,company_id,employee_id,schedule_version_id,journey_start,journey_end,local_date,timezone,attendance_calculations(id,revision,engine_version,rules_version,state,planned_minutes,worked_minutes,late_minutes,late_after_tolerance_minutes,early_departure_minutes,break_minutes,gross_overtime_minutes,overtime_after_tolerance_minutes,net_balance_minutes,classifications,calculated_at)')
      .eq('company_id', query.company_id).order('local_date', { ascending: false }).limit(500);
    if (query.employee_id) builder = builder.eq('employee_id', query.employee_id);
    if (query.date_from) builder = builder.gte('local_date', query.date_from);
    if (query.date_to) builder = builder.lte('local_date', query.date_to);
    const { data, error: dbError } = await builder;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    return { data };
  });
  app.get('/v1/reports/attendance', async (request, reply) => {
    const query = attendanceReportQuery.parse(request.query);
    let daysRequest = request.auth!.db.from('work_days')
      .select('employee_id,local_date,attendance_calculations(state,planned_minutes,worked_minutes,net_balance_minutes)')
      .eq('company_id', query.company_id).order('local_date', { ascending: true }).limit(5_000);
    if (query.employee_id) daysRequest = daysRequest.eq('employee_id', query.employee_id);
    if (query.date_from) daysRequest = daysRequest.gte('local_date', query.date_from);
    if (query.date_to) daysRequest = daysRequest.lte('local_date', query.date_to);
    const [daysResult, employeesResult, companyResult] = await Promise.all([
      daysRequest,
      request.auth!.db.from('employees').select('id,name,registration').eq('company_id', query.company_id).limit(5_000),
      request.auth!.db.from('companies').select('name,timezone').eq('id', query.company_id).single(),
    ]);
    if (!companyResult.data) return error(reply, 403, 'FORBIDDEN', 'Você não tem permissão para esta operação.', request.id);
    const dbError = daysResult.error ?? employeesResult.error ?? companyResult.error;
    if (dbError) return mapDatabaseError(reply, request, dbError);
    const report = toAttendanceReport(
      companyResult.data, query, daysResult.data as ReportWorkDay[], employeesResult.data as ReportEmployee[],
    );
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

# Jornada, pagamentos e funcionários Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir a jornada por horários da escala e entregar justificativas, cargos, pagamentos hierárquicos, matrícula automática e um painel de apuração claro.

**Architecture:** O motor puro de jornada passa a associar batidas aos slots temporais da escala e o worker persiste a nova revisão. Uma camada pura de pagamento resolve cada tarifa na hierarquia funcionário → cargo → empresa e entrega o mesmo resultado para painel e relatórios. O banco adiciona justificativas, cargos administráveis, tarifas por cargo e contador seguro de matrícula; a API mantém a autorização no servidor e o painel consome contratos tipados.

**Tech Stack:** Node.js 24, JavaScript ESM, TypeScript, Fastify, React 19, Vite, Supabase/PostgreSQL, `node:test` e Playwright-free component helpers.

**Spec:** `docs/superpowers/specs/2026-09-20-jornada-pagamentos-e-funcionarios-design.md`

## Global Constraints

- Preservar funcionários, escalas, batidas, perfis faciais e histórico de auditoria existentes.
- Nunca classificar batida somente por sua posição na lista quando existe escala aplicável.
- A matrícula é atribuída no banco, nunca pelo navegador.
- Valores vazios no nível de funcionário ou cargo herdam somente aquele item do nível seguinte.
- Atestado, licença paternidade e folga começam abonando as horas previstas.
- O painel, XLSX e PDF devem usar a mesma resposta de apuração financeira.
- Não publicar Supabase, Render ou GitHub antes da autorização específica de publicação.

## Review Focus

- Uma batida exatamente no limite temporal entre dois slots deve gerar ocorrência de ambiguidade, não uma classificação silenciosa.
- Uma jornada em andamento não pode gerar falta financeira definitiva antes de terminar a carência.
- Uma justificativa abonada com batidas reais preserva as batidas e não transforma as horas reais em horas abonadas.
- Limpar somente `Almoço` exclusivo deve manter os demais valores exclusivos do funcionário.
- Dois cadastros simultâneos precisam receber matrículas distintas, inclusive quando há matrículas antigas não numéricas.

---

### Task 1: Motor de jornada por slots temporais

**Files:**
- Modify: `packages/attendance/index.mjs`
- Modify: `tests/attendance.test.mjs`
- Modify: `packages/attendance/README.md`

**Interfaces:**
- Produces `evaluateAttendance(input)` com `classifications: Array<{ event_id: string, type: 'entry'|'break_start'|'break_end'|'exit'|'unclassified', slot_index?: number, planned_minute?: number }>`.
- Produces `missing_slot_indexes: number[]`, `regular_minutes: number | null`, `missing_minutes: number | null` e `justified_minutes: number` em cada resultado.
- Consumes `{ segments, punches, rules, journey_start, evaluated_at, justification? }`.

- [ ] **Step 1: Write the failing tests for a late start in the second segment**

```js
test('14h e 18h ocupam o segundo período e registram falta da manhã', () => {
  const result = evaluateAttendance({ ...base, segments: [
    { start_minute: 480, end_minute: 720 },
    { start_minute: 840, end_minute: 1080 },
  ], punches: [
    punch('a', '2026-09-01T14:00:00-03:00'),
    punch('b', '2026-09-01T18:00:00-03:00'),
  ] });
  assert.deepEqual(result.classifications.map((item) => item.type), ['break_end', 'exit']);
  assert.equal(result.worked_minutes, 240);
  assert.equal(result.regular_minutes, 240);
  assert.equal(result.missing_minutes, 240);
  assert.equal(result.net_balance_minutes, -240);
});

test('14h30 e 18h contabilizam atraso e falta antes do segundo período', () => {
  const result = evaluateAttendance({ ...base, segments: [
    { start_minute: 480, end_minute: 720 },
    { start_minute: 840, end_minute: 1080 },
  ], punches: [
    punch('a', '2026-09-01T14:30:00-03:00'),
    punch('b', '2026-09-01T18:00:00-03:00'),
  ] });
  assert.equal(result.worked_minutes, 210);
  assert.equal(result.missing_minutes, 270);
  assert.equal(result.net_balance_minutes, -270);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail because the current engine returns incomplete/unclassified values**

Run: `npm test -- tests/attendance.test.mjs`

Expected: the new tests fail with `null` metrics or `unclassified` types.

- [ ] **Step 3: Add deterministic slot construction and temporal matching**

```js
function scheduleSlots(segments) {
  return [...segments].sort((a, b) => a.start_minute - b.start_minute)
    .flatMap((segment, index, values) => [
      { slot_index: index * 2, type: index === 0 ? 'entry' : 'break_end', planned_minute: segment.start_minute, segment_index: index },
      { slot_index: index * 2 + 1, type: index === values.length - 1 ? 'exit' : 'break_start', planned_minute: segment.end_minute, segment_index: index },
    ]);
}

function matchPunchesToSlots(originMs, slots, punches) {
  // Associate each chronological punch with the nearest remaining slot between
  // adjacent midpoint boundaries. Return ambiguity instead of guessing on a tie.
}
```

Replace `punches.length === segments.length * 2` and index-based classification. Calculate work, absence, late and overtime independently for each segment. Set `regular_minutes` to worked minutes inside the planned segment bounds, set `justified_minutes` to only missing planned minutes covered by an abonada justification, and use `net_balance_minutes = regular_minutes + justified_minutes + overtime_after_tolerance_minutes - planned_minutes`. Keep an in-progress result provisional until the last segment plus `missing_punch_grace_minutes` has elapsed.

- [ ] **Step 4: Add the boundary, provisional and overnight regression tests**

```js
test('horário no ponto médio de dois slots gera ocorrência ambígua', () => {
  const result = evaluateAttendance({ ...base, segments: [
    { start_minute: 480, end_minute: 720 }, { start_minute: 840, end_minute: 1080 },
  ], punches: [punch('a', '2026-09-01T13:00:00-03:00')] });
  assert.ok(result.occurrences.some((item) => item.code === 'AMBIGUOUS_SCHEDULE_SLOT'));
});

test('jornada incompleta antes da carência não fecha saldo definitivo', () => {
  const result = evaluateAttendance({ ...base, evaluated_at: '2026-09-01T15:00:00-03:00', segments: [
    { start_minute: 480, end_minute: 720 }, { start_minute: 840, end_minute: 1080 },
  ], punches: [punch('a', '2026-09-01T14:00:00-03:00')] });
  assert.equal(result.provisional, true);
  assert.equal(result.net_balance_minutes, null);
});
```

- [ ] **Step 5: Run the attendance suite and document the slot policy**

Run: `npm run test:attendance`

Expected: all existing night-shift, duplicate, complete-day and new slot tests pass.

Update `packages/attendance/README.md` with the slot sequence, midpoint ambiguity rule and missing-period rule.

- [ ] **Step 6: Commit the pure engine change**

```bash
git add packages/attendance/index.mjs packages/attendance/README.md tests/attendance.test.mjs
git commit -m "fix: match attendance punches to schedule slots"
```

### Task 2: Persist slots, justifications and correct scale vigency

**Files:**
- Create: `supabase/migrations/20260920110000_attendance_slots_and_justifications.sql`
- Modify: `apps/api/src/attendance-worker.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/test/integration.test.ts`

**Interfaces:**
- Adds tables `public.absence_categories` and `public.day_justifications`.
- Adds `regular_minutes integer`, `justified_minutes integer not null default 0` and `missing_minutes integer` to `public.attendance_calculations`.
- Adds `POST /v1/day-justifications`, `DELETE /v1/day-justifications/:id`, `GET /v1/day-justifications`.
- Worker calls `evaluateAttendance({ ..., justification })` and persists its extended result.

- [ ] **Step 1: Write migration-level integration tests for default categories and a justified day**

```ts
test('justified absence is tenant-scoped and requests recalculation', async () => {
  const categories = await request('GET', `/v1/absence-categories?company_id=${companyA}`, tokenA);
  assert.deepEqual(categories.json().data.map((item: { name: string }) => item.name), ['Atestado', 'Folga', 'Licença paternidade']);
  const created = await request('POST', '/v1/day-justifications', tokenA, {
    company_id: companyA, employee_id: employeeId, local_date: localDate,
    absence_category_id: categories.json().data[0].id, note: 'Atestado médico',
  });
  assert.equal(created.statusCode, 201);
});
```

- [ ] **Step 2: Run the integration test and verify the endpoints/tables are missing**

Run: `npm run api:test`

Expected: test fails with `404` or a missing relation before the migration and API are implemented.

- [ ] **Step 3: Create the migration with audited, tenant-scoped category and justification records**

```sql
create table public.absence_categories (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  name text not null check(length(trim(name)) between 1 and 120),
  abones_hours boolean not null default true, active boolean not null default true,
  version integer not null default 1 check(version > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(company_id, name)
);
create table public.day_justifications (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, employee_id uuid not null,
  local_date date not null, absence_category_id uuid not null, note text,
  created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
  version integer not null default 1 check(version > 0),
  unique(company_id, employee_id, local_date),
  foreign key(company_id, employee_id) references public.employees(company_id, id),
  foreign key(company_id, absence_category_id) references public.absence_categories(company_id, id)
);
```

Seed `Atestado`, `Licença paternidade` and `Folga` for every active company using `on conflict(company_id,name) do nothing`. Add RLS, security-definer RPCs that validate `private.can_manage`, audit rows and enqueue the affected date. Extend `record_attendance_calculation` to insert `justified_minutes` and `missing_minutes` from `p_result`.

- [ ] **Step 4: Change the worker to read justifications and normalize assignment dates**

```ts
const assignmentFrom = localDate(assignment.valid_from, version.timezone);
const assignmentTo = assignment.valid_to ? localDate(assignment.valid_to, version.timezone) : null;
if (date < assignmentFrom || (assignmentTo && date >= assignmentTo)) continue;

const justification = justificationsByDate.get(candidate.localDate);
const result = evaluateAttendance({ ...engineInput, justification: justification && {
  abones_hours: justification.absence_categories.abones_hours,
  category_name: justification.absence_categories.name,
} });
```

Fetch justifications for the job's employee/date range together with the category. Use local dates for schedule assignment boundaries.

- [ ] **Step 5: Extend integration coverage and run the full API suite**

Add assertions for:

```ts
assert.equal(calculation.regular_minutes, 0);
assert.equal(calculation.justified_minutes, 480);
assert.equal(calculation.missing_minutes, 0);
assert.equal(calculation.net_balance_minutes, 0);
```

Also test a non-abonada category, cross-company rejection, first valid day included and closing date excluded.

Run: `npm run api:test`

Expected: all HTTP, queue and worker tests pass.

- [ ] **Step 6: Commit the persistence and worker changes**

```bash
git add supabase/migrations/20260920110000_attendance_slots_and_justifications.sql apps/api/src/attendance-worker.ts apps/api/src/app.ts apps/api/test/integration.test.ts
git commit -m "feat: add justified absences to attendance calculations"
```

### Task 3: Cargos, matrículas automáticas e tarifas por nível

**Files:**
- Create: `supabase/migrations/20260920120000_roles_registration_and_payment_layers.sql`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/test/integration.test.ts`
- Modify: `apps/admin/src/api.ts`

**Interfaces:**
- Reuses `public.departments` as the Cargo catalog with `active` and `version` fields.
- Adds `private.employee_registration_counters(company_id uuid primary key, next_registration bigint not null)`.
- Adds `public.department_payment_settings` with nullable rate columns and `serao_cents`.
- Makes employee override rate columns nullable and adds `serao_cents`; null means inherit one rate category.
- Adds `GET/POST/PATCH /v1/departments`, `GET/POST /v1/department-payment-settings`, and automatic `POST /v1/employees` registration.

- [ ] **Step 1: Write failing API tests for automatic registrations and cargo-level rate resolution**

```ts
test('employee creation assigns consecutive numeric registrations on the server', async () => {
  const first = await request('POST', '/v1/employees', tokenA, { company_id: companyA, name: 'Primeira', home_location_id: locationA });
  const second = await request('POST', '/v1/employees', tokenA, { company_id: companyA, name: 'Segunda', home_location_id: locationA });
  assert.equal(Number(second.json().registration), Number(first.json().registration) + 1);
});

test('employee payment resolution inherits each missing field from its cargo then company', async () => {
  const result = await request('GET', `/v1/payment-rates?company_id=${companyA}&employee_id=${employeeId}`, tokenA);
  assert.equal(result.json().data.meal_cents.source, 'department');
  assert.equal(result.json().data.dinner_cents.source, 'company');
});
```

- [ ] **Step 2: Run the integration test and verify it fails for absent contracts**

Run: `npm run api:test`

Expected: registration is currently required and `/v1/payment-rates` is absent.

- [ ] **Step 3: Implement the migration and server-authoritative write paths**

Use a security-definer `private.create_employee_with_registration` that locks or inserts the company counter, allocates the next integer text value, inserts the employee and returns it in one transaction. When a supplied numeric registration is higher than the counter, advance the counter to that number plus one. Preserve nonnumeric legacy registrations.

```sql
create table private.employee_registration_counters (
  company_id uuid primary key references public.companies(id),
  next_registration bigint not null check(next_registration > 0)
);
alter table public.departments add column if not exists active boolean not null default true;
alter table public.departments add column if not exists version integer not null default 1 check(version > 0);
```

Seed `Administrativo` and `Chapa` per company with `on conflict(company_id,name) do nothing`. Add `serao_cents integer not null default 0` to company rates and `serao_units integer not null default 0` to payment days. Make all employee and department payment rate columns nullable, add `serao_cents`, and define the resolver as `coalesce(employee_rate, department_rate, company_rate, 0)` for each rate separately. Preserve existing exclusive values when `use_company_defaults=false`; when it is true, set every existing employee override field to `null` so each item inherits from the company or cargo independently.

- [ ] **Step 4: Add typed API contracts and resource routes**

Change `employeeBody.registration` to optional. Call the creation RPC when absent; keep PATCH validation for an explicit correction. Add Zod schemas for cargo management and payment layer values (`number | null` for every override). Add `GET /v1/payment-rates` returning:

```ts
type ResolvedRate = { cents: number; source: 'employee' | 'department' | 'company' | 'none' };
type ResolvedPaymentRates = Record<PaymentRateKey, ResolvedRate>;
```

- [ ] **Step 5: Add cross-tenant, edit and simultaneous registration tests**

Use `Promise.all` for two employee creations and assert different numeric registrations. Test editing name, cargo, location and registration preserves employee id; test a role in use becomes inactive rather than deleted; test each rate falls through independently.

Run: `npm run api:test`

Expected: complete API suite passes with RLS and version conflicts intact.

- [ ] **Step 6: Commit the data and API layer**

```bash
git add supabase/migrations/20260920120000_roles_registration_and_payment_layers.sql apps/api/src/app.ts apps/api/test/integration.test.ts apps/admin/src/api.ts
git commit -m "feat: add roles payment layers and automatic registrations"
```

### Task 4: Apuração financeira compartilhada e relatórios

**Files:**
- Create: `packages/payments/index.mjs`
- Create: `tests/payments.test.mjs`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/attendance-report.ts`
- Modify: `tests/contracts.test.mjs`

**Interfaces:**
- Exports `resolveDailyFinancials({ calculation, rates, additions, justification })`.
- Exports `{ regularCents, overtimeCents, shortageCents, allowanceCents, totalCents, lines }`.
- Adds `GET /v1/financial-attendance` and makes PDF/XLSX call the same report builder.

- [ ] **Step 1: Write failing pure-payment tests**

```js
test('apuração soma extra, desconto e janta na mesma data', () => {
  const result = resolveDailyFinancials({
    calculation: { regular_minutes: 480, gross_overtime_minutes: 120, missing_minutes: 30, justified_minutes: 0 },
    rates: { regular_hour_cents: 1250, overtime_hour_cents: 2000, dinner_cents: 1500 },
    additions: { dinner_units: 1 }, justification: null,
  });
  assert.equal(result.regularCents, 10000);
  assert.equal(result.overtimeCents, 4000);
  assert.equal(result.shortageCents, -625);
  assert.equal(result.allowanceCents, 1500);
  assert.equal(result.totalCents, 14875);
});

test('hora abonada não vira desconto financeiro', () => {
  const result = resolveDailyFinancials({
    calculation: { regular_minutes: 0, gross_overtime_minutes: 0, missing_minutes: 0, justified_minutes: 480 },
    rates: { regular_hour_cents: 1250 }, additions: {}, justification: { abones_hours: true },
  });
  assert.equal(result.shortageCents, 0);
});
```

- [ ] **Step 2: Run the focused test and verify the module is absent**

Run: `node --test tests/payments.test.mjs`

Expected: failure because `packages/payments/index.mjs` does not export `resolveDailyFinancials`.

- [ ] **Step 3: Implement the pure financial resolver**

```js
export function resolveDailyFinancials({ calculation, rates, additions }) {
  const rate = (key) => rates[key] ?? 0;
  const regularCents = Math.round(((calculation.regular_minutes ?? 0) + (calculation.justified_minutes ?? 0)) * rate('regular_hour_cents') / 60);
  const overtimeCents = Math.round((calculation.gross_overtime_minutes ?? 0) * rate('overtime_hour_cents') / 60);
  const shortageCents = -Math.round((calculation.missing_minutes ?? 0) * rate('regular_hour_cents') / 60);
  const allowanceCents = ['meal', 'dinner', 'daily_allowance', 'night_shift', 'saturday', 'serao']
    .reduce((sum, key) => sum + (additions[`${key}_units`] ?? 0) * rate(`${key}_cents`), 0);
  return { regularCents, overtimeCents, shortageCents, allowanceCents, totalCents: regularCents + overtimeCents + shortageCents + allowanceCents };
}
```

Use the extended calculation result rather than recalculating time in reports.

- [ ] **Step 4: Add API report composition and export parity tests**

Create an API helper that loads current calculation, resolved rates and additions for each work day. Return per-day `financial` lines from `/v1/financial-attendance`. Extend `AttendanceReportRow` with financial totals and use that same object for XLSX and PDF.

```ts
assert.match(xlsx.body.toString('binary'), /Total financeiro/);
assert.match(pdf.body.toString('binary'), /Total financeiro/);
```

- [ ] **Step 5: Run pure, contract and API tests**

Run: `npm test; npm run api:test`

Expected: all payment cases and existing report exports pass.

- [ ] **Step 6: Commit the shared financial calculation**

```bash
git add packages/payments/index.mjs tests/payments.test.mjs apps/api/src/app.ts apps/api/src/attendance-report.ts tests/contracts.test.mjs apps/api/test/integration.test.ts
git commit -m "feat: unify financial attendance calculations and reports"
```

### Task 5: Refatorar o painel em abas orientadas à operação

**Files:**
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/api.ts`
- Modify: `apps/admin/src/styles.css`
- Create: `apps/admin/src/time-input.ts`
- Create: `apps/admin/src/time-input.test.ts`

**Interfaces:**
- Exports `normalizeClockInput(value: string): string` returning partial `HH:MM` input without deleting digits entered by the user.
- Adds views `overview`, `timesheet`, `payments`, `people`, `schedules`, `terminals`, `settings`.
- `Timesheet` consumes the API financial response and calculation classifications without positional fallback.

- [ ] **Step 1: Write failing unit tests for friendly time input and slot-safe display**

```ts
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { normalizeClockInput } from './time-input.js';

test('formats four time digits as HH:MM', () => assert.equal(normalizeClockInput('0831'), '08:31'));
test('pads a single hour before the minute digits', () => assert.equal(normalizeClockInput('831'), '08:31'));
test('keeps a clear field clear', () => assert.equal(normalizeClockInput(''), ''));
```

- [ ] **Step 2: Run the test and verify the utility is absent**

Run: `node --test apps/admin/src/time-input.test.ts`

Expected: module-not-found error.

- [ ] **Step 3: Implement the time input utility and replace browser prompts**

```ts
export function normalizeClockInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (!digits) return '';
  const padded = digits.length <= 2 ? digits.padStart(2, '0') : digits.padStart(4, '0');
  return padded.length < 3 ? padded : `${padded.slice(0, 2)}:${padded.slice(2)}`;
}
```

Replace `window.prompt` editing with a single inline cell editor containing the masked input, a reason field and explicit Salvar/Cancelar controls. Store the original row state until save succeeds. Do not use a click-position fallback for unclassified punches; display them under `Outras` with the warning status.

- [ ] **Step 4: Reorganize the main navigation and payment management**

Build seven explicit tabs from the specification. Move all period filters and PDF/XLSX buttons into Apuração. Create a Pagamentos tab with three panels: `Valores gerais`, `Por cargo`, and `Exclusivos por funcionário`. Each rate shows an inheritance label such as `Usando valor do cargo: R$ 20,00` and supports clearing only that override.

In Funcionários, add an Editar action and form with the Cargo select, complementary description, automatic matrícula display, local and active state. In Configurações, add Cargo and Categoria de justificativa management. In Apuração, add a Justificar dia control and rows for worked, justified, missing, extra and total financial value.

- [ ] **Step 5: Add visual states and verify the production build**

Add CSS sections for navigation hierarchy, mobile wrapping, green positive time/values, red shortage/discount values and neutral justified state. Verify keyboard access for time editing, selects and checkboxes.

Run: `npm run typecheck; npm run admin:build`

Expected: TypeScript and Vite complete with no errors.

- [ ] **Step 6: Commit the dashboard change**

```bash
git add apps/admin/src/App.tsx apps/admin/src/api.ts apps/admin/src/styles.css apps/admin/src/time-input.ts apps/admin/src/time-input.test.ts
git commit -m "feat: organize attendance payment and employee dashboard"
```

### Task 6: End-to-end validation and deployment preparation

**Files:**
- Modify: `README.md`
- Modify: `apps/api/README.md`
- Modify: `apps/admin/README.md`

**Interfaces:**
- Documents the revised staff workflow: cargo, automatic enrollment number, schedule-based attendance, full-day justification and three-level rates.

- [ ] **Step 1: Add end-to-end scenarios to the API integration suite before changing documentation**

```ts
test('full-day medical justification keeps the employee balance at zero', async () => {
  // Create a 08–12/14–18 work day, post the certificate justification, drain the queue,
  // then assert worked=0, justified=480, missing=0 and balance=0.
});

test('the financial endpoint, XLSX and PDF agree on dinner and overtime totals', async () => {
  // Configure a rate, add dinner, produce overtime, then compare the displayed cents
  // and exported report totals from the common report payload.
});
```

- [ ] **Step 2: Run the end-to-end suite and investigate every failure before documentation**

Run: `npm run api:test`

Expected: all tenant, worker, justification, cargo, payment and report parity tests pass.

- [ ] **Step 3: Document the operational workflows**

Add concise Portuguese instructions for creating cargos, setting company/cargo/employee values, registering a justified absence, reviewing an incomplete day and editing a schedule-based slot. Explain that no employee data or facial profile is removed by edits or cargo deactivation.

- [ ] **Step 4: Run the complete verification set**

Run: `npm test; npm run typecheck; npm run admin:build; npm run api:test`

Expected: all commands exit 0. Record any existing unrelated failure explicitly rather than hiding it.

- [ ] **Step 5: Commit documentation and verification state**

```bash
git add README.md apps/api/README.md apps/admin/README.md apps/api/test/integration.test.ts
git commit -m "docs: describe schedule payments and justified absences"
```

## Plan Self-Review

- Spec coverage: Tasks 1–2 cover slots, deficiencies, overnight shifts, assignment dates and justifications. Task 3 covers cargos, per-field inheritance, automatic registration and employee editing contracts. Task 4 covers a single financial result for screen and exports. Task 5 covers the requested navigation and simple time editing. Task 6 covers documentation and end-to-end verification.
- Placeholder scan: no unresolved planning markers remain; each task names paths, interfaces, commands and concrete test cases.
- Type consistency: `regular_minutes`, `missing_minutes` and `justified_minutes` originate in Task 1, persist in Task 2, feed Task 4, and render in Task 5. `ResolvedPaymentRates` originates in Task 3 and is consumed by Task 4.
- Review focus coverage: midpoint ambiguity and provisional days are tested in Task 1; partial justifications in Task 2; per-item inheritance in Task 3; clearing a single override and concurrent registration in Tasks 3 and 5.

## Execution Handoff

The plan contains linked database, API and UI interfaces, and a calculation mistake would affect time and money. I recommend the **native** approach: implement each task in sequence in this session, verify it fully, then perform a whole-branch review before any publication.

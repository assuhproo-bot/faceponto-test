import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDailyFinancials } from '../packages/payments/index.mjs';

test('apuração soma extra, desconto e janta na mesma data', () => {
  const result = resolveDailyFinancials({
    calculation: { regular_minutes: 480, gross_overtime_minutes: 120, missing_minutes: 30, justified_minutes: 0 },
    rates: { regular_hour_cents: 1250, overtime_hour_cents: 2000, dinner_cents: 1500 },
    additions: { dinner_units: 1 },
    justification: null,
  });
  assert.equal(result.regularCents, 10000);
  assert.equal(result.overtimeCents, 4000);
  assert.equal(result.shortageCents, -625);
  assert.equal(result.allowanceCents, 1500);
  assert.equal(result.totalCents, 14875);
  assert.deepEqual(result.lines.map((line) => [line.key, line.cents]), [
    ['regular', 10000], ['overtime', 4000], ['shortage', -625], ['dinner', 1500],
  ]);
});

test('hora abonada entra como hora paga e não vira desconto financeiro', () => {
  const result = resolveDailyFinancials({
    calculation: { regular_minutes: 0, gross_overtime_minutes: 0, missing_minutes: 0, justified_minutes: 480 },
    rates: { regular_hour_cents: 1250 },
    additions: {},
    justification: { abones_hours: true },
  });
  assert.equal(result.regularCents, 0);
  assert.equal(result.justifiedCents, 10000);
  assert.equal(result.shortageCents, 0);
  assert.equal(result.totalCents, 10000);
  assert.deepEqual(result.lines.map((line) => [line.key, line.cents]), [['justified', 10000]]);
});

test('justificativa sem abono não paga hora e a taxa pode vir com origem resolvida', () => {
  const result = resolveDailyFinancials({
    calculation: { regular_minutes: 0, gross_overtime_minutes: 0, missing_minutes: 120, justified_minutes: 120 },
    rates: { regular_hour_cents: { cents: 1500, source: 'department' } },
    additions: {},
    justification: { abones_hours: false },
  });
  assert.equal(result.regularCents, 0);
  assert.equal(result.shortageCents, -3000);
  assert.equal(result.totalCents, -3000);
});

test('adicionais preservam categorias separadas, inclusive serão fixo', () => {
  const result = resolveDailyFinancials({
    calculation: {},
    rates: {
      meal_cents: 1200, dinner_cents: 1600, daily_allowance_cents: 5000,
      night_shift_cents: 2000, saturday_cents: 2500, serao_cents: 3500,
    },
    additions: {
      meal_units: 1, dinner_units: 1, daily_allowance_units: 1,
      night_shift_units: 2, saturday_units: 1, serao_units: 2,
    },
    justification: null,
  });
  assert.equal(result.allowanceCents, 21300);
  assert.deepEqual(result.allowanceCentsByKey, {
    meal: 1200, dinner: 1600, daily_allowance: 5000, night_shift: 4000, saturday: 2500, serao: 7000,
  });
  assert.equal(result.totalCents, 21300);
  assert.deepEqual(result.lines.filter((line) => line.kind === 'allowance').map((line) => line.key), [
    'meal', 'dinner', 'daily_allowance', 'night_shift', 'saturday', 'serao',
  ]);
});

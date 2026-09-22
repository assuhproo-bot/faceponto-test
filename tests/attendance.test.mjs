import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateBalances, evaluateAttendance } from '../packages/attendance/index.mjs';

const base = {
  journey_start: '2026-09-01T00:00:00-03:00', evaluated_at: '2026-09-03T00:00:00-03:00',
  schedule_version: 1, rules_version: 1, rules: {
    missing_punch_grace_minutes: 60, late_tolerance_minutes: 5,
    overtime_tolerance_minutes: 5, duplicate_window_minutes: 1,
  },
};
const punch = (id, timestamp) => ({ id, timestamp });

test('turno noturno 22h–06h soma 480 minutos', () => {
  const result = evaluateAttendance({ ...base, segments: [{ start_minute: 1320, end_minute: 1800 }], punches: [
    punch('a', '2026-09-01T22:00:00-03:00'), punch('b', '2026-09-02T06:00:00-03:00'),
  ] });
  assert.equal(result.planned_minutes, 480); assert.equal(result.worked_minutes, 480); assert.equal(result.net_balance_minutes, 0);
});

test('duas batidas 14h–22h não inventam intervalo', () => {
  const result = evaluateAttendance({ ...base, segments: [{ start_minute: 840, end_minute: 1320 }], punches: [
    punch('a', '2026-09-01T14:00:00-03:00'), punch('b', '2026-09-01T22:00:00-03:00'),
  ] });
  assert.equal(result.worked_minutes, 480); assert.equal(result.break_minutes, 0);
});

test('quatro batidas preservam atraso, extra e saldo como métricas distintas', () => {
  const result = evaluateAttendance({ ...base, segments: [{ start_minute: 480, end_minute: 720 }, { start_minute: 810, end_minute: 1080 }], punches: [
    punch('a', '2026-09-01T08:05:00-03:00'), punch('b', '2026-09-01T12:00:00-03:00'),
    punch('c', '2026-09-01T13:30:00-03:00'), punch('d', '2026-09-01T18:40:00-03:00'),
  ] });
  assert.deepEqual({ planned: result.planned_minutes, worked: result.worked_minutes, late: result.late_minutes, overtime: result.gross_overtime_minutes, balance: result.net_balance_minutes },
    { planned: 510, worked: 545, late: 5, overtime: 40, balance: 35 });
  assert.equal(result.late_after_tolerance_minutes, 0);
  assert.equal(result.overtime_after_tolerance_minutes, 40);
});

test('batida faltante mantém saldo final nulo e ocorrência explícita', () => {
  const result = evaluateAttendance({ ...base, segments: [{ start_minute: 480, end_minute: 1080 }], punches: [punch('a', '2026-09-01T08:10:00-03:00')] });
  assert.equal(result.net_balance_minutes, null); assert.equal(result.provisional, false);
  assert.deepEqual(result.occurrences, [{ code: 'INCOMPLETE_PUNCHES', severity: 'error', definitive: true }]);
});

test('banco agrega +35 e -20 sem alterar resultados diários', () => {
  assert.equal(aggregateBalances([{ net_balance_minutes: 35 }, { net_balance_minutes: -20 }, { net_balance_minutes: null }]), 15);
});

test('dia encerrado sem batidas registra falta da escala sem fabricar horários', () => {
  const result = evaluateAttendance({ ...base, segments: [{ start_minute: 480, end_minute: 1080 }], punches: [] });
  assert.equal(result.worked_minutes, 0);
  assert.equal(result.regular_minutes, 0);
  assert.equal(result.missing_minutes, 600);
  assert.equal(result.net_balance_minutes, -600);
  assert.deepEqual(result.occurrences, [{ code: 'ABSENCE', severity: 'error', definitive: true }]);
});

test('batidas extras e próximas ficam sem classificação silenciosa', () => {
  const result = evaluateAttendance({ ...base, segments: [{ start_minute: 480, end_minute: 1080 }], punches: [
    punch('b', '2026-09-01T08:00:30-03:00'), punch('a', '2026-09-01T08:00:00-03:00'),
    punch('c', '2026-09-01T18:00:00-03:00'),
  ] });
  assert.ok(result.occurrences.some((item) => item.code === 'UNEXPECTED_PUNCH_COUNT'));
  assert.ok(result.occurrences.some((item) => item.code === 'POSSIBLE_DUPLICATE'));
  assert.deepEqual(result.classifications.map((item) => item.type), ['unclassified', 'unclassified', 'unclassified']);
});

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
  assert.equal(result.regular_minutes, 210);
  assert.equal(result.missing_minutes, 270);
  assert.equal(result.net_balance_minutes, -270);
});

test('horário no ponto médio de dois slots gera ocorrência ambígua', () => {
  const result = evaluateAttendance({ ...base, segments: [
    { start_minute: 480, end_minute: 720 },
    { start_minute: 840, end_minute: 1080 },
  ], punches: [punch('a', '2026-09-01T13:00:00-03:00')] });
  assert.deepEqual(result.classifications.map((item) => item.type), ['unclassified']);
  assert.ok(result.occurrences.some((item) => item.code === 'AMBIGUOUS_SCHEDULE_SLOT'));
  assert.equal(result.net_balance_minutes, null);
});

test('jornada incompleta antes da carência não fecha saldo definitivo', () => {
  const result = evaluateAttendance({ ...base, evaluated_at: '2026-09-01T15:00:00-03:00', segments: [
    { start_minute: 480, end_minute: 720 },
    { start_minute: 840, end_minute: 1080 },
  ], punches: [punch('a', '2026-09-01T14:00:00-03:00')] });
  assert.equal(result.provisional, true);
  assert.equal(result.net_balance_minutes, null);
});

test('justificativa abonada converte toda a falta da escala em horas abonadas', () => {
  const result = evaluateAttendance({ ...base, segments: [{ start_minute: 480, end_minute: 960 }], punches: [], justification: { abones_hours: true } });
  assert.equal(result.worked_minutes, 0);
  assert.equal(result.regular_minutes, 0);
  assert.equal(result.justified_minutes, 480);
  assert.equal(result.missing_minutes, 0);
  assert.equal(result.net_balance_minutes, 0);
  assert.equal(result.occurrences.some((item) => item.code === 'ABSENCE'), false);
});

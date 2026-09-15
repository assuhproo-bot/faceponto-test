export const ENGINE_VERSION = 1;

const minute = 60_000;

function assertMinute(value, name) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${name} deve ser um inteiro não negativo`);
}

/** Avalia uma instância de jornada já resolvida para um fuso e uma versão de escala. */
export function evaluateAttendance(input) {
  const origin = Date.parse(input.journey_start);
  const evaluatedAt = Date.parse(input.evaluated_at);
  if (!Number.isFinite(origin) || !Number.isFinite(evaluatedAt)) throw new TypeError('Instantes inválidos');
  if (!Array.isArray(input.segments) || input.segments.length === 0) throw new TypeError('A jornada precisa de segmentos');

  const segments = [...input.segments].sort((a, b) => a.start_minute - b.start_minute);
  for (const [index, segment] of segments.entries()) {
    assertMinute(segment.start_minute, `segments[${index}].start_minute`);
    assertMinute(segment.end_minute, `segments[${index}].end_minute`);
    if (segment.end_minute <= segment.start_minute) throw new TypeError('Segmento inválido');
    if (index && segment.start_minute < segments[index - 1].end_minute) throw new TypeError('Segmentos sobrepostos');
  }

  const punches = [...input.punches].map((punch) => ({ ...punch, instant_ms: Date.parse(punch.timestamp) }))
    .sort((a, b) => a.instant_ms - b.instant_ms || a.id.localeCompare(b.id));
  if (punches.some((punch) => !Number.isFinite(punch.instant_ms))) throw new TypeError('Batida inválida');

  const plannedMinutes = segments.reduce((sum, segment) => sum + segment.end_minute - segment.start_minute, 0);
  const grace = input.rules?.missing_punch_grace_minutes ?? 0;
  const lateTolerance = input.rules?.late_tolerance_minutes ?? 0;
  const overtimeTolerance = input.rules?.overtime_tolerance_minutes ?? 0;
  const duplicateWindow = input.rules?.duplicate_window_minutes ?? 0;
  assertMinute(grace, 'missing_punch_grace_minutes');
  assertMinute(lateTolerance, 'late_tolerance_minutes');
  assertMinute(overtimeTolerance, 'overtime_tolerance_minutes');
  assertMinute(duplicateWindow, 'duplicate_window_minutes');
  const endMs = origin + segments.at(-1).end_minute * minute;
  const complete = punches.length === segments.length * 2;
  const definitive = evaluatedAt >= endMs + grace * minute;
  const occurrences = [];
  if (!complete) occurrences.push({
    code: punches.length > segments.length * 2 ? 'UNEXPECTED_PUNCH_COUNT' : punches.length === 0 && definitive ? 'ABSENCE' : 'INCOMPLETE_PUNCHES',
    severity: definitive ? 'error' : 'warning', definitive,
  });
  for (let index = 1; index < punches.length; index += 1) {
    const distance = Math.round((punches[index].instant_ms - punches[index - 1].instant_ms) / minute);
    if (distance <= duplicateWindow) occurrences.push({
      code: 'POSSIBLE_DUPLICATE', severity: 'warning', definitive: true,
      event_ids: [punches[index - 1].id, punches[index].id], distance_minutes: distance,
    });
  }

  const classifications = punches.map((punch, index) => ({
    event_id: punch.id,
    type: complete ? (index % 2 === 0 ? (index === 0 ? 'entry' : 'break_end') : (index === punches.length - 1 ? 'exit' : 'break_start')) : 'unclassified',
  }));
  if (!complete) {
    return {
      engine_version: ENGINE_VERSION, schedule_version: input.schedule_version, rules_version: input.rules_version,
      planned_minutes: plannedMinutes, worked_minutes: null, late_minutes: null, early_departure_minutes: null,
      late_after_tolerance_minutes: null, break_minutes: null, gross_overtime_minutes: null,
      overtime_after_tolerance_minutes: null, net_balance_minutes: null,
      provisional: !definitive, classifications, occurrences,
    };
  }

  let workedMinutes = 0;
  for (let index = 0; index < punches.length; index += 2) {
    workedMinutes += Math.max(0, Math.round((punches[index + 1].instant_ms - punches[index].instant_ms) / minute));
  }
  const first = punches[0].instant_ms;
  const last = punches.at(-1).instant_ms;
  const plannedStart = origin + segments[0].start_minute * minute;
  const plannedEnd = origin + segments.at(-1).end_minute * minute;
  const lateMinutes = Math.max(0, Math.round((first - plannedStart) / minute));
  const earlyMinutes = Math.max(0, Math.round((plannedEnd - last) / minute));
  const overtimeMinutes = Math.max(0, Math.round((last - plannedEnd) / minute));
  const spanMinutes = Math.max(0, Math.round((last - first) / minute));

  return {
    engine_version: ENGINE_VERSION, schedule_version: input.schedule_version, rules_version: input.rules_version,
    planned_minutes: plannedMinutes, worked_minutes: workedMinutes, late_minutes: lateMinutes,
    late_after_tolerance_minutes: lateMinutes <= lateTolerance ? 0 : lateMinutes,
    early_departure_minutes: earlyMinutes, break_minutes: spanMinutes - workedMinutes,
    gross_overtime_minutes: overtimeMinutes,
    overtime_after_tolerance_minutes: overtimeMinutes <= overtimeTolerance ? 0 : overtimeMinutes,
    net_balance_minutes: workedMinutes - plannedMinutes,
    provisional: false, classifications, occurrences,
  };
}

export function aggregateBalances(results) {
  return results.reduce((total, result) => total + (result.net_balance_minutes ?? 0), 0);
}

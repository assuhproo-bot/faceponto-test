export const ENGINE_VERSION = 2;

const minute = 60_000;

function assertMinute(value, name) {
  if (!Number.isInteger(value) || value < 0) throw new TypeError(`${name} deve ser um inteiro não negativo`);
}

function roundedMinutes(value) {
  return Math.round(value / minute);
}

function overlapMinutes(start, end, plannedStart, plannedEnd) {
  return Math.max(0, Math.min(end, plannedEnd) - Math.max(start, plannedStart));
}

function scheduleSlots(segments) {
  return segments.flatMap((segment, segmentIndex) => [
    {
      slot_index: segmentIndex * 2,
      type: segmentIndex === 0 ? 'entry' : 'break_end',
      planned_minute: segment.start_minute,
      segment_index: segmentIndex,
      boundary: 'start',
    },
    {
      slot_index: segmentIndex * 2 + 1,
      type: segmentIndex === segments.length - 1 ? 'exit' : 'break_start',
      planned_minute: segment.end_minute,
      segment_index: segmentIndex,
      boundary: 'end',
    },
  ]);
}

function nearestScheduledSlot(slots, punchMinute) {
  let shortestDistance = Number.POSITIVE_INFINITY;
  let candidates = [];

  for (const slot of slots) {
    const distance = Math.abs(slot.planned_minute - punchMinute);
    if (distance < shortestDistance) {
      shortestDistance = distance;
      candidates = [slot];
    } else if (distance === shortestDistance) {
      candidates.push(slot);
    }
  }

  return { candidates, distance_minutes: shortestDistance };
}

function matchPunchesToSlots(slots, punches) {
  const matches = new Map();
  const occupiedSlots = new Map();
  const blockedSlots = new Set();
  const occurrences = [];

  for (const [punchIndex, punch] of punches.entries()) {
    const nearest = nearestScheduledSlot(slots, punch.relative_minute);
    if (nearest.candidates.length !== 1) {
      occurrences.push({
        code: 'AMBIGUOUS_SCHEDULE_SLOT', severity: 'warning', definitive: true,
        event_id: punch.id,
        slot_indexes: nearest.candidates.map((slot) => slot.slot_index),
      });
      continue;
    }

    const slot = nearest.candidates[0];
    if (blockedSlots.has(slot.slot_index)) continue;

    const existingPunchIndex = occupiedSlots.get(slot.slot_index);
    if (existingPunchIndex !== undefined) {
      matches.delete(existingPunchIndex);
      occupiedSlots.delete(slot.slot_index);
      blockedSlots.add(slot.slot_index);
      occurrences.push({
        code: 'SCHEDULE_SLOT_COLLISION', severity: 'warning', definitive: true,
        slot_index: slot.slot_index,
        event_ids: [punches[existingPunchIndex].id, punch.id],
      });
      continue;
    }

    const previous = [...matches.entries()].at(-1);
    if (previous && previous[1].slot_index >= slot.slot_index) {
      matches.delete(previous[0]);
      occupiedSlots.delete(previous[1].slot_index);
      blockedSlots.add(previous[1].slot_index);
      blockedSlots.add(slot.slot_index);
      occurrences.push({
        code: 'OUT_OF_ORDER_SCHEDULE_SLOT', severity: 'warning', definitive: true,
        event_ids: [punches[previous[0]].id, punch.id],
      });
      continue;
    }

    matches.set(punchIndex, slot);
    occupiedSlots.set(slot.slot_index, punchIndex);
  }

  return { matches, occurrences };
}

function emptyMetrics(input, plannedMinutes, definitive, classifications, occurrences, missingSlotIndexes) {
  return {
    engine_version: ENGINE_VERSION, schedule_version: input.schedule_version, rules_version: input.rules_version,
    planned_minutes: plannedMinutes, worked_minutes: null, regular_minutes: null, missing_minutes: null,
    justified_minutes: 0, late_minutes: null, early_departure_minutes: null,
    late_after_tolerance_minutes: null, break_minutes: null, gross_overtime_minutes: null,
    overtime_after_tolerance_minutes: null, net_balance_minutes: null,
    missing_slot_indexes: missingSlotIndexes, provisional: !definitive, classifications, occurrences,
  };
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

  const punches = [...input.punches].map((punch) => ({
    ...punch,
    instant_ms: Date.parse(punch.timestamp),
  })).sort((a, b) => a.instant_ms - b.instant_ms || String(a.id).localeCompare(String(b.id)));
  if (punches.some((punch) => !Number.isFinite(punch.instant_ms))) throw new TypeError('Batida inválida');
  for (const punch of punches) punch.relative_minute = roundedMinutes(punch.instant_ms - origin);

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
  const definitive = evaluatedAt >= endMs + grace * minute;
  const slots = scheduleSlots(segments);
  const occurrences = [];

  for (let index = 1; index < punches.length; index += 1) {
    const distance = roundedMinutes(punches[index].instant_ms - punches[index - 1].instant_ms);
    if (distance <= duplicateWindow) {
      occurrences.push({
        code: 'POSSIBLE_DUPLICATE', severity: 'warning', definitive: true,
        event_ids: [punches[index - 1].id, punches[index].id], distance_minutes: distance,
      });
    }
  }

  let matches = new Map();
  let matchingOccurrences = [];
  let unexpectedPunchCount = false;
  if (punches.length > slots.length) {
    unexpectedPunchCount = true;
    occurrences.unshift({ code: 'UNEXPECTED_PUNCH_COUNT', severity: 'error', definitive });
  } else {
    const matching = matchPunchesToSlots(slots, punches);
    matches = matching.matches;
    matchingOccurrences = matching.occurrences;
    occurrences.push(...matchingOccurrences);
  }

  const matchesBySlot = new Map([...matches.entries()].map(([punchIndex, slot]) => [slot.slot_index, punches[punchIndex]]));
  const missingSlotIndexes = slots.filter((slot) => !matchesBySlot.has(slot.slot_index)).map((slot) => slot.slot_index);
  const classifications = punches.map((punch, punchIndex) => {
    const slot = matches.get(punchIndex);
    return slot
      ? { event_id: punch.id, type: slot.type, slot_index: slot.slot_index, planned_minute: slot.planned_minute }
      : { event_id: punch.id, type: 'unclassified' };
  });

  const partialSegment = segments.some((_, segmentIndex) => {
    const hasStart = matchesBySlot.has(segmentIndex * 2);
    const hasEnd = matchesBySlot.has(segmentIndex * 2 + 1);
    return hasStart !== hasEnd;
  });
  const invalidMatching = unexpectedPunchCount || matchingOccurrences.length > 0;

  if (punches.length === 0 && definitive) {
    occurrences.push({ code: 'ABSENCE', severity: 'error', definitive: true });
  } else if (partialSegment) {
    occurrences.push({ code: 'INCOMPLETE_PUNCHES', severity: definitive ? 'error' : 'warning', definitive });
  } else if (missingSlotIndexes.length > 0 && !invalidMatching) {
    occurrences.push({ code: 'MISSING_SCHEDULE_SLOTS', severity: definitive ? 'error' : 'warning', definitive });
  }

  if (!definitive || partialSegment || invalidMatching) {
    return emptyMetrics(input, plannedMinutes, definitive, classifications, occurrences, missingSlotIndexes);
  }

  let workedMinutes = 0;
  let regularMinutes = 0;
  let lateMinutes = 0;
  let earlyDepartureMinutes = 0;
  let grossOvertimeMinutes = 0;
  let breakMinutes = 0;
  let previousEndMinute = null;

  for (const [segmentIndex, segment] of segments.entries()) {
    const startPunch = matchesBySlot.get(segmentIndex * 2);
    const endPunch = matchesBySlot.get(segmentIndex * 2 + 1);
    if (!startPunch && !endPunch) {
      previousEndMinute = null;
      continue;
    }

    const actualStart = startPunch.relative_minute;
    const actualEnd = endPunch.relative_minute;
    workedMinutes += Math.max(0, actualEnd - actualStart);
    regularMinutes += overlapMinutes(actualStart, actualEnd, segment.start_minute, segment.end_minute);
    lateMinutes += Math.max(0, actualStart - segment.start_minute);
    earlyDepartureMinutes += Math.max(0, segment.end_minute - actualEnd);
    grossOvertimeMinutes += Math.max(0, segment.start_minute - actualStart) + Math.max(0, actualEnd - segment.end_minute);
    if (previousEndMinute !== null) breakMinutes += Math.max(0, actualStart - previousEndMinute);
    previousEndMinute = actualEnd;
  }

  const rawMissingMinutes = Math.max(0, plannedMinutes - regularMinutes);
  const justifiedMinutes = input.justification?.abones_hours ? rawMissingMinutes : 0;
  const missingMinutes = rawMissingMinutes - justifiedMinutes;

  return {
    engine_version: ENGINE_VERSION, schedule_version: input.schedule_version, rules_version: input.rules_version,
    planned_minutes: plannedMinutes, worked_minutes: workedMinutes, regular_minutes: regularMinutes,
    missing_minutes: missingMinutes, justified_minutes: justifiedMinutes, late_minutes: lateMinutes,
    late_after_tolerance_minutes: lateMinutes <= lateTolerance ? 0 : lateMinutes,
    early_departure_minutes: earlyDepartureMinutes, break_minutes: breakMinutes,
    gross_overtime_minutes: grossOvertimeMinutes,
    overtime_after_tolerance_minutes: grossOvertimeMinutes <= overtimeTolerance ? 0 : grossOvertimeMinutes,
    net_balance_minutes: workedMinutes + justifiedMinutes - plannedMinutes,
    missing_slot_indexes: missingSlotIndexes, provisional: false, classifications, occurrences,
  };
}

export function aggregateBalances(results) {
  return results.reduce((total, result) => total + (result.net_balance_minutes ?? 0), 0);
}

const nonNegative = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

function cents(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (value && typeof value === 'object' && typeof value.cents === 'number' && Number.isFinite(value.cents)) {
    return Math.max(0, Math.round(value.cents));
  }
  return 0;
}

function rate(rates, key) {
  return cents(rates?.[key]);
}

function hourly(minutes, hourlyCents) {
  return Math.round(nonNegative(minutes) * hourlyCents / 60);
}

/**
 * Produces the money view for one calculated work day.
 *
 * The attendance engine is the source of minutes. This resolver only turns
 * those minutes and the independently resolved rates into money, so the
 * panel, PDF and XLSX cannot diverge in their calculations.
 */
export function resolveDailyFinancials({ calculation = {}, rates = {}, additions = {}, justification = null } = {}) {
  const justifiedMinutes = justification?.abones_hours === false ? 0 : nonNegative(calculation.justified_minutes);
  const regularMinutes = nonNegative(calculation.regular_minutes);
  const overtimeMinutes = nonNegative(calculation.gross_overtime_minutes);
  const missingMinutes = nonNegative(calculation.missing_minutes);
  const regularCents = hourly(regularMinutes, rate(rates, 'regular_hour_cents'));
  const justifiedCents = hourly(justifiedMinutes, rate(rates, 'regular_hour_cents'));
  const overtimeCents = hourly(overtimeMinutes, rate(rates, 'overtime_hour_cents'));
  const shortageAmount = hourly(missingMinutes, rate(rates, 'regular_hour_cents'));
  const shortageCents = shortageAmount === 0 ? 0 : -shortageAmount;

  const additionDefinitions = [
    ['meal', 'meal_units', 'meal_cents', 'Almoço'],
    ['dinner', 'dinner_units', 'dinner_cents', 'Janta'],
    ['daily_allowance', 'daily_allowance_units', 'daily_allowance_cents', 'Diária'],
    ['night_shift', 'night_shift_units', 'night_shift_cents', 'Madrugada'],
    ['saturday', 'saturday_units', 'saturday_cents', 'Sábado'],
    ['serao', 'serao_units', 'serao_cents', 'Serão'],
  ];
  const additionsLines = additionDefinitions
    .map(([key, unitsKey, rateKey, label]) => {
      const units = nonNegative(additions[unitsKey]);
      const unitCents = rate(rates, rateKey);
      return { key, kind: 'allowance', label, units, rateCents: unitCents, cents: Math.round(units * unitCents) };
    })
    .filter((line) => line.cents !== 0);
  const allowanceCents = additionsLines.reduce((sum, line) => sum + line.cents, 0);
  const allowanceCentsByKey = Object.fromEntries(additionDefinitions.map(([key]) => [key, 0]));
  for (const line of additionsLines) allowanceCentsByKey[line.key] = line.cents;

  const lines = [
    regularCents !== 0 && { key: 'regular', kind: 'regular', label: 'Horas normais', minutes: regularMinutes, rateCents: rate(rates, 'regular_hour_cents'), cents: regularCents },
    justifiedCents !== 0 && { key: 'justified', kind: 'justified', label: 'Horas abonadas', minutes: justifiedMinutes, rateCents: rate(rates, 'regular_hour_cents'), cents: justifiedCents },
    overtimeCents !== 0 && { key: 'overtime', kind: 'overtime', label: 'Horas extras', minutes: overtimeMinutes, rateCents: rate(rates, 'overtime_hour_cents'), cents: overtimeCents },
    shortageCents !== 0 && { key: 'shortage', kind: 'shortage', label: 'Horas faltas', minutes: missingMinutes, rateCents: rate(rates, 'regular_hour_cents'), cents: shortageCents },
    ...additionsLines,
  ].filter(Boolean);

  return {
    regularCents,
    justifiedCents,
    overtimeCents,
    shortageCents,
    allowanceCents,
    allowanceCentsByKey,
    totalCents: regularCents + justifiedCents + overtimeCents + shortageCents + allowanceCents,
    lines,
  };
}

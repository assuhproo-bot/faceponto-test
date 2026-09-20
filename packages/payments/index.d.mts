export type ResolvedRate = number | { cents: number; source?: string };

export type DailyFinancialLine = {
  key: string;
  kind: string;
  label: string;
  cents: number;
  rateCents: number;
  minutes?: number;
  units?: number;
};

export type DailyFinancials = {
  regularCents: number;
  justifiedCents: number;
  overtimeCents: number;
  shortageCents: number;
  allowanceCents: number;
  allowanceCentsByKey: Record<'meal' | 'dinner' | 'daily_allowance' | 'night_shift' | 'saturday' | 'serao', number>;
  totalCents: number;
  lines: DailyFinancialLine[];
};

export function resolveDailyFinancials(input?: {
  calculation?: {
    regular_minutes?: number | null;
    justified_minutes?: number | null;
    missing_minutes?: number | null;
    gross_overtime_minutes?: number | null;
  };
  rates?: Record<string, ResolvedRate | null | undefined>;
  additions?: {
    meal_units?: number | null;
    dinner_units?: number | null;
    daily_allowance_units?: number | null;
    night_shift_units?: number | null;
    saturday_units?: number | null;
    serao_units?: number | null;
  };
  justification?: { abones_hours?: boolean } | null;
}): DailyFinancials;

export const ENGINE_VERSION: number;
export type AttendanceResult = Record<string, unknown> & {
  provisional: boolean;
  occurrences: Array<Record<string, unknown>>;
  classifications: Array<Record<string, unknown>>;
};
export function evaluateAttendance(input: Record<string, unknown>): AttendanceResult;
export function aggregateBalances(results: Array<{ net_balance_minutes: number | null }>): number;

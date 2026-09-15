export type ValidationResult = { valid: true } | { valid: false; reason: string; errors?: unknown };
export interface ContractValidator {
  (value: unknown): boolean;
  errors?: unknown;
}
export const validateSyncRequest: ContractValidator;
export const validateSyncResponse: ContractValidator;
export function validateSyncExchange(request: unknown, response: unknown): ValidationResult;
export function readJson(relativePath: string): unknown;

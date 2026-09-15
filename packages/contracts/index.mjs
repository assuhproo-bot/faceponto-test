import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

export const readJson = (relativePath) =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));

export const validateSyncRequest = ajv.compile(readJson('./sync-request.schema.json'));
export const validateSyncResponse = ajv.compile(readJson('./sync-response.schema.json'));

// Constraints involving relations between records are not expressible by these schemas.
export function validateSyncExchange(request, response) {
  if (!validateSyncRequest(request)) {
    return { valid: false, reason: 'invalid_request', errors: structuredClone(validateSyncRequest.errors) };
  }
  const ids = new Set(request.events.map((event) => event.id));
  if (ids.size !== request.events.length) return { valid: false, reason: 'duplicate_request_id' };
  if (!validateSyncResponse(response)) {
    return { valid: false, reason: 'invalid_response', errors: structuredClone(validateSyncResponse.errors) };
  }
  const received = new Set();
  for (const result of response.results) {
    if (!ids.has(result.id)) return { valid: false, reason: 'unexpected_response_id' };
    if (received.has(result.id)) return { valid: false, reason: 'duplicate_response_id' };
    received.add(result.id);
  }
  if (received.size !== ids.size) return { valid: false, reason: 'missing_response_id' };
  return { valid: true };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readJson, validateSyncRequest, validateSyncResponse, validateSyncExchange,
} from '../packages/contracts/index.mjs';

const request = () => readJson('./examples/sync-request.json');
const response = () => readJson('./examples/sync-response.json');

test('evento sem âncora pode ser transmitido e recebe quarentena explícita', () => {
  assert.deepEqual(validateSyncExchange(request(), response()), { valid: true });
});

for (const field of ['company_id', 'terminal_id', 'location_id', 'punch_type', 'server_timestamp', 'sync_status']) {
  test(`terminal não pode impor ${field} no contrato de captura`, () => {
    const input = request();
    input.events[0][field] = 'forjado';
    assert.equal(validateSyncRequest(input), false);
  });
}

for (const value of ['2026-09-13T08:02:00', '2026-02-30T08:02:00Z', 'ontem']) {
  test(`rejeita instante inválido ou sem fuso: ${value}`, () => {
    const input = request();
    input.events[0].device_timestamp = value;
    assert.equal(validateSyncRequest(input), false);
  });
}

test('falha de liveness não pertence ao fluxo de marcação aceita', () => {
  const input = request();
  input.events[0].recognition.liveness_result = 'failed';
  assert.equal(validateSyncRequest(input), false);
});

test('não permite omitir evidência nem enviar foto bruta na marcação', () => {
  const input = request();
  delete input.events[0].recognition;
  assert.equal(validateSyncRequest(input), false);
  const withPhoto = request();
  withPhoto.events[0].photo = 'base64';
  assert.equal(validateSyncRequest(withPhoto), false);
});

test('limita lotes e rejeita lote vazio', () => {
  assert.equal(validateSyncRequest({ protocol_version: 1, events: [] }), false);
  const input = request();
  input.events = Array.from({ length: 101 }, () => structuredClone(input.events[0]));
  assert.equal(validateSyncRequest(input), false);
});

test('rejeita UUIDs duplicados no mesmo lote', () => {
  const input = request();
  input.events.push(structuredClone(input.events[0]));
  assert.equal(validateSyncExchange(input, response()).reason, 'duplicate_request_id');
});

test('UUID usa forma canônica minúscula para não disfarçar duplicidade', () => {
  const input = request();
  input.events[0].id = input.events[0].id.toUpperCase();
  assert.equal(validateSyncRequest(input), false);
});

test('não aceita recibo para evento que não foi enviado', () => {
  const output = response();
  output.results[0].id = '11111111-2222-4333-8444-555555555555';
  assert.equal(validateSyncExchange(request(), output).reason, 'unexpected_response_id');
});

test('recibo duplicado não confirma o lote', () => {
  const output = response();
  output.results.push(structuredClone(output.results[0]));
  assert.equal(validateSyncExchange(request(), output).reason, 'duplicate_response_id');
});

test('resposta parcial não confirma os demais registros', () => {
  const input = request();
  input.events.push({ ...structuredClone(input.events[0]), id: '11111111-2222-4333-8444-555555555555' });
  assert.equal(validateSyncExchange(input, response()).reason, 'missing_response_id');
});

test('status aceito exige recibo persistido e classificação explícita', () => {
  const output = response();
  output.results[0] = { id: output.results[0].id, status: 'accepted' };
  assert.equal(validateSyncResponse(output), false);
  Object.assign(output.results[0], { receipt_id: '11111111-2222-4333-8444-555555555555', punch_type: 'unclassified' });
  assert.equal(validateSyncResponse(output), true);
});

test('rejeição e retry têm estados distintos de confirmação persistida', () => {
  const output = response();
  output.results[0] = { id: output.results[0].id, status: 'retry', retry_after_seconds: 30 };
  assert.equal(validateSyncResponse(output), true);
  output.results[0].receipt_id = '11111111-2222-4333-8444-555555555555';
  assert.equal(validateSyncResponse(output), false);
});

test('versão desconhecida, contador negativo e UUID inválido são rejeitados', () => {
  const unknownVersion = request();
  unknownVersion.protocol_version = 2;
  assert.equal(validateSyncRequest(unknownVersion), false);
  const negativeClock = request();
  negativeClock.events[0].device_elapsed_ms = -1;
  assert.equal(validateSyncRequest(negativeClock), false);
  const badId = request();
  badId.events[0].id = 'T001';
  assert.equal(validateSyncRequest(badId), false);
});

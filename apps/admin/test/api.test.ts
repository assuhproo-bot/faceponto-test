import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../src/api.js';

test('post without body does not declare a JSON body', async () => {
  const originalFetch = globalThis.fetch;
  let receivedHeaders: Headers | undefined;
  globalThis.fetch = async (_input, init) => {
    receivedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ code: 'pairing' }), { status: 201, headers: { 'content-type': 'application/json' } });
  };

  try {
    await api('/v1/terminals/example/pairing', 'token', { method: 'POST' });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(receivedHeaders?.get('content-type'), null);
  assert.equal(receivedHeaders?.get('authorization'), 'Bearer token');
});

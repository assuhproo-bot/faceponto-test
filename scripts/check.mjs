import { readJson, validateSyncExchange } from '../packages/contracts/index.mjs';

const result = validateSyncExchange(
  readJson('./examples/sync-request.json'),
  readJson('./examples/sync-response.json'),
);
if (!result.valid) throw new Error(JSON.stringify(result));
console.log('Schemas compilados em modo estrito; exemplos de requisição e recibo compatíveis.');
console.log('Validação de contrato apenas; serviços e hardware ainda não implementados.');

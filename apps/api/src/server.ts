import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { startAttendanceWorker } from './attendance-worker.js';

const config = loadConfig();
const app = buildApp(config);
const stopAttendanceWorker = startAttendanceWorker(config);
app.addHook('onClose', async () => { stopAttendanceWorker(); });
await app.listen({ host: config.HOST, port: config.PORT });

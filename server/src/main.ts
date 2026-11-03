import { buildApp } from './app.js';
import { ensureAdmin } from './auth/index.js';
import { config } from './config.js';
import { cancelActiveRuns } from './hivemind.js';
import { moveImagesToHiveMind } from './images.js';
import { startRollTimers } from './game/engine.js';
import { recoverInterrupted, resumeInterrupted } from './game/turn.js';
import { startScheduler } from './jobs.js';
import { logProblem } from './problems.js';
import { recoverSims } from './trainer/sim.js';

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  logProblem('server', err, 'Unhandled rejection');
});

await ensureAdmin();
const interrupted = recoverInterrupted();
recoverSims();
const app = await buildApp();
startScheduler();
startRollTimers();
void moveImagesToHiveMind();

// Clean stop (docker stop, Unraid update): Node as PID 1 ignores SIGTERM unless handled.
const stop = async () => {
  await cancelActiveRuns();
  await app.close().catch(() => {});
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

await app.listen({ port: config.port, host: config.host });
// Give HiveMind a moment, then carry on with the turns the restart cut off.
setTimeout(() => resumeInterrupted(interrupted), 5000).unref();

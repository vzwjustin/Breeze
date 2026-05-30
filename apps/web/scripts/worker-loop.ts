/**
 * Local worker loop — polls runWorkerTick every 30s.
 * Usage: BREEZE_CRON_SECRET=dev pnpm --filter @breeze/web worker
 */
import { runWorkerTick } from "../src/server/worker/run-tick.js";

const INTERVAL_MS = Number(process.env.BREEZE_WORKER_INTERVAL_MS ?? 30_000);

async function tick() {
  const result = await runWorkerTick();
  console.log(`[breeze-worker] ${new Date().toISOString()}`, JSON.stringify(result));
}

console.log(`[breeze-worker] starting (interval ${INTERVAL_MS}ms)`);
await tick();
setInterval(() => {
  tick().catch((err) => console.error("[breeze-worker] tick failed", err));
}, INTERVAL_MS);

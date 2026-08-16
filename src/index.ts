import { app } from './app.js';
import { env } from './config/env.js';
import { startScheduler } from './modules/checker/checker.scheduler.js';

app.listen(env.port, () => {
  console.log(`SitePulse listening on port ${env.port}`);
});

// Not awaited: the API shouldn't wait on the first check cycle to start accepting
// requests. startScheduler() never rejects (see checker.scheduler.ts), but `void` makes
// the "fire and forget, and that's deliberate" explicit rather than looking like an
// oversight.
void startScheduler();

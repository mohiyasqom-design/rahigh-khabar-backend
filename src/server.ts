import app from './app.js';
import { env } from './config/env.js';
import { DatabaseStartupError } from './plugins/prisma.plugin.js';

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => {
    app.log.error('Shutdown timed out');
    process.exit(1);
  }, 10_000);
  deadline.unref();
  try {
    await app.close();
  } catch {
    app.log.error('Shutdown failed; sensitive error details omitted');
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.fatal(
    error instanceof DatabaseStartupError
      ? error.message
      : 'Server startup failed. Check PORT availability and application configuration.',
  );
  process.exitCode = 1;
  await shutdown();
}

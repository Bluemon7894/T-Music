// Starts the Vite dev server, then launches Electron pointed at it.
import { createServer } from 'vite';
import { spawn } from 'child_process';
import electron from 'electron';

const server = await createServer({ configFile: 'vite.config.js' });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`[dev] renderer at ${url}`);

// TMUSIC_DEBUG_PORT=9333 opens Chrome's debugging port, for driving the app from a script while testing.
const debug = process.env.TMUSIC_DEBUG_PORT ? [`--remote-debugging-port=${process.env.TMUSIC_DEBUG_PORT}`] : [];
const child = spawn(electron, [...debug, '.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_URL: url },
});
child.on('close', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

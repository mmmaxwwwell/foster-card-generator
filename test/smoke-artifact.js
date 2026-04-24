const { spawn } = require('child_process');
const path = require('path');

const exe = process.argv[2];
if (!exe) {
  console.error('usage: node test/smoke-artifact.js <path-to-executable> [args...]');
  process.exit(2);
}
const extraArgs = process.argv.slice(3);

const ALIVE_MS = 15000;
const KILL_GRACE_MS = 5000;

const env = { ...process.env };
if (process.platform === 'linux' && !env.DISPLAY) {
  console.error('smoke: no DISPLAY set on linux — run under xvfb-run');
  process.exit(2);
}

console.log(`smoke: launching ${exe} ${extraArgs.join(' ')}`);
const child = spawn(exe, extraArgs, {
  env,
  stdio: ['ignore', 'inherit', 'inherit'],
  detached: false,
});

let exited = false;
let exitCode = null;
let exitSignal = null;
child.on('exit', (code, signal) => {
  exited = true;
  exitCode = code;
  exitSignal = signal;
});
child.on('error', (err) => {
  console.error(`smoke: spawn error: ${err.message}`);
  process.exit(1);
});

setTimeout(() => {
  if (exited) {
    console.error(`smoke: FAIL — process exited before ${ALIVE_MS}ms (code=${exitCode}, signal=${exitSignal})`);
    process.exit(1);
  }
  console.log(`smoke: OK — process still alive after ${ALIVE_MS}ms, terminating`);
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!exited) {
      console.error('smoke: process did not exit on SIGTERM, sending SIGKILL');
      child.kill('SIGKILL');
    }
    process.exit(0);
  }, KILL_GRACE_MS);
}, ALIVE_MS);

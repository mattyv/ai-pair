import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Keep the parent pipe open until failure is reported; EOF intentionally cancels.
const helper = process.argv[2];
assert.ok(helper);
const child = spawn(helper, ['--play'], { stdio: ['pipe', 'pipe', 'ignore'] });
const events = [];
const timer = setTimeout(() => child.kill(), 10_000);
const lines = createInterface({ input: child.stdout });
lines.on('line', (line) => {
  events.push(JSON.parse(line));
  if (events.length === 2) child.stdin.end();
});
child.stdin.write(`${JSON.stringify({ version: 1, sequence: 0, type: 'open', id: 'ai-pair-nonexistent-device-00000000' })}\n`);
const code = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', resolve);
});
clearTimeout(timer);
assert.notEqual(code, 0);
assert.deepEqual(events, [
  { version: 1, sequence: 0, type: 'failed' },
  { version: 1, sequence: 1, type: 'retired' },
]);

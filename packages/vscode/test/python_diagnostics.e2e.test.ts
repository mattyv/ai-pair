// Runs the real parser when python3 is available; source is parsed, never executed.
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { pythonDiagnostic } from '../src/python_diagnostics';

const available = spawnSync('python3', ['-I', '-S', '-c', 'pass'], { timeout: 2000 }).status === 0;

it.skipIf(!available)('reports invalid Python and accepts a syntactically valid tuple', async () => {
  expect(await pythonDiagnostic('def f(:\n')).toMatchObject({ diagnostic: { line: 1, source: 'Python ast' } });
  expect(await pythonDiagnostic('total_balance = 1,\n')).toEqual({});
});

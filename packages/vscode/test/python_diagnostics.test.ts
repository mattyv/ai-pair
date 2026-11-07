import { afterEach, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { pythonDiagnostic } from '../src/python_diagnostics';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

afterEach(() => {
  vi.resetAllMocks();
});

/** Fires the stream's error handler as a prematurely closed pipe would. */
function firePipeError(event: string, listener: () => void): void {
  expect(event).toBe('error');
  listener();
}

it('reports Python syntax errors and sends source on standard input', async () => {
  const end = vi.fn();
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args[3];
    // execFile's successful callback uses null for its error.
    // oxlint-disable-next-line typescript/no-unsafe-call, unicorn/no-null
    if (typeof callback === 'function') callback(null, '{"line":3,"endLine":3,"message":"invalid syntax"}', '');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return { stdin: { end, on: vi.fn() } } as unknown as ReturnType<typeof execFile>;
  });
  expect(await pythonDiagnostic('def f(:\n')).toEqual({
    diagnostic: { line: 3, endLine: 3, message: 'invalid syntax', source: 'Python ast' },
  });
  expect(end).toHaveBeenCalledWith('def f(:\n');
  expect(vi.mocked(execFile).mock.calls[0]?.[1]).toEqual(['-I', '-S', '-c', expect.any(String)]);
});

it('reports unavailable checks without rejecting the edit', async () => {
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args[3];
    // oxlint-disable-next-line typescript/no-unsafe-call
    if (typeof callback === 'function') callback(new Error('missing'), '', '');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return { stdin: { end: vi.fn(), on: vi.fn() } } as unknown as ReturnType<typeof execFile>;
  });
  expect(await pythonDiagnostic('x = 1')).toEqual({ warning: 'Python syntax check unavailable (python3 missing, failed, or timed out).' });
});

it('accepts valid syntax and treats malformed checker output as unavailable', async () => {
  for (const [output, expected] of [
    ['null', {}],
    ['not JSON', { warning: 'Python syntax check unavailable (python3 missing, failed, or timed out).' }],
    ['{"line":0,"endLine":1,"message":"bad"}', { warning: 'Python syntax check unavailable (python3 missing, failed, or timed out).' }],
  ] as const) {
    vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
      const callback = args[3];
      // execFile's successful callback uses null for its error.
      // oxlint-disable-next-line typescript/no-unsafe-call, unicorn/no-null
      if (typeof callback === 'function') callback(null, output, '');
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return { stdin: { end: vi.fn(), on: vi.fn() } } as unknown as ReturnType<typeof execFile>;
    });
    expect(await pythonDiagnostic('x = 1')).toEqual(expected);
  }
});

it('absorbs a broken stdin pipe when the interpreter exits early', async () => {
  vi.mocked(execFile).mockImplementationOnce((...args: unknown[]) => {
    const callback = args[3];
    // oxlint-disable-next-line typescript/no-unsafe-call
    if (typeof callback === 'function') callback(new Error('exited'), '', '');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return { stdin: { end: vi.fn(), on: firePipeError } } as unknown as ReturnType<typeof execFile>;
  });
  expect(await pythonDiagnostic('x = 1')).toEqual({ warning: 'Python syntax check unavailable (python3 missing, failed, or timed out).' });
});

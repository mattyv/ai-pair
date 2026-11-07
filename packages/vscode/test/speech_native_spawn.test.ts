import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mock } from 'vitest-mock-extended';
vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFile: vi.fn() }));
import { NativeOutputDriver } from '../src/speech_native_output';

describe('native process construction', () => {
  it('passes a fixed executable and argument vector without a shell', () => {
    const child = mock<ChildProcess>();
    child.stdin = new PassThrough();
    child.stderr = new PassThrough();
    vi.mocked(spawn).mockReturnValueOnce(child);
    const driver = new NativeOutputDriver();
    const event = vi.fn<(event: 'started' | 'ended' | 'failed') => void>();
    expect(driver.play('safe.sink', new Uint8Array(44), event)).toBe(true);
    const [program, args, options] = vi.mocked(spawn).mock.calls[0] ?? [];
    expect(program).toBe('setpriv');
    expect(args).toEqual(expect.arrayContaining(['--pdeathsig=KILL', '--', 'pw-play', '--target=safe.sink', '-']));
    expect(options).toMatchObject({ stdio: ['pipe', 'ignore', 'pipe'] });
    driver.control('stop');
  });
});

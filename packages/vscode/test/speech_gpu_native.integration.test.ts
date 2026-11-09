import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const root = path.resolve('packages/vscode/native');
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gpu-native-test-'));
  execFileSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', `-I${root}/vulkan/include`, `${root}/gpu_probe.c`, '-ldl', '-o', `${dir}/probe`]);
  execFileSync('cc', ['-std=c11', '-shared', '-fPIC', `-I${root}/vulkan/include`, 'packages/vscode/test/fixtures/fake_vulkan.c', '-o', `${dir}/fake.so`]);
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe.skipIf(process.platform !== 'linux')('native Vulkan device proof', () => {
  it('accepts exactly one physical AMD device through the chosen loader', () => {
    const result = spawnSync(`${dir}/probe`, [`${dir}/fake.so`], { env: { FAKE_GPU: 'amd' }, encoding: 'utf8', timeout: 5000 });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{"result":"physical_amd"}');
  });
  it.each(['none', 'multiple', 'other', 'software', 'virtual', 'unknown', 'create_fail', 'enum_fail', 'incomplete', 'changed', 'missing_symbol'])('rejects %s', (kind) => {
    const result = spawnSync(`${dir}/probe`, [`${dir}/fake.so`], { env: { FAKE_GPU: kind }, encoding: 'utf8', timeout: 5000 });
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe('{"result":"unavailable"}');
  });
  it('accepts a discrete AMD device', () => {
    expect(spawnSync(`${dir}/probe`, [`${dir}/fake.so`], { env: { FAKE_GPU: 'discrete' }, timeout: 5000 }).status).toBe(0);
  });
  it('rejects missing and relative arguments', () => {
    expect(spawnSync(`${dir}/probe`, [], { timeout: 5000 }).status).toBe(1);
    expect(spawnSync(`${dir}/probe`, ['relative.so'], { timeout: 5000 }).status).toBe(1);
  });
  it('rejects a missing loader', () => {
    expect(spawnSync(`${dir}/probe`, [`${dir}/missing.so`], { timeout: 5000 }).status).toBe(1);
  });
});

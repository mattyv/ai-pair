import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const root = path.resolve('packages/vscode/native');
let dir: string;

function probeArgs(): string[] {
  const info = statSync(`${dir}/libvulkan_radeon.so`, { bigint: true });
  return [`${dir}/fake.so`, `${dir}/libvulkan_radeon.so`, info.dev.toString(), info.ino.toString()];
}

describe.skipIf(process.platform !== 'linux')('native Vulkan device proof', () => {
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gpu-native-test-'));
    execFileSync('cc', [
      '-std=c11',
      '-Wall',
      '-Wextra',
      '-Werror',
      `-I${root}/vulkan/include`,
      `${root}/gpu_probe.c`,
      '-ldl',
      '-o',
      `${dir}/probe`,
    ]);
    execFileSync('cc', [
      '-std=c11',
      '-shared',
      '-fPIC',
      `-I${root}/vulkan/include`,
      'packages/vscode/test/fixtures/fake_vulkan.c',
      '-o',
      `${dir}/fake.so`,
    ]);
    copyFileSync(`${dir}/fake.so`, `${dir}/libvulkan_radeon.so`);
    copyFileSync(`${dir}/fake.so`, `${dir}/libvulkan_lvp.so`);
    copyFileSync(`${dir}/fake.so`, `${dir}/renamed-driver.so`);
    for (const name of [
      'vk_icdGetInstanceProcAddr',
      'vk_icdNegotiateLoaderICDInterfaceVersion',
      'vkGetInstanceProcAddr',
      'unrelated_export',
    ]) {
      writeFileSync(`${dir}/${name}.c`, `void ${name}(void) {}`);
      execFileSync('cc', ['-shared', '-fPIC', `${dir}/${name}.c`, '-o', `${dir}/${name}.so`]);
    }
    execFileSync('cc', ['-shared', '-fPIC', '-Wl,--hash-style=sysv', `${dir}/vkGetInstanceProcAddr.c`, '-o', `${dir}/sysv-driver.so`]);
    const forged = readFileSync(`${dir}/vkGetInstanceProcAddr.so`);
    const sectionOffset = Number(forged.readBigUInt64LE(40));
    const sectionCount = forged.readUInt16LE(60);
    for (let i = 0; i < sectionCount; i += 1) {
      const section = sectionOffset + i * 64;
      if (forged.readUInt32LE(section + 4) === 11) forged.writeBigUInt64LE(0n, section + 32);
    }
    writeFileSync(`${dir}/forged-driver.so`, forged);
    const shadow = readFileSync(`${dir}/vkGetInstanceProcAddr.so`);
    const programOffset = Number(shadow.readBigUInt64LE(32));
    const programCount = shadow.readUInt16LE(56);
    for (let i = 0; i < programCount; i += 1) {
      const program = programOffset + i * 56;
      if (shadow.readUInt32LE(program) === 2) shadow.writeBigUInt64LE(0n, program + 8);
    }
    writeFileSync(`${dir}/shadow-driver.so`, shadow);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('accepts exactly one physical AMD device through the chosen loader', () => {
    const result = spawnSync(`${dir}/probe`, probeArgs(), {
      env: { FAKE_GPU: 'amd', FAKE_DRIVER: `${dir}/libvulkan_radeon.so` },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('{"result":"physical_amd"}');
  });
  it.each([
    'none',
    'multiple',
    'other',
    'software',
    'virtual',
    'unknown',
    'create_fail',
    'enum_fail',
    'incomplete',
    'changed',
    'missing_symbol',
    'old_loader',
    'missing_version',
    'version_fail',
  ])('rejects %s', (kind) => {
    const result = spawnSync(`${dir}/probe`, probeArgs(), {
      env: { FAKE_GPU: kind, FAKE_DRIVER: `${dir}/libvulkan_radeon.so` },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe('{"result":"unavailable"}');
  });
  it('accepts a discrete AMD device', () => {
    expect(
      spawnSync(`${dir}/probe`, probeArgs(), { env: { FAKE_GPU: 'discrete', FAKE_DRIVER: `${dir}/libvulkan_radeon.so` }, timeout: 5000 })
        .status,
    ).toBe(0);
  });
  it('rejects missing and relative arguments', () => {
    expect(spawnSync(`${dir}/probe`, [], { timeout: 5000 }).status).toBe(1);
    expect(spawnSync(`${dir}/probe`, ['relative.so'], { timeout: 5000 }).status).toBe(1);
  });
  it('rejects a missing loader', () => {
    expect(spawnSync(`${dir}/probe`, [`${dir}/missing.so`], { timeout: 5000 }).status).toBe(1);
  });

  it('rejects a missing or substituted mapped Radeon driver', () => {
    const args = probeArgs();
    expect(spawnSync(`${dir}/probe`, args, { env: { FAKE_GPU: 'amd' }, timeout: 5000 }).status).toBe(1);
    const replaced = [...args];
    replaced[3] = '1';
    expect(
      spawnSync(`${dir}/probe`, replaced, { env: { FAKE_GPU: 'amd', FAKE_DRIVER: `${dir}/libvulkan_radeon.so` }, timeout: 5000 }).status,
    ).toBe(1);
  });

  it('rejects a renamed additional mapped ICD while the instance is alive', () => {
    const result = spawnSync(`${dir}/probe`, probeArgs(), {
      env: { FAKE_GPU: 'amd', FAKE_DRIVER: `${dir}/libvulkan_radeon.so`, FAKE_EXTRA_DRIVER: `${dir}/renamed-driver.so` },
      timeout: 5000,
    });
    expect(result.status).toBe(1);
  });

  it.each(['vk_icdGetInstanceProcAddr', 'vk_icdNegotiateLoaderICDInterfaceVersion', 'vkGetInstanceProcAddr'])(
    'rejects an additional renamed DSO defining %s',
    (name) => {
      const result = spawnSync(`${dir}/probe`, probeArgs(), {
        env: { FAKE_GPU: 'amd', FAKE_DRIVER: `${dir}/libvulkan_radeon.so`, FAKE_EXTRA_DRIVER: `${dir}/${name}.so` },
        timeout: 5000,
      });
      expect(result.status).toBe(1);
    },
  );

  it('rejects an ICD whose dynamic-symbol section size is forged to zero', () => {
    const result = spawnSync(`${dir}/probe`, probeArgs(), {
      env: { FAKE_GPU: 'amd', FAKE_DRIVER: `${dir}/libvulkan_radeon.so`, FAKE_EXTRA_DRIVER: `${dir}/forged-driver.so` },
      timeout: 5000,
    });
    expect(result.status).toBe(1);
  });

  it('rejects a forged dynamic segment file offset', () => {
    const result = spawnSync(`${dir}/probe`, probeArgs(), {
      env: { FAKE_GPU: 'amd', FAKE_DRIVER: `${dir}/libvulkan_radeon.so`, FAKE_EXTRA_DRIVER: `${dir}/shadow-driver.so` },
      timeout: 5000,
    });
    expect(result.status).toBe(1);
  });

  it('rejects an ICD using the SysV dynamic hash table', () => {
    const result = spawnSync(`${dir}/probe`, probeArgs(), {
      env: { FAKE_GPU: 'amd', FAKE_DRIVER: `${dir}/libvulkan_radeon.so`, FAKE_EXTRA_DRIVER: `${dir}/sysv-driver.so` },
      timeout: 5000,
    });
    expect(result.status).toBe(1);
  });

  it('accepts an unrelated mapped shared library', () => {
    const result = spawnSync(`${dir}/probe`, probeArgs(), {
      env: { FAKE_GPU: 'amd', FAKE_DRIVER: `${dir}/libvulkan_radeon.so`, FAKE_EXTRA_DRIVER: `${dir}/unrelated_export.so` },
      timeout: 5000,
    });
    expect(result.status).toBe(0);
  });

  it('rejects any additional mapped ICD while the instance is alive', () => {
    const result = spawnSync(`${dir}/probe`, probeArgs(), {
      env: { FAKE_GPU: 'amd', FAKE_DRIVER: `${dir}/libvulkan_radeon.so`, FAKE_EXTRA_DRIVER: `${dir}/libvulkan_lvp.so` },
      timeout: 5000,
    });
    expect(result.status).toBe(1);
  });
});

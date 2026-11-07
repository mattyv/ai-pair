import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('local companion package', () => {
  it('runs only in the UI extension host and has no Marketplace dependency', () => {
    const raw: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const manifest = z
      .object({
        extensionKind: z.array(z.string()),
        api: z.string(),
        activationEvents: z.array(z.string()),
        extensionDependencies: z.array(z.string()).optional(),
        main: z.string(),
      })
      .parse(raw);
    expect(manifest.extensionKind).toEqual(['ui']);
    expect(manifest.api).toBe('none');
    expect(manifest.activationEvents).toContain('onCommand:aiPair.localAudio.prepare');
    expect(manifest.extensionDependencies).toBeUndefined();
    expect(manifest.main).toBe('./dist/extension.js');
  });
  it('typechecks the companion build scripts with the repository checks', () => {
    const raw: unknown = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    const root = z.object({ scripts: z.object({ typecheck: z.string() }) }).parse(raw);
    expect(root.scripts.typecheck).toContain('tsc -p packages/audio-ui/scripts');
  });
  it('runs the main controller in the workspace extension host', () => {
    const raw: unknown = JSON.parse(readFileSync(new URL('../../vscode/package.json', import.meta.url), 'utf8'));
    const manifest = z.object({ extensionKind: z.array(z.string()) }).parse(raw);
    expect(manifest.extensionKind).toEqual(['workspace']);
  });
});

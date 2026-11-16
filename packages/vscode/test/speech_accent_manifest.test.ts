import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { SPEECH_ACCENTS } from '@ai-pair/protocol';

it('offers the accents the panel offers, or none, in VS Code settings (#101)', () => {
  const manifest: unknown = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  const setting = z
    .object({
      contributes: z.object({
        configuration: z.object({
          properties: z.object({ 'aiPair.speech.openRouterAccent': z.object({ enum: z.array(z.string()), default: z.string() }) }),
        }),
      }),
    })
    .parse(manifest).contributes.configuration.properties['aiPair.speech.openRouterAccent'];
  expect(setting).toEqual({ enum: ['', ...SPEECH_ACCENTS], default: '' });
});

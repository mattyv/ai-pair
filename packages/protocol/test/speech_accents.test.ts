// The accent setting's schema (#101). Solitary: speech_accents.ts is a constant and a zod schema.

import { expect, it } from 'vitest';
import { SPEECH_ACCENTS, speechAccent } from '../src/speech_accents';

it('accepts each offered accent, or none, and nothing else (#101)', () => {
  for (const accent of ['', ...SPEECH_ACCENTS]) {
    expect(speechAccent.parse(accent)).toBe(accent);
  }
  for (const accent of ['australian', 'Klingon', '[Australian accent]', 3]) {
    expect(speechAccent.safeParse(accent).success).toBe(false);
  }
});

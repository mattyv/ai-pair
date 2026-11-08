// The actual shipped guide is embedded by the relay and sent to the agent on start.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { agentGuide } from '../src/server';

it('guides each session to select bounded, safe spoken narration while respecting user settings', () => {
  const guide = agentGuide(readFileSync('AGENT_GUIDE.md', 'utf8'));
  const narration = guide.split('## Narration')[1]?.split('\n## ')[0];
  expect(narration).toBeDefined();
  expect(narration).toContain('one useful `say` in each batch');
  expect(narration).toContain('`speak: true`');
  expect(narration).toContain('280 Unicode characters');
  expect(narration).toContain('45 words');
  expect(narration).toContain('one spoken `say` per batch');
  expect(narration).toContain('speech is disabled');
  expect(narration).toContain('secrets');
  expect(narration).toContain('cloud');
});

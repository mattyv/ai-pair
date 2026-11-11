// The actual shipped guide is embedded by the relay and sent to the agent on start.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { agentGuide } from '../src/server';

it('guides each session to speak every bounded say, keep secrets silent, and respect user settings', () => {
  const guide = agentGuide(readFileSync('AGENT_GUIDE.md', 'utf8'));
  const narration = guide.split('## Narration')[1]?.split('\n## ')[0];
  expect(narration).toBeDefined();
  expect(narration).toContain('Every `say` is spoken');
  expect(narration).toContain('`speak: false`');
  expect(narration).toContain('280 Unicode characters');
  expect(narration).toContain('45 words');
  expect(narration).toContain('speech is disabled');
  expect(narration).toContain('a secret');
  expect(narration).toContain('cloud');
});

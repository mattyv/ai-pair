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

it('explains when narration overlaps work and when a question needs an answer', () => {
  const guide = agentGuide(readFileSync('AGENT_GUIDE.md', 'utf8'));
  const narration = guide.split('## Narration')[1]?.split('\n## ')[0];
  expect(narration).toMatch(/`speech_mode: "continue"`[\s\S]*explanatory\s+commentary[\s\S]*same batch/);
  expect(narration).toMatch(/`speech_mode: "wait"`[\s\S]*questions[\s\S]*choices[\s\S]*instructions/);
  expect(narration).toMatch(/`listen`[\s\S]*audio completion is not a response/);
  expect(narration).toContain('`speak: true`');
});

it('delivers teaching guidance grounded in verified shared history and bounded narration', () => {
  const guide = agentGuide(readFileSync('AGENT_GUIDE.md', 'utf8'));
  expect(guide).toMatch(/conversation or verified\s+session history supports that claim/);
  expect(guide).toMatch(/Do not assume the programmer heard canceled speech/);
  expect(guide).toMatch(/do not require quizzes, exercises, or an answer before continuing/);
  expect(guide).toMatch(/Keep the normal speech\s+limits/);
});

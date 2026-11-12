// Checks the shipped demo instructions as an agent reads them.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('demonstrates overlapping narration and a gated question without changing speech settings', () => {
  const skill = readFileSync('packages/vscode/skills/ai-pair-demo/SKILL.md', 'utf8');
  expect(skill).toMatch(/speech_mode: "continue"[\s\S]*meaningful[\s\S]*`type`[\s\S]*same batch/);
  expect(skill).toMatch(/speech_mode: "wait"[\s\S]*`listen`[\s\S]*do not continue until[\s\S]*repl/i);
  expect(skill).toMatch(/never\s+enable speech/i);
  expect(skill).toMatch(/cannot establish[\s\S]*audible/i);
  expect(skill).toMatch(/Never end a\s+session you did not create/);
});

// The canonical skills are shipped as physical files and embedded by the relay.
import * as fs from 'node:fs';
import demo from '../../vscode/skills/ai-pair-demo/SKILL.md?raw';
import diagnose from '../../vscode/skills/ai-pair-diagnose/SKILL.md?raw';
import { expect, it } from 'vitest';

it('ships the canonical demo and diagnose skills in the VSIX and relay', () => {
  const ignore = fs.readFileSync('packages/vscode/.vscodeignore', 'utf8');
  const server = fs.readFileSync('packages/relay/src/server.ts', 'utf8');
  for (const [name, embedded] of [
    ['demo', demo],
    ['diagnose', diagnose],
  ] as const) {
    const canonical = fs.readFileSync(`packages/vscode/skills/ai-pair-${name}/SKILL.md`, 'utf8');
    expect(canonical).toMatch(new RegExp(`name: ai-pair-${name}`));
    expect(canonical).toContain('description:');
    expect(embedded).toBe(canonical);
    expect(ignore).toContain(`!skills/ai-pair-${name}/SKILL.md`);
    expect(server).toContain(`../../vscode/skills/ai-pair-${name}/SKILL.md?raw`);
  }
});

it('checks session ownership before demonstrating and ends only its own session', () => {
  expect(demo).toContain('Call `diagnostics` first');
  expect(demo).toContain('active or suspended');
  expect(demo).toContain('do not append to or drain');
  expect(demo).toMatch(/end the\s+session you created/);
  expect(demo).toContain('If the programmer has taken over');
});

it('guides a real programmer edit and navigator comment without taking the turn', () => {
  expect(demo).toContain('**My turn**');
  expect(demo).toContain('small, safe edit');
  expect(demo).toContain('dependency-free code');
  expect(demo).toContain('change a value');
  expect(demo).toContain('`point`');
  expect(demo).toContain('skip or defer');
  expect(demo).toContain('call `listen`');
  expect(demo).toContain('report confirms');
  expect(demo).toMatch(/useful\s+written `say`/);
  expect(demo).toContain('Do not invent');
  expect(demo).toContain('do not ask them to hand back');
  expect(demo).toContain('permission to end');
});

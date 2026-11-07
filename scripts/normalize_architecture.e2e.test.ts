import { describe, expect, it } from 'vitest';
import { normalizeArchitecture } from './normalize_architecture';

describe('architecture export normalization', () => {
  it('formats JSON while preserving its Unicode values', async () => {
    const input = '{"label":"Hello \u2014 \u{1F30D}"}';
    const output = await normalizeArchitecture(input, 'json');
    expect(output).toMatch(/\\u2014/);
    expect(output).toMatch(/\\ud83c\\udf0d/);
    expect(JSON.parse(output)).toEqual(JSON.parse(input));
    expect(await normalizeArchitecture(output, 'json')).toBe(output);
  });

  it('keeps a closing style tag inside a script string in JavaScript context', async () => {
    const output = await normalizeArchitecture('<script>const closing = "</style>"; const name = "\u00E9";</script>', 'html');
    expect(output).toContain('\\u00e9');
    expect(output).not.toContain('&#xe9;');
  });

  it('escapes markup, CSS and JavaScript according to their contexts', async () => {
    const input =
      '<p title="Caf\u00E9">Hello \u2014 \u{1F30D}</p><style>.x::before { content: "\u2713"; }</style><script>globalThis.label = "Caf\u00E9 \u{1F30D}";</script>';
    const output = await normalizeArchitecture(input, 'html');
    expect(output).toContain('Caf&#xe9;');
    expect(output).toContain('&#x2014;');
    expect(output).toContain('&#x1f30d;');
    expect(output).toContain('\\2713 ');
    expect(output).toContain('Caf\\u00e9 \\ud83c\\udf0d');
    expect(output).not.toMatch(/[\u0080-\u{10FFFF}]/u);
    expect(await normalizeArchitecture(output, 'html')).toBe(output);
  });
});

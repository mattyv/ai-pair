import { expect, it, vi } from 'vitest';
import { format } from 'prettier';
import { normalizeArchitecture } from './normalize_architecture';

vi.mock('prettier', () => ({ format: vi.fn((input: string) => Promise.resolve(input)) }));

it('escapes JSON values as UTF-16 without changing their meaning', async () => {
  const input = '{"label":"\u2014 \u{1F30D}"}';
  const output = await normalizeArchitecture(input, 'json');
  expect(output).toBe('{"label":"\\u2014 \\ud83c\\udf0d"}');
  expect(JSON.parse(output)).toEqual(JSON.parse(input));
  expect(format).toHaveBeenCalledWith(input, { parser: 'json', semi: false, printWidth: 140 });
});

it('escapes markup, scripts and styles without mixing their syntaxes', async () => {
  const input = '<p>\u00E9</p><style>.x {content:"\u2713"}</style><script>"\u{1F30D}"</script>';
  const output = await normalizeArchitecture(input, 'html');
  expect(output).toBe('<p>&#xe9;</p><style>.x {content:"\\2713 "}</style><script>"\\ud83c\\udf0d"</script>');
  expect(format).toHaveBeenLastCalledWith(output, { parser: 'html', semi: false, printWidth: 140 });
});

import { format } from 'prettier';

const HEX_RADIX = 16;
const UTF16_HEX_WIDTH = 4;

/** Escapes non-ASCII UTF-16 code units for JSON and JavaScript. */
function javascriptEscape(value: string): string {
  // Each regex match is one UTF-16 unit, including either half of a surrogate pair.
  return value.replaceAll(
    /[\u0080-\uFFFF]/g,
    (unit) => `\\u${Number(unit.codePointAt(0)).toString(HEX_RADIX).padStart(UTF16_HEX_WIDTH, '0')}`,
  );
}

/** Formats an Archi bundle or generated HTML and preserves Unicode as escapes. */
export async function normalizeArchitecture(input: string, kind: 'json' | 'html'): Promise<string> {
  const formatted = await format(input, { parser: kind, semi: false, printWidth: 140 });
  if (kind === 'json') return javascriptEscape(formatted);
  const sections = formatted.split(/(<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>)/gi);
  const escaped = sections
    .map((section) => {
      if (/^<script\b/i.test(section)) return javascriptEscape(section);
      if (/^<style\b/i.test(section)) {
        return section.replaceAll(/[\u0080-\u{10FFFF}]/gu, (character) => `\\${character.codePointAt(0)?.toString(HEX_RADIX)} `);
      }
      return section.replaceAll(/[\u0080-\u{10FFFF}]/gu, (character) => `&#x${character.codePointAt(0)?.toString(HEX_RADIX)};`);
    })
    .join('');
  return format(escaped, { parser: kind, semi: false, printWidth: 140 });
}

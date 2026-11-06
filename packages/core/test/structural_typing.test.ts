import { describe, expect, it } from 'vitest';
import { structuralNewline } from '../src/structural_typing';

/** Places the cursor at the marker without passing the marker to production. */
function expand(file: string, marked: string, indent = '    ') {
  const offset = marked.indexOf('|');
  return structuralNewline(file, marked.replace('|', ''), offset, indent);
}

describe('structural newline', () => {
  it('splits a Python or JSON pair, retaining the enclosing indentation', () => {
    expect(expand('a.py', '  x = {|}')).toEqual({ before: '\n      ', after: '\n  ' });
    expect(expand('a.json', '{|}', '  ')).toEqual({ before: '\n  ', after: '\n' });
    expect(expand('a.py', 'x = [|]', '\t')).toEqual({ before: '\n\t', after: '\n' });
  });

  it.each([
    ['a.py', '# {|}'],
    ['a.py', '"{|}"'],
    ['a.py', "r'{|}'"],
    ['a.py', 'f"value {|}"'],
    ['a.py', '"""\n{|}\n"""'],
    ['a.py', "'escaped \\\' {|}'"],
    ['a.json', '"{|}"'],
    ['a.json', '"escaped \\" {|}"'],
    ['a.py', 'x = { |}'],
    ['a.py', 'x = {|]'],
    ['a.ts', 'x = {|}'],
  ])('rejects unsafe or unsupported context in %s: %s', (file, text) => {
    expect(expand(file, text)).toBeUndefined();
  });

  it('accepts code after comments and closed strings, including escaped backslashes', () => {
    expect(expand('a.py', '# comment\nx = {|}')).toBeDefined();
    expect(expand('a.json', '"a\\\\" {|}')).toBeDefined();
    expect(expand('a.py', `f'{name}'\nx = {|}`)).toBeDefined();
    expect(expand('a.py', `f'{{literal}} {value:{width}}'\nx = {|}`)).toBeDefined();
  });

  it('rejects non-whitespace indent and cursor offsets outside the text', () => {
    expect(expand('a.py', 'x = {|}', 'abc')).toBeUndefined();
    expect(structuralNewline('a.py', '{}', -1, '  ')).toBeUndefined();
    expect(structuralNewline('a.py', '{}', 3, '  ')).toBeUndefined();
  });

  it('recognizes each adjacent pair after closed strings', () => {
    expect(expand('a.py', "'done' (|)")).toEqual({ before: '\n    ', after: '\n' });
    expect(expand('a.py', "'''done''' [|]")).toBeDefined();
    expect(expand('a.json', '"done" {|}')).toBeDefined();
  });

  it.each([
    ['a.py', "'''unterminated {|}"],
    ['a.py', 'f"{call({|})}"'],
    ['a.py', 'f"{call("x", {|})}"'],
    ['a.py', `f'bad }'\nx = {|}`],
    ['a.py', `f'bad \\}'\nx = {|}`],
    ['a.py', `f'{value # comment\n}'\nx = {|}`],
    ['a.py', `f'{value\\n}'\nx = {|}`],
    ['a.py', '# comment {|}\n'],
    ['a.json', '"odd backslash \\\" {|}'],
  ])('keeps ambiguous text opaque in %s: %s', (file, text) => {
    expect(expand(file, text)).toBeUndefined();
  });

  it('keeps scanning a triple string past isolated quote characters', () => {
    expect(expand('a.py', `'''one ' two {|} three'''`)).toBeUndefined();
    expect(expand('a.py', `f'''{name}'''\nx = {|}`)).toBeDefined();
  });

  it.each([
    `t"{call("{|}")}"`,
    `tr"{call("{|}")}"`,
    `rt"{call("{|}")}"`,
    `f"\\{call("{|}")}"`,
    `rf"\\{call("{|}")}"`,
    `f"""\\{call("{|}")}"""`,
  ])('rejects pairs inside formatted string expressions: %s', (text) => {
    expect(expand('a.py', text)).toBeUndefined();
  });

  it('rejects empty or multiline indentation and non-integer offsets', () => {
    expect(expand('a.py', '{|}', '')).toBeUndefined();
    expect(expand('a.py', '{|}', ' \n')).toBeUndefined();
    expect(structuralNewline('a.py', '{}', 0.5, '  ')).toBeUndefined();
  });
});

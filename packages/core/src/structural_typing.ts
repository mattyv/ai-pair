const TRIPLE_QUOTE_LENGTH = 3;
const MAX_FIELD_DEPTH = 64;

/** Returns whether the cursor is outside strings and comments. */
function isCode(text: string, offset: number, python: boolean): boolean {
  let quote = '';
  let triple = false;
  let formatted = false;
  let fieldStack: string[] = [];
  let fieldQuote = '';
  let fieldTriple = false;
  let comment = false;
  for (let index = 0; index < offset; index++) {
    const character = text[index];
    if (comment) {
      if (character === '\n') {
        comment = false;
      }
      continue;
    }
    if (quote) {
      if (formatted && fieldStack.length > 0) {
        // specs/StructuralTyping.tla, ClosedFieldRecovers: scan a quoted
        // literal inside a field, without treating its braces as delimiters.
        if (fieldQuote !== '') {
          if (character === '\\') {
            index++;
          } else if (character === '\n' && !fieldTriple) {
            return false;
          } else if (character === fieldQuote) {
            if (!fieldTriple) {
              fieldQuote = '';
            } else if (text.slice(index, index + TRIPLE_QUOTE_LENGTH) === fieldQuote.repeat(TRIPLE_QUOTE_LENGTH)) {
              fieldQuote = '';
              fieldTriple = false;
              index += TRIPLE_QUOTE_LENGTH - 1;
            }
          }
          continue;
        }
        if (character === '"' || character === "'") {
          // A nested formatted string needs another lexical stack. Refuse it
          // instead of guessing where its own replacement fields end.
          if (/(?:^|[^a-zA-Z0-9_])(?:[ft]|[ft]r|r[ft])$/i.test(text.slice(0, index))) return false;
          fieldQuote = character;
          fieldTriple = text.slice(index, index + TRIPLE_QUOTE_LENGTH) === character.repeat(TRIPLE_QUOTE_LENGTH);
          if (fieldTriple) index += TRIPLE_QUOTE_LENGTH - 1;
        } else if (character === '#' || character === '\\') {
          return false;
        } else if (character === '{' || character === '[' || character === '(') {
          if (fieldStack.length >= MAX_FIELD_DEPTH) return false;
          fieldStack.push(character);
        } else if (character === '}' || character === ']' || character === ')') {
          const opening = fieldStack.pop();
          if ((character === '}' && opening !== '{') || (character === ']' && opening !== '[') || (character === ')' && opening !== '(')) {
            return false;
          }
        }
        continue;
      }
      if (formatted && (character === '{' || character === '}')) {
        if (text[index + 1] === character) {
          index++;
        } else if (character === '{') {
          fieldStack = ['{'];
        } else {
          return false;
        }
        continue;
      }
      if (character === '\\') {
        // Braces still start or end a replacement field after a backslash.
        if (!formatted || (text[index + 1] !== '{' && text[index + 1] !== '}')) {
          index++;
        }
      } else if (character === quote) {
        if (!triple) {
          quote = '';
          formatted = false;
        } else if (text.slice(index, index + TRIPLE_QUOTE_LENGTH) === quote.repeat(TRIPLE_QUOTE_LENGTH)) {
          quote = '';
          triple = false;
          formatted = false;
          index += TRIPLE_QUOTE_LENGTH - 1;
        }
      }
      continue;
    }
    if (python && character === '#') {
      comment = true;
    } else if (character === '"' || (python && character === "'")) {
      formatted = python && /(?:^|[^a-zA-Z0-9_])(?:[ft]|[ft]r|r[ft])$/i.test(text.slice(0, index));
      quote = character;
      triple = python && text.slice(index, index + TRIPLE_QUOTE_LENGTH) === character.repeat(TRIPLE_QUOTE_LENGTH);
      if (triple) {
        index += TRIPLE_QUOTE_LENGTH - 1;
      }
    }
  }
  return !quote && !comment;
}

/** Splits an adjacent pair when its lexical context is safe. */
export function structuralNewline(
  file: string,
  text: string,
  offset: number,
  indent: string,
): { before: string; after: string } | undefined {
  const python = file.endsWith('.py');
  if (
    (!python && !file.endsWith('.json')) ||
    !Number.isInteger(offset) ||
    offset < 1 ||
    offset >= text.length ||
    !/^[ \t]+$/.test(indent)
  ) {
    return undefined;
  }
  const pair = text.slice(offset - 1, offset + 1);
  if (!['()', '[]', '{}'].includes(pair) || !isCode(text, offset, python)) {
    return undefined;
  }
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const base = text.slice(lineStart, offset).replace(/^([ \t]*).*$/s, '$1');
  return { before: `\n${base}${indent}`, after: `\n${base}` };
}

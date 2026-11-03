import { NecroTalkError, formatError } from './errors.js';

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

export type TokenType =
  | 'keyword'
  | 'identifier'
  | 'number'
  | 'string'
  | 'operator'
  | 'punctuation'
  | 'newline'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

// ---------------------------------------------------------------------------
// Keyword set (all lowercase)
// ---------------------------------------------------------------------------

export const KEYWORDS = new Set([
  'on', 'end', 'if', 'then', 'else', 'repeat', 'exit', 'pass',
  'go', 'to', 'card', 'next', 'prev', 'first', 'last',
  'put', 'into', 'before', 'after', 'get', 'set', 'of',
  'global', 'answer', 'with', 'or', 'ask', 'show', 'hide', 'beep',
  'visual', 'effect', 'dissolve', 'wipe', 'left', 'right', 'scroll', 'up',
  'and', 'not', 'is', 'contains',
  'the', 'times', 'while', 'mod',
  'true', 'false',
  // object type keywords used in ObjectRef
  'button', 'field', 'image', 'background', 'stack', 'me',
  // number-of keywords
  'number', 'words', 'lines', 'chars', 'cards',
  // chunk and container keywords
  'word', 'line', 'char', 'it',
]);

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize a NecroTalk source string.
 * Returns a flat array of tokens ending with an 'eof' token.
 * Comments (-- to end of line) are stripped.
 * Throws NecroTalkError for invalid input (unterminated strings, bad chars).
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let lineStart = 0;

  function col(): number {
    return pos - lineStart + 1;
  }

  function makeToken(type: TokenType, value: string, tokenLine: number, tokenCol: number): Token {
    return { type, value, line: tokenLine, column: tokenCol };
  }

  while (pos < source.length) {
    const startLine = line;
    const startCol = col();
    const ch = source[pos];

    // Skip spaces and tabs (not newlines)
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      pos++;
      continue;
    }

    // Newline
    if (ch === '\n') {
      tokens.push(makeToken('newline', '\n', startLine, startCol));
      pos++;
      line++;
      lineStart = pos;
      continue;
    }

    // Comment: -- to end of line
    if (ch === '-' && source[pos + 1] === '-') {
      while (pos < source.length && source[pos] !== '\n') pos++;
      continue;
    }

    // String literal: "..."
    if (ch === '"') {
      pos++; // skip opening quote
      let str = '';
      let closed = false;
      while (pos < source.length) {
        const c = source[pos];
        if (c === '\n' || c === '\r') break; // strings cannot span lines
        pos++;
        if (c === '"') { closed = true; break; }
        str += c;
      }
      if (!closed) {
        throw new NecroTalkError(
          formatError(startLine, startCol, 'Unterminated string literal'),
          startLine, startCol,
        );
      }
      tokens.push(makeToken('string', str, startLine, startCol));
      continue;
    }

    // Numbers: digits optionally followed by . digits
    if (ch >= '0' && ch <= '9') {
      let num = '';
      while (pos < source.length && source[pos] >= '0' && source[pos] <= '9') {
        num += source[pos++];
      }
      if (pos < source.length && source[pos] === '.') {
        const dotPos = pos;
        num += source[pos++];
        if (pos >= source.length || source[pos] < '0' || source[pos] > '9') {
          // Not a decimal — back up and emit without dot
          pos = dotPos;
          num = num.slice(0, -1);
        } else {
          while (pos < source.length && source[pos] >= '0' && source[pos] <= '9') {
            num += source[pos++];
          }
        }
      }
      tokens.push(makeToken('number', num, startLine, startCol));
      continue;
    }

    // Two-char operators: <=, >=, <>, &&
    if (pos + 1 < source.length) {
      const two = source.slice(pos, pos + 2);
      if (two === '<=' || two === '>=' || two === '<>') {
        tokens.push(makeToken('operator', two, startLine, startCol));
        pos += 2;
        continue;
      }
      if (two === '&&') {
        tokens.push(makeToken('operator', '&&', startLine, startCol));
        pos += 2;
        continue;
      }
    }

    // Single-char operators
    if (ch === '<' || ch === '>' || ch === '=' ||
        ch === '+' || ch === '-' || ch === '*' ||
        ch === '/' || ch === '^' || ch === '&') {
      tokens.push(makeToken('operator', ch, startLine, startCol));
      pos++;
      continue;
    }

    // Punctuation
    if (ch === '(' || ch === ')' || ch === ',') {
      tokens.push(makeToken('punctuation', ch, startLine, startCol));
      pos++;
      continue;
    }

    // Identifiers and keywords
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_') {
      let ident = '';
      while (pos < source.length) {
        const c = source[pos];
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9') || c === '_') {
          ident += c;
          pos++;
        } else {
          break;
        }
      }
      const lower = ident.toLowerCase();
      if (KEYWORDS.has(lower)) {
        tokens.push(makeToken('keyword', lower, startLine, startCol));
      } else {
        tokens.push(makeToken('identifier', ident, startLine, startCol));
      }
      continue;
    }

    // Unknown character
    throw new NecroTalkError(
      formatError(startLine, startCol, `Unexpected character "${ch}"`),
      startLine, startCol,
    );
  }

  tokens.push(makeToken('eof', '', line, col()));
  return tokens;
}

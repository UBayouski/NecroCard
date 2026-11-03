import { tokenize } from './tokenizer.js';
import type { Token, TokenType } from './tokenizer.js';
import { NecroTalkError, formatError } from './errors.js';
import type {
  ScriptNode, HandlerNode, StatementNode, ExpressionNode,
  GoStatement, GoTarget, VisualEffectStatement,
  PutStatement, GetStatement, SetStatement, GlobalStatement,
  AnswerStatement, AskStatement, ShowStatement, HideStatement, BeepStatement,
  IfStatement, RepeatStatement, RepeatVariant,
  ExitStatement, NextRepeatStatement, PassStatement,
  LiteralExpression, VariableExpression, BinaryExpression, BinaryOp,
  UnaryExpression, FunctionCallExpression, PropertyExpression,
  ChunkExpression, CountExpression,
  ObjectRef, ContainerNode,
} from './ast.js';

// ---------------------------------------------------------------------------
// Operator precedence (higher number = tighter binding)
// ---------------------------------------------------------------------------
const PREC: Record<string, number> = {
  'or': 1,
  'and': 2,
  '=': 4, '<>': 4, '<': 4, '>': 4, '<=': 4, '>=': 4,
  'is': 4, 'is not': 4, 'contains': 4,
  '&': 5, '&&': 5,
  '+': 6, '-': 6,
  '*': 7, '/': 7, 'mod': 7,
  '^': 8,
};
const RIGHT_ASSOC = new Set(['^']);

function precedenceOf(op: string): number {
  return PREC[op] ?? 0;
}

// ---------------------------------------------------------------------------
// Parser class
// ---------------------------------------------------------------------------
class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private get current(): Token { return this.tokens[this.pos]; }
  private peek(offset = 1): Token { return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]; }

  private advance(): Token {
    const t = this.tokens[this.pos];
    if (t.type !== 'eof') this.pos++;
    return t;
  }

  private isKeyword(value: string, tok = this.current): boolean {
    return tok.type === 'keyword' && tok.value === value;
  }

  private matchKeyword(value: string): boolean {
    if (this.isKeyword(value)) { this.advance(); return true; }
    return false;
  }

  private expectKeyword(value: string): Token {
    if (!this.isKeyword(value)) {
      const cur = this.current;
      throw new NecroTalkError(
        formatError(cur.line, cur.column, `Expected "${value}" but found "${cur.value}"`),
        cur.line, cur.column,
      );
    }
    return this.advance();
  }

  private expectType(type: TokenType): Token {
    if (this.current.type !== type) {
      const cur = this.current;
      throw new NecroTalkError(
        formatError(cur.line, cur.column, `Expected ${type} but found "${cur.value}"`),
        cur.line, cur.column,
      );
    }
    return this.advance();
  }

  private skipNewlines(): void {
    while (this.current.type === 'newline') this.advance();
  }

  private expectNewlineOrEof(): void {
    if (this.current.type === 'newline' || this.current.type === 'eof') {
      this.skipNewlines();
    } else {
      const cur = this.current;
      throw new NecroTalkError(
        formatError(cur.line, cur.column, `Expected end of line but found "${cur.value}"`),
        cur.line, cur.column,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Script
  // ---------------------------------------------------------------------------
  parseScript(): ScriptNode {
    this.skipNewlines();
    const handlers: HandlerNode[] = [];
    while (this.current.type !== 'eof') {
      if (this.isKeyword('on')) {
        handlers.push(this.parseHandler());
      } else {
        const cur = this.current;
        throw new NecroTalkError(
          formatError(cur.line, cur.column, `Expected "on" to begin a handler but found "${cur.value}"`),
          cur.line, cur.column,
        );
      }
      this.skipNewlines();
    }
    return { kind: 'script', handlers };
  }

  // ---------------------------------------------------------------------------
  // Handler
  // ---------------------------------------------------------------------------
  parseHandler(): HandlerNode {
    this.expectKeyword('on');
    const nameTok = this.current;
    if (nameTok.type !== 'identifier' && nameTok.type !== 'keyword') {
      throw new NecroTalkError(
        formatError(nameTok.line, nameTok.column, `Expected handler name but found "${nameTok.value}"`),
        nameTok.line, nameTok.column,
      );
    }
    const name = nameTok.value.toLowerCase();
    this.advance();

    // Optional parameters (comma-separated identifiers on same line)
    const params: string[] = [];
    while (this.current.type !== 'newline' && this.current.type !== 'eof') {
      if (this.current.type === 'punctuation' && this.current.value === ',') {
        this.advance();
        continue;
      }
      if (this.current.type === 'identifier' || this.current.type === 'keyword') {
        params.push(this.current.value.toLowerCase());
        this.advance();
      } else {
        break;
      }
    }
    this.expectNewlineOrEof();

    const body = this.parseStatementList('handler');

    this.expectKeyword('end');
    const endNameTok = this.current;
    const endName = (endNameTok.type === 'identifier' || endNameTok.type === 'keyword')
      ? endNameTok.value.toLowerCase() : '';
    if (endName !== name) {
      throw new NecroTalkError(
        formatError(endNameTok.line, endNameTok.column,
          `Expected "end ${name}" but found "end ${endNameTok.value}"`),
        endNameTok.line, endNameTok.column,
      );
    }
    this.advance();
    this.skipNewlines();

    return { kind: 'handler', name, params, body };
  }

  // ---------------------------------------------------------------------------
  // Statement list (until end keyword or else/end if/end repeat)
  // ---------------------------------------------------------------------------
  parseStatementList(context: 'handler' | 'if' | 'repeat' | 'else'): StatementNode[] {
    const stmts: StatementNode[] = [];
    while (true) {
      this.skipNewlines();
      const cur = this.current;
      if (cur.type === 'eof') {
        if (context !== 'handler') {
          throw new NecroTalkError(
            formatError(cur.line, cur.column, `Unexpected end of file inside "${context}"`),
            cur.line, cur.column,
          );
        }
        break;
      }
      // Stop conditions
      if (context === 'handler' && this.isKeyword('end')) break;
      if (context === 'if' && (this.isKeyword('end') || this.isKeyword('else'))) break;
      if (context === 'else' && this.isKeyword('end')) break;
      if (context === 'repeat' && this.isKeyword('end')) break;
      stmts.push(this.parseStatement());
    }
    return stmts;
  }

  // ---------------------------------------------------------------------------
  // Single statement dispatch
  // ---------------------------------------------------------------------------
  parseStatement(): StatementNode {
    const cur = this.current;
    const line = cur.line;

    if (cur.type === 'keyword') {
      switch (cur.value) {
        case 'go': return this.parseGo();
        case 'visual': return this.parseVisualEffect();
        case 'put': return this.parsePut();
        case 'get': return this.parseGet();
        case 'set': return this.parseSet();
        case 'global': return this.parseGlobal();
        case 'answer': return this.parseAnswer();
        case 'ask': return this.parseAsk();
        case 'show': return this.parseShow();
        case 'hide': return this.parseHide();
        case 'beep': {
          this.advance();
          this.expectNewlineOrEof();
          return { kind: 'beep', line } satisfies BeepStatement;
        }
        case 'if': return this.parseIf();
        case 'repeat': return this.parseRepeat();
        case 'exit': return this.parseExit();
        case 'next': {
          this.advance();
          this.expectKeyword('repeat');
          this.expectNewlineOrEof();
          return { kind: 'nextRepeat', line } satisfies NextRepeatStatement;
        }
        case 'pass': {
          this.advance();
          const nameTok = this.current;
          const handlerName = (nameTok.type === 'identifier' || nameTok.type === 'keyword')
            ? nameTok.value.toLowerCase() : '';
          if (!handlerName) {
            throw new NecroTalkError(
              formatError(nameTok.line, nameTok.column, `Expected handler name after "pass"`),
              nameTok.line, nameTok.column,
            );
          }
          this.advance();
          this.expectNewlineOrEof();
          return { kind: 'pass', handlerName, line } satisfies PassStatement;
        }
      }
    }

    // Unknown
    throw new NecroTalkError(
      formatError(cur.line, cur.column, `Unknown command "${cur.value}"`),
      cur.line, cur.column,
    );
  }

  // ---------------------------------------------------------------------------
  // go statement
  // ---------------------------------------------------------------------------
  parseGo(): GoStatement {
    const line = this.current.line;
    this.expectKeyword('go');

    // go next / go prev / go first / go last
    for (const dir of ['next', 'prev', 'first', 'last'] as const) {
      if (this.matchKeyword(dir)) {
        this.expectNewlineOrEof();
        return { kind: 'go', target: { type: dir }, line };
      }
    }

    // go to card N / go to card "Name"
    this.expectKeyword('to');
    this.expectKeyword('card');

    const valTok = this.current;
    let target: GoTarget;
    if (valTok.type === 'number') {
      target = { type: 'card', value: Number(valTok.value) };
      this.advance();
    } else if (valTok.type === 'string') {
      target = { type: 'card', value: valTok.value };
      this.advance();
    } else {
      throw new NecroTalkError(
        formatError(valTok.line, valTok.column, `Expected card number or name after "go to card"`),
        valTok.line, valTok.column,
      );
    }
    this.expectNewlineOrEof();
    return { kind: 'go', target, line };
  }

  // ---------------------------------------------------------------------------
  // visual effect
  // ---------------------------------------------------------------------------
  parseVisualEffect(): VisualEffectStatement {
    const line = this.current.line;
    this.expectKeyword('visual');
    this.expectKeyword('effect');
    const tok = this.current;

    if (this.matchKeyword('dissolve')) {
      this.expectNewlineOrEof();
      return { kind: 'visualEffect', effect: 'dissolve', line };
    }
    if (this.matchKeyword('scroll')) {
      this.expectKeyword('up');
      this.expectNewlineOrEof();
      return { kind: 'visualEffect', effect: 'scroll up', line };
    }
    if (this.matchKeyword('wipe')) {
      if (this.matchKeyword('left')) {
        this.expectNewlineOrEof();
        return { kind: 'visualEffect', effect: 'wipe left', line };
      }
      if (this.matchKeyword('right')) {
        this.expectNewlineOrEof();
        return { kind: 'visualEffect', effect: 'wipe right', line };
      }
    }
    throw new NecroTalkError(
      formatError(tok.line, tok.column, `Unknown visual effect "${tok.value}"`),
      tok.line, tok.column,
    );
  }

  // ---------------------------------------------------------------------------
  // put
  // ---------------------------------------------------------------------------
  parsePut(): PutStatement {
    const line = this.current.line;
    this.expectKeyword('put');
    const value = this.parseExpression();

    let mode: 'into' | 'before' | 'after';
    if (this.matchKeyword('into')) mode = 'into';
    else if (this.matchKeyword('before')) mode = 'before';
    else if (this.matchKeyword('after')) mode = 'after';
    else {
      const cur = this.current;
      throw new NecroTalkError(
        formatError(cur.line, cur.column, `Expected "into", "before", or "after" in put statement`),
        cur.line, cur.column,
      );
    }

    const target = this.parseContainer();
    this.expectNewlineOrEof();
    return { kind: 'put', value, mode, target, line };
  }

  // ---------------------------------------------------------------------------
  // get
  // ---------------------------------------------------------------------------
  parseGet(): GetStatement {
    const line = this.current.line;
    this.expectKeyword('get');
    const value = this.parseExpression();
    this.expectNewlineOrEof();
    return { kind: 'get', value, line };
  }

  // ---------------------------------------------------------------------------
  // set
  // ---------------------------------------------------------------------------
  parseSet(): SetStatement {
    const line = this.current.line;
    this.expectKeyword('set');
    // set <property> of <objectRef> to <expr>
    const propTok = this.current;
    if (propTok.type !== 'identifier' && propTok.type !== 'keyword') {
      throw new NecroTalkError(
        formatError(propTok.line, propTok.column, `Expected property name after "set"`),
        propTok.line, propTok.column,
      );
    }
    const property = propTok.value;
    this.advance();
    this.expectKeyword('of');
    const object = this.parseObjectRef();
    this.expectKeyword('to');
    const value = this.parseExpression();
    this.expectNewlineOrEof();
    return { kind: 'set', property, object, value, line };
  }

  // ---------------------------------------------------------------------------
  // global
  // ---------------------------------------------------------------------------
  parseGlobal(): GlobalStatement {
    const line = this.current.line;
    this.expectKeyword('global');
    const nameTok = this.current;
    if (nameTok.type !== 'identifier' && nameTok.type !== 'keyword') {
      throw new NecroTalkError(
        formatError(nameTok.line, nameTok.column, `Expected variable name after "global"`),
        nameTok.line, nameTok.column,
      );
    }
    const varName = nameTok.value.toLowerCase();
    this.advance();
    this.expectNewlineOrEof();
    return { kind: 'global', varName, line };
  }

  // ---------------------------------------------------------------------------
  // answer
  // ---------------------------------------------------------------------------
  parseAnswer(): AnswerStatement {
    const line = this.current.line;
    this.expectKeyword('answer');
    const prompt = this.parseExpression();
    const buttons: string[] = [];
    if (this.matchKeyword('with')) {
      const b1Tok = this.current;
      if (b1Tok.type !== 'string') {
        throw new NecroTalkError(
          formatError(b1Tok.line, b1Tok.column, `Expected quoted button label after "with"`),
          b1Tok.line, b1Tok.column,
        );
      }
      buttons.push(b1Tok.value);
      this.advance();
      while (this.matchKeyword('or')) {
        const btnTok = this.current;
        if (btnTok.type !== 'string') {
          throw new NecroTalkError(
            formatError(btnTok.line, btnTok.column, `Expected quoted button label after "or"`),
            btnTok.line, btnTok.column,
          );
        }
        buttons.push(btnTok.value);
        this.advance();
      }
    }
    if (buttons.length === 0) buttons.push('OK');
    this.expectNewlineOrEof();
    return { kind: 'answer', prompt, buttons, line };
  }

  // ---------------------------------------------------------------------------
  // ask
  // ---------------------------------------------------------------------------
  parseAsk(): AskStatement {
    const line = this.current.line;
    this.expectKeyword('ask');
    const prompt = this.parseExpression();
    let defaultExpr: ExpressionNode | undefined;
    if (this.matchKeyword('with')) {
      defaultExpr = this.parseExpression();
    }
    this.expectNewlineOrEof();
    return { kind: 'ask', prompt, default: defaultExpr, line };
  }

  // ---------------------------------------------------------------------------
  // show / hide
  // ---------------------------------------------------------------------------
  parseShow(): ShowStatement {
    const line = this.current.line;
    this.expectKeyword('show');
    const object = this.parseObjectRef();
    this.expectNewlineOrEof();
    return { kind: 'show', object, line };
  }

  parseHide(): HideStatement {
    const line = this.current.line;
    this.expectKeyword('hide');
    const object = this.parseObjectRef();
    this.expectNewlineOrEof();
    return { kind: 'hide', object, line };
  }

  // ---------------------------------------------------------------------------
  // if
  // ---------------------------------------------------------------------------
  parseIf(): IfStatement {
    const line = this.current.line;
    this.expectKeyword('if');
    const condition = this.parseExpression();
    this.expectKeyword('then');

    // Single-line if: if <cond> then <stmt> (no newline between then and stmt)
    if (this.current.type !== 'newline' && this.current.type !== 'eof') {
      const stmt = this.parseStatement();
      // optional else on same line is NOT standard HyperTalk single-line — skip
      return { kind: 'if', condition, thenBranch: [stmt], line };
    }

    // Multi-line if
    this.skipNewlines();
    const thenBranch = this.parseStatementList('if');

    let elseBranch: StatementNode[] | undefined;
    if (this.matchKeyword('else')) {
      // else if sugar
      if (this.isKeyword('if')) {
        const innerIf = this.parseIf();
        elseBranch = [innerIf];
      } else {
        this.skipNewlines();
        elseBranch = this.parseStatementList('else');
        this.expectKeyword('end');
        this.expectKeyword('if');
        this.expectNewlineOrEof();
      }
    } else {
      this.expectKeyword('end');
      this.expectKeyword('if');
      this.expectNewlineOrEof();
    }

    return { kind: 'if', condition, thenBranch, elseBranch, line };
  }

  // ---------------------------------------------------------------------------
  // repeat
  // ---------------------------------------------------------------------------
  parseRepeat(): RepeatStatement {
    const line = this.current.line;
    this.expectKeyword('repeat');
    let variant: RepeatVariant;

    if (this.matchKeyword('while')) {
      const condition = this.parseExpression();
      this.expectNewlineOrEof();
      variant = { type: 'while', condition };
    } else if (this.matchKeyword('with')) {
      const varTok = this.current;
      const varName = (varTok.type === 'identifier' || varTok.type === 'keyword')
        ? varTok.value.toLowerCase() : '';
      if (!varName) {
        throw new NecroTalkError(
          formatError(varTok.line, varTok.column, `Expected variable name in "repeat with"`),
          varTok.line, varTok.column,
        );
      }
      this.advance();
      if (!this.current || (this.current.type !== 'operator' || this.current.value !== '=')) {
        const cur = this.current;
        throw new NecroTalkError(
          formatError(cur.line, cur.column, `Expected "=" after variable in "repeat with"`),
          cur.line, cur.column,
        );
      }
      this.advance(); // skip =
      const from = this.parseExpression();
      this.expectKeyword('to');
      const to = this.parseExpression();
      this.expectNewlineOrEof();
      variant = { type: 'with', varName, from, to };
    } else {
      // repeat <N> times
      const count = this.parseExpression();
      this.expectKeyword('times');
      this.expectNewlineOrEof();
      variant = { type: 'times', count };
    }

    const body = this.parseStatementList('repeat');
    this.expectKeyword('end');
    this.expectKeyword('repeat');
    this.expectNewlineOrEof();
    return { kind: 'repeat', variant, body, line };
  }

  // ---------------------------------------------------------------------------
  // exit
  // ---------------------------------------------------------------------------
  parseExit(): ExitStatement {
    const line = this.current.line;
    this.expectKeyword('exit');
    const tok = this.current;
    if (this.matchKeyword('repeat')) {
      this.expectNewlineOrEof();
      return { kind: 'exit', target: 'repeat', line };
    }
    if (tok.type === 'identifier' || tok.type === 'keyword') {
      const name = tok.value.toLowerCase();
      this.advance();
      this.expectNewlineOrEof();
      return { kind: 'exit', target: name, line };
    }
    throw new NecroTalkError(
      formatError(tok.line, tok.column, `Expected handler name or "repeat" after "exit"`),
      tok.line, tok.column,
    );
  }

  // ---------------------------------------------------------------------------
  // ObjectRef parser
  // ---------------------------------------------------------------------------
  parseObjectRef(): ObjectRef {
    const cur = this.current;
    const objTypes = ['button', 'field', 'image', 'card', 'background', 'stack', 'me'] as const;

    for (const t of objTypes) {
      if (this.isKeyword(t)) {
        this.advance();
        if (t === 'me' || t === 'stack' || t === 'card' || t === 'background') {
          // may or may not have a name string
          if (this.current.type === 'string') {
            const name: ExpressionNode = { kind: 'literal', value: this.current.value };
            this.advance();
            return { type: t, name };
          }
          return { type: t };
        }
        // button, field, image — expect quoted name or identifier
        if (this.current.type === 'string') {
          const name: ExpressionNode = { kind: 'literal', value: this.current.value };
          this.advance();
          return { type: t, name };
        }
        if (this.current.type === 'identifier') {
          const name: ExpressionNode = { kind: 'variable', name: this.current.value.toLowerCase() };
          this.advance();
          return { type: t, name };
        }
        return { type: t };
      }
    }
    throw new NecroTalkError(
      formatError(cur.line, cur.column, `Expected object type (button, field, etc.) but found "${cur.value}"`),
      cur.line, cur.column,
    );
  }

  // ---------------------------------------------------------------------------
  // Container parser (put/get target)
  // ---------------------------------------------------------------------------
  parseContainer(): ContainerNode {
    if (this.isKeyword('field')) {
      const ref = this.parseObjectRef();
      return { kind: 'field', ref };
    }
    if (this.isKeyword('it')) {
      this.advance();
      return { kind: 'it' };
    }
    if (this.current.type === 'identifier' || this.current.type === 'keyword') {
      const name = this.current.value.toLowerCase();
      this.advance();
      return { kind: 'variable', name };
    }
    const cur = this.current;
    throw new NecroTalkError(
      formatError(cur.line, cur.column, `Expected container (field, variable, or "it") but found "${cur.value}"`),
      cur.line, cur.column,
    );
  }

  // ---------------------------------------------------------------------------
  // Expression (precedence climbing)
  // ---------------------------------------------------------------------------
  parseExpression(minPrec = 0): ExpressionNode {
    let left = this.parseUnary();

    while (true) {
      const op = this.currentBinaryOp();
      if (!op) break;
      const prec = precedenceOf(op);
      if (prec <= minPrec) break;

      // consume op tokens
      this.consumeOp(op);

      const nextMinPrec = RIGHT_ASSOC.has(op) ? prec - 1 : prec;
      const right = this.parseExpression(nextMinPrec);
      left = { kind: 'binary', op: op as BinaryOp, left, right } satisfies BinaryExpression;
    }

    return left;
  }

  /** Returns the binary operator string at current position, or null. */
  private currentBinaryOp(): string | null {
    const cur = this.current;

    if (cur.type === 'operator') {
      if (['+', '-', '*', '/', '^', '=', '<>', '<', '>', '<=', '>=', '&', '&&'].includes(cur.value)) {
        return cur.value;
      }
    }
    if (cur.type === 'keyword') {
      if (cur.value === 'and' || cur.value === 'or' || cur.value === 'mod' ||
          cur.value === 'contains') {
        return cur.value;
      }
      // 'is not' two-token operator
      if (cur.value === 'is') {
        const next = this.peek();
        if (next.type === 'keyword' && next.value === 'not') return 'is not';
        return 'is';
      }
    }
    return null;
  }

  private consumeOp(op: string): void {
    if (op === 'is not') { this.advance(); this.advance(); return; }
    this.advance();
  }

  private parseUnary(): ExpressionNode {
    const cur = this.current;
    // unary not — precedence level 3 per the design table: the operand absorbs
    // comparisons and tighter operators, but not `and` / `or`.
    if (cur.type === 'keyword' && cur.value === 'not') {
      this.advance();
      return { kind: 'unary', op: 'not', operand: this.parseExpression(3) } satisfies UnaryExpression;
    }
    // unary minus
    if (cur.type === 'operator' && cur.value === '-') {
      this.advance();
      return { kind: 'unary', op: '-', operand: this.parseUnary() } satisfies UnaryExpression;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionNode {
    const cur = this.current;

    // Parenthesized expression
    if (cur.type === 'punctuation' && cur.value === '(') {
      this.advance();
      const expr = this.parseExpression(0);
      if (!(this.current.type === 'punctuation' && this.current.value === ')')) {
        const c = this.current;
        throw new NecroTalkError(
          formatError(c.line, c.column, `Expected ")" but found "${c.value}"`),
          c.line, c.column,
        );
      }
      this.advance();
      return expr;
    }

    // Number literal
    if (cur.type === 'number') {
      this.advance();
      return { kind: 'literal', value: parseFloat(cur.value) } satisfies LiteralExpression;
    }

    // String literal
    if (cur.type === 'string') {
      this.advance();
      return { kind: 'literal', value: cur.value } satisfies LiteralExpression;
    }

    // Boolean literals
    if (cur.type === 'keyword' && cur.value === 'true') {
      this.advance();
      return { kind: 'literal', value: true } satisfies LiteralExpression;
    }
    if (cur.type === 'keyword' && cur.value === 'false') {
      this.advance();
      return { kind: 'literal', value: false } satisfies LiteralExpression;
    }

    // `the ...` — property, count, or date/time
    if (cur.type === 'keyword' && cur.value === 'the') {
      return this.parseTheExpression();
    }

    // word/line/char N of <expr>  — chunk expression
    for (const ct of ['word', 'line', 'char'] as const) {
      if ((cur.type === 'keyword' || cur.type === 'identifier') && cur.value === ct) {
        this.advance();
        const index = this.parseExpression(precedenceOf('of') + 1);
        this.expectKeyword('of');
        const source = this.parsePrimary(); // tight binding
        return { kind: 'chunk', chunkType: ct, index, source } satisfies ChunkExpression;
      }
    }

    // Function call: identifier(args)
    if (cur.type === 'identifier' && this.peek().type === 'punctuation' && this.peek().value === '(') {
      const name = cur.value.toLowerCase();
      this.advance(); // name
      this.advance(); // (
      const args: ExpressionNode[] = [];
      if (!(this.current.type === 'punctuation' && this.current.value === ')')) {
        args.push(this.parseExpression(0));
        while (this.current.type === 'punctuation' && this.current.value === ',') {
          this.advance();
          args.push(this.parseExpression(0));
        }
      }
      if (!(this.current.type === 'punctuation' && this.current.value === ')')) {
        const c = this.current;
        throw new NecroTalkError(
          formatError(c.line, c.column, `Expected ")" to close function call`),
          c.line, c.column,
        );
      }
      this.advance(); // )
      return { kind: 'functionCall', name, args } satisfies FunctionCallExpression;
    }

    // it as an expression (reads the special `it` variable)
    if (cur.type === 'keyword' && cur.value === 'it') {
      this.advance();
      return { kind: 'variable', name: 'it' } satisfies VariableExpression;
    }

    // Variable (identifier)
    if (cur.type === 'identifier') {
      this.advance();
      return { kind: 'variable', name: cur.value.toLowerCase() } satisfies VariableExpression;
    }

    throw new NecroTalkError(
      formatError(cur.line, cur.column, `Expected expression but found "${cur.value}"`),
      cur.line, cur.column,
    );
  }

  /**
   * Parse a `the ...` expression:
   * - `the date` / `the time`
   * - `the number of cards`
   * - `the number of words of <expr>`
   * - `the number of lines of <expr>`
   * - `the number of chars of <expr>`
   * - `the <property> of <objectRef>`
   */
  private parseTheExpression(): ExpressionNode {
    const theTok = this.current;
    this.expectKeyword('the');

    // the number of ...
    if (this.isKeyword('number')) {
      this.advance(); // number
      this.expectKeyword('of');
      if (this.matchKeyword('cards')) {
        return { kind: 'count', what: 'cards' } satisfies CountExpression;
      }
      for (const what of ['words', 'lines', 'chars'] as const) {
        if (this.matchKeyword(what)) {
          this.expectKeyword('of');
          // Source binds as a primary (like chunk sources) so `the number of words of x * 2`
          // means (count) * 2; use parentheses for a compound source.
          const source = this.parsePrimary();
          return { kind: 'count', what, source } satisfies CountExpression;
        }
      }
      throw new NecroTalkError(
        formatError(theTok.line, theTok.column, `Expected "cards", "words", "lines", or "chars" after "the number of"`),
        theTok.line, theTok.column,
      );
    }

    // the date / the time (bare properties)
    if (this.isKeyword('date') || this.isKeyword('time') ||
        this.current.type === 'identifier') {
      const propTok = this.current;
      if (propTok.type !== 'keyword' && propTok.type !== 'identifier') {
        throw new NecroTalkError(
          formatError(propTok.line, propTok.column, `Expected property name after "the"`),
          propTok.line, propTok.column,
        );
      }
      const property = propTok.value;
      this.advance();
      // the <property> of <objectRef>?
      if (this.matchKeyword('of')) {
        const object = this.parseObjectRef();
        return { kind: 'property', property, object } satisfies PropertyExpression;
      }
      return { kind: 'property', property } satisfies PropertyExpression;
    }

    throw new NecroTalkError(
      formatError(theTok.line, theTok.column, `Expected property name after "the"`),
      theTok.line, theTok.column,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parse(source: string): ScriptNode {
  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  return parser.parseScript();
}

// ---------------------------------------------------------------------------
// AST Printer
// ---------------------------------------------------------------------------

/** Returns a deep copy of the AST with every statement's line set to 0. */
export function stripPositions(ast: ScriptNode): ScriptNode {
  return {
    kind: 'script',
    handlers: ast.handlers.map(h => ({
      ...h,
      body: h.body.map(stripStmt),
    })),
  };
}

function stripStmt(stmt: StatementNode): StatementNode {
  const s = { ...stmt, line: 0 };
  switch (s.kind) {
    case 'if':
      return {
        ...s,
        thenBranch: s.thenBranch.map(stripStmt),
        elseBranch: s.elseBranch?.map(stripStmt),
      };
    case 'repeat':
      return { ...s, body: s.body.map(stripStmt) };
    default:
      return s;
  }
}

export function print(script: ScriptNode): string {
  const lines: string[] = [];
  for (const handler of script.handlers) {
    const paramStr = handler.params.length ? ' ' + handler.params.join(', ') : '';
    lines.push(`on ${handler.name}${paramStr}`);
    for (const stmt of handler.body) {
      lines.push(...printStatement(stmt, 1));
    }
    lines.push(`end ${handler.name}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

function ind(depth: number): string {
  return '  '.repeat(depth);
}

function printStatement(stmt: StatementNode, depth: number): string[] {
  const i = ind(depth);
  switch (stmt.kind) {
    case 'beep': return [`${i}beep`];
    case 'go': return [`${i}go ${printGoTarget(stmt.target)}`];
    case 'visualEffect': return [`${i}visual effect ${stmt.effect}`];
    case 'put': return [`${i}put ${printExpr(stmt.value)} ${stmt.mode} ${printContainer(stmt.target)}`];
    case 'get': return [`${i}get ${printExpr(stmt.value)}`];
    case 'set': return [`${i}set ${stmt.property} of ${printObjectRef(stmt.object)} to ${printExpr(stmt.value)}`];
    case 'global': return [`${i}global ${stmt.varName}`];
    case 'answer': {
      const btns = stmt.buttons.length === 1 && stmt.buttons[0] === 'OK'
        ? ''
        : ' with ' + stmt.buttons.map(b => `"${b}"`).join(' or ');
      return [`${i}answer ${printExpr(stmt.prompt)}${btns}`];
    }
    case 'ask': {
      const def = stmt.default ? ` with ${printExpr(stmt.default)}` : '';
      return [`${i}ask ${printExpr(stmt.prompt)}${def}`];
    }
    case 'show': return [`${i}show ${printObjectRef(stmt.object)}`];
    case 'hide': return [`${i}hide ${printObjectRef(stmt.object)}`];
    case 'exit': return [`${i}exit ${stmt.target}`];
    case 'nextRepeat': return [`${i}next repeat`];
    case 'pass': return [`${i}pass ${stmt.handlerName}`];
    case 'if': return printIf(stmt, depth);
    case 'repeat': return printRepeat(stmt, depth);
    default: return [`${i}-- unknown stmt`];
  }
}

function printIf(stmt: IfStatement, depth: number): string[] {
  const i = ind(depth);
  const lines: string[] = [`${i}if ${printExpr(stmt.condition)} then`];
  for (const s of stmt.thenBranch) lines.push(...printStatement(s, depth + 1));
  if (stmt.elseBranch) {
    // else if sugar: single IfStatement in elseBranch
    if (stmt.elseBranch.length === 1 && stmt.elseBranch[0].kind === 'if') {
      const inner = printIf(stmt.elseBranch[0] as IfStatement, depth);
      // inner[0] = "  if ..." — replace leading indent+if with "  else if ..."
      lines.push(`${i}else ${inner[0].trimStart()}`);
      lines.push(...inner.slice(1));
      // inner already ends with "end if"
    } else {
      lines.push(`${i}else`);
      for (const s of stmt.elseBranch) lines.push(...printStatement(s, depth + 1));
      lines.push(`${i}end if`);
    }
  } else {
    lines.push(`${i}end if`);
  }
  return lines;
}

function printRepeat(stmt: RepeatStatement, depth: number): string[] {
  const i = ind(depth);
  let header: string;
  const v = stmt.variant;
  if (v.type === 'times') header = `repeat ${printExpr(v.count)} times`;
  else if (v.type === 'while') header = `repeat while ${printExpr(v.condition)}`;
  else header = `repeat with ${v.varName} = ${printExpr(v.from)} to ${printExpr(v.to)}`;

  const lines: string[] = [`${i}${header}`];
  for (const s of stmt.body) lines.push(...printStatement(s, depth + 1));
  lines.push(`${i}end repeat`);
  return lines;
}

function printGoTarget(target: GoTarget): string {
  if (target.type === 'next' || target.type === 'prev' ||
      target.type === 'first' || target.type === 'last') {
    return target.type;
  }
  // target.type === 'card'
  const cardTarget = target as { type: 'card'; value: number | string };
  if (typeof cardTarget.value === 'number') return `to card ${cardTarget.value}`;
  return `to card "${cardTarget.value}"`;
}

function printContainer(c: ContainerNode): string {
  if (c.kind === 'it') return 'it';
  if (c.kind === 'variable') return c.name;
  return printObjectRef(c.ref);
}

function printObjectRef(ref: ObjectRef): string {
  if (!ref.name) return ref.type;
  const nameStr = printExpr(ref.name);
  // If the name expression is a literal string, print with quotes
  if (ref.name.kind === 'literal' && typeof ref.name.value === 'string') {
    return `${ref.type} "${ref.name.value}"`;
  }
  return `${ref.type} ${nameStr}`;
}

// Precedence of a child expression for parenthesization decisions.
// Unary `not` sits at level 3 (design table); unary `-` binds tightest (9);
// primaries (literals, variables, calls, chunks, counts, properties) never need parens.
const NOT_PREC = 3;
function exprPrec(expr: ExpressionNode): number {
  if (expr.kind === 'binary') return precedenceOf(expr.op);
  if (expr.kind === 'unary') return expr.op === 'not' ? NOT_PREC : 9;
  return 99;
}

/** True for nodes the parser reads as a single primary (safe without parens). */
function isAtomic(expr: ExpressionNode): boolean {
  return expr.kind === 'literal' || expr.kind === 'variable';
}

function needsParens(child: ExpressionNode, parentOp: string, side: 'left' | 'right'): boolean {
  const childPrec = exprPrec(child);
  if (childPrec === 99) return false;
  const parentPrec = precedenceOf(parentOp);
  if (childPrec < parentPrec) return true;
  // Equal precedence on the "wrong" side for the operator's associativity:
  // right side of a left-associative op, or left side of a right-associative op (^).
  if (childPrec === parentPrec) {
    const rightAssoc = RIGHT_ASSOC.has(parentOp);
    if (side === 'right' && !rightAssoc) return true;
    if (side === 'left' && rightAssoc) return true;
  }
  return false;
}

function printExpr(expr: ExpressionNode): string {
  switch (expr.kind) {
    case 'literal': {
      if (typeof expr.value === 'string') return `"${expr.value}"`;
      if (typeof expr.value === 'boolean') return expr.value ? 'true' : 'false';
      return String(expr.value);
    }
    case 'variable': return expr.name;
    case 'binary': {
      let leftStr = printExpr(expr.left);
      let rightStr = printExpr(expr.right);
      if (needsParens(expr.left, expr.op, 'left')) leftStr = `(${leftStr})`;
      if (needsParens(expr.right, expr.op, 'right')) rightStr = `(${rightStr})`;
      return `${leftStr} ${expr.op} ${rightStr}`;
    }
    case 'unary': {
      const operand = expr.operand;
      if (expr.op === 'not') {
        // The parser reads `not`'s operand at precedence > 3, so and/or operands need parens.
        const wrap = operand.kind === 'binary' && precedenceOf(operand.op) <= NOT_PREC;
        return `not ${wrap ? `(${printExpr(operand)})` : printExpr(operand)}`;
      }
      // Unary minus binds tightest; wrap anything non-atomic (also avoids "--" comments).
      return isAtomic(operand) || operand.kind === 'functionCall'
        ? `-${printExpr(operand)}`
        : `-(${printExpr(operand)})`;
    }
    case 'functionCall': return `${expr.name}(${expr.args.map(printExpr).join(', ')})`;
    case 'property': {
      if (expr.object) return `the ${expr.property} of ${printObjectRef(expr.object)}`;
      return `the ${expr.property}`;
    }
    case 'chunk': {
      const idx = isAtomic(expr.index) ? printExpr(expr.index) : `(${printExpr(expr.index)})`;
      const src = isAtomic(expr.source) ? printExpr(expr.source) : `(${printExpr(expr.source)})`;
      return `${expr.chunkType} ${idx} of ${src}`;
    }
    case 'count': {
      if (expr.what === 'cards') return 'the number of cards';
      const src = isAtomic(expr.source!) ? printExpr(expr.source!) : `(${printExpr(expr.source!)})`;
      return `the number of ${expr.what} of ${src}`;
    }
    default: return '';
  }
}

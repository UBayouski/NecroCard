import { tokenize } from './tokenizer.js';
import type { Token } from './tokenizer.js';
import { NecroTalkError, formatError } from './errors.js';
import type {
  ScriptNode, HandlerNode, StatementNode, ExpressionNode,
  GoStatement, GoTarget, VisualEffectStatement,
  PutStatement, GetStatement, SetStatement, GlobalStatement,
  AnswerStatement, AskStatement, ShowStatement, HideStatement, BeepStatement,
  IfStatement, RepeatStatement, RepeatVariant,
  ExitStatement, NextRepeatStatement, PassStatement, CallStatement,
  LiteralExpression, VariableExpression, BinaryExpression, BinaryOp,
  UnaryExpression, FunctionCallExpression, PropertyExpression,
  ChunkExpression, CountExpression, FieldExpression,
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

  /** Plain-English description of a token for "found ..." clauses. */
  private describe(tok: Token): string {
    if (tok.type === 'newline') return 'end of line';
    if (tok.type === 'eof') return 'end of script';
    return `"${tok.value}"`;
  }

  private error(tok: Token, msg: string): NecroTalkError {
    return new NecroTalkError(formatError(tok.line, tok.column, msg), tok.line, tok.column);
  }

  /**
   * Read a user-chosen name (variable, parameter, handler). Reserved words are
   * rejected with `"<word>" is a reserved word`. Returns the name as written.
   * @param what used in the "Expected ..." message when no name is present
   */
  private expectName(what: string): string {
    const tok = this.current;
    if (tok.type === 'keyword') throw this.error(tok, `"${tok.value}" is a reserved word`);
    if (tok.type !== 'identifier') throw this.error(tok, `Expected ${what} but found ${this.describe(tok)}`);
    this.advance();
    return tok.value;
  }

  private matchKeyword(value: string): boolean {
    if (this.isKeyword(value)) { this.advance(); return true; }
    return false;
  }

  private expectKeyword(value: string): Token {
    if (!this.isKeyword(value)) {
      throw this.error(this.current, `Expected "${value}" but found ${this.describe(this.current)}`);
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
      throw this.error(this.current, `Expected end of line but found ${this.describe(this.current)}`);
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
        throw this.error(this.current,
          `Expected "on" to begin a handler but found ${this.describe(this.current)}`);
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
    // Handler name keeps its source case; comparisons are case-insensitive
    const name = this.expectName('a handler name');

    // Optional parameters: comma-separated variable names on the same line
    const params: string[] = [];
    if (this.current.type !== 'newline' && this.current.type !== 'eof') {
      params.push(this.expectName('a parameter name').toLowerCase());
      while (this.current.type === 'punctuation' && this.current.value === ',') {
        this.advance();
        params.push(this.expectName('a parameter name').toLowerCase());
      }
    }
    this.expectNewlineOrEof();

    const body = this.parseStatementList('handler');

    this.expectKeyword('end');
    const endNameTok = this.current;
    const endMatches = (endNameTok.type === 'identifier' || endNameTok.type === 'keyword')
      && endNameTok.value.toLowerCase() === name.toLowerCase();
    if (!endMatches) {
      const found = endNameTok.type === 'newline' || endNameTok.type === 'eof'
        ? `"end" followed by ${this.describe(endNameTok)}`
        : `"end ${endNameTok.value}"`;
      throw this.error(endNameTok, `Expected "end ${name}" but found ${found}`);
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
          const block = context === 'repeat' ? 'repeat' : 'if';
          throw this.error(cur, `Expected "end ${block}" but found end of script`);
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
          const handlerName = this.expectName('a handler name after "pass"');
          this.expectNewlineOrEof();
          return { kind: 'pass', handlerName, line } satisfies PassStatement;
        }
      }
    }

    // Custom handler call: `<name> [arg, arg...]` where <name> is not a keyword
    if (cur.type === 'identifier') {
      const lower = cur.value.toLowerCase();
      // Out-of-scope commands are rejected ahead of time (steering error examples)
      if (lower === 'do') {
        throw new NecroTalkError(
          formatError(cur.line, cur.column, '"do" is not allowed in NecroTalk'),
          cur.line, cur.column,
        );
      }
      if (lower === 'sort') {
        throw new NecroTalkError(
          formatError(cur.line, cur.column, 'Unknown command "sort". NecroTalk does not support sort'),
          cur.line, cur.column,
        );
      }
      this.advance();
      const args: ExpressionNode[] = [];
      if (this.current.type !== 'newline' && this.current.type !== 'eof') {
        args.push(this.parseExpression());
        while (this.current.type === 'punctuation' && this.current.value === ',') {
          this.advance();
          args.push(this.parseExpression());
        }
      }
      this.expectNewlineOrEof();
      return { kind: 'call', name: cur.value, args, line } satisfies CallStatement;
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
    throw this.error(tok, `Unknown visual effect ${this.describe(tok)}`);
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
    // set [the] <property> of <objectRef> to <expr>
    this.matchKeyword('the');
    const propTok = this.current;
    if (propTok.type !== 'identifier' && propTok.type !== 'keyword') {
      throw this.error(propTok, `Expected property name after "set" but found ${this.describe(propTok)}`);
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
    const varName = this.expectName('a variable name after "global"').toLowerCase();
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
      while (this.isKeyword('or')) {
        const orTok = this.advance();
        if (buttons.length === 3) {
          throw this.error(orTok, '"answer" accepts at most three buttons');
        }
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
  /**
   * Parse an if statement.
   * @param chained true when this `if` follows `else` inside a multi-line block
   *   (`else if <cond> then ...`). A chained if is always part of the enclosing
   *   block: even in its single-line form (`else if c then <stmt>`) it must still
   *   be closed by the block's `end if`.
   */
  parseIf(chained = false): IfStatement {
    const line = this.current.line;
    this.expectKeyword('if');
    const condition = this.parseExpression();
    this.expectKeyword('then');

    let thenBranch: StatementNode[];
    if (this.current.type !== 'newline' && this.current.type !== 'eof') {
      // Statement on the same line as `then`
      const stmt = this.parseStatement();
      // A standalone single-line if ends here (no else, no end if)
      if (!chained) return { kind: 'if', condition, thenBranch: [stmt], line };
      thenBranch = [stmt];
      this.skipNewlines();
      // A chained single-line branch may be followed by more statements before else/end if
      thenBranch.push(...this.parseStatementList('if'));
    } else {
      // Multi-line if
      this.skipNewlines();
      thenBranch = this.parseStatementList('if');
    }

    let elseBranch: StatementNode[] | undefined;
    if (this.matchKeyword('else')) {
      if (this.isKeyword('if')) {
        // else if sugar: the chained if consumes the shared `end if`
        elseBranch = [this.parseIf(true)];
      } else {
        this.skipNewlines();
        elseBranch = this.parseStatementList('else');
        this.expectEndIf();
      }
    } else {
      this.expectEndIf();
    }

    return { kind: 'if', condition, thenBranch, elseBranch, line };
  }

  private expectEndIf(): void {
    const cur = this.current;
    if (cur.type === 'eof') {
      throw this.error(cur, 'Expected "end if" but found end of script');
    }
    this.expectKeyword('end');
    this.expectKeyword('if');
    this.expectNewlineOrEof();
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
      const varName = this.expectName('a variable name in "repeat with"').toLowerCase();
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
    if (this.matchKeyword('repeat')) {
      this.expectNewlineOrEof();
      return { kind: 'exit', target: 'repeat', line };
    }
    const name = this.expectName('a handler name or "repeat" after "exit"');
    this.expectNewlineOrEof();
    return { kind: 'exit', target: name, line };
  }

  // ---------------------------------------------------------------------------
  // ObjectRef parser
  // ---------------------------------------------------------------------------
  /**
   * `button <expr>`, `field <expr>`, `image <expr>`, `card <expr>`, or `me`.
   * The name binds as a primary (like a chunk source), so `field "Score" + 1`
   * means (field "Score") + 1; parenthesize a compound name.
   */
  parseObjectRef(): ObjectRef {
    const cur = this.current;
    if (this.matchKeyword('me')) return { type: 'me' };
    if (this.isKeyword('background') || this.isKeyword('stack')) {
      throw this.error(cur, `"${cur.value}" references are not supported in NecroTalk`);
    }
    for (const t of ['button', 'field', 'image', 'card'] as const) {
      if (this.matchKeyword(t)) {
        if (!this.startsPrimary()) {
          throw this.error(this.current, `Expected a name after "${t}" but found ${this.describe(this.current)}`);
        }
        return { type: t, name: this.parsePrimary() };
      }
    }
    throw this.error(cur, `Expected an object (button, field, image, card, or me) but found ${this.describe(cur)}`);
  }

  /** True if the current token can begin a primary expression (an object name). */
  private startsPrimary(): boolean {
    const t = this.current;
    if (t.type === 'number' || t.type === 'string' || t.type === 'identifier') return true;
    if (t.type === 'punctuation') return t.value === '(';
    if (t.type === 'keyword') {
      return ['true', 'false', 'the', 'it', 'word', 'line', 'char', 'field'].includes(t.value);
    }
    return false;
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
      // expectName rejects keywords with `"<word>" is a reserved word`
      const name = this.expectName('a container').toLowerCase();
      return { kind: 'variable', name };
    }
    throw this.error(this.current,
      `Expected a container (field, variable, or "it") but found ${this.describe(this.current)}`);
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
        throw this.error(this.current, `Expected ")" but found ${this.describe(this.current)}`);
      }
      this.advance();
      return expr;
    }

    // Field read: `field <name>` evaluates to the field's text
    if (cur.type === 'keyword' && cur.value === 'field') {
      const ref = this.parseObjectRef() as { type: 'field'; name: ExpressionNode };
      return { kind: 'field', ref } satisfies FieldExpression;
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

    // Any other keyword here is a reserved word misused as a value
    if (cur.type === 'keyword') throw this.error(cur, `"${cur.value}" is a reserved word`);

    throw this.error(cur, `Expected an expression but found ${this.describe(cur)}`);
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
    case 'call': return [`${i}${stmt.name}${stmt.args.length ? ' ' + stmt.args.map(printExpr).join(', ') : ''}`];
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
  if (ref.type === 'me') return 'me';
  // The parser reads an object name as a primary; wrap anything non-atomic
  const name = isAtomic(ref.name) ? printExpr(ref.name) : `(${printExpr(ref.name)})`;
  return `${ref.type} ${name}`;
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
    case 'field': return printObjectRef(expr.ref);
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

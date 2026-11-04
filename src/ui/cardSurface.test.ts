// The card surface is sacred (retro-ui.md): 1-bit, no gradients, shadows, opacity or system fonts. This guard reads every
// stylesheet under src/ and checks each rule whose selector mentions `.card-surface`. It is a lint-grade brace scan, not a
// full CSS parser; the self-tests below prove it flags each kind of violation.
import { describe, expect, it } from 'vitest';

interface NodeFs {
  readFileSync(p: URL, e: 'utf8'): string;
  readdirSync(p: URL, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
}
const fs = async (): Promise<NodeFs> => (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as NodeFs;

async function cssFiles(dir = new URL('../', import.meta.url)): Promise<URL[]> {
  const f = await fs();
  const out: URL[] = [];
  for (const entry of f.readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) out.push(...(await cssFiles(url)));
    else if (entry.name.endsWith('.css')) out.push(url);
  }
  return out;
}

export interface Rule {
  selector: string;
  body: string;
}

/** Every style rule in a stylesheet, descending into @media/@supports blocks. Comments are dropped first. */
export function rulesOf(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const scan = (text: string): void => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const selector = text.slice(i, open).trim();
      const body = text.slice(open + 1, j - 1);
      if (selector.startsWith('@')) {
        if (!/^@(font-face|keyframes|page)/.test(selector)) scan(body);
      } else {
        rules.push({ selector, body });
      }
      i = j;
    }
  };
  scan(src);
  return rules;
}

const onCard = (r: Rule) => r.selector.split(',').some(s => s.includes('.card-surface'));

const ALLOWED_HEX = new Set(['#000', '#000000', '#fff', '#ffffff']);
const ALLOWED_FONT = /^var\(--font-(ui|field|script)\)$/;

/** Plain-English problems with one card rule; empty when it is clean. */
export function problemsIn(rule: Rule): string[] {
  const { selector, body } = rule;
  const out: string[] = [];
  const say = (what: string) => out.push(`${selector} { … }: ${what}`);

  if (/gradient\s*\(/i.test(body)) say('gradient');
  if (/(^|[;\s{])(box-shadow|text-shadow)\s*:/i.test(body) || /drop-shadow\s*\(/i.test(body)) say('shadow');
  if (/(^|[;\s{])opacity\s*:/i.test(body)) say('opacity');
  if (/(^|[;\s{])(filter|backdrop-filter)\s*:/i.test(body)) say('filter');
  if (/(^|[;\s{])(transition|animation)(-[a-z-]+)?\s*:/i.test(body)) say('transition or animation');
  if (/(^|[;\s{])font\s*:/i.test(body)) say('font shorthand (use font-family with a --font-* variable)');

  for (const m of body.matchAll(/(^|[;\s{])font-family\s*:\s*([^;}]+)/gi)) {
    if (!ALLOWED_FONT.test(m[2].trim())) say(`font-family "${m[2].trim()}" is not a bundled --font-* variable`);
  }
  for (const m of body.matchAll(/(^|[;\s{])font-size\s*:\s*([^;}]+)/gi)) {
    const v = m[2].trim();
    if (!/^\d+px$/.test(v) && !/^var\(--font-size-[a-z]+\)$/.test(v)) say(`font-size "${v}" is not fixed pixels`);
  }
  for (const m of body.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
    if (!ALLOWED_HEX.has(m[0].toLowerCase())) say(`colour ${m[0]} is not black or white`);
  }
  if (/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\s*\(/i.test(body)) say('non-hex colour function');
  for (const m of body.matchAll(/url\(([^)]*)\)/gi)) {
    if (!/assets\/patterns\/dither-[0-9-]+\.svg/.test(m[1])) say(`url(${m[1]}) is not a dither pattern`);
  }
  if (/!important/.test(body) && !/\[hidden\]\s*$/.test(selector)) say('!important outside a [hidden] reset');
  return out;
}

describe('the card surface CSS guard (retro-ui.md)', () => {
  it('finds a plausible number of card rules, so a parser fault cannot pass vacuously', async () => {
    const f = await fs();
    let count = 0;
    for (const url of await cssFiles()) count += rulesOf(f.readFileSync(url, 'utf8')).filter(onCard).length;
    expect(count).toBeGreaterThan(40);
  });

  it('no rule scoped to .card-surface breaks the 1-bit rules', async () => {
    const f = await fs();
    const problems: string[] = [];
    for (const url of await cssFiles()) {
      const name = url.pathname.split('/src/')[1];
      for (const rule of rulesOf(f.readFileSync(url, 'utf8')).filter(onCard)) {
        problems.push(...problemsIn(rule).map(p => `${name}: ${p}`));
      }
    }
    expect(problems).toEqual([]);
  });

  it('the round-rect button has no ::after rule and no shadow (single-colour border)', async () => {
    const f = await fs();
    const css = f.readFileSync(new URL('./browse/browse.css', import.meta.url), 'utf8');
    const rules = rulesOf(css);
    expect(rules.some(r => /button-roundrect[^,]*::after/.test(r.selector))).toBe(false);
  });
});

describe('the guard detects each kind of violation', () => {
  const check = (body: string, selector = '.card-surface .x') => problemsIn({ selector, body });

  it.each([
    ['gradient', 'background: linear-gradient(#000, #fff);'],
    ['gradient', 'background-image: radial-gradient(#000, #fff);'],
    ['shadow', 'box-shadow: 1px 1px #000;'],
    ['shadow', 'text-shadow: 1px 1px #000;'],
    ['opacity', 'opacity: 0.5;'],
    ['filter', 'filter: blur(2px);'],
    ['transition or animation', 'transition: all 1s;'],
    ['transition or animation', 'animation-name: spin;'],
    ['font shorthand', 'font: 12px sans-serif;'],
    ['not a bundled', 'font-family: sans-serif;'],
    ['not a bundled', 'font-family: monospace;'],
    ['not a bundled', 'font-family: "Arial", var(--font-ui);'],
    ['not fixed pixels', 'font-size: 1.2em;'],
    ['not fixed pixels', 'font-size: 120%;'],
    ['not black or white', 'color: #333;'],
    ['not black or white', 'background: #f0f0f0;'],
    ['non-hex colour function', 'color: rgb(0, 0, 0);'],
    ['not a dither pattern', 'background-image: url("photo.png");'],
    ['!important outside', 'display: none !important;'],
  ])('flags %s', (what, body) => {
    expect(check(body).join('\n')).toContain(what);
  });

  it('accepts the things the card is allowed to use', () => {
    expect(check([
      'font-family: var(--font-field);', 'font-size: var(--font-size-text);', 'font-size: 8px;',
      'color: #000000;', 'background: #ffffff;', 'border: 1px solid #000;', 'background: transparent;',
      'background-image: url("../../assets/patterns/dither-50.svg");', 'border-radius: 8px;',
    ].join(' '))).toEqual([]);
  });

  it('allows !important only in a [hidden] reset', () => {
    expect(check('display: none !important;', '.card-surface .card-object[hidden]')).toEqual([]);
  });

  it('ignores chrome rules entirely, and reads rules inside @media', () => {
    const css = '.chrome { box-shadow: 1px 1px #888; } @media (min-width: 1px) { .card-surface .y { opacity: .5; } }';
    const rules = rulesOf(css);
    expect(rules.filter(onCard).map(r => r.selector)).toEqual(['.card-surface .y']);
    expect(rules.filter(onCard).flatMap(problemsIn).join()).toContain('opacity');
  });
});

import { describe, expect, it } from 'vitest';

interface NodeFs {
  readFileSync(p: URL, e: 'utf8'): string;
  readFileSync(p: URL): Uint8Array;
  existsSync(p: URL): boolean;
  readdirSync(p: URL, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
}

/** Node's fs without Node typings (the repo has no @types/node). */
async function fs(): Promise<NodeFs> {
  return (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as NodeFs;
}

const here = (rel: string) => new URL(rel, import.meta.url);
const text = async (rel: string) => (await fs()).readFileSync(here(rel), 'utf8');

/** Every source file under src/ (not node_modules), as { url, name }. */
async function sourceFiles(dir = here('../')): Promise<URL[]> {
  const f = await fs();
  const out: URL[] = [];
  for (const entry of f.readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) out.push(...(await sourceFiles(url)));
    else out.push(url);
  }
  return out;
}

const FACES = [
  { alias: 'NecroUI', weight: '400', file: 'Silkscreen-Regular.woff2', license: 'Silkscreen-OFL.txt' },
  { alias: 'NecroUI', weight: '700', file: 'Silkscreen-Bold.woff2', license: 'Silkscreen-OFL.txt' },
  { alias: 'NecroField', weight: '400', file: 'DotGothic16-Regular-latin.woff2', license: 'DotGothic16-OFL.txt' },
  { alias: 'NecroScript', weight: '400', file: 'VT323-Regular.woff2', license: 'VT323-OFL.txt' },
] as const;

describe('fonts.css', () => {
  it('declares exactly the four bundled faces, each with a local woff2 url and a Latin unicode-range', async () => {
    const css = await text('../assets/fonts/fonts.css');
    const blocks = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(blocks).toHaveLength(FACES.length);
    for (const face of FACES) {
      const block = blocks.find(b => b.includes(`font-family: "${face.alias}"`) && b.includes(`font-weight: ${face.weight};`));
      expect(block, `${face.alias} ${face.weight}`).toBeDefined();
      expect(block).toContain(`url("./${face.file}") format("woff2")`);
      expect(block).toContain('font-display: block;');
      expect(block).toContain('unicode-range: U+0000-00FF');
    }
  });

  it('loads nothing from the network', async () => {
    const css = await text('../assets/fonts/fonts.css');
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/fonts\.(googleapis|gstatic)/);
    expect(css).not.toMatch(/@import/);
  });

  it('every referenced file exists, is a real woff2, and has its license beside it', async () => {
    const f = await fs();
    for (const face of FACES) {
      const font = here(`../assets/fonts/${face.file}`);
      expect(f.existsSync(font), face.file).toBe(true);
      expect(String.fromCharCode(...f.readFileSync(font).slice(0, 4)), face.file).toBe('wOF2');
      expect(f.existsSync(here(`../assets/fonts/${face.license}`)), face.license).toBe(true);
    }
  });

  it('each license is the SIL Open Font License 1.1', async () => {
    for (const license of new Set(FACES.map(face => face.license))) {
      const t = await text(`../assets/fonts/${license}`);
      expect(t, license).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(t, license).toMatch(/^Copyright /);
    }
  });
});

describe('variables.css', () => {
  it('binds each font variable to its bundled family, with a generic last resort', async () => {
    const css = await text('./variables.css');
    expect(css).toMatch(/--font-ui:\s*"NecroUI",\s*monospace;/);
    expect(css).toMatch(/--font-field:\s*"NecroField",\s*monospace;/);
    expect(css).toMatch(/--font-script:\s*"NecroScript",\s*monospace;/);
  });

  it('fixes sizes in pixels at each font’s native size', async () => {
    const css = await text('./variables.css');
    expect(css).toMatch(/--font-size-ui:\s*8px;/);
    expect(css).toMatch(/--font-size-title:\s*16px;/);
    expect(css).toMatch(/--font-size-text:\s*16px;/);
    expect(css).toMatch(/--line-height-text:\s*20px;/);
  });
});

describe('FONTS.md', () => {
  it('names each family, designer, license and source, records the subset and the Reserved Font Name status', async () => {
    const md = await text('../assets/fonts/FONTS.md');
    for (const needle of [
      'Silkscreen', 'Jason Kottke', 'https://github.com/googlefonts/silkscreen',
      'DotGothic16', 'Fontworks Inc.', 'https://github.com/fontworks-fonts/DotGothic16',
      'VT323', 'Peter Hull', 'https://github.com/phoikoi/VT323',
      'SIL Open Font License', 'subset', 'Reserved Font Name',
    ]) {
      expect(md, needle).toContain(needle);
    }
    for (const face of FACES) expect(md).toContain(face.file);
  });
});

describe('proprietary typeface names', () => {
  it('appear nowhere under src/', async () => {
    // Built at run time so this file does not contain the words it forbids.
    const banned = [['Chi', 'cago'], ['Gen', 'eva'], ['Mon', 'aco']].map(parts => parts.join(''));
    const f = await fs();
    const files = (await sourceFiles()).filter(u => /\.(ts|css|md|html|json|txt|svg)$/.test(u.pathname));
    expect(files.length).toBeGreaterThan(50);
    for (const url of files) {
      const body = f.readFileSync(url, 'utf8');
      for (const word of banned) {
        expect(body.includes(word), `${url.pathname} mentions a proprietary typeface`).toBe(false);
      }
    }
  });
});

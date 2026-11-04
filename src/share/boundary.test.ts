import { describe, expect, it } from 'vitest';

/** Read the files of src/share/ from disk (no bundler needed for a source check). */
async function shareSources(): Promise<{ name: string; src: string }[]> {
  const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as {
    readdirSync(p: URL): string[];
    readFileSync(p: URL, e: 'utf8'): string;
  };
  const dir = new URL('./', import.meta.url);
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.ts'))
    .map(name => ({ name, src: fs.readFileSync(new URL(name, dir), 'utf8') }));
}

const importsOf = (src: string): string[] =>
  [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);

describe('src/share boundary (sharing REQ-5.3)', () => {
  it('non-test files import only src/model/ (and nothing from ui, summon, interp, server)', async () => {
    const files = (await shareSources()).filter(f => !f.name.endsWith('.test.ts') && f.name !== 'testStacks.ts');
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const { name, src } of files) {
      for (const spec of importsOf(src)) {
        expect(spec, `${name} imports ${spec}`).toMatch(/^\.\.\/model\/|^\.\//);
        expect(spec, `${name} imports ${spec}`).not.toMatch(/\/(ui|summon|interp)\/|server\//);
      }
    }
  });
});

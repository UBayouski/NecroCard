// The page shell carries the link-preview tags. This reads index.html as text, so a dropped or mistyped tag fails here.
import { describe, expect, it } from 'vitest';

interface NodeFs {
  readFileSync(p: URL, e: 'utf8'): string;
}
const fs = async (): Promise<NodeFs> => (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as NodeFs;

const LIVE = 'https://necrocard.onrender.com';

function metaContent(html: string, attr: 'name' | 'property', key: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/g) ?? []) {
    if (tag.includes(`${attr}="${key}"`)) return /content="([^"]*)"/.exec(tag)?.[1] ?? null;
  }
  return null;
}

describe('index.html meta tags', () => {
  it('has description, Open Graph, Twitter card, theme-color and a noscript line', async () => {
    const f = await fs();
    const html = f.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const css = f.readFileSync(new URL('./variables.css', import.meta.url), 'utf8');
    const description = metaContent(html, 'name', 'description');
    expect(description).toMatch(/^Describe a stack in plain English/);
    expect(metaContent(html, 'property', 'og:title')).toBeTruthy();
    expect(metaContent(html, 'property', 'og:description')).toBe(description);
    expect(metaContent(html, 'property', 'og:type')).toBe('website');
    expect(metaContent(html, 'property', 'og:url')).toBe(LIVE);
    expect(metaContent(html, 'property', 'og:image')).toBe(`${LIVE}/og-image.png`);
    expect(metaContent(html, 'name', 'twitter:card')).toBe('summary_large_image');
    expect(metaContent(html, 'name', 'twitter:image')).toBe(`${LIVE}/og-image.png`);
    expect(metaContent(html, 'name', 'theme-color')).toBe(/--chrome-bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1]);
    expect(html).toMatch(/<noscript>[^<]*JavaScript[^<]*<\/noscript>/);
  });
});

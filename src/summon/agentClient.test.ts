import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_FAILED, AgentUnavailableError, createAgentClient, createStubAgentClient, NOT_CONFIGURED, stripFence,
  type ScriptContext,
} from './agentClient.js';
import { TransportError, type Transport } from './transport.js';

/** Read a file next to this test from disk (no src/ui helper: src/summon never imports src/ui). */
async function ownSource(relative: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readFileSync(p: URL, e: 'utf8'): string };
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
}

const context: ScriptContext = {
  owner: { type: 'button', name: 'Go' }, stackName: 'Quiz', cardName: 'Title', backgroundName: 'Default',
  objectNames: [{ type: 'button', name: 'Go' }],
};

describe('stub agent client', () => {
  it('explain and fix reject with "Summon is not configured"', async () => {
    const agent = createStubAgentClient();
    const e1 = await agent.explain('on h\nend h', context).catch(e => e);
    const e2 = await agent.fix('on h', 'Line 1: …', context).catch(e => e);
    for (const e of [e1, e2]) {
      expect(e).toBeInstanceOf(AgentUnavailableError);
      expect(e.message).toBe('Summon is not configured');
    }
    expect(NOT_CONFIGURED).toBe('Summon is not configured');
  });

  it('an already-aborted signal rejects as an AbortError', async () => {
    const c = new AbortController();
    c.abort();
    const e = await createStubAgentClient().fix('x', null, context, c.signal).catch(err => err);
    expect(e.name).toBe('AbortError');
  });

  it('the stub never touches the network', async () => {
    const src = await ownSource('./agentClient.ts');
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  });

  it('every src/summon module imports only src/summon, src/model and src/interp, and no browser globals', async () => {
    const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { readdirSync(p: URL): string[] };
    const files = fs.readdirSync(new URL('./', import.meta.url)).filter(f => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const src = await ownSource(`./${file}`);
      const specifiers = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);
      for (const spec of specifiers) {
        expect(spec, `${file} imports ${spec}`).toMatch(/^(\.\/|\.\.\/model\/|\.\.\/interp\/|\.\.\/\.\.\/fixtures\/|vitest$|fast-check$|ajv$)/);
        expect(spec, `${file} imports ${spec}`).not.toMatch(/\/ui\//);
      }
      if (!file.endsWith('.test.ts')) {
        const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        expect(code, file).not.toMatch(/\b(window|document|localStorage|sessionStorage|navigator)\b|import\.meta\.env/);
        expect(specifiers.filter(s => !/^(\.\/|\.\.\/model\/|\.\.\/interp\/|ajv$)/.test(s)), file).toEqual([]);
      }
    }
  });
});

describe('real agent client', () => {
  const reply = (text: string): Transport => ({ path: 'server', send: vi.fn(async () => ({ text })) });

  it('explain sends an explain request through the current transport and trims the reply', async () => {
    const t = reply('  It beeps.\n');
    const agent = createAgentClient(() => t);
    expect(await agent.explain('on mouseUp\n  beep\nend mouseUp', context)).toBe('It beeps.');
    expect(t.send).toHaveBeenCalledWith({ kind: 'explain', payload: { script: 'on mouseUp\n  beep\nend mouseUp', context } }, undefined);
  });

  it('fix sends the error and strips a code fence', async () => {
    const t = reply('```necrotalk\non mouseUp\n  beep\nend mouseUp\n```\n');
    const c = new AbortController();
    const agent = createAgentClient(() => t);
    expect(await agent.fix('on mouseUp\nend click', 'Line 2: x.', context, c.signal)).toBe('on mouseUp\n  beep\nend mouseUp');
    expect(t.send).toHaveBeenCalledWith(
      { kind: 'fix', payload: { script: 'on mouseUp\nend click', error: 'Line 2: x.', context } }, c.signal,
    );
  });

  it('asks for the transport on every call', async () => {
    const a = reply('a');
    const b = reply('b');
    let current = a;
    const agent = createAgentClient(() => current);
    expect(await agent.explain('x', context)).toBe('a');
    current = b;
    expect(await agent.explain('x', context)).toBe('b');
  });

  it('transport errors become AgentUnavailableError with the message; other errors get a plain one', async () => {
    const failing = (e: Error): Transport => ({ path: 'server', send: async () => { throw e; } });
    const e1 = await createAgentClient(() => failing(new TransportError('cap', 'Limit reached.'))).explain('x', context).catch(e => e);
    expect(e1).toBeInstanceOf(AgentUnavailableError);
    expect(e1.message).toBe('Limit reached.');
    const e2 = await createAgentClient(() => failing(new Error('secret internals'))).fix('x', null, context).catch(e => e);
    expect(e2).toBeInstanceOf(AgentUnavailableError);
    expect(e2.message).toBe(AGENT_FAILED);
  });

  it('aborts pass through as AbortError', async () => {
    const t: Transport = { path: 'direct', send: async () => { throw new DOMException('cancelled', 'AbortError'); } };
    const e = await createAgentClient(() => t).explain('x', context).catch(err => err);
    expect(e).not.toBeInstanceOf(AgentUnavailableError);
    expect(e.name).toBe('AbortError');
  });

  it.each([
    ['plain', 'on h\nend h', 'on h\nend h'],
    ['fenced', '```\non h\nend h\n```', 'on h\nend h'],
    ['fenced with language and spaces', '  ```hypertalk  \r\non h\r\nend h\r\n```  ', 'on h\r\nend h'],
    ['text around a fence is kept', 'Here:\n```\non h\n```', 'Here:\n```\non h\n```'],
  ])('stripFence: %s', (_name, input, output) => {
    expect(stripFence(input)).toBe(output);
  });
});

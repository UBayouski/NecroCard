import { describe, expect, it } from 'vitest';
import { AgentUnavailableError, createStubAgentClient, NOT_CONFIGURED, type ScriptContext } from './agentClient.js';

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

  it('the module imports nothing and never touches the network', async () => {
    const src = await ownSource('./agentClient.ts');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  });

  it('nothing in src/summon imports src/ui', async () => {
    for (const file of ['./agentClient.ts', './agentClient.test.ts']) {
      expect(await ownSource(file)).not.toMatch(/from\s+['"][^'"]*\/ui\//);
    }
  });
});

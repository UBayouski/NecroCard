// Pure prompt builders for Summon, Explain and Fix (summon REQ-1). Used unchanged by the server and the
// direct (bring-your-own-key) transport, so both paths send identical prompts.
import schema from '../model/stack.schema.json' with { type: 'json' };
import type { ScriptContext } from './agentClient.js';
import type { SummonRequest } from './contract.js';
import { GRAMMAR_SUMMARY } from './grammar.js';

export interface BuiltPrompt {
  systemInstruction: string;
  text: string;
  /** True when the reply must be JSON (summon and retry). */
  json: boolean;
}

export const SCHEMA_TEXT = JSON.stringify(schema, null, 2);

/** A minimal valid stack, shown to the model as the shape to follow (validated by prompts.test.ts). */
export const EXAMPLE_STACK = {
  id: 'stk4Fq9a',
  name: 'Tiny Example',
  backgrounds: [{
    id: 'bg7Lw2xQ',
    name: 'Main',
    // "Score" is on the background, so it shows on every card and any card button can update it.
    objects: [{
      id: 'fd0Sc0re1', name: 'Score', type: 'field', rect: { x: 400, y: 10, w: 100, h: 24 },
      visible: true, script: '', text: '0', lockText: true, style: 'transparent',
    }],
    script: '',
  }],
  cards: [
    {
      id: 'cd1Pz8kR',
      name: 'Start',
      backgroundId: 'bg7Lw2xQ',
      objects: [
        {
          id: 'fd3Hy6tM', name: 'Title', type: 'field', rect: { x: 56, y: 40, w: 400, h: 60 },
          visible: true, script: '', text: 'Hello', lockText: true, style: 'transparent',
        },
        {
          id: 'bt9Vc5nE', name: 'Next', type: 'button', rect: { x: 206, y: 260, w: 100, h: 28 },
          visible: true,
          script: 'on mouseUp\n  put field "Score" + 1 into field "Score"\n  go next\nend mouseUp',
          style: 'roundRect', label: 'Next', autoHilite: true,
        },
      ],
      script: '',
    },
    { id: 'cd2Gm4sJ', name: 'End', backgroundId: 'bg7Lw2xQ', objects: [], script: '' },
  ],
  script: '',
  metadata: { created: '2026-11-03T14:00:00.000Z', modified: '2026-11-03T14:00:00.000Z', author: 'Summon' },
};

export const SYSTEM_INSTRUCTION = `You build NecroCard stacks. NecroCard is HyperCard in the browser.
Reply with exactly one JSON object: a complete stack. No prose, no Markdown, no code fences.

The stack must validate against this JSON Schema (2020-12):
${SCHEMA_TEXT}

Rules the schema does not check, which are required too:
- Every id (stack, backgrounds, cards, objects) is 8 to 10 characters from A-Z a-z 0-9 _ - and unique in the stack.
  Ids look like the examples: a two-letter prefix and six random letters or digits, never a word and never padded.
- Every card's backgroundId is the id of a background in this stack.
- At least one background and at least one card.
- Cards are 512 x 342 pixels; keep every rect inside the card (x + w <= 512, y + h <= 342). Integers only.
- Do not create image objects.
- metadata.created and metadata.modified look like 2026-11-03T14:00:00.000Z; author is "Summon".
- Give every object a short, unique, human name; scripts refer to objects by name, never by id or label.
- An object that must appear on every card — a score, a title bar, a persistent Next button, any shared control — is
  a BACKGROUND object: put it in the background's objects. A card object exists on that one card only. A card and
  its background share a name space, so a card button can read or set a background field by name, as in the example
  below where the "Next" button on the card updates the "Score" field on the background.
- Use lockText true for fields the user should not type into, false for answer fields.
- Every script is NecroTalk (below). Empty scripts are "". Put "\\n" between lines inside JSON strings.

This is the shape of a valid stack:
${JSON.stringify(EXAMPLE_STACK)}

${GRAMMAR_SUMMARY}`;

const AGENT_ROLE = `You help people write NecroTalk scripts for NecroCard, a HyperCard clone in the browser.`;

export const EXPLAIN_INSTRUCTION = `${AGENT_ROLE}
Explain the given script in plain English for a beginner: what each handler does and when it runs. Keep it short
(at most about 150 words), use plain text without Markdown headings. If the script has a reported error, say what
is wrong in one sentence.

${GRAMMAR_SUMMARY}`;

export const FIX_INSTRUCTION = `${AGENT_ROLE}
Fix the given script so it parses and does what it was meant to do. Reply with the complete replacement script
only: no explanation, no Markdown, no code fences. Keep the author's handlers, names and comments where possible.
Use only NecroTalk as described below.

${GRAMMAR_SUMMARY}`;

/** Wrap untrusted text so it cannot close its own block early. */
export function delimit(tag: string, body: string): string {
  const close = `${tag}>>>`;
  const safe = body.split(close).join(`${tag}> > >`);
  return `<<<${tag}\n${safe}\n${close}`;
}

export function summonMessage(prompt: string): string {
  return `Build a NecroCard stack for this description:\n${delimit('PARAGRAPH', prompt.trim())}`;
}

export function retryMessage(prompt: string, previous: string, errors: readonly string[]): string {
  const list = errors.map((e, i) => `${i + 1}. ${e}`).join('\n');
  return [
    `Build a NecroCard stack for this description:\n${delimit('PARAGRAPH', prompt.trim())}`,
    `Your previous reply:\n${delimit('PREVIOUS', previous)}`,
    `It failed these checks:\n${delimit('ERRORS', list)}`,
    'Return the complete corrected stack as one JSON object.',
  ].join('\n\n');
}

function describeContext(context: ScriptContext): string {
  const q = (s: string) => JSON.stringify(s);
  const objects = context.objectNames.length
    ? context.objectNames.map(o => `${o.type} ${q(o.name)}`).join(', ')
    : 'none';
  return [
    `Script of: ${context.owner.type} ${q(context.owner.name)}`,
    `Stack: ${q(context.stackName)}`,
    `Card: ${context.cardName === null ? 'none (not a card or card object script)' : q(context.cardName)}`,
    `Background: ${context.backgroundName === null ? 'none' : q(context.backgroundName)}`,
    `Objects that scripts can refer to by name: ${objects}`,
  ].join('\n');
}

export function explainMessage(script: string, context: ScriptContext): string {
  return `${describeContext(context)}\n\nExplain this script:\n${delimit('SCRIPT', script)}`;
}

export function fixMessage(script: string, error: string | null, context: ScriptContext): string {
  const reported = error === null ? 'No parse error is reported.' : `Reported error: ${error}`;
  return `${describeContext(context)}\n${reported}\n\nFix this script:\n${delimit('SCRIPT', script)}`;
}

/** The one entry point for both transports. */
export function buildPrompt(request: SummonRequest): BuiltPrompt {
  switch (request.kind) {
    case 'summon':
      return { systemInstruction: SYSTEM_INSTRUCTION, text: summonMessage(request.payload.prompt), json: true };
    case 'retry': {
      const { prompt, previous, errors } = request.payload;
      return { systemInstruction: SYSTEM_INSTRUCTION, text: retryMessage(prompt, previous, errors), json: true };
    }
    case 'explain':
      return {
        systemInstruction: EXPLAIN_INSTRUCTION,
        text: explainMessage(request.payload.script, request.payload.context),
        json: false,
      };
    case 'fix': {
      const { script, error, context } = request.payload;
      return { systemInstruction: FIX_INSTRUCTION, text: fixMessage(script, error, context), json: false };
    }
  }
}

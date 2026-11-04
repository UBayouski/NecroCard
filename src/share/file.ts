// Export and import a stack as a .necrocard.json file (sharing REQ-3). Imports only src/model/.
import { serializeStack } from '../model/serialize.js';
import type { Stack } from '../model/types.js';
import { validateStack } from '../model/validate.js';

export class ShareImportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ShareImportError';
  }
}

export const FILE_EXTENSION = '.necrocard.json';

/** "The Haunted Quiz" -> "The Haunted Quiz.necrocard.json"; unsafe characters -> "-"; empty -> "stack". */
export function safeFileName(name: string): string {
  const base = name
    .replace(/[^A-Za-z0-9 _-]+/g, '-')  // unsafe runs -> one dash
    .replace(/\s*-+\s*/g, '-')          // a dash (with any adjacent spaces) collapses to one dash
    .replace(/^-+|-+$/g, '')            // trim leading/trailing dashes
    .replace(/\s+/g, ' ')               // collapse remaining whitespace runs
    .trim();
  return `${base === '' ? 'stack' : base}${FILE_EXTENSION}`;
}

export interface ExportDeps {
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
  anchor?: () => HTMLAnchorElement;
  /** Deferred revoke, so the click is processed first. */
  defer?: (fn: () => void) => void;
}

/** Download the canonical JSON as <name>.necrocard.json via a Blob and a temporary anchor. */
export function exportStack(stack: Stack, deps: ExportDeps = {}): void {
  const blob = new Blob([serializeStack(stack)], { type: 'application/json' });
  const createUrl = deps.createUrl ?? (b => URL.createObjectURL(b));
  const revokeUrl = deps.revokeUrl ?? (u => URL.revokeObjectURL(u));
  const anchor = (deps.anchor ?? (() => document.createElement('a')))();
  const defer = deps.defer ?? (fn => setTimeout(fn, 0));
  const url = createUrl(blob);
  anchor.href = url;
  anchor.download = safeFileName(stack.name);
  anchor.rel = 'noopener';
  anchor.click();
  defer(() => revokeUrl(url));
}

/** Read a chosen file, parse and validate; any failure becomes a ShareImportError. */
export async function readStackFile(file: Blob): Promise<Stack> {
  let text: string;
  try {
    text = await file.text();
  } catch (cause) {
    throw new ShareImportError('That file could not be read.', { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new ShareImportError('That file is not valid JSON.', { cause });
  }
  try {
    return validateStack(parsed);
  } catch (cause) {
    const first = cause instanceof Error ? cause.message.split('\n').slice(1)[0]?.trim() : '';
    throw new ShareImportError(`That file is not a valid NecroCard stack${first ? `: ${first}` : ''}.`, { cause });
  }
}

/** Open a file chooser filtered to JSON; resolves with the chosen file or null if cancelled. */
export function pickStackFile(doc: Document = document): Promise<File | null> {
  return new Promise(resolve => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = `${FILE_EXTENSION},application/json,.json`;
    input.style.display = 'none';
    let settled = false;
    const done = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    // If the chooser is cancelled, `change` never fires; `cancel` does in modern browsers.
    input.addEventListener('cancel', () => done(null));
    doc.body.append(input);
    input.click();
  });
}

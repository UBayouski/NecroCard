// Test-only helper: read a source file next to the caller from disk.
// Vitest returns empty modules for CSS imports (including `?raw`), so stylesheet assertions
// read the file directly. The module name is built at runtime so TypeScript does not need
// Node typings (the repo has no @types/node).
interface NodeFs { readFileSync(path: URL, encoding: 'utf8'): string }

export async function readSource(relative: string, base: string): Promise<string> {
  const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as NodeFs;
  return fs.readFileSync(new URL(relative, base), 'utf8');
}

export interface DiffRow {
  kind: 'same' | 'add' | 'del';
  text: string;
  /** 1-based line in the old text (null for added lines). */
  oldLine: number | null;
  /** 1-based line in the new text (null for removed lines). */
  newLine: number | null;
}

/** Above this many LCS cells, fall back to "remove all, add all" (still correct, less precise). */
export const MAX_CELLS = 250_000;

/** Line diff by longest common subsequence; at each change, removals are listed before additions. */
export function diffLines(oldText: string, newText: string): DiffRow[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) {
    return [
      ...a.map((text, i) => ({ kind: 'del' as const, text, oldLine: i + 1, newLine: null })),
      ...b.map((text, j) => ({ kind: 'add' as const, text, oldLine: null, newLine: j + 1 })),
    ];
  }
  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      rows.push({ kind: 'same', text: a[i], oldLine: i + 1, newLine: j + 1 });
      i++; j++;
    } else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) {
      rows.push({ kind: 'del', text: a[i], oldLine: i + 1, newLine: null });
      i++;
    } else {
      rows.push({ kind: 'add', text: b[j], oldLine: null, newLine: j + 1 });
      j++;
    }
  }
  return rows;
}

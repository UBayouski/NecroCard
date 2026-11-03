import { describe, it, expect } from 'vitest';
import { generateId } from './id.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{10}$/;

describe('generateId', () => {
  it('returns a string matching the URL-safe pattern', () => {
    const id = generateId();
    expect(id).toMatch(ID_PATTERN);
  });

  it('always produces exactly 10 characters', () => {
    for (let i = 0; i < 100; i++) {
      expect(generateId()).toHaveLength(10);
    }
  });

  it('generates 1000 unique ids (collision resistance smoke test)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(1000);
  });
});

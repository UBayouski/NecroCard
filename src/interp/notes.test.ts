import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatNotes, NoteParseError, parseNotes, type Note } from './notes.js';

describe('parseNotes', () => {
  it('defaults to octave 4 and a quarter note', () => {
    expect(parseNotes('a')).toEqual([{ frequency: 440, beats: 1 }]);
  });

  it('a4 is 440 and a5 is 880 (equal temperament octave)', () => {
    const [a4, a5] = parseNotes('a4 a5');
    expect(a4.frequency).toBeCloseTo(440, 6);
    expect(a5.frequency).toBeCloseTo(880, 6);
  });

  it('c4 is middle C, about 261.63 Hz', () => {
    expect(parseNotes('c4')[0].frequency!).toBeCloseTo(261.6256, 3);
  });

  it('the octave sticks for later notes', () => {
    const [c5, e, g] = parseNotes('c5 e g');
    expect(c5.frequency!).toBeCloseTo(523.2511, 3);
    // e and g keep octave 5
    expect(e.frequency!).toBeCloseTo(659.2551, 3);
    expect(g.frequency!).toBeCloseTo(783.9909, 3);
  });

  it('the duration sticks for later notes and rests', () => {
    // `ah` sets half-note; later notes and rests keep it until changed.
    expect(parseNotes('ah b r')).toEqual([
      { frequency: 440, beats: 2 },
      { frequency: parseNotes('b')[0].frequency, beats: 2 },
      { frequency: null, beats: 2 },
    ]);
  });

  it('# raises and b lowers by a semitone', () => {
    const [cSharp, dFlat] = parseNotes('c#4 db4');
    expect(cSharp.frequency!).toBeCloseTo(dFlat.frequency!, 6); // enharmonic
  });

  it('b is the note B, bb is B-flat, cb is C-flat', () => {
    const [b, bFlat, cFlat] = parseNotes('b4 bb4 cb4');
    expect(b.frequency!).toBeCloseTo(493.8833, 3);
    expect(bFlat.frequency!).toBeCloseTo(466.1638, 3);
    // C-flat equals B of the octave below (Cb4 == B3).
    expect(cFlat.frequency!).toBeCloseTo(parseNotes('b3')[0].frequency!, 6);
  });

  it('is case-insensitive for the letter and the duration', () => {
    expect(parseNotes('C E G')).toEqual(parseNotes('c e g'));
    expect(parseNotes('AH')).toEqual(parseNotes('ah'));
  });

  it('durations map w h q e s to 4 2 1 0.5 0.25 beats', () => {
    expect(parseNotes('aw ah aq ae as').map(n => n.beats)).toEqual([4, 2, 1, 0.5, 0.25]);
  });

  it('a rest has a duration but no frequency', () => {
    expect(parseNotes('rw')).toEqual([{ frequency: null, beats: 4 }]);
  });

  it('an empty or whitespace string yields no notes', () => {
    expect(parseNotes('')).toEqual([]);
    expect(parseNotes('   ')).toEqual([]);
  });

  it('throws NoteParseError naming a bad token', () => {
    expect(() => parseNotes('c e h9')).toThrowError(NoteParseError);
    try {
      parseNotes('c e h9');
    } catch (e) {
      expect(e).toBeInstanceOf(NoteParseError);
      expect((e as NoteParseError).token).toBe('h9');
    }
  });

  it('rejects an octave or accidental on a rest', () => {
    expect(() => parseNotes('r4')).toThrowError(NoteParseError);
    expect(() => parseNotes('r#')).toThrowError(NoteParseError);
  });
});

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

const BEATS = [4, 2, 1, 0.5, 0.25] as const;
/** A representable note: a pitch an integer number of semitones from A4, or a rest; one of the five durations. */
const noteArb: fc.Arbitrary<Note> = fc.record({
  frequency: fc.option(fc.integer({ min: -33, max: 39 }).map(n => 440 * 2 ** (n / 12)), { nil: null }),
  beats: fc.constantFrom(...BEATS),
});

describe('notes properties', () => {
  it('parse(format(notes)) deep-equals notes (round-trip)', () => {
    fc.assert(
      fc.property(fc.array(noteArb, { maxLength: 24 }), notes => {
        const round = parseNotes(formatNotes(notes));
        expect(round.length).toBe(notes.length);
        round.forEach((n, i) => {
          expect(n.beats).toBe(notes[i].beats);
          if (notes[i].frequency === null) expect(n.frequency).toBeNull();
          else expect(n.frequency!).toBeCloseTo(notes[i].frequency!, 6);
        });
      }),
      { numRuns: 300 },
    );
  });

  it('every parsed note frequency is 440 * 2^(n/12) for an integer n; rests are null', () => {
    const letters = 'abcdefg';
    const accidentals = ['', '#', 'b'];
    const durations = ['', 'w', 'h', 'q', 'e', 's'];
    const tokenArb = fc.oneof(
      fc.record({
        letter: fc.constantFrom(...letters.split('')),
        acc: fc.constantFrom(...accidentals),
        oct: fc.constantFrom('', '0', '1', '2', '3', '4', '5', '6', '7', '8'),
        dur: fc.constantFrom(...durations),
      }).map(t => `${t.letter}${t.acc}${t.oct}${t.dur}`),
      fc.constantFrom('r', 'rw', 'rh', 'rq', 're', 'rs'),
    );
    fc.assert(
      fc.property(fc.array(tokenArb, { maxLength: 24 }), tokens => {
        for (const note of parseNotes(tokens.join(' '))) {
          if (note.frequency === null) continue;
          const n = Math.log2(note.frequency / 440) * 12;
          expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
        }
      }),
      { numRuns: 300 },
    );
  });
});

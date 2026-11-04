// Pure NecroTalk notes parser for `play` (necrotalk-play REQ-2). No host or DOM dependency, so it is
// unit-testable and shared by the evaluator and the browse host. It does not import the tokenizer or parser.

/** One parsed note (or rest). */
export interface Note {
  /** Frequency in Hz, or null for a rest. */
  frequency: number | null;
  /** Length in quarter-note beats: w=4, h=2, q=1, e=0.5, s=0.25. */
  beats: number;
}

/** A notes-string token that is not a valid note or rest. Carries the token but no line number. */
export class NoteParseError extends Error {
  constructor(readonly token: string) {
    super(`"${token}" is not a note`);
    this.name = 'NoteParseError';
  }
}

/** Beats per duration letter. */
const DURATION: Record<string, number> = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25 };
/** Duration letter per beats value (for formatting). */
const DURATION_LETTER = new Map<number, string>([[4, 'w'], [2, 'h'], [1, 'q'], [0.5, 'e'], [0.25, 's']]);

/** Semitones from A (within one octave) for each note letter. */
const SEMITONE: Record<string, number> = { c: -9, d: -7, e: -5, f: -4, g: -2, a: 0, b: 2 };

/** letter, optional accidental (# or b), optional octave 0-8, optional duration (w h q e s). */
const NOTE_RE = /^([a-g])(#|b)?([0-8])?([whqes])?$/;
/** rest r with an optional duration letter. */
const REST_RE = /^r([whqes])?$/;

const DEFAULT_OCTAVE = 4;
const DEFAULT_DURATION = 'q';

function frequencyOf(letter: string, accidental: string | undefined, octave: number): number {
  const semitones = SEMITONE[letter]
    + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0)
    + 12 * (octave - 4);
  return 440 * 2 ** (semitones / 12);
}

/**
 * Parse a whitespace-separated notes string into notes. The octave and the duration are sticky: once a note gives
 * an octave digit it becomes the default for later notes (starting at 4), and once any token gives a duration
 * letter it becomes the default (starting at a quarter). `a4` is 440 Hz, equal temperament. A bad token throws
 * `NoteParseError`. An empty or all-whitespace string is valid and yields no notes.
 */
export function parseNotes(source: string): Note[] {
  const tokens = source.trim().split(/\s+/).filter(t => t.length > 0);
  const notes: Note[] = [];
  let octave = DEFAULT_OCTAVE;
  let durationLetter = DEFAULT_DURATION;

  for (const raw of tokens) {
    const token = raw.toLowerCase();
    const rest = REST_RE.exec(token);
    if (rest) {
      if (rest[1]) durationLetter = rest[1];
      notes.push({ frequency: null, beats: DURATION[durationLetter] });
      continue;
    }
    const note = NOTE_RE.exec(token);
    if (!note) throw new NoteParseError(raw);
    const [, letter, accidental, octaveDigit, duration] = note;
    if (octaveDigit !== undefined) octave = Number(octaveDigit);
    if (duration !== undefined) durationLetter = duration;
    notes.push({ frequency: frequencyOf(letter, accidental, octave), beats: DURATION[durationLetter] });
  }
  return notes;
}

/** Semitone offset from A4 for a frequency (rounded to the nearest integer semitone). */
function semitonesFromA4(frequency: number): number {
  return Math.round(Math.log2(frequency / 440) * 12);
}

const LETTER_FROM_SEMITONE = new Map<number, { letter: string; accidental: string }>();
for (const [letter, base] of Object.entries(SEMITONE)) {
  const within = ((base % 12) + 12) % 12;
  if (!LETTER_FROM_SEMITONE.has(within)) LETTER_FROM_SEMITONE.set(within, { letter, accidental: '' });
}
// Fill the five accidental slots with a sharp of the letter below.
for (const [letter, base] of Object.entries(SEMITONE)) {
  const sharp = ((((base + 1) % 12) + 12) % 12);
  if (!LETTER_FROM_SEMITONE.has(sharp)) LETTER_FROM_SEMITONE.set(sharp, { letter, accidental: '#' });
}

/**
 * Format notes back to a canonical notes string. The octave and duration are emitted only when they change from
 * the running default (mirroring the sticky parse rule), so `parseNotes(formatNotes(x))` deep-equals `x`.
 */
export function formatNotes(notes: Note[]): string {
  const out: string[] = [];
  let octave = DEFAULT_OCTAVE;
  let durationLetter = DEFAULT_DURATION;

  for (const note of notes) {
    const dur = DURATION_LETTER.get(note.beats) ?? 'q';
    const durPart = dur !== durationLetter ? dur : '';
    if (dur !== durationLetter) durationLetter = dur;

    if (note.frequency === null) {
      out.push(`r${durPart}`);
      continue;
    }
    const semis = semitonesFromA4(note.frequency);
    const noteOctave = 4 + Math.floor((semis + 9) / 12); // +9 so C is the start of an octave
    const within = ((semis % 12) + 12) % 12;
    const spelled = LETTER_FROM_SEMITONE.get(within)!;
    const octavePart = noteOctave !== octave ? String(noteOctave) : '';
    if (noteOctave !== octave) octave = noteOctave;
    out.push(`${spelled.letter}${spelled.accidental}${octavePart}${durPart}`);
  }
  return out.join(' ');
}

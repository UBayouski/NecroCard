# stack-model — Design

## Module map

```
src/model/
├── types.ts        # All TypeScript interfaces and type aliases (REQ-1)
├── id.ts           # generateId() using crypto.getRandomValues (REQ-2)
├── stack.schema.json  # JSON Schema draft 2020-12 (REQ-3)
├── validate.ts     # validateStack() wrapping ajv (REQ-3.3)
├── serialize.ts    # serializeStack() + deserializeStack() (REQ-4)
├── fixtures.ts     # loadFixture() dynamic import helper (REQ-5.6)
└── serialize.test.ts  # Vitest + fast-check round-trip PBT (REQ-4.4)

fixtures/
├── quiz.necrocard.json
├── adventure.necrocard.json
└── flashcards.necrocard.json
```

No `index.ts` barrel: the module has exactly 5 public export files, which is at the threshold.
Importers use direct paths (`src/model/types.ts`, etc.) until a barrel is justified.

---

## types.ts

Pure type declarations, no runtime code. Exported as named interfaces and type aliases matching
REQ-1 exactly. The `CardObject` discriminated union uses a `type` literal field, which lets
TypeScript narrow in `switch` statements without a cast:

```ts
switch (obj.type) {
  case 'button': // obj is ButtonObject
  case 'field':  // obj is FieldObject
  case 'image':  // obj is ImageObject
}
```

`Rect` uses `number` in the TypeScript type (integers are a subset of `number`; the schema enforces
`integer`). This avoids a custom `Integer` branded type that would add friction for callers.

---

## id.ts

```ts
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const ID_LENGTH = 10;

export function generateId(): string {
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}
```

Notes:
- `crypto.getRandomValues` is available in Node 22 (global `crypto`) and all modern browsers.
- Modulo bias: `ALPHABET.length` is 64, which divides 256 evenly, so there is zero modulo bias.
- Length 10 gives 64^10 ≈ 1.15 × 10^18 possible ids — collision probability is negligible within
  any single stack (which will have at most a few hundred objects).
- The function is synchronous and pure (no side effects beyond the CSPRNG call).

---

## stack.schema.json

Draft 2020-12, `$id: "https://necrocard.app/schemas/stack.json"`.

Key design decisions:

- `$defs` for all reusable sub-schemas: `Rect`, `ButtonObject`, `FieldObject`, `ImageObject`,
  `Background`, `Card`, `StackMetadata`. `ObjectBase` is a TypeScript-only type; it is **not** a
  `$defs` entry in the schema (see composition note below).
- `CardObject` uses `oneOf` with a `type` discriminator property rather than `anyOf`, so ajv can
  give a precise error message pointing to the wrong discriminator value.
- `id` pattern: `"^[A-Za-z0-9_-]{8,10}$"` on every `id` field.
- `Rect` properties: `type: "integer"`, `minimum: 0` for `w` and `h` (width/height cannot be
  negative); `x` and `y` have no minimum (objects can be partially off-card).
- `script`: `type: "string"` only — the schema does not validate NecroTalk syntax (that is the
  interpreter's job).
- `unevaluatedProperties: false` replaces `additionalProperties: false` on composed schemas (see
  below). Standalone leaf schemas (`Rect`, `StackMetadata`) still use `additionalProperties: false`.

### Schema composition: `unevaluatedProperties: false`

Do **not** combine `{ "$ref": "#/$defs/ObjectBase" }` with `additionalProperties: false` inside an
`allOf`. JSON Schema evaluates `additionalProperties` before sibling `$ref` properties are resolved,
so it treats base-type properties as "additional" and rejects valid objects.

The correct approach for `ButtonObject`, `FieldObject`, and `ImageObject` is one of:

**Option A (preferred) — `unevaluatedProperties: false`:**
```json
{
  "$defs": {
    "ObjectBase": {
      "type": "object",
      "properties": {
        "id":      { "type": "string", "pattern": "^[A-Za-z0-9_-]{8,10}$" },
        "name":    { "type": "string" },
        "rect":    { "$ref": "#/$defs/Rect" },
        "visible": { "type": "boolean" },
        "script":  { "type": "string" }
      },
      "required": ["id", "name", "rect", "visible", "script"]
    },
    "ButtonObject": {
      "allOf": [{ "$ref": "#/$defs/ObjectBase" }],
      "properties": {
        "type":        { "const": "button" },
        "style":       { "enum": ["rect", "roundRect", "transparent"] },
        "label":       { "type": "string" },
        "autoHilite":  { "type": "boolean" }
      },
      "required": ["type", "style", "label", "autoHilite"],
      "unevaluatedProperties": false
    }
  }
}
```

`unevaluatedProperties: false` is aware of all properties evaluated across the entire schema
including those inside `$ref`, so it correctly rejects truly unknown fields without blocking
inherited base properties. This requires JSON Schema draft 2019-09 or later; draft 2020-12 fully
supports it, as does ajv's 2020 build.

**Option B — inline all base properties** into each object schema directly (no `$ref` to
`ObjectBase`). More verbose but equally correct. Use this as a fallback if tooling issues arise.

Use Option A. Add `ObjectBase` to `$defs` so the `$ref` resolves, but do not put
`additionalProperties: false` on it or on any schema that uses `allOf` + `$ref` together.

---

## validate.ts

Uses `ajv` (JSON Schema draft 2020-12 build) pinned to an exact version.

```ts
import Ajv2020 from 'ajv/dist/2020';
import schema from './stack.schema.json';

const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(schema);

export class ValidationError extends Error {
  constructor(public readonly errors: ErrorObject[]) {
    super('Stack validation failed:\n' + errors.map(e => `  ${e.instancePath} ${e.message}`).join('\n'));
  }
}

export function validateStack(value: unknown): Stack {
  if (!validate(value)) throw new ValidationError(validate.errors ?? []);
  return value as Stack;
}
```

`ajv` is the only permitted dependency addition in this spec. Pin exact version in `package.json`.

---

## serialize.ts

### serializeStack

Canonical JSON: `JSON.stringify` with a custom replacer that sorts object keys alphabetically at
every level, plus 2-space indent.

```ts
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    );
  }
  return value;
}

export function serializeStack(stack: Stack): string {
  return JSON.stringify(stack, sortedReplacer, 2);
}
```

Arrays are not sorted — array order is significant (card order, object order).

### deserializeStack

```ts
export function deserializeStack(json: string): Stack {
  const parsed: unknown = JSON.parse(json);
  return validateStack(parsed);
}
```

Parse errors from `JSON.parse` propagate as native `SyntaxError`. Validation errors propagate as
`ValidationError`. Callers handle both.

### metadata dates

`metadata.created` and `metadata.modified` are validated with a pattern rather than `format:
"date-time"`. Core ajv does not include format validators, and enabling `strict: true` without
registering a format throws. The pattern covers the ISO 8601 combined date-time form produced by
`new Date().toISOString()`:

```json
"pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+Z$"
```

This matches `2026-11-03T14:00:00.000Z` and similar strings. It is intentionally simple — the
schema enforces structure, not calendar validity. Do not add `ajv-formats` or any other ajv plugin.

### Round-trip guarantee

Because `serializeStack` sorts keys and `deserializeStack` validates the result, and because
`unevaluatedProperties: false` in the schema prevents phantom fields, the output of
`deserializeStack(serializeStack(s))` is structurally identical to `s` for any valid `Stack`.

---

## serialize.test.ts — PBT design

Uses `fast-check` arbitraries. Key decisions:

### Id arbitrary

Do not use `fc.stringOf` or `fc.mapToConstant` — both are deprecated in fast-check v3+. Use
`fc.stringOf` replacement via `fc.string` with a character pool, or build directly with
`fc.integer` mapped to alphabet characters:

```ts
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

const idArb: fc.Arbitrary<string> = fc.integer({ min: 0, max: ALPHABET.length - 1 })
  .map(i => ALPHABET[i])
  .chain(() =>
    fc.array(
      fc.integer({ min: 0, max: ALPHABET.length - 1 }).map(i => ALPHABET[i]),
      { minLength: 8, maxLength: 10 }
    ).map(chars => chars.join(''))
  );
```

Simpler alternative using `fc.constantFrom` spread across the alphabet:

```ts
const idCharArb = fc.constantFrom(...ALPHABET.split(''));
const idArb = fc.array(idCharArb, { minLength: 8, maxLength: 10 }).map(cs => cs.join(''));
```

Use whichever form is clearest; both are correct. Verify the chosen API against the pinned
fast-check version before committing.

### Unique-id constraint

Generate a flat pool of ids using `fc.uniqueArray(idArb, { minLength: N })`, then assign them to
positions in the Stack structure. This avoids the complexity of filtering duplicates after
generation. N must be large enough to cover all id slots in the generated stack structure
(stack + backgrounds + cards + all objects).

### String fields — Unicode

Use `fc.string({ unit: 'grapheme' })` for `name`, `text`, `script`, and `author` fields. This
generates full Unicode grapheme clusters including emoji, accented characters, and CJK. Do not use
bare `fc.string()` — it produces only ASCII in most fast-check versions and does not satisfy the
Unicode coverage requirement in REQ-4.4.

If the pinned fast-check version does not support `{ unit: 'grapheme' }`, use
`fc.fullUnicodeString()` as the fallback. Check the pinned version's changelog before choosing.

### Metadata date fields

Use `fc.date({ noInvalidDate: true }).map(d => d.toISOString())` for `metadata.created` and
`metadata.modified`. This produces valid ISO 8601 strings that match the schema pattern and
exercises the full date range.

### Stack arbitrary

```ts
const stackArb: fc.Arbitrary<Stack> = fc.record({
  backgrounds: fc.array(backgroundArb, { minLength: 1, maxLength: 3 }),
  cards: fc.array(cardArb, { minLength: 0, maxLength: 5 }),
  // ...
});
```

Cards reference background ids; the arbitrary ensures `backgroundId` is always drawn from the
backgrounds generated in the same Stack (use `fc.record` + `fc.chain` or a pool approach).

### PBT assertion

```ts
it('round-trip identity', () => {
  fc.assert(
    fc.property(stackArb, stack => {
      const json = serializeStack(stack);
      const restored = deserializeStack(json);
      expect(restored).toEqual(stack);
    }),
    { numRuns: 200 }
  );
});
```

---

## Fixture design

All three fixtures follow the same structure:
- One background shared by all cards (background `script: ""`).
- One stack `script: ""`.
- Spooky Halloween theme in names and text.
- All object ids generated by `generateId()` during fixture authoring and committed as static strings.

### quiz.necrocard.json sketch

5 cards: title, Q1, Q2, Q3, results.
- Title card: one "Begin" button → `go to card "Q1"`.
- Each Qn card: question field (lockText true) + 2–3 answer buttons. One correct button → increments
  a score field and goes next. Wrong buttons → show a "Wrong!" field briefly (actually just navigate
  on any button for simplicity in the first fixture).
- Results card: a field showing a completion message.

### adventure.necrocard.json sketch

5 cards: intro + 4 branching scenes.
- Each card: a story-text field (lockText true) + 2 choice buttons.
- Buttons use `go to card "Name"` for branching. At least one cycle (return path).

### flashcards.necrocard.json sketch

6 cards: title + 4 flashcard cards + end card.
- Each flashcard: question field (visible, lockText true), answer field (visible false, lockText true),
  "Flip" button (`show field "Answer"` / `hide field "Answer"` via toggle — simplified to always
  show on flip), "Next" and "Prev" navigation buttons.

---

## Dependency

`ajv` (exact version, draft 2020-12 build) is the only new runtime dependency introduced by this spec.
`fast-check` is a dev dependency; it should already be listed per `tech.md`. If not present, add it
pinned to an exact version.

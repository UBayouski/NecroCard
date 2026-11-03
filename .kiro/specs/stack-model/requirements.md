# stack-model — Requirements

## Overview

Define the NecroCard stack data model: all TypeScript types, the canonical JSON schema, lossless
serialization/deserialization, object id generation, and three sample stacks committed as fixtures.
This is spec 1 of 8. All downstream specs depend on the types and schema produced here.

---

## REQ-1 — TypeScript types for the full object model

The following types must be defined in `src/model/types.ts`. No other source file may declare parallel
or conflicting versions of these types.

### REQ-1.1 — Stack

```ts
interface Stack {
  id: string;           // short URL-safe id, unique within the stack
  name: string;
  backgrounds: Background[];
  cards: Card[];
  script: string;       // stack-level NecroTalk handler source, may be empty string
  metadata: StackMetadata;
}

interface StackMetadata {
  created: string;      // ISO 8601 date-time string
  modified: string;     // ISO 8601 date-time string
  author: string;       // free text, may be empty string
}
```

### REQ-1.2 — Background

```ts
interface Background {
  id: string;
  name: string;
  objects: CardObject[];
  script: string;
}
```

### REQ-1.3 — Card

```ts
interface Card {
  id: string;
  name: string;
  backgroundId: string; // must reference a Background.id that exists in the same Stack
  objects: CardObject[];
  script: string;
}
```

### REQ-1.4 — CardObject union

```ts
type CardObject = ButtonObject | FieldObject | ImageObject;

interface ObjectBase {
  id: string;
  name: string;
  rect: Rect;
  visible: boolean;
  script: string;
}

interface Rect {
  x: number;   // logical pixels, origin top-left of card
  y: number;
  w: number;
  h: number;
}

interface ButtonObject extends ObjectBase {
  type: 'button';
  style: 'rect' | 'roundRect' | 'transparent';
  label: string;
  autoHilite: boolean;
}

interface FieldObject extends ObjectBase {
  type: 'field';
  text: string;
  lockText: boolean;
  style: 'rect' | 'scrolling' | 'transparent';
}

interface ImageObject extends ObjectBase {
  type: 'image';
  src: string;   // data URL or asset id string
}
```

### REQ-1.5 — No extra types

Do not define types for paint objects, sounds, menus, or any concept not listed in REQ-1.1–1.4.
Adding new object types or properties requires explicit approval (see `product.md`).

---

## REQ-2 — Short URL-safe object ids

### REQ-2.1 — Format

Every `id` field on Stack, Background, Card, and CardObject must be a short random string of exactly
8–10 URL-safe characters drawn from the alphabet `A-Za-z0-9_-` (the standard URL-safe base64 / nanoid
alphabet). UUID v4 strings must not be used.

### REQ-2.2 — Uniqueness scope

Ids must be unique within the stack document (across all backgrounds, cards, and objects). Two objects
in different cards must not share an id.

### REQ-2.3 — Stability

Once assigned, an id is never changed or reused after deletion. The id generation function must be
pure (no side effects) and exported from `src/model/id.ts`.

### REQ-2.4 — Generation function

```ts
// src/model/id.ts
export function generateId(): string;
```

The implementation must not use `Math.random()` alone; use `crypto.getRandomValues` (browser/Node 22)
for cryptographic-quality randomness. No external dependency is required or permitted for this function.

---

## REQ-3 — JSON schema

### REQ-3.1 — Schema file

A JSON Schema (draft 2020-12) document must be committed at `src/model/stack.schema.json`. It must
fully describe the Stack type including all nested types, required fields, and enum constraints.

### REQ-3.2 — Coverage

The schema must enforce:
- All required fields on every type (no optional fields that are actually always present).
- Enum values for `ButtonObject.style`, `FieldObject.style`, and `CardObject.type`.
- `Rect` field types as `integer` (logical pixels are always whole numbers).
- `id` fields as `string` with `pattern: "^[A-Za-z0-9_-]{8,10}$"`.
- `metadata.created` and `metadata.modified` as `string` with a pattern matching ISO 8601
  date-time strings of the form produced by `Date.prototype.toISOString()`:
  `"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+Z$"`.
  Do not use `format: "date-time"` — core ajv has no format validators and strict mode throws
  on unregistered formats.

### REQ-3.3 — Schema validator

A thin validation wrapper must be exported from `src/model/validate.ts`:

```ts
export function validateStack(value: unknown): Stack;
// Throws a descriptive ValidationError if the value does not conform.
// Returns the typed Stack if it does.
```

The validator may use a bundled JSON Schema library (e.g. `ajv`) pinned to an exact version. If `ajv`
is chosen, import only the core 2020-12 validator with no plugins or format extensions.

---

## REQ-4 — Lossless serialization round-trip

### REQ-4.1 — Serialize

```ts
// src/model/serialize.ts
export function serializeStack(stack: Stack): string;
// Returns a canonical JSON string (keys sorted, 2-space indent).
```

### REQ-4.2 — Deserialize

```ts
export function deserializeStack(json: string): Stack;
// Parses, validates via validateStack, and returns a typed Stack.
// Throws if the JSON is invalid or fails schema validation.
```

### REQ-4.3 — Round-trip identity invariant

For any Stack value `s`:
```
deserializeStack(serializeStack(s)) deep-equals s
```

This invariant must hold for all representative Stack values, including empty stacks, stacks with
multiple backgrounds, stacks with all three object types, and stacks with non-ASCII characters in
`name`, `text`, and `script` fields.

### REQ-4.4 — Property-based test (fast-check)

A `src/model/serialize.test.ts` file must use `fast-check` to generate arbitrary `Stack` values and
assert the round-trip identity invariant (REQ-4.3) for at least 200 generated examples per run.

The fast-check arbitrary for `Stack` must:
- Generate valid `id` strings matching the pattern in REQ-2.1.
- Generate unique ids within the stack (no two objects share an id within one generated Stack).
- Cover stacks with 0, 1, and multiple cards.
- Cover all three `CardObject` types.
- Include strings with Unicode characters (emoji, accented characters, CJK) in text fields.

### REQ-4.5 — Canonical key order

`serializeStack` must produce keys in a stable, deterministic order (alphabetical within each object
level). Two Stack values that are deep-equal must always produce identical JSON strings. This is
required for content-hash-based caching in the share feature.

---

## REQ-5 — Sample stacks in fixtures/

### REQ-5.1 — Three fixture files

Three sample stacks must be committed as:

```
fixtures/
├── quiz.necrocard.json
├── adventure.necrocard.json
└── flashcards.necrocard.json
```

Each file must be a valid serialized Stack (passes `validateStack` and `deserializeStack` without error).

### REQ-5.2 — quiz.necrocard.json

A short multiple-choice quiz with at least 3 question cards and a results card. Each question card
must have button objects for each answer choice. Buttons must have NecroTalk scripts using
`go next` / `go to card`. Carries a Halloween / spooky theme.

### REQ-5.3 — adventure.necrocard.json

A choose-your-own-adventure with at least 4 cards and meaningful branching (each card has at least
two choices leading to different cards). Button scripts use `go to card "Name"`. Spooky theme.

### REQ-5.4 — flashcards.necrocard.json

A flashcard deck with at least 4 cards. Each card has a field for the question and a field for the
answer. A "Flip" button toggles answer visibility using `show` / `hide`. Navigation buttons use
`go next` / `go prev`. May have a title card. Spooky theme.

### REQ-5.5 — Scripts must parse

Every `script` field in every fixture must be valid NecroTalk source that passes the parser introduced
in spec `necrotalk-interpreter`. For this spec, scripts must at minimum be non-empty strings that
follow the `on <handler> ... end <handler>` structure where scripts are non-empty. Empty string `""`
is valid for objects with no behaviour.

### REQ-5.6 — Loader utility

A `src/model/fixtures.ts` module must export a `loadFixture` function:

```ts
export async function loadFixture(
  name: 'quiz' | 'adventure' | 'flashcards'
): Promise<Stack>;
```

This is used by the Summon feature and sample-stack UI to load stacks without AI calls.

---

## REQ-6 — Module boundary and exports

### REQ-6.1 — Public surface

`src/model/` must export only via named exports. The public surface is:

| Export | From |
|---|---|
| Types: `Stack`, `Background`, `Card`, `CardObject`, `ButtonObject`, `FieldObject`, `ImageObject`, `ObjectBase`, `Rect`, `StackMetadata` | `src/model/types.ts` |
| `generateId` | `src/model/id.ts` |
| `validateStack`, `ValidationError` | `src/model/validate.ts` |
| `serializeStack`, `deserializeStack` | `src/model/serialize.ts` |
| `loadFixture` | `src/model/fixtures.ts` |

### REQ-6.2 — No barrel unless needed

Do not create `src/model/index.ts` unless the module has more than 5 public symbols that are
frequently imported together. If created, it must re-export only the symbols listed in REQ-6.1.

### REQ-6.3 — Forbidden imports

`src/model/` must not import from `src/interp/`, `src/ui/`, `src/summon/`, `src/share/`, or
`src/worker/`. It is the lowest layer of the dependency graph.

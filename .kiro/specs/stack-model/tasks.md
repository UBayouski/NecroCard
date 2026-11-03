# stack-model — Tasks

Execute in order. Each task is independently verifiable. Do not start a task until the previous one passes its acceptance check.

---

## Task 1 — Project scaffold

Set up the TypeScript/Vite project so that `npm run typecheck`, `npm test`, and `npm run build` all run
(they may produce zero results at this stage, but the commands must not fail with "script not found").

**Steps:**
1. Initialise `package.json` with `name: "necrocard"`, `type: "module"`, Node 22 engine requirement.
2. Install dev dependencies (pinned exact versions): `typescript`, `vite`, `vitest`, `fast-check`,
   `eslint`, `@eslint/js`, `typescript-eslint`.
3. Install runtime dependency (pinned exact version): `ajv` (2020-12 build — package `ajv`).
4. Create `tsconfig.json`: `strict: true`, `target: "ES2022"`, `module: "ESNext"`,
   `moduleResolution: "bundler"`, `resolveJsonModule: true`, `noEmit: true`.
5. Create `vite.config.ts` with Vitest configuration: `test.include: ['src/**/*.test.ts']`,
   `test.reporter: 'verbose'`.
6. Create a minimal `eslint.config.js` (flat config format) using `@eslint/js` recommended rules
   and `typescript-eslint` recommended rules so that `npx eslint src` runs without errors on an
   empty `src/` directory:
   ```js
   import js from '@eslint/js';
   import tseslint from 'typescript-eslint';
   export default tseslint.config(
     js.configs.recommended,
     ...tseslint.configs.recommended,
   );
   ```
7. Add npm scripts: `dev`, `build`, `test` (`vitest --run`), `typecheck` (`tsc --noEmit`),
   `lint` (`eslint src`), `e2e` (placeholder `echo "no e2e yet"`).
8. Create `index.html` (minimal shell, links to `src/main.ts`).
9. Create `src/main.ts` with a single comment `// NecroCard entry point`.

**Acceptance:** `npm run typecheck` exits 0; `npm test` exits 0 (zero tests); `npm run build` produces
a `dist/` folder.

---

## Task 2 — Types (`src/model/types.ts`)

Implement all TypeScript types from REQ-1 exactly as specified.

**Steps:**
1. Create `src/model/types.ts` exporting `Stack`, `StackMetadata`, `Background`, `Card`,
   `CardObject`, `ButtonObject`, `FieldObject`, `ImageObject`, `ObjectBase`, `Rect`.
2. Ensure `CardObject` is a discriminated union on `type` literal.
3. Do not add any runtime code — this file is types only.

**Acceptance:** `npm run typecheck` exits 0. Import the types in a scratch expression and confirm
all discriminated union narrowing works (check with `tsc` alone, no test file needed).

---

## Task 3 — Id generation (`src/model/id.ts`)

Implement `generateId()` per REQ-2 and the design.

**Steps:**
1. Create `src/model/id.ts` with the `ALPHABET`, `ID_LENGTH`, and `generateId` implementation from
   the design doc.
2. Write `src/model/id.test.ts` with unit tests:
   - Generated id matches `/^[A-Za-z0-9_-]{10}$/`.
   - 1000 generated ids are all unique (collision resistance smoke test).
   - Function is importable and callable in both Node and browser-compatible environments.

**Acceptance:** `npm test` passes with the id tests green.

---

## Task 4 — JSON Schema (`src/model/stack.schema.json`)

Author the JSON Schema document per REQ-3 and the design.

**Steps:**
1. Create `src/model/stack.schema.json` (draft 2020-12).
2. Define `$defs` for `Rect`, `ObjectBase`, `ButtonObject`, `FieldObject`, `ImageObject`,
   `Background`, `Card`, `StackMetadata`. Root schema is `Stack`.
3. Use `unevaluatedProperties: false` (not `additionalProperties: false`) on `ButtonObject`,
   `FieldObject`, and `ImageObject` schemas that compose via `allOf` + `$ref`. Do not combine
   `additionalProperties: false` with `allOf`/`$ref` — it rejects valid base-type properties.
   Standalone leaf schemas (`Rect`, `StackMetadata`) may use `additionalProperties: false`.
4. Enforce: required fields, enum constraints, integer rects, id pattern
   (`"^[A-Za-z0-9_-]{8,10}$"`), date-time pattern on `metadata.created` / `metadata.modified`
   (`"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+Z$"`). Do not use `format: "date-time"` —
   core ajv has no format validators and strict mode throws on unknown formats.
5. Validate the schema itself with `ajv --strict` or by running the validator in a quick Node
   script during this task (not a CI step, just a one-time author-time check).

**Acceptance:** The schema file exists and is valid JSON. A quick manual `ajv validate` or equivalent
confirms the schema compiles without errors.

---

## Task 5 — Validator (`src/model/validate.ts`)

Implement `validateStack` and `ValidationError` per REQ-3.3 and the design.

**Steps:**
1. Create `src/model/validate.ts` importing `ajv/dist/2020` and the schema JSON with a plain
   `import schema from './stack.schema.json'` (no import assertion — `resolveJsonModule` handles it).
2. Export `ValidationError extends Error` with an `errors` property (ajv `ErrorObject[]`).
3. Export `validateStack(value: unknown): Stack`. Do not register any ajv plugins or formats.
4. Write `src/model/validate.test.ts`:
   - Valid minimal Stack passes without throwing.
   - Stack missing required field throws `ValidationError`.
   - Stack with wrong enum value throws `ValidationError`.
   - Stack with an id not matching the pattern throws `ValidationError`.
   - Unknown extra field throws `ValidationError` (additionalProperties).

**Acceptance:** `npm test` passes with all validator tests green. `npm run typecheck` exits 0.

---

## Task 6 — Serialization (`src/model/serialize.ts`)

Implement `serializeStack` and `deserializeStack` per REQ-4.

**Steps:**
1. Create `src/model/serialize.ts` with the sorted-key replacer and both functions.
2. Write unit tests in `src/model/serialize.test.ts` (non-PBT section):
   - `serializeStack` returns a string that `JSON.parse` can parse back to an equal object.
   - Keys are in alphabetical order at the top level and in nested objects.
   - `deserializeStack` of valid JSON returns a typed Stack.
   - `deserializeStack` of malformed JSON throws `SyntaxError`.
   - `deserializeStack` of valid JSON that fails schema throws `ValidationError`.

**Acceptance:** `npm test` passes all serialize unit tests. `npm run typecheck` exits 0.

---

## Task 7 — Property-based round-trip test

Add the fast-check PBT to `src/model/serialize.test.ts` per REQ-4.4 and the design.

**Steps:**
1. Implement `idArb` using the current fast-check API — do not use deprecated `fc.stringOf` or
   `fc.mapToConstant`. Use `fc.constantFrom(...ALPHABET.split(''))` mapped to an array, or
   `fc.integer` mapped over the alphabet string. Verify against the pinned version.
2. Implement a unique-id pool helper using `fc.uniqueArray(idArb, { minLength: N })` where N
   covers all id slots in the generated Stack.
3. Implement arbitraries: `rectArb`, `buttonArb`, `fieldArb`, `imageArb`, `cardObjectArb`,
   `backgroundArb`, `cardArb`, `stackArb`.
4. Use `fc.string({ unit: 'grapheme' })` for all `name`, `text`, `script`, and `author` string
   fields to generate full Unicode grapheme clusters. If the pinned version does not support
   `{ unit: 'grapheme' }`, use `fc.fullUnicodeString()` as a fallback.
5. Use `fc.date({ noInvalidDate: true }).map(d => d.toISOString())` for `metadata.created` and
   `metadata.modified`.
6. Ensure `cardArb` always draws `backgroundId` from the backgrounds generated in the same Stack.
7. Add the `fc.assert` property test with `numRuns: 200`.

**Acceptance:** `npm test` passes; the PBT runs 200 examples with no failures. If fast-check finds
a counter-example, fix the serialization or type code (do not reduce `numRuns`).

---

## Task 8 — Sample stacks (`fixtures/`)

Commit the three fixture JSON files per REQ-5.

**Steps:**
1. Create `fixtures/` directory.
2. Author `quiz.necrocard.json` per REQ-5.2 (spooky quiz, 5 cards, button scripts).
3. Author `adventure.necrocard.json` per REQ-5.3 (spooky CYOA, 5 cards, branching buttons).
4. Author `flashcards.necrocard.json` per REQ-5.4 (spooky flashcards, 6 cards, show/hide flip).
5. All ids must be hand-authored 10-character strings from the valid alphabet (or generated by a
   one-off script and pasted in).
6. Run `deserializeStack(readFileSync(...))` on each fixture in a throw-away script or test to
   confirm they pass validation before committing.

**Acceptance:** All three files exist. A test in `src/model/fixtures.test.ts` loads each via
`deserializeStack(JSON.stringify(...))` (or imports the JSON directly) and asserts it passes
`validateStack` without throwing.

---

## Task 9 — Fixture loader (`src/model/fixtures.ts`)

Implement `loadFixture` per REQ-5.6.

**Steps:**
1. Create `src/model/fixtures.ts` exporting `loadFixture`.
2. Implement using dynamic `import()` for JSON modules — with `resolveJsonModule: true` in
   `tsconfig.json`, no import assertion syntax is needed. Use `import('./../../fixtures/quiz.necrocard.json')`
   style paths so Vite bundles the fixtures and no network request is required at runtime.
3. Return a `Promise<Stack>` that resolves to a validated Stack.
4. Add unit test: `loadFixture('quiz')` resolves and the result passes `validateStack`.

**Acceptance:** `npm test` passes all fixture loader tests. `npm run typecheck` exits 0.

---

## Task 10 — Final verification

Run the full suite and confirm the spec is complete.

**Steps:**
1. `npm run typecheck` — must exit 0.
2. `npm test` — all tests pass, PBT runs 200 examples.
3. `npm run build` — production build succeeds, no type errors in build output.
4. `npm run lint` — no errors (warnings acceptable if pre-existing).
5. Confirm `src/model/` contains exactly the files listed in the design module map (no extra files).
6. Confirm `fixtures/` contains exactly the three `.necrocard.json` files.
7. Confirm no import in `src/model/` crosses the forbidden boundaries in REQ-6.3.

**Acceptance:** All six checks pass. The spec is done when this task is green.

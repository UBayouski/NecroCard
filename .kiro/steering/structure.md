# NecroCard — Project Structure Steering

## Directory layout

```
necrocard/
├── docs/                   # Project documentation (BRIEF.md, etc.)
├── .kiro/
│   ├── steering/           # Steering files (product.md, tech.md, structure.md, necrotalk.md, retro-ui.md)
│   ├── specs/              # Spec files (stack-model, necrotalk-interpreter, etc.)
│   ├── hooks/              # Hook definitions
│   ├── agents/             # Custom agent definitions
│   └── settings/           # mcp.json (MCP server configuration)
├── src/
│   ├── model/              # Stack data model, types, JSON schema, serialization
│   ├── interp/             # NecroTalk tokenizer, parser, AST, evaluator
│   ├── ui/                 # DOM rendering, card surface, browse mode, edit mode
│   │   ├── browse/         # Browse mode: card render, hit testing, transitions
│   │   ├── edit/           # Edit mode: selection, move, resize, inspector, tools
│   │   └── script-editor/  # Script editor: highlighting, inline errors, message box
│   ├── summon/             # AI authoring: prompt, validation, retry, BYO-key
│   ├── share/              # localStorage autosave, export/import, URL share
│   ├── worker/             # Cloudflare Worker source (Summon endpoint, blob store)
│   └── assets/             # Fonts, patterns, static images
├── test/
│   └── e2e/                # Playwright end-to-end tests
├── fixtures/               # Sample stack JSON files (3–4 stacks)
├── public/                 # Static assets served by Vite
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

## Naming conventions

- **Files**: `camelCase.ts` for modules, `PascalCase.ts` for classes/types when the file exports one primary type.
- **Test files**: co-located with source as `<module>.test.ts`. E2e tests live in `test/e2e/`.
- **Types**: PascalCase interfaces and type aliases (e.g., `CardObject`, `StackModel`).
- **Constants**: SCREAMING_SNAKE_CASE for true constants (e.g., `CARD_WIDTH`, `CARD_HEIGHT`).
- **CSS classes**: kebab-case (e.g., `card-surface`, `button-rect`).
- **IDs in the stack model**: short random URL-safe strings, 8–10 characters (e.g. `nanoid` alphabet: `A-Za-z0-9_-`), unique within the stack, never reused after deletion. UUID v4 is too long for compressed share URLs.

## Module boundaries

| Module | Allowed imports | Forbidden imports |
|---|---|---|
| `src/model/` | Nothing from `src/` except other `model/` files | `interp/`, `ui/`, `summon/`, `share/` |
| `src/interp/` | `src/model/` types only | `ui/`, `summon/`, `share/`, `worker/` |
| `src/ui/` | `src/model/`, `src/interp/`, `src/summon/` public modules (e.g. `src/summon/agentClient.ts`) | `src/worker/`, non-public `src/summon/` internals |
| `src/summon/` | `src/model/`, `src/interp/` | `src/ui/` (never, in any form) |
| `src/share/` | `src/model/` | `src/interp/`, `src/ui/` internals |
| `src/worker/` | `src/model/`, `src/summon/` | All browser APIs |

The evaluator (`src/interp/`) must not import the tokenizer or parser at runtime — only AST types.

## Spec-to-folder mapping

| Spec | Primary folder |
|---|---|
| `stack-model` | `src/model/` |
| `necrotalk-interpreter` | `src/interp/` |
| `browse-mode` | `src/ui/browse/` |
| `edit-mode` | `src/ui/edit/` |
| `script-editor` | `src/ui/script-editor/` |
| `summon` | `src/summon/`, `src/worker/` |
| `sharing` | `src/share/`, `src/worker/` |
| `retro-skin` | `src/ui/`, `src/assets/`, CSS files |

## File size and scope

- Keep files focused: one primary export per file where practical.
- If a file exceeds ~300 lines, consider splitting by concern.
- No barrel `index.ts` re-exports unless the module has more than 5 public symbols.

## Assets

- Fonts go in `src/assets/fonts/`. Use `@font-face` in a dedicated CSS file.
- 1-bit dither patterns go in `src/assets/patterns/` as small PNG or inline SVG data URLs.
- Sample stacks go in `fixtures/` as `*.necrocard.json`.

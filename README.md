# NecroCard

**HyperCard, raised from the dead.** Describe a stack in plain English and NecroCard builds the cards, buttons, fields,
and HyperTalk-style scripts. Then click through it, edit it, and share it by URL.

Built for **Kiroween 2026**, category **Resurrection**, with [Kiro](https://kiro.dev).

> Status: scaffolding. Nothing runs yet.

## What it is

HyperCard (1987 to 2004) let anyone build interactive software by stacking cards, dropping buttons and fields onto
them, and writing small English-like scripts. NecroCard brings that model back in the browser and adds the one thing
1987 did not have: an agent that writes the stack for you from a sentence.

- **Stacks, backgrounds, cards.** Objects: buttons, fields, images. Each has properties and a script.
- **NecroTalk.** A frozen subset of HyperTalk: handlers, navigation, `put`/`get`/`set`, `if`/`repeat`, `answer`/`ask`,
  visual effects.
- **Summon.** Type a description, get a working stack with scripts. Explain and fix scripts in the editor.
- **Share.** Save locally, export JSON, or share a stack by URL.
- **Look.** 1-bit Macintosh: Chicago-style type, dither patterns, bevelled buttons, dissolve transitions.

## Run

Coming soon. Target: `npm install`, `npm run dev`.

## Built with Kiro

Specs, steering docs, hooks, custom agents, and MCP settings live in [`.kiro/`](.kiro/). The running log of how Kiro
was used during the build is in [`KIRO_USAGE.md`](KIRO_USAGE.md). The full write-up is added before submission.

## Disclosure

NecroCard was created from scratch during the Kiroween 2026 submission period (October 30 to December 4, 2026).
It uses standard open source frameworks and libraries only; no other pre-existing code is incorporated.

## License

MIT. See [LICENSE](LICENSE).

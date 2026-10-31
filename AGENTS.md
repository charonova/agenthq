# AGENTS.md

AgentHQ turns live Claude Code sessions into a 2D pixel-art office: one office per session, the session's agent as manager, teammates as staff, their helpers as interns. A Node CLI reads `~/.claude` and serves a local page; the page draws the building with PixiJS.

## Layout

| Path                                | Responsibility                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/tail.ts`         | Reading the end of a transcript (never the whole file) and what its last lines say: step, tool, title, context                                                                                          |
| `packages/core/src/state.ts`        | Turning that into what the office shows: working, waiting, done, idle (coffee, couch), gone                                                                                                             |
| `packages/core/src/office.ts`       | Finding live sessions (from a list of recently used ones, redone every 30 s) and building offices: manager, staff, interns                                                                              |
| `packages/cli/src/server.ts`        | The local server: the page, `/api/offices`, `/events` (Server-Sent Events, only on change; rescans every 2 s and on file changes). 127.0.0.1 only                                                       |
| `packages/core/src/processes.ts`    | Running sessions from `~/.claude/sessions/<pid>.json` (pid ↔ session id), live processes only                                                                                                           |
| `packages/cli/src/jump.ts`          | Going to a session: the process table → the app above the session's process → a plan (Terminal/iTerm2 tab by tty, editor window by folder, the app, or copying `claude --resume`), then carrying it out |
| `packages/cli/src/cli.ts`           | `agenthq` (opens the office), `--list` / `--json`, `--port`, `--no-open`                                                                                                                                |
| `apps/web/src/scene/layout.ts`      | The floor plan in tiles, and which tiles furniture blocks                                                                                                                                               |
| `apps/web/src/scene/path.ts`        | A* on the floor plan, so people walk around furniture                                                                                                                                                   |
| `apps/web/src/scene/plan.ts`        | Who goes where for what they're doing, and what their bubble says (pure: tested)                                                                                                                        |
| `apps/web/src/scene/art/`           | Pixel art drawn in code: `people` (a look per name), `furniture`, `paint`                                                                                                                               |
| `apps/web/src/scene/textures.ts`    | Art drawn once into cached textures (a person's look × pose × frame)                                                                                                                                    |
| `apps/web/src/scene/OfficeScene.ts` | One office in PixiJS: layers, depth sorting, walking, bubbles, name tags, night                                                                                                                         |
| `apps/web/src/scene/World.ts`       | The PixiJS app and camera (pixi-viewport): offices on one map, zooming into one, clicks                                                                                                                 |
| `apps/web/src/state/`               | Zustand store; the event stream (`?once` loads once); the `#/office/<id>` route                                                                                                                         |
| `apps/web/src/ui/`                  | React: header, the canvas host, the side panel                                                                                                                                                          |
| `e2e/`                              | Playwright on a made-up `~/.claude` (`fixture-home.mjs`), served by `serve.mjs`                                                                                                                         |

## Commands

`pnpm dev` (server + Vite, hot reload) · `pnpm check` (lint, format, types, tests) · `pnpm build` · `pnpm e2e` (after a build) · `pnpm start`.

## Rules

- **Read only.** Never write to `~/.claude`, never run Claude Code, never send anything off the machine.
- **Never read a whole transcript.** They reach gigabytes: read the last ~96 KB (and the first ~32 KB for the title). Rescans reuse tails until a file changes.
- **The format isn't documented.** Parse defensively: unknown line types are skipped, missing fields are null. Every field the reader relies on gets a test with a line shaped like the real one (compact JSON, no space after `:`).
- **Staff and interns come from `.meta.json`**: `spawnDepth: 0` / `taskKind: in_process_teammate` is a teammate (`name`, `color`, `model`, `permissionMode`); deeper ones are helpers with `parentAgentId` and `finished`. Helpers work in the permission mode of whoever started them.
- **Tests and screenshots never use real transcripts or names.** Use made-up data shaped like the real thing (`e2e/fixture-home.mjs`).
- **`POST /api/jump` is guarded**: POST only, the `X-AgentHQ: 1` header (other sites can't send it without a CORS preflight, never answered), a localhost `Host` (no DNS rebinding), and only sessions in the office. It runs programs directly (`osascript`, `open`, `ps`), never a shell; a tty goes into AppleScript only as `ttys123`.
- **Never read `~/.claude/sessions/*.key`**: they're secrets. Only `<pid>.json`.
- **Claude Code's own `status` beats guessing, for the lead only** (`applyStatus`): `busy` → working (a pending tool is running); `idle` with a pending tool → waiting for you; `idle` otherwise → its turn is over. Other words (`shell`…) leave the guess from the transcript's quiet time alone. A session with no process (where `~/.claude/sessions` exists) has ended: nobody in it works or waits. A running session stays in the building however long it's quiet.
- **Tests never open real windows**: the e2e server runs with `AGENTHQ_JUMP=copy`.
- **The server listens on 127.0.0.1 only.** Text from transcripts reaches the page as text (React children, Pixi `Text`), never as HTML.
- **Idle costs little.** The scene runs at 30 fps at most and stops in a hidden tab; art is drawn once into textures, and each frame only swaps them.
- **Pure logic stays out of PixiJS.** Layout, paths and plans are plain functions with tests; the scene only draws what they decide.
- **Pixi classes extend `Container`**: don't reuse its member names (`label`, `height`, `width`…).
- pnpm blocks dependencies' install scripts; only `esbuild` is allowed (`pnpm-workspace.yaml`).

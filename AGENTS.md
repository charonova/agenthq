# AGENTS.md

AgentHQ turns live Claude Code sessions into a 2D pixel-art office: one office per session, the session's agent as manager, teammates as staff, their helpers as interns. Browser-based and cross-platform: a Node CLI reads `~/.claude` and serves the office to a local page (`npm start`).

## Layout

| Path | Responsibility |
|---|---|
| `src/core/tail.ts` | Reading the end of a transcript (never the whole file) and what its last lines say: step, tool, title, context |
| `src/core/state.ts` | Turning that into what the office shows: working, waiting, done, idle (coffee, couch), gone |
| `src/core/office.ts` | Finding live sessions and building offices: manager, staff, interns |
| `src/server.ts` | The local server: the page, `/api/offices`, and `/events` (Server-Sent Events, sent only when something changed; rescans every 2 s and on file changes). Loopback only |
| `src/cli.ts` | `agenthq` (opens the office), `--list` / `--json`, `--port`, `--no-open` |
| `web/art.ts` | Pixel art drawn in code: people (a look per name: skin, hair, team-coloured shirt) and furniture |
| `web/room.ts` | One office: the floor plan, where each agent goes for what it's doing, walking, bubbles, clicks |
| `web/main.ts` | The page: the building (a live miniature per office) and one office with its people listed |
| `test/` | Vitest suites with made-up lines shaped like real transcripts |

## Rules

- **Read only.** Never write to `~/.claude`, never run Claude Code, never send anything off the machine.
- **Never read a whole transcript.** They reach gigabytes: read the last ~96 KB (and the first ~32 KB for the title).
- **The format isn't documented.** Parse defensively: unknown line types are skipped, missing fields are null. Every new field the reader relies on gets a test with a line shaped like the real one (compact JSON, no space after `:`).
- **Staff and interns come from `.meta.json`**: `spawnDepth: 0` / `taskKind: in_process_teammate` is a teammate (with `name`, `color`, `model`, `permissionMode`); deeper ones are helpers with `parentAgentId` and `finished`.
- **Tests never use real transcripts or real names**; describe real data only by its shape.
- **The server listens on 127.0.0.1 only**: transcripts are private. Text from transcripts reaches the page as text (`textContent`, canvas `fillText`), never as HTML.
- **Idle costs little**: the page draws ~20 frames a second, only canvases on screen, nothing in a hidden tab. The server rescans live sessions from a list of recently used ones (redone every 30 s): `~/.claude/projects` holds thousands of sessions.
- Screenshots: `?once` loads the offices once instead of streaming (headless Chrome never finishes a page that's streaming).

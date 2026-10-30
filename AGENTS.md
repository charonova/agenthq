# AGENTS.md

AgentHQ turns live Claude Code sessions into a 2D pixel-art office: one office per session, the session's agent as manager, teammates as staff, their helpers as interns. Browser-based and cross-platform: a Node CLI reads `~/.claude` and (soon) serves the office to a local page.

## Layout

| Path | Responsibility |
|---|---|
| `src/core/tail.ts` | Reading the end of a transcript (never the whole file) and what its last lines say: step, tool, title, context |
| `src/core/state.ts` | Turning that into what the office shows: working, waiting, done, idle (coffee, couch), gone |
| `src/core/office.ts` | Finding live sessions and building offices: manager, staff, interns |
| `src/cli.ts` | `agenthq --list` / `--json` |
| `test/` | Vitest suites with made-up lines shaped like real transcripts |

## Rules

- **Read only.** Never write to `~/.claude`, never run Claude Code, never send anything off the machine.
- **Never read a whole transcript.** They reach gigabytes: read the last ~96 KB (and the first ~32 KB for the title).
- **The format isn't documented.** Parse defensively: unknown line types are skipped, missing fields are null. Every new field the reader relies on gets a test with a line shaped like the real one (compact JSON, no space after `:`).
- **Staff and interns come from `.meta.json`**: `spawnDepth: 0` / `taskKind: in_process_teammate` is a teammate (with `name`, `color`, `model`, `permissionMode`); deeper ones are helpers with `parentAgentId` and `finished`.
- **Tests never use real transcripts or real names**; describe real data only by its shape.

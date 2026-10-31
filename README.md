<div align="center">

# 🏢 AgentHQ

**A pixel-art office for your Claude Code sessions.**

[Website](https://charonova.github.io/agenthq/) · [How it works](#how-it-works) · [Develop](#develop)

<img src="docs/media/office.gif" width="860" alt="AgentHQ: the building of live sessions, then one office: teammates walk from the couch to their desks, to the bookshelf, to the lab, and into the manager's glass office to report">

</div>

---

Every live session is an office. Its main agent is the manager, every teammate gets a desk, and the helpers they start sit beside them as interns. Working agents type at their desks, read at the bookshelf, run tests at the lab and walk over to talk to each other; idle ones get coffee, then nap on the couch.

> Status: early (0.1). Not on npm yet: run it from source (below). Works on macOS, Linux and Windows.

## Run it

You need [Node.js](https://nodejs.org) 20 or later and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/charonova/agenthq.git
cd agenthq
pnpm install
pnpm start        # builds, then opens the office at http://localhost:4747
```

`node packages/cli/dist/cli.js --list` prints the same offices in the terminal.

<table>
  <tr>
    <td width="50%"><img src="docs/media/building.png" alt="The building: three live sessions as offices on one map, with a list of offices on the right"></td>
    <td width="50%"><img src="docs/media/office.png" alt="Inside an office: the manager in a glass office, staff at desks, the bookshelf, lab and couch, and a selected agent's details"></td>
  </tr>
  <tr>
    <td align="center"><sub><b>The building</b> · every live session, on one map</sub></td>
    <td align="center"><sub><b>An office</b> · click anyone for their task, tool, model and context</sub></td>
  </tr>
</table>

The pictures come from made-up sessions (`pnpm media`); AgentHQ shows your own.

- **The building**: every live session as an office on one map. Drag to move around, scroll to zoom, click an office to go inside.
- **In an office**: the manager in a glass office, staff at desks in their team colour, interns beside whoever started them. Bubbles say what each one is doing; click anyone for their task, tool, model, context and last words.
- **Where they go**: writing code → their desk · reading → the bookshelf · commands → the server rack · tests → the lab · web → the window · plans → the whiteboard · messaging a teammate → that teammate's desk · waiting for you → a raised hand · idle → coffee, then the couch. They walk around the furniture.
- **Day and night** follow your clock.

## How it works

AgentHQ only **reads** what Claude Code writes in `~/.claude`; it never runs or changes Claude Code, and nothing leaves your computer (the page is served on 127.0.0.1 only).

| Office             | From                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| Offices            | Sessions in `~/.claude/projects/*/*.jsonl` active in the last 30 minutes                                     |
| Manager            | The session's own transcript                                                                                 |
| Staff              | Teammates: `<session>/subagents/agent-*.jsonl` whose `.meta.json` says `spawnDepth: 0` (name, colour, model) |
| Interns            | Helpers they started: `spawnDepth` 1+, with `parentAgentId`                                                  |
| What each one does | The last lines of its transcript: the tool it called, and how long ago                                       |

Only the end of each transcript is read, so multi-gigabyte sessions stay fast. Settings: `AGENTHQ_CLAUDE_HOME` reads another folder; `AGENTHQ_IGNORE=frag1,frag2` leaves out sessions whose folder contains those (claude-mem's background sessions are left out by default).

## Develop

A pnpm workspace:

| Package         | What                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `packages/core` | The reader: live sessions → offices (Node, no dependencies)                                     |
| `packages/cli`  | `@charonova/agenthq`: the command, the local server (Server-Sent Events), and the built web app |
| `apps/web`      | The office: Vite + React + PixiJS (pixi-viewport for the camera), Zustand for state             |
| `e2e`           | Playwright tests on a made-up `~/.claude`                                                       |

```bash
pnpm install
pnpm dev          # server + Vite with hot reload: http://localhost:5173
pnpm check        # lint, format, types, unit tests
pnpm build        # web app, then the CLI with it inside
pnpm e2e          # end-to-end tests (after a build), with screenshots in test-results/
pnpm start        # build, then open the office
pnpm media        # the README's screenshots and GIF, from made-up sessions
```

CI runs the checks on Linux, macOS and Windows, and the end-to-end tests on Linux.

## License

MIT

# AgentHQ

**A pixel-art office for your Claude Code sessions.** Every live session is an office. Its main agent is the manager, every teammate gets a desk, and the helpers they start sit beside them as interns. Working agents type; idle ones get coffee, then nap on the couch.

> Status: early (0.1). The office and the building work; walking between rooms, conversations and sounds come next.

```bash
npx @charonova/agenthq          # opens the office at http://localhost:4747
npx @charonova/agenthq --list   # or print it in the terminal
```

**In the office:** the manager sits in the glass office; staff at desks with their team colour on their shirts; interns on stools beside whoever started them. Writing code → typing at the desk; reading → the bookshelf; commands → the server rack; tests → the lab bench; web → the window; messages → the meeting table; plans → the whiteboard; waiting for you → a raised hand; idle → coffee, then the couch. Click anyone to see their task, tool, model, context and last words.

```
🏢 shop · Add CSV export  (2 working)
   👔 Manager  💤 watching the team
   ├ 🧑‍💻 core  ⌨️  test: Run the unit tests
   │   └ 🧑‍🎓 Research CSV libraries  ⌨️  web: csv streaming
   ├ 🧑‍💻 qa  💤 getting coffee
   (3 helpers went home)
```

## How it works

AgentHQ only **reads** what Claude Code writes in `~/.claude`; it never runs or changes Claude Code, and nothing leaves your computer.

| Office | From |
|---|---|
| Offices | Sessions in `~/.claude/projects/*/*.jsonl` that changed in the last 30 minutes |
| Manager | The session's own transcript |
| Staff | Teammates: `<session>/subagents/agent-*.jsonl` whose `.meta.json` says `spawnDepth: 0` (name, colour, model) |
| Interns | Helpers they started: `spawnDepth` 1+, with `parentAgentId` |
| What each one does | The last lines of its transcript: the tool it called, and how long ago |

Only the end of each transcript is read, so multi-gigabyte sessions stay fast.

Settings: `AGENTHQ_CLAUDE_HOME` reads another folder; `AGENTHQ_IGNORE=frag1,frag2` leaves out sessions whose folder contains those. claude-mem's background sessions are left out by default.

## Develop

```bash
npm install
npm test          # vitest, with made-up transcripts shaped like real ones
npm start         # build, then open the office
npm run list      # build, then list your live offices
```

## License

MIT

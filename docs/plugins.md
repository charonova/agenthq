# AgentHQ plugins: more agent sources

AgentHQ shows Claude Code and Codex sessions out of the box. A **source plugin** adds another agent CLI: it finds that agent's live sessions and describes them as offices, and AgentHQ draws them, opens their conversations, replays them and copies their resume command like any other.

## Turning plugins on

Plugins are plain ES modules (`.mjs`) in `~/.agenthq/plugins/` (or `$AGENTHQ_STATE_DIR/plugins`). They run inside AgentHQ with your rights, so they load only when you ask:

```bash
agenthq --plugins          # or AGENTHQ_PLUGINS=1 agenthq
```

AgentHQ prints which plugins loaded and why any didn't. A plugin that fails to load, throws, or returns something that isn't an office is left out; Claude Code's and Codex's offices are never affected. Only install plugins you trust or have read.

## The interface

A plugin's default export is a source:

```ts
interface AgentSource {
  /** New and plain: "my-agent" (lowercase letters, digits, dashes). */
  kind: string
  /** Its name, as the page shows it: "My Agent". */
  label: string
  /** Its folder, from the environment. */
  home(env?: NodeJS.ProcessEnv): string
  /** Its live sessions, as offices (called every couple of seconds: keep it quick, cache what you can). */
  discover(options: { home: string; ignore: string[]; now?: number }): Office[]
  /** Transcript lines (a page of the file `agent.transcript` names) as conversation messages. */
  messages(lines: string[]): Message[]
  /** Transcript lines as replay steps, from `since` (ms) on. */
  steps(lines: string[], since: number): ReplayStep[]
  /** The command that resumes a session in a terminal. */
  resume(sessionId: string): string
}
```

`Office`, `Agent`, `Message` and `ReplayStep` are the types in [`packages/core/src/types.ts`](../packages/core/src/types.ts), [`conversation.ts`](../packages/core/src/conversation.ts) and [`replay.ts`](../packages/core/src/replay.ts). An office needs at least `sessionId`, `project`, `manager`, `staff`, `interns` and `updatedAt`; its `kind` and `label` are set from the source. Each agent's `transcript` is the file its conversation and replay are read from (a page at a time, never whole).

## Rules for a good plugin

- **Read only.** Never write to the agent's folder, run the agent, or send anything off the machine.
- **Never read a whole transcript.** They grow large: read the end (AgentHQ's own sources read the last ~96 KB).
- **Parse defensively.** Unknown lines are skipped, missing fields are null.
- **Don't read secrets** (login files, keys) even if they sit next to the sessions.

## An example

[`plugins/hello-agent.mjs`](plugins/hello-agent.mjs) reads a made-up agent's JSONL sessions. Copy it into `~/.agenthq/plugins/`, point `HELLO_AGENT_HOME` at a folder with a `sessions/<id>.jsonl` file, and start AgentHQ with `--plugins`.

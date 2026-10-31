// An example AgentHQ source plugin: a made-up agent CLI ("Hello Agent") that writes one JSONL
// file per session in ~/.hello-agent/sessions (or HELLO_AGENT_HOME), each line like
// {"time":"2026-10-31T10:00:00.000Z","role":"user"|"agent","text":"…","tool":"Edit","target":"a.ts","done":true}.
// Copy it into ~/.agenthq/plugins/ and start AgentHQ with --plugins to see its sessions as offices.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const parse = (line) => {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}
const activityOf = (tool) => ({ Edit: 'edit', Read: 'read', Bash: 'run', Test: 'test' })[tool] ?? 'tool'

/** The last lines of a file (a real plugin should read only the end of large files). */
const lines = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean)

export default {
  kind: 'hello-agent',
  label: 'Hello Agent',
  home: (env = process.env) => env.HELLO_AGENT_HOME || join(homedir(), '.hello-agent'),

  discover({ home, ignore, now = Date.now() }) {
    const dir = join(home, 'sessions')
    let files = []
    try {
      files = readdirSync(dir).filter((file) => file.endsWith('.jsonl'))
    } catch {
      return []
    }
    return files.flatMap((file) => {
      const path = join(dir, file)
      const updatedAt = statSync(path).mtimeMs
      if (now - updatedAt > 30 * 60_000) return []
      const entries = lines(path).map(parse).filter(Boolean)
      const first = entries.find((entry) => entry.cwd) ?? {}
      if (ignore.some((fragment) => (first.cwd ?? '').includes(fragment))) return []
      const last = entries.at(-1) ?? {}
      const working = !last.done
      const tool = last.tool ? { name: last.tool, target: last.target ?? null, activity: activityOf(last.tool) } : null
      const sessionId = file.slice(0, -'.jsonl'.length)
      return [
        {
          kind: 'hello-agent',
          sessionId,
          project: (first.cwd ?? 'hello').split(/[\\/]/).filter(Boolean).pop(),
          cwd: first.cwd ?? null,
          title: entries.find((entry) => entry.role === 'user')?.text?.slice(0, 60) ?? null,
          manager: {
            id: sessionId,
            name: 'Hello Agent',
            role: 'manager',
            color: null,
            parentId: null,
            task: null,
            model: null,
            state: working ? 'working' : 'idle',
            rest: null,
            activity: working ? (tool?.activity ?? 'thinking') : null,
            tool,
            lastText: entries.findLast((entry) => entry.role === 'agent' && entry.text)?.text ?? null,
            contextTokens: null,
            history: [],
            updatedAt,
            transcript: path,
          },
          staff: [],
          interns: [],
          wentHome: 0,
          process: null,
          ended: false,
          updatedAt,
        },
      ]
    })
  },

  messages: (lines) =>
    lines.map(parse).flatMap((entry, n) => {
      if (!entry) return []
      const at = Date.parse(entry.time) || null
      if (entry.tool)
        return [
          {
            kind: 'tool',
            id: `t${n}`,
            at,
            tool: { name: entry.tool, target: entry.target ?? null, activity: activityOf(entry.tool) },
            input: entry.target ?? null,
            result: null,
          },
        ]
      if (!entry.text) return []
      return [{ kind: entry.role === 'user' ? 'user' : 'assistant', id: `m${n}`, at, text: entry.text }]
    }),

  steps: (lines, since) =>
    lines
      .map(parse)
      .filter((entry) => entry && Date.parse(entry.time) >= since)
      .map((entry) => ({
        at: Date.parse(entry.time),
        kind: entry.done ? 'done' : entry.tool ? 'tool' : entry.role === 'user' ? 'prompt' : 'reply',
        ...(entry.tool ? { tool: { name: entry.tool, target: entry.target ?? null, activity: activityOf(entry.tool) } } : {}),
      })),

  resume: (sessionId) => `hello-agent resume ${sessionId}`,
}

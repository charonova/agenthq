#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { claudeHome, discoverAll, ignoreFrom, looksLikeClaudeHome } from '@agenthq/core'
import type { Agent, Office } from '@agenthq/core'
import { loadPlugins, pluginsWanted } from './plugins.js'

const args = process.argv.slice(2)
const home = claudeHome()

if (args.includes('--version') || args.includes('-v')) {
  // The package's own version, from the package.json next to the built files.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  console.log(pkg.version)
  process.exit(0)
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`AgentHQ: a pixel-art office for your Claude Code and Codex sessions.

Usage:
  agenthq           open the office in your browser (http://localhost:4747)
  agenthq --list    print every live session as an office: manager, staff, interns
  agenthq --json    the same, as JSON

Options:
  --port <n>        serve on another port (the next free one if it's taken)
  --no-open         don't open the browser
  --version         print the version
  --plugins         load more agent sources from ~/.agenthq/plugins (or AGENTHQ_PLUGINS=1)

Reads ${home} (set AGENTHQ_CLAUDE_HOME to read another folder) and Codex's folder (CODEX_HOME). Only
reads them, unless you turn on answering from AgentHQ (⚙️ Settings in the page): that adds one hook to
Claude Code's settings.json, after saving a copy. Typing into Terminal/iTerm2 tabs (macOS) is off
until you turn it on there too; AgentHQ keeps its own settings in ~/.agenthq.
Leaves out claude-mem's background sessions; AGENTHQ_IGNORE=frag1,frag2 leaves out more folders.
AGENTHQ_JUMP=copy: going to a session only copies the command that resumes it (and typing only copies).
Sessions you start from the page run your own Claude Code (\`claude\` on your PATH, or AGENTHQ_CLAUDE_PATH).`)
  process.exit(0)
}

if (pluginsWanted(args)) {
  const { loaded, failed } = await loadPlugins()
  if (loaded.length) console.error(`Plugins: ${loaded.join(', ')}`)
  for (const { file, why } of failed) console.error(`Plugin ${file} wasn’t loaded: ${why}`)
}

if (!looksLikeClaudeHome(home)) {
  console.error(`No Claude Code sessions found in ${home}. Use Claude Code once, or set AGENTHQ_CLAUDE_HOME.`)
  process.exit(1)
}

function printOffices(offices: Office[]): void {
  if (offices.length === 0) {
    console.log('No live sessions: every office is closed.')
    return
  }
  for (const office of offices) {
    const busy = [office.manager, ...office.staff, ...office.interns].filter((a) => a.state === 'working').length
    console.log(
      `\n🏢 ${office.kind === 'codex' ? '[Codex] ' : office.kind !== 'claude' ? `[${office.label ?? office.kind}] ` : ''}${office.project}${office.title ? ` · ${office.title}` : ''}  (${busy} working)`,
    )
    console.log(`   ${line(office.manager)}`)
    for (const member of office.staff) {
      console.log(`   ├ ${line(member)}`)
      for (const intern of office.interns.filter((i) => i.parentId === member.id)) console.log(`   │   └ ${line(intern)}`)
    }
    for (const intern of office.interns.filter((i) => i.parentId === office.sessionId)) console.log(`   └ ${line(intern)}`)
    if (office.wentHome > 0) console.log(`   (${office.wentHome} helper${office.wentHome === 1 ? '' : 's'} went home)`)
  }
}

const icons: Record<Agent['state'], string> = { working: '⌨️ ', waiting: '✋', idle: '💤', done: '✅', gone: '🚪' }

function line(agent: Agent): string {
  const role = agent.role === 'manager' ? '👔 Manager' : agent.role === 'staff' ? `🧑‍💻 ${agent.name}` : `🧑‍🎓 ${agent.name}`
  const doing =
    agent.state === 'working' && agent.tool
      ? `${agent.tool.activity}: ${agent.tool.target ?? agent.tool.name}`
      : agent.state === 'idle'
        ? agent.rest === 'couch'
          ? 'on the couch'
          : agent.rest === 'coffee'
            ? 'getting coffee'
            : agent.rest === 'watching'
              ? 'watching the team'
              : agent.rest === 'background'
                ? 'a command runs in the background'
                : 'idle'
        : agent.state === 'waiting' && agent.waitingFor
          ? `waiting: ${agent.waitingFor}`
          : agent.state
  return `${role}  ${icons[agent.state]} ${doing}  · ${ago(agent.updatedAt)}`
}

function ago(time: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}

if (args.includes('--list') || args.includes('--json')) {
  const offices = discoverAll({ homes: { claude: home }, ignore: ignoreFrom() })
  if (args.includes('--json')) console.log(JSON.stringify(offices, null, 2))
  else printOffices(offices)
} else {
  const { startServer } = await import('./server.js')
  const portArg = args.indexOf('--port')
  const port = portArg >= 0 ? Number(args[portArg + 1]) : 4747
  const server = await startServer({ home, port: Number.isFinite(port) ? port : 4747, ignore: ignoreFrom() })
  console.log(`🏢 AgentHQ is open at ${server.url}  (Ctrl+C to close)`)
  if (!args.includes('--no-open')) openBrowser(server.url)
  const stop = () => {
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

/** The system's own way to open a link: open (macOS), start (Windows), xdg-open (Linux). */
function openBrowser(url: string): void {
  const [command, ...rest] =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url]
  try {
    spawn(command!, rest, { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref()
  } catch {
    // No browser to open: the link above is enough.
  }
}

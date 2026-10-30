#!/usr/bin/env node
import { claudeHome, discoverOffices, ignoreFrom, looksLikeClaudeHome } from './core/office.js'
import type { Agent, Office } from './core/types.js'

const args = process.argv.slice(2)
const home = claudeHome()

if (args.includes('--help') || args.includes('-h')) {
  console.log(`AgentHQ: a pixel-art office for your Claude Code sessions.

Usage:
  agenthq --list    print every live session as an office: manager, staff, interns
  agenthq --json    the same, as JSON

Reads ${home} (set AGENTHQ_CLAUDE_HOME to read another folder). Never writes to it.
Leaves out claude-mem's background sessions; AGENTHQ_IGNORE=frag1,frag2 leaves out more folders.`)
  process.exit(0)
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
    console.log(`\n🏢 ${office.project}${office.title ? ` · ${office.title}` : ''}  (${busy} working)`)
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
    agent.state === 'working' && agent.tool ? `${agent.tool.activity}: ${agent.tool.target ?? agent.tool.name}`
    : agent.state === 'idle' ? (agent.rest === 'couch' ? 'on the couch' : agent.rest === 'coffee' ? 'getting coffee' : agent.rest === 'watching' ? 'watching the team' : 'idle')
    : agent.state
  return `${role}  ${icons[agent.state]} ${doing}  · ${ago(agent.updatedAt)}`
}

function ago(time: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}

const offices = discoverOffices({ home, ignore: ignoreFrom() })
if (args.includes('--json')) console.log(JSON.stringify(offices, null, 2))
else printOffices(offices)

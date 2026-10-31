import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverAll, sources } from '../src/sources.js'

describe('sources', () => {
  let claude: string
  let codex: string
  beforeEach(() => {
    claude = mkdtempSync(join(tmpdir(), 'agenthq-src-claude-'))
    codex = mkdtempSync(join(tmpdir(), 'agenthq-src-codex-'))
  })
  afterEach(() => {
    rmSync(claude, { recursive: true, force: true })
    rmSync(codex, { recursive: true, force: true })
  })

  it('each says what it is and how its sessions are resumed', () => {
    expect(Object.values(sources).map((source) => [source.kind, source.label])).toEqual([
      ['claude', 'Claude Code'],
      ['codex', 'Codex'],
    ])
    expect(sources.claude.resume('abc')).toBe('claude --resume abc')
    expect(sources.codex.resume('abc')).toBe('codex resume abc')
    expect(sources.codex.home({ CODEX_HOME: '/x/codex' })).toBe('/x/codex')
  })

  it('finds every source’s offices, most recently busy first', () => {
    const now = Date.now()
    // A made-up Claude Code session and Codex thread, shaped like the real files.
    mkdirSync(join(claude, 'projects', '-p'), { recursive: true })
    writeFileSync(
      join(claude, 'projects', '-p', 'c1.jsonl'),
      JSON.stringify({
        type: 'user',
        cwd: '/w/claude-app',
        timestamp: new Date(now).toISOString(),
        message: { role: 'user', content: 'hi' },
      }) + '\n',
    )
    const day = new Date(now)
    const dir = join(
      codex,
      'sessions',
      String(day.getFullYear()),
      String(day.getMonth() + 1).padStart(2, '0'),
      String(day.getDate()).padStart(2, '0'),
    )
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'rollout-1.jsonl'),
      JSON.stringify({
        timestamp: new Date(now).toISOString(),
        type: 'session_meta',
        payload: { id: 'x1', cwd: '/w/codex-app' },
      }) + '\n',
    )
    const offices = discoverAll({ homes: { claude, codex }, ignore: [], now })
    expect(offices.map((office) => [office.kind, office.project]).sort()).toEqual([
      ['claude', 'claude-app'],
      ['codex', 'codex-app'],
    ])
  })
})

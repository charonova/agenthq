import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverAll, registerSource, sourceOf, unregisterSource } from '@agenthq/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadPlugins, pluginsWanted } from '../src/plugins'

const example = join(import.meta.dirname, '../../../docs/plugins/hello-agent.mjs')

describe('plugins', () => {
  let dir: string
  let home: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agenthq-plugins-'))
    home = mkdtempSync(join(tmpdir(), 'agenthq-hello-'))
  })
  afterEach(() => {
    unregisterSource('hello-agent')
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it('load only when asked', () => {
    expect(pluginsWanted([], {})).toBe(false)
    expect(pluginsWanted(['--plugins'], {})).toBe(true)
    expect(pluginsWanted([], { AGENTHQ_PLUGINS: '1' })).toBe(true)
  })

  it('adds a plugin’s source, and skips broken ones without stopping', async () => {
    copyFileSync(example, join(dir, 'hello-agent.mjs'))
    writeFileSync(join(dir, 'broken.mjs'), 'export default {')
    writeFileSync(join(dir, 'half.mjs'), "export default { kind: 'half', label: 'Half' }")
    writeFileSync(join(dir, 'notes.txt'), 'not a plugin')
    const { loaded, failed } = await loadPlugins(dir)
    expect(loaded).toEqual(['Hello Agent'])
    expect(failed.map((failure) => failure.file)).toEqual(['broken.mjs', 'half.mjs'])
    expect(failed[1]!.why).toBe('it needs home()')

    // Its sessions show up as offices, with its name.
    mkdirSync(join(home, 'sessions'))
    const at = new Date().toISOString()
    writeFileSync(
      join(home, 'sessions', 'h1.jsonl'),
      [
        JSON.stringify({ time: at, role: 'user', cwd: '/w/garden', text: 'Water the plants' }),
        JSON.stringify({ time: at, role: 'agent', tool: 'Edit', target: 'plants.ts' }),
      ].join('\n') + '\n',
    )
    const offices = discoverAll({
      homes: { 'hello-agent': home, claude: join(home, 'none'), codex: join(home, 'none') },
      ignore: [],
    })
    expect(offices).toHaveLength(1)
    expect(offices[0]).toMatchObject({ kind: 'hello-agent', label: 'Hello Agent', project: 'garden' })
    expect(offices[0]!.manager).toMatchObject({ state: 'working', activity: 'edit' })
    expect(sourceOf('hello-agent')!.resume('h1')).toBe('hello-agent resume h1')
  })

  it('refuses a source whose kind is taken or odd', () => {
    const source = { label: 'X', home: () => '', discover: () => [], messages: () => [], steps: () => [], resume: () => '' }
    expect(registerSource({ ...source, kind: 'codex' })).toContain('already there')
    expect(registerSource({ ...source, kind: '../evil' })).toContain('its kind must be')
    expect(registerSource(null)).toBe('not a source')
  })

  it('keeps the office going when a plugin throws', () => {
    const kind = 'thrower'
    registerSource({
      kind,
      label: 'Thrower',
      home: () => '',
      discover: () => {
        throw new Error('boom')
      },
      messages: () => [],
      steps: () => [],
      resume: () => '',
    })
    expect(() => discoverAll({ homes: { claude: join(home, 'none'), codex: join(home, 'none') }, ignore: [] })).not.toThrow()
    unregisterSource(kind)
  })
})

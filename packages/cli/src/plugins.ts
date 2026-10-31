import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerSource } from '@agenthq/core'
import { stateDir } from './hook.js'

/**
 * Plugins: more agent sources, as plain ES modules in `~/.agenthq/plugins/*.mjs`, each exporting
 * a source as its default (docs/plugins.md). They run inside AgentHQ with your rights, so they
 * load only when you ask: `agenthq --plugins`, or `AGENTHQ_PLUGINS=1`. A plugin that fails to
 * load is skipped and said so; it never stops the office.
 */

export const pluginsDir = (): string => join(stateDir(), 'plugins')

export function pluginsWanted(args: string[], env: NodeJS.ProcessEnv = process.env): boolean {
  return args.includes('--plugins') || env.AGENTHQ_PLUGINS === '1'
}

export async function loadPlugins(dir = pluginsDir()): Promise<{ loaded: string[]; failed: { file: string; why: string }[] }> {
  const loaded: string[] = []
  const failed: { file: string; why: string }[] = []
  let files: string[]
  try {
    files = readdirSync(dir)
      .filter((file) => file.endsWith('.mjs'))
      .sort()
  } catch {
    return { loaded, failed }
  }
  for (const file of files) {
    try {
      const module = (await import(pathToFileURL(join(dir, file)).href)) as { default?: unknown }
      const why = registerSource(module.default)
      if (why) failed.push({ file, why })
      else loaded.push((module.default as { label: string }).label)
    } catch (error) {
      failed.push({ file, why: (error as Error).message })
    }
  }
  return { loaded, failed }
}

import { defineConfig } from 'tsup'

// One file to publish: the CLI with the reader bundled in. The web app is copied next to it.
export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The Agent SDK's JavaScript is bundled (loaded when a session starts); it runs the user's own `claude`.
  noExternal: ['@agenthq/core', '@anthropic-ai/claude-agent-sdk'],
})

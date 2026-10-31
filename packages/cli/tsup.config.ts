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
  noExternal: ['@agenthq/core'],
  banner: { js: '#!/usr/bin/env node' },
})

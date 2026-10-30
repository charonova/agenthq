// Bundles the page into dist/web, next to the server that serves it.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('dist/web', { recursive: true })
await build({
  entryPoints: ['web/main.ts'],
  bundle: true,
  minify: true,
  sourcemap: true,
  target: 'es2022',
  format: 'iife',
  outfile: 'dist/web/app.js',
  logLevel: 'warning',
})
for (const file of ['index.html', 'style.css']) copyFileSync(`web/${file}`, `dist/web/${file}`)

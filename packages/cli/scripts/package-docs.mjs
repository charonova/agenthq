// The npm package carries the README and licence: images point at GitHub, so they show on npmjs.com.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../../../', import.meta.url)
const raw = 'https://raw.githubusercontent.com/charonova/agenthq/main/'
const readme = readFileSync(new URL('README.md', root), 'utf8')
  .replaceAll('src="docs/', `src="${raw}docs/`)
  .replaceAll('](docs/', `](${raw}docs/`)
writeFileSync(new URL('../README.md', import.meta.url), readme)
copyFileSync(new URL('LICENSE', root), new URL('../LICENSE', import.meta.url))

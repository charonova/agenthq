import { defineConfig } from 'vitest/config'

// Every package's tests in one run: `pnpm test`.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/web'],
  },
})

import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/*
 * The build stamps its own version in, and the channel follows from it.
 *
 * One source of truth: package.json. A release is cut by writing the version
 * there and tagging it (scripts/release.mjs), so there is no second place to
 * forget - a build can never claim a channel its version does not support.
 */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
    // Set by CI on a tag build; a local `npm run dev` has no commit to name.
    __APP_COMMIT__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) || 'dev'),
  },
  server: { host: true, port: 5173 },
  build: { target: 'es2022' },
})

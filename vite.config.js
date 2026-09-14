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
  build: {
    target: 'es2022',
    /*
     * CSS gets browsers, not an ECMAScript year.
     *
     * cssTarget defaults to `target`, and esbuild cannot map "es2022" onto
     * browser support, so it fell back to mangling anything it was unsure of.
     * The result was that `backdrop-filter` survived only in its -webkit-
     * form - which meant the glass had a tint and no blur in every browser,
     * and looked plausible enough that it took reading the built stylesheet
     * to notice.
     *
     * Safari 15.4 is the oldest here because it is the first with
     * :has() and container-query-free modern CSS this app already relies on;
     * it also still wants the -webkit- prefix, which esbuild now adds
     * *alongside* the standard property rather than instead of it.
     */
    cssTarget: ['chrome100', 'firefox103', 'safari15.4', 'edge100'],
  },
})

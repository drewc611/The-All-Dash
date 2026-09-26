/** Importing this file registers every built-in widget. */
import { createElement } from 'react'
import './work.jsx'
import './analytics.jsx'
import './report.jsx'
import './triage.jsx'
import './map.jsx'
import './brain.jsx'
import './boards.jsx'
import './focus.jsx'

/*
 * React is bundled, not global, so a <script>-tag plugin has nothing to build
 * an element with. `h` is createElement; a plugin widget's render returns
 * `AllDash.h('div', ...)` and the board treats it like any other component.
 */
if (typeof window !== 'undefined') window.AllDash = Object.assign(window.AllDash || {}, { h: createElement })

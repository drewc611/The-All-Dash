import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/work.css'
import './styles/viz.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)

// Installable and offline-capable in production. Skipped in dev so the
// service worker never caches the dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

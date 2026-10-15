import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useStore } from './store'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The splash in index.html plays at least one full logo animation, then stays until the page knows
// whether it is following the plant server or running its own copy.
const SPLASH_MIN_MS = 1600
const splash = document.getElementById('splash')
if (splash) {
  const hide = () => {
    unsubscribe()
    window.setTimeout(() => {
      splash.classList.add('is-done')
      window.setTimeout(() => splash.remove(), 500)
    }, Math.max(0, SPLASH_MIN_MS - performance.now()))
  }
  const unsubscribe = useStore.subscribe((s) => { if (s.link !== 'connecting') hide() })
  if (useStore.getState().link !== 'connecting') hide()
}

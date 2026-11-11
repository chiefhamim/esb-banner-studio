import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/primitives.css'
import './index.css'
import App from './App.tsx'
import { initStaffSession } from './editorial/siteApi'

// The signed-in session is read from the encrypted store before the first paint, so the app never opens looking
// signed out for a moment. A store that does not answer within a second does not hold the window back.
void Promise.race([initStaffSession(), new Promise((r) => setTimeout(r, 1000))]).finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})

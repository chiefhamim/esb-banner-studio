import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/primitives.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

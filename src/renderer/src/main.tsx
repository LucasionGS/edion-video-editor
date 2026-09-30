import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ErrorBoundary } from './app/ErrorBoundary'
import '@fontsource-variable/inter'
import './styles/app.css'

if (window.edion.automated) void import('./app/debugHandle').then((m) => m.installDebugHandle())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)

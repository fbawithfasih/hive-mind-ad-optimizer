import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { ThemeProvider } from './hooks/useTheme.jsx'
import { initObservability } from './observability.js'
import { captureAttribution } from './attribution.js'

// Before render, so an error thrown during the first paint is still reported.
initObservability()
// Before the router touches the URL, so utm_* and ?ref= are seen as they arrived.
captureAttribution()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)

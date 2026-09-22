import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ToastProvider } from './components/ui/Toast'
import { AccessProvider } from './hooks/useAccess'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AccessProvider>
        <App />
      </AccessProvider>
    </ToastProvider>
  </StrictMode>,
)

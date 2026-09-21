import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ToastProvider } from './components/ui/Toast'
import { PermissionsProvider } from './hooks/usePermissions'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <PermissionsProvider>
        <App />
      </PermissionsProvider>
    </ToastProvider>
  </StrictMode>,
)

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import App from './App.tsx'
import './index.css'

// Configure @monaco-editor/react to use locally bundled monaco-editor
// This ensures 100% offline functionality and avoids CDN blocks / CSP restrictions
loader.config({ monaco });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: 'border border-border bg-card text-card-foreground shadow-2xl text-xs font-sans',
          style: {
            background: 'hsl(var(--card))',
            color: 'hsl(var(--card-foreground))',
            border: '1px solid hsl(var(--border))',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
            fontSize: '12px',
            padding: '8px 14px',
            borderRadius: '8px',
          },
          success: {
            iconTheme: {
              primary: '#10b981',
              secondary: 'hsl(var(--card))',
            },
          },
          error: {
            iconTheme: {
              primary: '#f43f5e',
              secondary: 'hsl(var(--card))',
            },
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
)

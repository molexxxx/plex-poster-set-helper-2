import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './app/App'
import LogWindow from './features/logs/LogWindow'
import './styles/global.css'
import { createWebClient } from './api/webClient'

// Electron preload sets window.api before the renderer loads. In the browser
// build served by the Node web server, create the HTTP client here instead.
if (!window.api) {
  window.api = createWebClient()
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

const isLogWindow = window.location.hash === '#logs-window'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {isLogWindow ? <LogWindow /> : <App />}
    </QueryClientProvider>
  </React.StrictMode>
)

import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { RouterProvider } from 'react-router-dom'
import './styles/globals.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import { store } from './store'
import { router } from './router'
import { loadIdentity } from './services/nostrService'
import { initializeActiveSigner } from './services/signerService'
import { registerServiceWorker, unregisterServiceWorkers } from './services/serviceWorker'

if (import.meta.env.PROD) registerServiceWorker()
else unregisterServiceWorkers()

// Load local and active signer state before mounting so the initial identity mode
// is coherent across every signing call site.
loadIdentity().then(initializeActiveSigner).finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Provider store={store}>
        <RouterProvider router={router} />
      </Provider>
    </React.StrictMode>
  )
})

import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { RouterProvider } from 'react-router-dom'
import './styles/globals.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import { store } from './store'
import { router } from './router'
import { loadIdentity } from './services/nostrService'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {/* non-fatal */})
}

// Load the persisted identity before mounting so the synchronous getCachedKeypair()
// call sites have a populated cache. loadIdentity never rejects (it degrades
// internally), but .finally guards against any unexpected throw still rendering.
loadIdentity().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Provider store={store}>
        <RouterProvider router={router} />
      </Provider>
    </React.StrictMode>
  )
})

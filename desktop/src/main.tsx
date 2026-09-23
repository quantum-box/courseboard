import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Side-effect import: initialises i18next before the first render.
import './i18n'
import { adoptLegacyLocation } from './lib/router'
import './styles.css'

// Before the first render: a bookmark or a payment link written for the old
// `#/route` shape has to become the route this app reads, not a blank page.
adoptLegacyLocation()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

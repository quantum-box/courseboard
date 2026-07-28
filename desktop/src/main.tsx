import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Side-effect import: initialises i18next before the first render.
import './i18n'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

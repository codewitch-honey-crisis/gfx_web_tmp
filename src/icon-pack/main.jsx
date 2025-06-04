import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import IconPack from './IconPack.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <IconPack />
  </StrictMode>,
)


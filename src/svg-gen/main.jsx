import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import SvgGen from './SvgGen.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SvgGen />
  </StrictMode>,
)


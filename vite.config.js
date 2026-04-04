import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/gfx_web/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        docs: resolve(__dirname, 'docs/index.html'),
        header: resolve(__dirname, 'header/index.html'),
        icon_pack: resolve(__dirname, 'icon-pack/index.html')
      },
    },
  },
})

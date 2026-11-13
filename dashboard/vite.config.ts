import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server uses the same paths as nginx in compose: /api/* -> ingest (prefix stripped), /ws -> ingest /ws.
const INGEST = 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: INGEST, rewrite: (path) => path.replace(/^\/api/, '') },
      '/ws': { target: INGEST, ws: true },
    },
  },
})

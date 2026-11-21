import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The backend (FastAPI) runs on :8000. During development Vite forwards /api
// calls to it, so the browser only ever talks to one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': process.env.API_URL ?? 'http://127.0.0.1:8000' }, // override with API_URL
    fs: { allow: ['..'] }, // lets the Docs page import ../docs/*.md
  },
})

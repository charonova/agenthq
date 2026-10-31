import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the page comes from Vite (hot reload) and the data from the AgentHQ server.
const server = `http://127.0.0.1:${process.env.AGENTHQ_PORT ?? 4747}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/events': { target: server, changeOrigin: true },
      '/api': { target: server, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // PixiJS is most of the page; it loads once and stays cached.
    chunkSizeWarningLimit: 1200,
  },
})

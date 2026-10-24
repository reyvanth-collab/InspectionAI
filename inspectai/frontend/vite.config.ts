import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const SUPABASE_URL = env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
  if (command === 'build' && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before building')
  return ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      // Backend Express API
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // Supabase — proxy all Supabase paths through Vite so the browser
      // never makes a cross-origin request (bypasses corporate CORS/SSL inspection).
      '/auth/v1': {
        target: SUPABASE_URL,
        changeOrigin: true,
        secure: true,
      },
      '/rest/v1': {
        target: SUPABASE_URL,
        changeOrigin: true,
        secure: true,
      },
      '/storage/v1': {
        target: SUPABASE_URL,
        changeOrigin: true,
        secure: true,
      },
      '/realtime/v1': {
        target: SUPABASE_URL,
        changeOrigin: true,
        secure: true,
        ws: true,
      },
    },
  },
})
})

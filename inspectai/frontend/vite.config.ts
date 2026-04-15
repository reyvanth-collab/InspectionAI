import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const SUPABASE_URL = 'https://ehrgsakhrpbtintshjha.supabase.co'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
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

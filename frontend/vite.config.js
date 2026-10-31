import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react';
          // recharts SEM grupo fixo de propósito: ele só é usado nas telas de Analytics (carregadas sob
          // demanda). Com grupo fixo, o rolldown puxava o React pra dentro dele e o pré-carregava no início.
          if (id.includes('node_modules/leaflet') || id.includes('node_modules/react-leaflet')) return 'vendor-maps';
          if (id.includes('node_modules/@supabase'))     return 'vendor-supabase';
          if (id.includes('node_modules/socket.io'))     return 'vendor-socket';
        }
      }
    }
  }
})
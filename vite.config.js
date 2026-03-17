import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 🎯 Correção: Caminho direto para o src
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ['react', 'react-dom'],
  },

  // 📍 Indica que o index.html está aqui na raiz
  root: '.',
  build: {
    // 📂 Onde o build final será jogado (o server.js vai ler daqui)
    outDir: 'dist',
    emptyOutDir: true,
    minify: true
  }
})
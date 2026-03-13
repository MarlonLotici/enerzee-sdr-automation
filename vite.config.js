import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 🎯 Aqui está a correção: O "@" agora aponta para o lugar certo
      "@": path.resolve(__dirname, "./frontend/src"),
    },
    // ✅ Mantendo sua segurança contra duplicatas do React
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
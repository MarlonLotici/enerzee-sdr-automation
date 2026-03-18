// frontend/postcss.config.js
import tailwind from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindConfig from './tailwind.config.cjs' // 🎯 Puxando o manual do Greg

export default {
  plugins: [
    tailwind(tailwindConfig),
    autoprefixer,
  ],
}
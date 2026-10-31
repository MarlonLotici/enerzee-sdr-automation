import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import 'leaflet/dist/leaflet.css';

// Deploy novo apaga os arquivos antigos das telas carregadas sob demanda. Se o painel estava
// aberto e tenta baixar um deles, recarrega 1x pra pegar a versão nova (trava evita loop).
window.addEventListener('vite:preloadError', (e) => {
  try {
    if (sessionStorage.getItem('reloadPorDeploy')) return;
    sessionStorage.setItem('reloadPorDeploy', '1');
  } catch { /* sem storage: recarrega mesmo assim */ }
  e.preventDefault();
  window.location.reload();
});
window.addEventListener('load', () => {
  setTimeout(() => { try { sessionStorage.removeItem('reloadPorDeploy'); } catch { /* ignore */ } }, 10000);
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

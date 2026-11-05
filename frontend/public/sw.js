// Service worker mínimo: existe só pra o navegador oferecer "Instalar app" / "Adicionar à tela inicial".
// NÃO guarda nada em cache de propósito: o painel sempre abre na versão mais recente (index.html já é
// servido com no-cache e os arquivos com hash mudam a cada deploy), então não há risco de ficar preso numa versão velha.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => { /* passa direto pra rede */ })

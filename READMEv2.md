# Enerzee SDR Automation

Sistema de prospecção automática e SDR com IA para o segmento de energia solar.
Stack: Node.js + Express 5 + Socket.io + WhatsApp Web.js | React + Vite + Tailwind CSS.

---

## Rodar localmente

### Pré-requisitos

- **Node.js** >= 18
- **Google Chrome** instalado (o sistema detecta automaticamente)
- **npm** (vem com o Node)

### Passo a passo

```bash
# 1. Instalar dependências do backend
npm install

# 2. Instalar dependências do frontend e buildar
npm run build

# 3. Iniciar o servidor
npm start
```

O servidor sobe em **http://localhost:3001**.
O frontend buildado é servido pelo próprio Express — não precisa rodar `npm run dev` no frontend separadamente.

### Modo desenvolvimento (frontend com hot-reload)

Se quiser editar o frontend com hot-reload do Vite:

```bash
# Terminal 1 — backend
npm start

# Terminal 2 — frontend (dev server na porta 5173)
cd frontend && npm run dev
```

Nesse modo o frontend em `localhost:5173` conecta o Socket.io automaticamente em `localhost:3001`.

---

## Deploy na Railway

### 1. Configurar os scripts (já feito)

O `package.json` raiz já tem os scripts corretos:

```json
{
  "scripts": {
    "start": "node server.js",
    "build": "cd frontend && npm install && npm run build"
  }
}
```

A Railway executa `npm run build` no deploy e depois `npm start` para rodar.

### 2. Variáveis de ambiente na Railway

No painel da Railway, vá em **Settings > Variables** e adicione:

| Variável | Valor | Obrigatório |
|---|---|---|
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/google-chrome-stable` | Sim |
| `PORT` | *(não precisa setar — a Railway injeta automaticamente)* | — |

### 3. Instalar o Google Chrome no container

A Railway usa **Nixpacks** por padrão. Crie um arquivo `nixpacks.toml` na raiz do projeto:

```toml
[phases.setup]
nixPkgs = ["google-chrome-stable"]

[phases.install]
cmds = ["npm install"]

[phases.build]
cmds = ["npm run build"]

[start]
cmd = "npm start"
```

Isso garante que o Chrome esteja disponível no container para o Puppeteer/WhatsApp Web.js.

### 4. Deploy

```bash
# Se usar Railway CLI
railway up

# Ou simplesmente faça push para o repo conectado na Railway
git push
```

### Checklist pré-deploy

- [ ] `nixpacks.toml` criado na raiz
- [ ] Variável `PUPPETEER_EXECUTABLE_PATH` configurada na Railway
- [ ] `.gitignore` inclui `node_modules/`, `frontend/node_modules/`, `frontend/dist/`, `.wwebjs_auth/`, `leads.db`
- [ ] Sem arquivos `.env` com segredos commitados

---

## O que estava quebrado (e por quê)

Abaixo, os 4 problemas que impediam o projeto de rodar localmente e na Railway.

### 1. Porta hardcoded no `server.js`

**Antes:**
```js
const PORT = 3001;
```

**Problema:** A Railway injeta a porta via `process.env.PORT` (geralmente algo como 4521, 8080, etc). Com a porta fixa em 3001, o servidor subia mas a Railway não conseguia rotear o tráfego — o health check falhava e o deploy morria.

**Correção:**
```js
const PORT = process.env.PORT || 3001;
```

---

### 2. URL do Socket.io hardcoded no `App.jsx`

**Antes:**
```js
const socket = io('http://localhost:3001', { autoConnect: false });
```

**Problema:** Em produção (Railway), o browser do usuário tentava conectar em `localhost:3001` — que é a máquina do próprio usuário, não o servidor. O Socket.io nunca conectava, e toda a comunicação real-time (QR code, leads, status do WhatsApp) ficava morta.

**Correção:**
```js
const SOCKET_URL = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;
const socket = io(SOCKET_URL, { autoConnect: false });
```

Em dev (`npm run dev` do Vite), conecta em localhost. Em produção, conecta no mesmo domínio de onde o frontend foi servido.

---

### 3. CSS/Tailwind não carregava na Railway — `postcss.config` duplicado

**Antes:** Existiam dois arquivos de configuração do PostCSS no frontend:

- `postcss.config.js` — sintaxe ESM (`export default {}`)
- `postcss.config.cjs` — sintaxe CommonJS (`module.exports = {}`)

**Problema:** O `package.json` do frontend tem `"type": "module"`, então o Node trata `.js` como ESM. Quando o PostCSS (usado pelo Tailwind durante o build) carregava a config, ele encontrava dois arquivos e dependendo da resolução, podia carregar o `.cjs` — que usa `module.exports` (CommonJS) — em um contexto ESM, ou simplesmente conflitar. O resultado: o build do Tailwind falhava silenciosamente e o CSS saía vazio ou sem as classes utilitárias. Por isso o frontend aparecia sem estilo na Railway.

**Correção:** Removido o `postcss.config.cjs`. Mantido apenas o `postcss.config.js` com sintaxe ESM, compatível com `"type": "module"`.

---

### 4. Express não servia o frontend buildado

**Antes:** O `server.js` só tinha rotas de API e Socket.io. Não havia `express.static` nem fallback SPA.

**Problema:** Em desenvolvimento, o Vite serve o frontend separadamente (`localhost:5173`). Mas na Railway, não existe um servidor Vite de dev rodando — só o Express. Sem `express.static` apontando para `frontend/dist`, a Railway retornava 404 ou uma resposta vazia para qualquer rota do frontend. O browser não recebia nem o `index.html`, nem o JS, nem o CSS.

**Correção:**
```js
// Serve os arquivos estáticos do build
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));

// Fallback SPA — rotas que não são API devolvem o index.html
// (registrado DEPOIS das rotas de API, no final do arquivo)
app.get('{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
});
```

> **Nota sobre Express 5:** A sintaxe de wildcard mudou de `'*'` para `'{*path}'`. O projeto usa Express 5 (`"express": "^5.2.1"`), então a sintaxe antiga causava crash com `PathError: Missing parameter name`.

---

### 5. Script `start` apontava para o arquivo errado

**Antes:**
```json
"start": "node main.js"
```

**Problema:** O `main.js` é o orquestrador dos scripts de scraping (1_scraper, 2_limpeza, etc), não o servidor web. Na Railway, o `npm start` executava `main.js`, que não abre porta HTTP nenhuma — o deploy falhava no health check.

**Correção:**
```json
"start": "node server.js",
"build": "cd frontend && npm install && npm run build"
```

---

### 6. Chrome não encontrado (Puppeteer)

**Antes:**
```js
const client = new Client({
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true
    }
});
```

**Problema:** O `whatsapp-web.js` usa internamente o `puppeteer-core`, que **não baixa** o Chrome automaticamente. Ele espera encontrar um Chrome na versão exata do seu cache (`~/.cache/puppeteer`). Se essa versão específica não existe, ele crasha com `Could not find Chrome`. Isso acontecia tanto localmente (se você nunca rodou `npx puppeteer browsers install`) quanto na Railway (onde não há Chrome instalado por padrão).

**Correção:** Função `findChromePath()` que detecta o Chrome automaticamente:
1. Primeiro checa `process.env.PUPPETEER_EXECUTABLE_PATH` (Railway/Docker)
2. Depois procura nos caminhos padrão do OS (Mac: `/Applications/Google Chrome.app/...`, Linux: `/usr/bin/google-chrome-stable`)
3. Se nenhum for encontrado, deixa o Puppeteer tentar o Chrome bundled como fallback

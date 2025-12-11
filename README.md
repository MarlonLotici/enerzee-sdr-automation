# 🤖 Enerzee AI SDR + Lead Scraper

Sistema inteligente de prospecção e qualificação de leads automatizado via WhatsApp, utilizando IA Generativa (Llama 3 via Groq) para negociação e agendamento.

## 🚀 Funcionalidades

### 1. Scraper de Dados (Google Maps)
- Coleta leads B2B (Empresas) baseado em geolocalização e nicho.
- Sanitização automática de dados (Telefones, Nomes).
- Exportação estruturada para Excel (`.xlsx`).

### 2. SDR Ativo (WhatsApp Automation)
- **Engine:** WPPConnect (WhatsApp Web API).
- **Cérebro:** Llama 3-70b (via Groq Cloud) com Prompt Engineering avançado (Neurovendas + GPCTBA).
- **Gestão de Sessão:** Sistema de fila de disparo com *delays* humanizados e anti-banimento.
- **Memória:** Histórico de contexto da conversa e prevenção de duplicidade.
- **Handover:** Detecção automática de necessidade humana e transbordo para atendente real.

## 🛠️ Stack Tecnológica

- **Runtime:** Node.js
- **IA:** Groq SDK (Llama 3)
- **WhatsApp:** @wppconnect-team/wppconnect
- **Dados:** ExcelJS / FileSystem (JSON/TXT)

## ⚙️ Configuração

1. Clone o repositório.
2. Instale as dependências:
   ```bash
   npm install
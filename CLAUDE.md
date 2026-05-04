# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Enerzee SDR Automation is a B2B sales automation platform for the Brazilian solar energy sector. It combines Google Maps lead scraping, CNPJ data enrichment, and AI-powered WhatsApp SDR automation with multi-tenant support.

## Commands

```bash
# Install dependencies (root)
npm install

# Start backend server (port 3001)
npm start

# Frontend hot-reload dev server (port 5173)
cd frontend && npm run dev

# Build frontend for production (output: frontend/dist, served by Express)
npm run build

# Lint frontend
cd frontend && npm run lint
```

There is no test suite. No single-test command exists.

## Architecture

### Data Pipeline (sequential ETL flow)

```
1_scraper.js  →  2_clean.js  →  3_enrich.js  →  4_sdr.js
Google Maps       sanitize        CNPJ lookup      WhatsApp
  scraping        + dedup         BrasilAPI         Baileys
```

`server.js` is the main entry point — it runs Express + Socket.io on port 3001, serves the built frontend from `frontend/dist`, and orchestrates the pipeline via HTTP API routes.

### AI Agent Flow

Incoming WhatsApp messages are queued in BullMQ (Redis) and processed through a chain of Groq LLM calls:

```
routerAgent.js  →  profilerAgent.js  →  closerAgent.js
  classify           lead profile        qualify/close
  intent                                      ↓
                                      objectionAgent.js
                                      handoffAgent.js
                                      auditorAgent.js
```

Each agent lives in `agents/` and makes a Groq API call (Llama 3-70b) with a specialized system prompt. Context includes full conversation history, per-instance rules from Supabase, and regional discount maps.

### Multi-Tenancy

Each WhatsApp number is an **instance** (chip). Instances are isolated rows in the Supabase `instances` table and carry their own `system_prompt`, `agent_name`, `company_name`, `regional_rules`, and `daily_limit`. Session credentials are stored in `whatsapp_sessions` (Supabase) or Redis — two adapters exist: `auth_adapter.js` (Supabase) and `auth_redis_adapter.js` (Redis).

### Real-Time Communication

Socket.io connects frontend clients to the backend. The scraper, SDR engine, and message processor emit events that are broadcast to all connected clients for live dashboard updates.

### Regional Intelligence

- `MAPA_CONCESSIONARIAS` — maps Brazilian states to power utility names
- `MAPA_DESCONTO_REGIONAL` — state-specific solar discount percentages
- `gerarContextoNicho()` — injects sector vocabulary into agent prompts (e.g., "freezer 24h" for supermarkets)

## Environment Variables

```
# Backend (.env)
GROQ_API_KEY=
SUPABASE_URL=
SUPABASE_KEY=
SERPER_API_KEY=        # Google search enrichment
TOGETHER_API_KEY=      # Alternative LLM provider
REDIS_URL=             # Defaults to redis://localhost:6379
DISCORD_WEBHOOK_URL=   # Alert notifications
PORT=3001

# Frontend (frontend/.env)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Key Database Tables (Supabase)

| Table | Purpose |
|---|---|
| `instances` | WhatsApp accounts with per-tenant config |
| `leads` | Prospects with status, conversation history, niche |
| `whatsapp_sessions` | Baileys auth credentials |
| `whatsapp_keys` | Baileys session key cache |
| `conversations` | Per-lead message logs |

## Deployment

Deployed on Railway. `nixpacks.toml` handles Chrome/Chromium installation for Puppeteer. Frontend is built at deploy time and served as static files by Express — there is no separate frontend service.

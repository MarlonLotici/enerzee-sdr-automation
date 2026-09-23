# Checklist LGPD — Antix Colony

> ⚠️ **NÃO É ACONSELHAMENTO JURÍDICO.** Checklist prático para cobrir o básico de conformidade com a LGPD. **Um(a) advogado(a) deve revisar** os documentos, contratos e bases legais antes de uso em produção.

**Contexto:** Antix Colony — SaaS de SDR de IA no WhatsApp (multi-tenant). Estágio: pré-receita / 1º cliente, operação solo. A prioridade é **cobertura mínima realista**, não perfeição.

Legenda: 🔴 Essencial agora · 🟡 Importante em breve · 🟢 Depois (maturidade)

---

## 🔴 FASE 1 — Essencial AGORA (pré-receita / 1º cliente)

Estes itens são baratos, rápidos e reduzem o maior risco jurídico e reputacional.

- [ ] **1. Publicar a Política de Privacidade** no site antix-ia.com (usar `politica-privacidade.md`, preencher `[COLCHETES]`).
      → *Por quê:* obrigação legal (transparência, art. 9º LGPD) e pré-requisito de confiança para vender.
- [ ] **2. Aviso de IA no widget** — deixar claro que "Sofia" é uma IA, não humano.
      → *Por quê:* transparência e boa-fé; evita alegação de indução a erro. Ver `texto-consentimento-widget.md`.
- [ ] **3. Consentimento no widget** — checkbox/aviso com link para a Política antes/ao iniciar a conversa.
      → *Por quê:* base legal para tratar as conversas do site (Antix como controladora).
- [ ] **4. Opt-out no WhatsApp ("PARE/SAIR/PARAR/CANCELAR/não quero mais")** — detectar e parar a IA, marcar lead como opt-out/blacklist.
      → *Por quê:* direito de oposição (art. 18) + evita banimento no WhatsApp e reclamações. Ver `opt-out-e-retencao.md`. *(blacklist já existe no banco — falta o gatilho automático.)*
- [ ] **5. Indicar um Encarregado (DPO) e um e-mail de contato de privacidade** (ex.: privacidade@antix-ia.com).
      → *Por quê:* exigência do art. 41; pode ser o próprio Marlon no início.
- [ ] **6. DPA mínimo (Contrato Operador–Controlador) com o 1º cliente** — cláusula ou anexo definindo que a Antix é operadora e trata dados só sob instrução do cliente.
      → *Por quê:* art. 39; protege a Antix ao deixar claro os papéis e responsabilidades. ⚠️ *Advogado deve redigir/revisar.*

---

## 🟡 FASE 2 — Importante em breve (ao ganhar tração / 2º-3º cliente)

- [ ] **7. Política de retenção implementada** — apagar/anonimizar conversas de leads inativos após N meses. Ver `opt-out-e-retencao.md`.
      → *Por quê:* princípio da necessidade (art. 6º, III); reduz risco e custo de armazenamento.
- [ ] **8. ROPA — Registro de Operações de Tratamento (versão simples)** — planilha/tabela com finalidades, dados, bases legais, terceiros, retenção. (Modelo abaixo.)
      → *Por quê:* art. 37; a ANPD pode solicitar; ajuda a organizar tudo.
- [ ] **9. Fluxo para atender pedidos de titulares** — canal e processo para acesso/exclusão/correção (mesmo que manual).
      → *Por quê:* art. 18; prazos de resposta.
- [ ] **10. Mapear e formalizar transferências internacionais** (Meta, LLMs, Supabase, Railway — provável fora do BR).
      → *Por quê:* art. 33. ⚠️ *Requer análise jurídica das salvaguardas.*
- [ ] **11. DPAs com os subprocessadores** (verificar/assinar os DPAs padrão de Supabase, Railway, provedor de LLM, provedor de e-mail).
      → *Por quê:* cadeia de operadores; a maioria oferece DPA pronto.
- [ ] **12. Banner/política de cookies** no site (se houver cookies de analytics/marketing).

---

## 🟢 FASE 3 — Depois (maturidade / escala)

- [ ] **13. Plano de resposta a incidentes** (quem faz o quê, comunicação à ANPD e titulares).
- [ ] **14. Relatório de Impacto (RIPD/DPIA)** — especialmente por tratar conteúdo de conversas e usar IA.
- [ ] **15. Avaliação de decisões automatizadas** (art. 20) — direito à revisão, dado que a IA qualifica leads.
- [ ] **16. Revisão periódica das bases legais e legítimo interesse (teste LIA)**.
- [ ] **17. Treinamento/procedimentos internos** conforme a equipe crescer.
- [ ] **18. Due diligence de segurança** (criptografia em repouso, logs de acesso, rotação de segredos).

---

## Modelo de ROPA simples (Registro de Tratamento)

> Preencher e manter atualizado. ⚠️ *Validar com advogado.*

| # | Operação / Finalidade | Papel da Antix | Dados tratados | Titulares | Base legal | Compartilhado com | Retenção |
|---|---|---|---|---|---|---|---|
| 1 | Chat da IA no site (widget) | Controladora | Nome, telefone, e-mail, conteúdo da conversa | Visitantes do site | Consentimento / contrato | LLMs, Supabase, Railway | [N meses] |
| 2 | Atendimento/qualificação de leads no WhatsApp | Operadora | Nome, telefone, conteúdo, CNPJ, nicho | Leads dos clientes | Def. pelo cliente controlador | Meta/WhatsApp, LLMs, Supabase, Railway | Conforme cliente |
| 3 | E-mail marketing/comunicação | Controladora [confirmar] | Nome, e-mail | Contatos | Legítimo interesse (c/ opt-out) | [Provedor de e-mail] | [N meses] |
| 4 | Enriquecimento de dados de empresa | Operadora/Controladora [confirmar] | CNPJ, nicho, dados públicos | Empresas/leads | Legítimo interesse | [Serper/outros] | [N meses] |
| 5 | Agendamento de reuniões | Operadora | Nome, telefone, horário | Leads | Def. pelo cliente | Google Agenda | [N meses] |

---

## Resumo — os 3 itens MAIS urgentes agora

1. **Aviso de IA + consentimento no widget** (com link para a Política) — transparência e base legal do site.
2. **Opt-out automático no WhatsApp** ("PARE/SAIR") parando a IA e marcando blacklist — direito de oposição + proteção anti-ban.
3. **Publicar a Política de Privacidade + indicar um DPO/e-mail** — obrigação legal básica e pré-requisito de confiança para fechar clientes.

*(O DPA com o cliente é o 4º, e vira essencial no exato momento em que houver contrato assinado.)*

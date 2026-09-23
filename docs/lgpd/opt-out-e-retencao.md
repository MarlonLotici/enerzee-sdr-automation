# Especificação Técnica — Opt-out, Aviso de IA e Retenção

> ⚠️ **NÃO É ACONSELHAMENTO JURÍDICO.** Esta é uma **especificação de implementação** (o "o quê" e "onde", não o código). As regras, prazos e textos legais devem ser **revisados por advogado**. Palavras-gatilho, prazos de retenção e microcopy são sugestões a validar.

Objetivo: cobrir três mecanismos de conformidade — (a) opt-out no WhatsApp, (b) aviso de IA no widget do site, (c) retenção/expurgo de dados.

---

## (a) Opt-out no WhatsApp

### Objetivo
Quando um lead pedir para parar de receber mensagens, a IA deve **parar imediatamente** e o lead deve ser marcado como opt-out/blacklist, sem depender de ação manual.

### Detecção (palavras-gatilho)
Detectar, na mensagem recebida (normalizada: minúsculas, sem acento, trim), intenção de opt-out. Sugestão de gatilhos:

- Palavras isoladas/curtas: `PARE`, `SAIR`, `PARAR`, `CANCELAR`, `SAIA`, `STOP`, `DESCADASTRAR`.
- Frases: `não quero mais`, `nao quero mais`, `me tira da lista`, `não me mande mais`, `pare de me mandar`, `remover meu contato`, `descadastrar`.

⚠️ *Cuidado com falsos positivos:* "pare" pode aparecer em outra frase. Recomenda-se:
- Tratar como opt-out forte quando a mensagem for **curta e essencialmente a palavra-gatilho** (ex.: só "PARE", "SAIR").
- Para frases mais longas, considerar confirmação leve ("Ok, não vou mais te enviar mensagens. Confirma?") ⚠️ *ou aplicar direto — decisão jurídica/produto.*
- Manter a detecção como um passo **determinístico (regex/keyword)**, independente da LLM, para não falhar quando o modelo estiver indisponível.

### Ação ao detectar
1. **Parar a IA** para aquele lead (não gerar/enviar mais respostas automáticas) — semelhante ao estado "pausado", mas permanente até reversão.
2. **Marcar o lead como opt-out / blacklist** no banco (a blacklist/opt-out já existe no banco — reutilizar).
3. **Enviar uma única confirmação curta** (ex.: "Pronto, você não receberá mais mensagens. Se mudar de ideia, é só chamar.") ⚠️ *texto a validar.*
4. **Registrar** data/hora e origem do opt-out (para prova de atendimento ao direito de oposição).
5. **Respeitar o multi-tenant:** o opt-out deve valer no escopo correto (por lead + tenant/instância). Avaliar se o opt-out é por cliente-controlador ou global. ⚠️ *Decisão jurídica.*

### Onde mexer (termos gerais)
- **Motor do WhatsApp / processador de mensagens de entrada** (onde a mensagem recebida é normalizada e roteada, antes de acionar os agentes de IA): inserir a verificação de opt-out como **primeiro passo**, curto-circuitando o restante do fluxo.
- **Camada de dados (Supabase):** garantir flag de opt-out/blacklist no registro do lead e uma checagem dessa flag antes de qualquer envio (inbound e qualquer disparo).
- **Fila de mensagens (BullMQ):** ao marcar opt-out, descartar/ignorar jobs pendentes daquele lead.
- **E-mail:** o unsubscribe já existe; garantir que opt-out no WhatsApp e no e-mail conversem (ideal: um contato que pediu para sair sai de todos os canais). ⚠️ *validar escopo.*

### Reversão
Prever caminho para o lead **voltar a receber** (ex.: enviar "quero voltar" ou ação manual no painel), com registro.

---

## (b) Aviso de IA no widget do site + link para a Política

### Objetivo
Deixar explícito que a conversa é com uma IA e dar acesso à Política de Privacidade, coletando consentimento.

### Comportamento sugerido
1. **Antes ou no início da conversa**, exibir aviso curto: identifica a IA ("Sofia") + link "Política de Privacidade". (Ver microcopy em `texto-consentimento-widget.md`.)
2. **Consentimento:** exibir aviso com aceite (checkbox ou "ao continuar, você concorda...") antes de a conversa realmente começar/persistir dados.
3. **Registrar o consentimento**: timestamp + versão da política aceita (para prova). ⚠️ *nível de rigor a validar.*
4. O link da Política deve permanecer acessível durante toda a conversa (rodapé do widget).

### Onde mexer (termos gerais)
- **Widget de chat do site (antix-ia.com):** camada de UI do widget — adicionar a mensagem inicial de sistema/aviso e o elemento de consentimento; adicionar link para `/politica-privacidade`.
- **Endpoint que recebe as conversas do widget** (ex.: `/api/web-chat`): idealmente só persistir/tratar a conversa após o consentimento; gravar o registro de consentimento junto ao lead/sessão.
- **Página da Política:** publicar `politica-privacidade.md` renderizada em uma URL estável do site.

---

## (c) Política de retenção (expurgo/anonimização)

### Objetivo
Não guardar dados pessoais além do necessário. Apagar ou anonimizar conversas/leads inativos após um período.

### Regras sugeridas (⚠️ prazos a validar juridicamente)
- **Leads inativos:** após **[ex.: 12] meses** sem nenhuma interação, **anonimizar** (remover nome/telefone/conteúdo identificável) ou **excluir** o registro.
  - *Anonimizar* preserva métricas agregadas; *excluir* é mais simples e seguro. Escolher por finalidade.
- **Conteúdo de conversas:** pode ter prazo mais curto que os metadados de negócio. ⚠️ *decidir.*
- **Contatos em opt-out/blacklist:** **manter o mínimo** (ex.: só o telefone/e-mail em hash ou em lista de bloqueio) **justamente para não recontatar** — este dado sobrevive ao expurgo por ser necessário ao cumprimento do próprio opt-out.
- **Dados sob obrigação legal:** manter pelo prazo legal, depois expurgar.
- **Multi-tenant / papel de operadora:** para dados de leads dos clientes, a **retenção deve seguir a instrução do cliente-controlador** (definir no DPA). O expurgo padrão da Antix é fallback. ⚠️ *jurídico.*

### Mecanismo sugerido
- **Job agendado (rotina periódica)** que varre o banco, identifica registros elegíveis (por `last_activity`/`updated_at` + status) e aplica anonimização/exclusão.
- **Logar** o que foi expurgado (contagem, data) sem registrar os dados pessoais expurgados.
- **Excluir também** dados derivados: mensagens/conversas, chaves de sessão órfãs, caches.
- **Idempotente e reversível em janela curta** (ex.: soft-delete por X dias antes do hard-delete) para evitar perda acidental. ⚠️ *avaliar se soft-delete conflita com o direito à eliminação.*

### Onde mexer (termos gerais)
- **Camada de dados (Supabase):** identificar tabelas com dados pessoais (`leads`, `conversations`, mensagens, `whatsapp_sessions`/`whatsapp_keys` para órfãos) e os campos de data de atividade.
- **Backend (rotina agendada):** criar um worker/cron de expurgo. Pode reusar a infraestrutura de jobs existente.
- **Documentar** o prazo escolhido na Política de Privacidade (Seção 7) e no ROPA.

---

## Resumo de prioridade de implementação
1. **Opt-out no WhatsApp** (item a) — maior risco imediato (direito + anti-ban). Detecção determinística + parar IA + blacklist.
2. **Aviso de IA + consentimento no widget** (item b) — barato, alto valor de conformidade e confiança.
3. **Retenção** (item c) — importante, mas pode vir logo após, com job agendado simples.

# Checklist de ativação: Enerzee Consultoria (API oficial)

Atendente de IA feminina, receptiva, que conversa e agenda. Conta da Enerzee no painel:
`user_id = cf8950a2-318f-47b5-831c-ee697d8c5c51` (agente padrão hoje: **Lorena**). Hoje a conta não tem nenhum chip.

## 0. Confirmar antes de começar

- [x] **Número:** +55 48 8824-5113 (Phone Number ID 1400458459825400, WABA 2148464835774402). O 4961 original foi descartado.
- [x] **O número sai do app do WhatsApp** antes do cadastro na Meta (conversas antigas do celular não vêm junto). Confirmado.
- [x] **Atendente:** Carla. Falta o **nome de exibição** na Meta (ex.: "Enerzee Consultoria"; nomes genéricos são recusados).
- [x] **Foco:** energia por assinatura + mercado livre (`product_type = 'generico'`). Os demais produtos só são citados.
- [ ] **Números do prompt:** preencher os `<<CONFIRMAR>>` de `prompt_carla.md` (desconto, conta mínima, região, regra de
      cancelamento, perfil do mercado livre).
- [x] **Agenda:** marlonlotici6@gmail.com, reunião online de 30 minutos. Falta: horários permitidos.
- [x] **Avisos:** Discord (geral do Marlon; ou um canal próprio em `profiles.discord_webhook_url` da Enerzee).
- [ ] **Business Manager e pagamento da Meta:** o BM da Antix (já verificado) ou um da Enerzee; cartão de quem.

## 1. Meta (no Business Manager)

- [ ] Adicionar o número como **nova WABA** e confirmar o código por SMS ou ligação.
- [ ] Cadastrar o **nome de exibição** e aguardar a aprovação.
- [ ] Anotar o **Phone Number ID** e o **WABA ID** (WhatsApp Manager → API Setup).
- [ ] Criar o **System User token** sem expiração, com `whatsapp_business_messaging` e
      `whatsapp_business_management`, com acesso **só** a essa WABA.
- [ ] Forma de pagamento da WABA.

## 2. Chip e virada para a API oficial

1. [x] **Chip criado no banco** (23/11): `7ca283d1-d28f-4c9b-a97e-17568e21f749`, "Enerzee (Carla)", conta da Enerzee, oficial,
       receptivo (inbound_only), sem disparo frio, com o prompt da Carla (7.906 caracteres, override por chip).
2. [ ] Trocar os 3 placeholders e rodar o **UPDATE** de `db/enerzee_consultoria_api_oficial.sql` no Supabase (token, Phone Number ID, WABA ID).
3. [ ] Rodar `scripts/setup_cloud_api.js` com o token (assina o app na WABA e, com `--register --pin`, registra o número).
4. [ ] **Redeploy** no Railway (ou "Reconectar" no painel). Deve ficar CONNECTED sem QR.
5. [ ] **Webhook** na Meta, com o `&token=` (URL pronta no SQL). Assinar o campo "messages".

## 3. Persona e agenda

- [x] Prompt da Carla pronto e gravado no chip: `docs/clientes/enerzee-consultoria/prompt_carla.md` (sem campo pendente).
- [ ] **Google Agenda:** logar no painel como a conta da Enerzee e conectar a agenda `marlonlotici6@gmail.com` (autorização do Google, só você).
      Depois me avise para ligar o `booking_ativo` e conferir horário e duração (padrão 30 minutos).
- [ ] Voz (se ela mandar áudio): escolher uma voz feminina e testar com `scripts/amostras_voz.js`.

## 4. Teste ponta a ponta (com um número seu)

- [ ] "Oi" do seu celular → ela responde, se apresenta com o nome certo e fala da Enerzee (não da Antix).
- [ ] Áudio seu → ela transcreve e responde.
- [ ] Conversa até o fim: necessidade → solução → convite → escolhe horário → evento criado na agenda com Meet →
      aviso no WhatsApp do responsável.
- [ ] Conferir no log o custo da conversa (`💲 [LLM] ... conversa <nome>: US$ ...`).

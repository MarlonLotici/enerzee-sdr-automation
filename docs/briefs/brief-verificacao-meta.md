# BRIEF — Verificação da Meta + Criação do Número na WhatsApp Cloud API (API Oficial)

> **Para quem vai executar:** você NÃO precisa entender de programação. É burocracia + cliques em painéis da Meta (Facebook). Siga passo a passo. Quando travar em qualquer ponto, pare e mande print/mensagem pro Marlon — NÃO chute.

---

## OBJETIVO

Deixar pronta a conta oficial de WhatsApp da empresa cliente ("Foz") dentro do sistema da Meta, para que a inteligência artificial da Antix possa enviar e receber mensagens de forma oficial (sem risco de banimento por anúncio pago).

No fim, três coisas precisam existir:
1. **Empresa verificada** no Meta Business Manager (com o CNPJ).
2. **Um número de WhatsApp dedicado** criado dentro da Cloud API (não pode ser o WhatsApp pessoal de ninguém).
3. **Duas informações técnicas** entregues ao Marlon: o `PHONE_NUMBER_ID` e o **token permanente** (esse último é secreto — leia a seção de segurança).

---

## ⚠️ REGRA DE OURO DE SEGURANÇA (leia antes de começar)

- O **token permanente** é como a **senha mestra** da conta de WhatsApp. Quem tem o token pode enviar mensagens em nome da empresa.
- **Você (VA/estagiário/freelancer) prepara tudo até o ponto de gerar o token, mas quem clica em "gerar/copiar o token e usar" é o Marlon.** Se possível, faça a etapa final do token com o Marlon junto (chamada de vídeo compartilhando tela) ou deixe a tela pronta e chame ele.
- **NUNCA** cole o token em: WhatsApp, e-mail comum, Google Docs compartilhado, planilha, bloco de notas do celular, chat de grupo, print público. Se por acidente o token vazar, avise o Marlon IMEDIATAMENTE (ele revoga e gera outro).
- **NUNCA** aprove logins de dois fatores (2FA) que chegarem no celular do Marlon sem ele pedir.
- Se a Meta pedir documento da empresa (cartão CNPJ, conta de luz, contrato social), **peça esses arquivos ao Marlon** — não invente nem use documento de outra empresa.

---

## FERRAMENTAS / ACESSOS NECESSÁRIOS (peça ao Marlon antes de começar)

- [ ] Login no **Meta Business Manager** (business.facebook.com) — o Marlon te adiciona como "pessoa" com o cargo adequado (de preferência **Administrador limitado / Funcionário**, não Admin total).
- [ ] Acesso ao **Meta for Developers** (developers.facebook.com) se o Marlon pedir para você acompanhar o app.
- [ ] **CNPJ e razão social** da empresa que vai ser verificada.
- [ ] **Documentos da empresa** (cartão CNPJ, comprovante de endereço da empresa) — o Marlon envia por canal seguro.
- [ ] **O número de telefone** que vai virar o WhatsApp oficial. IMPORTANTE: precisa ser um número que **não esteja** usando o app WhatsApp comum nem o WhatsApp Business no celular. O ideal é um **chip novo** ou um número fixo/VoIP que consiga receber SMS ou ligação para o código.
- [ ] Um jeito de **receber o código de verificação** desse número (SMS ou chamada).

---

## PASSO A PASSO

### PARTE A — Verificação da empresa (Business Verification)

1. Entre em **business.facebook.com** com o login que o Marlon te deu.
2. No canto superior/menu, clique em **Configurações do Negócio** (o ícone de engrenagem).
3. No menu da esquerda, procure **Central de Segurança** (ou "Security Center").
4. Localize a seção **Verificação da empresa** (Business Verification). Vai mostrar o status: "Não verificada", "Em análise" ou "Verificada".
5. Se estiver "Não verificada", clique em **Iniciar verificação** / **Começar**.
6. Preencha exatamente com os dados oficiais da empresa (peça ao Marlon):
   - Nome legal / Razão social (igual ao cartão CNPJ)
   - CNPJ
   - Endereço da empresa
   - Telefone da empresa
   - Site (pode usar antix-ia.com ou o site do cliente, conforme o Marlon indicar)
7. Quando pedir **documento comprovante**, envie o arquivo que o Marlon te passou (cartão CNPJ e/ou comprovante de endereço). Confira que o nome e o CNPJ no documento batem 100% com o que você digitou.
8. A Meta pode pedir um **código de verificação** por telefone/e-mail da empresa — combine com o Marlon quem recebe.
9. Clique em **Enviar**. O status muda para **"Em análise"**.
10. **A partir daqui é espera.** A Meta pode levar de algumas horas até alguns dias. Cheque o status 1x por dia e registre no relatório (ver "Critério de pronto").
11. Se a Meta **recusar**, ela diz o motivo (ex.: documento ilegível, endereço divergente). Tire print do motivo, avise o Marlon e refaça o que ele orientar.

### PARTE B — Criar a conta de WhatsApp (WABA) e o número

> Só faça a Parte B depois que o Marlon confirmar que existe um **App** criado no Meta for Developers (ou peça pra ele criar — leva 2 min e envolve conta de desenvolvedor).

1. Entre em **developers.facebook.com** (ou peça ao Marlon o link direto do App).
2. Abra o **App** da Antix/Foz. No menu da esquerda, procure o produto **WhatsApp**.
3. Clique em **WhatsApp → Introdução / Primeiros passos** (Getting Started).
4. Vai aparecer uma **WhatsApp Business Account (WABA)**. Se não existir, o painel oferece criar uma — dê um nome claro, ex.: `Foz - WhatsApp Oficial`.
5. Ainda nessa tela, procure a área de **números de telefone** e clique em **Adicionar número de telefone**.
6. Preencha:
   - **Nome de exibição** (Display Name): o nome que aparece pro cliente no WhatsApp (ex.: "Foz Energia"). Pergunte ao Marlon o nome exato — a Meta revisa e pode reprovar nomes genéricos.
   - **Categoria** do negócio.
   - **Fuso/telefone**: coloque o número dedicado (com DDI +55).
7. Escolha **receber o código por SMS ou por chamada** e digite o código que chegou. O número fica verificado.
8. Pronto: agora existe um número oficial dentro da Cloud API.

### PARTE C — Encontrar o PHONE_NUMBER_ID (informação técnica, não é secreta)

1. Ainda em **developers.facebook.com → seu App → WhatsApp → Introdução (API Setup)**.
2. Nessa página tem uma caixa "Enviar e receber mensagens". Ali aparecem dois códigos numéricos longos:
   - **Phone number ID** (ID do número de telefone) ← **é esse que a gente quer.**
   - **WhatsApp Business Account ID** (ID da WABA) ← anote também, ajuda o Marlon.
3. **Copie o Phone number ID** e cole no relatório para o Marlon (esse número **não é secreto**, pode mandar por mensagem normal).

### PARTE D — Token permanente (⚠️ ETAPA DO MARLON — você só deixa pronto)

> Aqui você **NÃO copia o token final**. Você prepara o "usuário de sistema" e chama o Marlon para a etapa de gerar/copiar.

1. Vá em **business.facebook.com → Configurações do Negócio**.
2. No menu esquerdo, clique em **Usuários → Usuários do sistema** (System Users).
3. Clique em **Adicionar** e crie um usuário de sistema:
   - Nome: `antix-integracao`
   - Função: **Admin** (o Marlon confirma).
4. Depois de criado, clique nele e em **Adicionar ativos** (Assign Assets): associe o **App** e a **WhatsApp Business Account (WABA)** criados na Parte B, com permissão de **controle total**.
5. **PARE AQUI e chame o Marlon.** A próxima ação (botão **"Gerar novo token"**, escolher as permissões `whatsapp_business_messaging` e `whatsapp_business_management`, e **copiar o token**) deve ser feita **pelo Marlon**, porque o token aparece **uma única vez** na tela e é secreto.
6. Se o Marlon pedir que você deixe a tela aberta em chamada de tela compartilhada, tudo bem — mas quem clica em "gerar" e guarda o token é ele.

---

## CRITÉRIO DE PRONTO (como saber que terminou)

Monte um pequeno relatório (mensagem ou doc privado pro Marlon) com:

- [ ] Status da **verificação da empresa**: Verificada ✅ / Em análise ⏳ / Recusada ❌ (com print do motivo).
- [ ] **WABA criada?** Sim/Não — e o nome dela.
- [ ] **Número dedicado adicionado e verificado?** Sim/Não — qual número.
- [ ] **Nome de exibição** enviado e status (aprovado/em revisão).
- [ ] **PHONE_NUMBER_ID** copiado e colado (pode mandar normal).
- [ ] **WABA ID** copiado (ajuda o Marlon).
- [ ] **Usuário de sistema `antix-integracao` criado** com App + WABA associados. ✅ Token **NÃO gerado por você** — deixado pronto pro Marlon.

Terminou quando: empresa verificada + número dedicado ativo + PHONE_NUMBER_ID entregue + usuário de sistema pronto para o Marlon gerar o token.

---

## TEMPO ESTIMADO

- Parte A (enviar verificação): **30–45 min** de trabalho + **horas a dias** de espera da Meta (fora do seu controle).
- Partes B e C (número + IDs): **30–60 min**.
- Parte D (deixar usuário de sistema pronto): **15 min**.
- **Total de trabalho ativo: ~1h30 a 2h**, espalhado ao longo de alguns dias por causa das análises da Meta.

---

## O QUE NÃO FAZER (limites)

- ❌ **NÃO** gere, copie, cole ou guarde o **token permanente**. Essa parte é do Marlon.
- ❌ **NÃO** use um número de WhatsApp que já esteja em uso no app WhatsApp comum — isso quebra a Cloud API.
- ❌ **NÃO** invente dados da empresa nem use documentos de terceiros na verificação.
- ❌ **NÃO** exclua/remova nenhum ativo, número, App ou usuário existente. Você só **adiciona/cria**.
- ❌ **NÃO** mude senhas, 2FA ou configurações de cobrança/cartão da conta Meta.
- ❌ **NÃO** aceite mudanças que a Meta sugerir sem entender — na dúvida, tire print e pergunte ao Marlon.
- ❌ **NÃO** compartilhe prints que mostrem tokens, códigos SMS ou dados pessoais em grupos/redes.

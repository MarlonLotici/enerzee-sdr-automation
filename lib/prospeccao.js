'use strict';
/**
 * PROSPECÇÃO DIÁRIA DA ANTIX (dias úteis). Acha integradores de energia solar (Google Maps via Serper) e gestores de
 * tráfego que trabalham com solar (Instagram via Serper), escreve uma mensagem personalizada pra cada um e manda a
 * lista pro Discord da Antix com o link do WhatsApp já com o texto pronto. NÃO ENVIA NADA pro prospect: o Marlon
 * revisa e aperta "enviar" (disparo automático em massa bane número e queima a marca).
 *
 * Tudo que depende de rede vem injetado (serper, gerarMensagens, redis, enviarDiscord) → o núcleo é testável.
 */

const CIDADES = [
    'Florianópolis SC', 'Joinville SC', 'Blumenau SC', 'Chapecó SC', 'Criciúma SC', 'Curitiba PR', 'Londrina PR',
    'Maringá PR', 'Cascavel PR', 'Ponta Grossa PR', 'Porto Alegre RS', 'Caxias do Sul RS', 'Passo Fundo RS',
    'São Paulo SP', 'Campinas SP', 'Ribeirão Preto SP', 'Sorocaba SP', 'São José do Rio Preto SP', 'Bauru SP',
    'Belo Horizonte MG', 'Uberlândia MG', 'Juiz de Fora MG', 'Montes Claros MG', 'Goiânia GO', 'Anápolis GO',
    'Rio Verde GO', 'Brasília DF', 'Cuiabá MT', 'Rondonópolis MT', 'Campo Grande MS', 'Dourados MS',
    'Rio de Janeiro RJ', 'Vitória ES', 'Salvador BA', 'Feira de Santana BA', 'Recife PE', 'Petrolina PE',
    'Fortaleza CE', 'Natal RN', 'João Pessoa PB', 'Teresina PI', 'São Luís MA', 'Palmas TO', 'Belém PA',
];

const BUSCAS_GESTORES = [
    'site:instagram.com "gestor de tráfego" "energia solar"',
    'site:instagram.com "tráfego pago" "integradores" "solar"',
    'site:instagram.com "marketing para energia solar"',
    'site:instagram.com "leads" "energia solar" "agência"',
    'site:instagram.com "gestora de tráfego" "energia solar"',
    'site:instagram.com "marketing digital" "fotovoltaica"',
];

/** Dia útil em Brasília? (seg a sex) */
function ehDiaUtilBRT(d = new Date()) {
    const dia = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay();
    return dia >= 1 && dia <= 5;
}
function horaBRT(d = new Date()) {
    const x = new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    return x.getHours() + x.getMinutes() / 60;
}
function dataBRT(d = new Date()) {
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // AAAA-MM-DD
}

/** Cidades do dia: rotaciona pela lista conforme a data (cada dia começa numa cidade diferente). */
function cidadesDoDia(dataISO, n = 3) {
    const dias = Math.floor(Date.parse(`${dataISO}T12:00:00Z`) / 86400000);
    const ini = ((dias * n) % CIDADES.length + CIDADES.length) % CIDADES.length;
    return Array.from({ length: Math.min(n, CIDADES.length) }, (_, i) => CIDADES[(ini + i) % CIDADES.length]);
}

/** Telefone BR → { digitos: '55DDXXXXXXXXX', celular } ou null. */
function normalizarTelefoneBR(tel) {
    let d = String(tel || '').replace(/\D/g, '');
    if (d.startsWith('0')) d = d.replace(/^0+/, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    if (!/^55\d{10,11}$/.test(d)) return null;
    return { digitos: d, celular: d.length === 13 && d[4] === '9' };
}

function linkWhatsApp(digitos, texto) {
    return `https://wa.me/${digitos}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}

/** @handle do Instagram a partir de um link de perfil (ignora post/reel/explore). */
function handleInstagram(link) {
    const m = /instagram\.com\/([A-Za-z0-9._]{2,30})\/?(?:[?#].*)?$/i.exec(String(link || ''));
    if (!m) return null;
    const h = m[1].toLowerCase();
    return ['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts', 'direct'].includes(h) ? null : h;
}

/** Converte resultados do /places em integradores (filtra quem não parece integradora solar). */
function integradoresDePlaces(places = [], cidade = '') {
    return places
        .filter(p => p && p.title && /solar|fotovolt|energia/i.test(`${p.title} ${p.category || ''}`))
        .map(p => {
            const tel = normalizarTelefoneBR(p.phoneNumber);
            return {
                tipo: 'integrador', nome: p.title, cidade, nota: p.rating || null, avaliacoes: p.ratingCount || 0,
                site: p.website || null, telefone: tel?.digitos || null, celular: !!tel?.celular,
                chave: tel?.digitos ? `tel:${tel.digitos}` : `nome:${String(p.title).toLowerCase()}|${cidade.toLowerCase()}`,
            };
        })
        .filter(x => x.telefone); // sem telefone não dá pra abordar no WhatsApp
}

/** Converte resultados do /search (site:instagram.com) em gestores de tráfego. */
function gestoresDeBusca(organic = []) {
    const vistos = new Set();
    const out = [];
    for (const o of organic) {
        const h = handleInstagram(o.link);
        if (!h || vistos.has(h)) continue;
        vistos.add(h);
        const nome = String(o.title || '').replace(/\s*[(•|].*$/, '').trim() || `@${h}`;
        out.push({ tipo: 'gestor', nome, instagram: h, bio: String(o.snippet || '').slice(0, 300), chave: `ig:${h}` });
    }
    return out;
}

/** Ordena integradores: celular primeiro (WhatsApp mais provável), depois mais avaliações. */
function priorizarIntegradores(lista) {
    return [...lista].sort((a, b) => (b.celular - a.celular) || ((b.avaliacoes || 0) - (a.avaliacoes || 0)));
}

const REMETENTE = () => process.env.PROSPECCAO_REMETENTE || 'Marlon, da Antix';
const COMISSAO = () => process.env.PROSPECCAO_COMISSAO || '30% recorrente';

/** Mensagem padrão (usada quando o LLM falha). Sem abreviação, sem promessa de número. */
function mensagemPadrao(p) {
    if (p.tipo === 'gestor') {
        return `Oi, tudo bem? Aqui é o ${REMETENTE()}. Vi que você trabalha com tráfego para energia solar. Sabe quando o cliente diz que os leads são ruins, mas na verdade ninguém respondeu a tempo? A gente resolve isso com uma inteligência artificial que atende na hora, qualifica e agenda, pela API oficial do WhatsApp. Pago ${COMISSAO()} por cliente indicado. Topa um papo de 15 minutos?`;
    }
    const elogio = p.nota && p.avaliacoes >= 10 ? ` (nota ${String(p.nota).replace('.', ',')} no Google, parabéns)` : '';
    return `Oi, tudo bem? Aqui é o ${REMETENTE()}. Vi a ${p.nome} em ${String(p.cidade).replace(/ [A-Z]{2}$/, '')}${elogio}. No solar o cliente cota com 3 ou 4 empresas e costuma fechar com quem responde primeiro. A gente coloca uma inteligência artificial que atende os contatos no WhatsApp na hora, 24 horas, qualifica e já marca a visita na sua agenda. Posso te mandar um áudio de 1 minuto mostrando?`;
}

/** Prompt pro LLM personalizar as mensagens (devolve JSON {chave: mensagem}). */
function promptMensagens(prospects) {
    const dados = prospects.map(p => ({ chave: p.chave, tipo: p.tipo, nome: p.nome, cidade: p.cidade, nota: p.nota, avaliacoes: p.avaliacoes, site: p.site, bio: p.bio }));
    return `Você escreve a PRIMEIRA mensagem de WhatsApp ou Instagram que o ${REMETENTE()} vai mandar para cada contato abaixo. A Antix cria agentes de inteligência artificial que atendem os contatos no WhatsApp na hora, 24 horas, qualificam e agendam, pela API oficial do WhatsApp. É de Florianópolis, está no mercado há quase 1 ano e atende energia solar, clínicas, academias e deliverys.
Tipos:
- "integrador": empresa de energia solar. Ângulo: no solar o cliente cota com 3 ou 4 empresas e fecha com quem responde primeiro. Termine oferecendo um áudio de 1 minuto mostrando.
- "gestor": gestor de tráfego ou agência que atende energia solar. Ângulo: parceria; o cliente dele culpa os leads quando na verdade ninguém respondeu a tempo; pagamos ${COMISSAO()} por cliente indicado. Termine propondo um papo de 15 minutos.
REGRAS: comece com "Oi, tudo bem? Aqui é o ${REMETENTE()}." Use 1 detalhe real do contato (nome, cidade, nota no Google, algo da bio) se houver. Máximo 4 frases curtas. Português do Brasil, tom humano, sem abreviação, sem emoji, sem inventar número, cliente ou resultado. Uma única pergunta no fim.
Contatos (JSON):
${JSON.stringify(dados)}
Responda SOMENTE com um JSON no formato {"<chave>": "<mensagem>"}, uma entrada por contato.`;
}

function lerJsonMensagens(texto) {
    const t = String(texto || '');
    const ini = t.indexOf('{'), fim = t.lastIndexOf('}');
    if (ini < 0 || fim <= ini) return {};
    try { const j = JSON.parse(t.slice(ini, fim + 1)); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}

/** Embeds do Discord (máx. 10 por mensagem). */
function montarEmbeds(prospects) {
    return prospects.map((p, i) => {
        if (p.tipo === 'gestor') {
            return {
                title: `🤝 ${i + 1}. ${p.nome} (@${p.instagram})`.slice(0, 250),
                url: `https://ig.me/m/${p.instagram}`,
                description: `**Abrir o direct (link do título) e colar:**\n${p.mensagem}`.slice(0, 4000),
                color: 0x10B981,
                fields: p.bio ? [{ name: 'Bio', value: p.bio.slice(0, 1000) }] : [],
            };
        }
        const campos = [{ name: 'Cidade', value: p.cidade, inline: true }];
        if (p.nota) campos.push({ name: 'Google', value: `${p.nota} ⭐ (${p.avaliacoes})`, inline: true });
        campos.push({ name: 'Telefone', value: `+${p.telefone}${p.celular ? '' : ' (fixo: confira se tem WhatsApp)'}`, inline: true });
        if (p.site) campos.push({ name: 'Site', value: p.site.slice(0, 1000) });
        return {
            title: `☀️ ${i + 1}. ${p.nome}`.slice(0, 250),
            url: linkWhatsApp(p.telefone, p.mensagem), // abre o WhatsApp com a mensagem pronta
            description: `**Toque no título pra abrir o WhatsApp com a mensagem pronta:**\n${p.mensagem}`.slice(0, 4000),
            color: 0xF59E0B,
            fields: campos,
        };
    });
}

/**
 * Roda a prospecção do dia.
 * @param {object} deps
 * @param {(endpoint:'places'|'search', q:string)=>Promise<object>} deps.serper
 * @param {(prompt:string)=>Promise<string>} deps.gerarMensagens  chamada ao LLM
 * @param {(chave:string)=>Promise<boolean>} deps.marcarNovo  true se o contato NUNCA foi enviado (e marca como visto)
 * @param {(payload:object)=>Promise<any>} deps.enviarDiscord
 */
async function rodarProspeccao({ serper, gerarMensagens, marcarNovo, enviarDiscord, dataISO = dataBRT(), qtdIntegradores = 8, qtdGestores = 4, log = console.log }) {
    // 1) Integradores: cidades do dia, até completar a cota com contatos inéditos.
    const integradores = [];
    const errosBusca = [];
    for (const cidade of cidadesDoDia(dataISO, 4)) {
        if (integradores.length >= qtdIntegradores) break;
        let r;
        try { r = await serper('places', `integradora de energia solar em ${cidade}`); } catch (e) { errosBusca.push(e.message); log(`⚠️ [PROSPECCAO] places ${cidade}: ${e.message}`); continue; }
        for (const p of priorizarIntegradores(integradoresDePlaces(r?.places || [], cidade))) {
            if (integradores.length >= qtdIntegradores) break;
            if (await marcarNovo(p.chave)) integradores.push(p);
        }
    }
    // 2) Gestores de tráfego: 2 buscas rotativas por dia.
    const gestores = [];
    const dia = Math.floor(Date.parse(`${dataISO}T12:00:00Z`) / 86400000);
    for (let k = 0; k < 2 && gestores.length < qtdGestores; k++) {
        const q = BUSCAS_GESTORES[(dia * 2 + k) % BUSCAS_GESTORES.length];
        let r;
        try { r = await serper('search', q); } catch (e) { errosBusca.push(e.message); log(`⚠️ [PROSPECCAO] search: ${e.message}`); continue; }
        for (const g of gestoresDeBusca(r?.organic || [])) {
            if (gestores.length >= qtdGestores) break;
            if (await marcarNovo(g.chave)) gestores.push(g);
        }
    }
    const todos = [...integradores, ...gestores];
    if (!todos.length && errosBusca.length) {
        // Nada veio porque a BUSCA falhou (ex.: Serper sem créditos), não porque não há contatos novos.
        throw new Error(`buscas falharam: ${errosBusca[0]}`);
    }
    if (!todos.length) {
        await enviarDiscord({ content: `🔎 **Prospecção ${dataISO}:** nenhum contato novo hoje (as buscas não trouxeram ninguém inédito).` });
        return { integradores: 0, gestores: 0 };
    }
    // 3) Mensagens personalizadas (fallback: padrão).
    let msgs = {};
    try { msgs = lerJsonMensagens(await gerarMensagens(promptMensagens(todos))); } catch (e) { log(`⚠️ [PROSPECCAO] LLM: ${e.message}`); }
    for (const p of todos) {
        const m = String(msgs[p.chave] || '').trim();
        p.mensagem = m.length >= 40 ? m : mensagemPadrao(p);
    }
    // 4) Discord: resumo + blocos de até 10 cards.
    await enviarDiscord({ content: `🔎 **Prospecção de ${dataISO.split('-').reverse().join('/')}** — ${integradores.length} integradores solares e ${gestores.length} gestores de tráfego. Revise, ajuste se quiser e envie você mesmo (cerca de 15 minutos).` });
    const embeds = montarEmbeds(todos);
    for (let i = 0; i < embeds.length; i += 10) await enviarDiscord({ embeds: embeds.slice(i, i + 10) });
    return { integradores: integradores.length, gestores: gestores.length };
}

module.exports = {
    CIDADES, BUSCAS_GESTORES, ehDiaUtilBRT, horaBRT, dataBRT, cidadesDoDia, normalizarTelefoneBR, linkWhatsApp,
    handleInstagram, integradoresDePlaces, gestoresDeBusca, priorizarIntegradores, mensagemPadrao, promptMensagens,
    lerJsonMensagens, montarEmbeds, rodarProspeccao,
};

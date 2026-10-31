import React, { useState, useEffect, useCallback, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import {
    Megaphone, Upload, Play, Pause, Trash2, Loader2, CheckCircle2, AlertTriangle,
    Plus, X, RefreshCw, Trophy, Users, Send, Eye, MessageSquare, Ban,
} from 'lucide-react'

// ============================================================================
// CAMPANHAS DE REAQUECIMENTO — a IA trabalha a BASE de clientes do tenant.
// 1) Importa a base (CSV/XLSX, mapeia colunas no navegador)  2) Cria a campanha com
// templates APROVADOS pela Meta (1 a 3 passos)  3) Inicia e acompanha o funil.
// Só chips da API oficial (disparo pra base via WhatsApp Web bane o número).
// ============================================================================

const C = {
    amber: '#F59E0B', green: '#10B981', red: '#F43F5E', cyan: '#06B6D4', violet: '#8B5CF6',
    muted: 'rgba(255,255,255,0.45)', border: 'rgba(255,255,255,0.08)', card: 'rgba(255,255,255,0.03)',
}
const CAMPOS_FIXOS = [
    { v: 'primeiro_nome', l: 'Primeiro nome' }, { v: 'nome', l: 'Nome completo' },
    { v: 'empresa', l: 'Empresa' }, { v: 'email', l: 'E-mail' },
]
const STATUS_COR = { ativa: C.green, pausada: C.amber, rascunho: C.muted, concluida: C.cyan }
const STATUS_ROTULO = { ativa: 'Ativa', pausada: 'Pausada', rascunho: 'Rascunho', concluida: 'Concluída' }

async function api(caminho, opcoes = {}) {
    const { data: { session } } = await supabase.auth.getSession()
    const resp = await fetch(caminho, {
        ...opcoes,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...(opcoes.headers || {}) },
    })
    const json = await resp.json().catch(() => ({}))
    if (!resp.ok) throw Object.assign(new Error(json.error || `Erro ${resp.status}`), { dados: json })
    return json
}

const inputCls = 'w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-amber-500/50'
const labelCls = 'block text-[10px] font-black uppercase tracking-widest mb-1.5'
const botaoCls = (cor = C.amber, cheio = true) => ({
    background: cheio ? cor : 'transparent', color: cheio ? '#000' : cor,
    border: `1px solid ${cor}${cheio ? '' : '55'}`, borderRadius: 10, padding: '8px 14px',
    fontSize: 12, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
})

function Secao({ titulo, icone, children, acao }) {
    return (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    {React.createElement(icone, { className: 'h-4 w-4', style: { color: C.amber } })}
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">{titulo}</h3>
                </div>
                {acao}
            </div>
            {children}
        </div>
    )
}

function Aviso({ tipo = 'erro', children }) {
    const cor = tipo === 'ok' ? C.green : tipo === 'info' ? C.cyan : C.red
    const Ic = tipo === 'ok' ? CheckCircle2 : AlertTriangle
    return (
        <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 mt-3"
             style={{ background: `${cor}12`, border: `1px solid ${cor}40`, color: cor }}>
            <Ic className="h-4 w-4 shrink-0 mt-0.5" /><div>{children}</div>
        </div>
    )
}

// ── 1. Importação da base ───────────────────────────────────────────────────
function ImportarBase({ chip, onImportado }) {
    const [linhas, setLinhas] = useState([])
    const [colunas, setColunas] = useState([])
    const [mapa, setMapa] = useState({ telefone: '', nome: '', email: '' })
    const [lote, setLote] = useState('')
    const [baseLegal, setBaseLegal] = useState('')
    const [enviando, setEnviando] = useState(false)
    const [progresso, setProgresso] = useState(null)
    const [resultado, setResultado] = useState(null)
    const [erro, setErro] = useState(null)

    const lerArquivo = async (e) => {
        setErro(null); setResultado(null)
        const arq = e.target.files?.[0]
        if (!arq) return
        try {
            const wb = XLSX.read(await arq.arrayBuffer(), { type: 'array', raw: false })
            const dados = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false })
            if (!dados.length) throw new Error('Planilha vazia.')
            const cols = Object.keys(dados[0])
            setLinhas(dados); setColunas(cols)
            const acha = (re) => cols.find(c => re.test(c.toLowerCase())) || ''
            setMapa({ telefone: acha(/tel|cel|whats|fone|phone/), nome: acha(/^nome|name|cliente/), email: acha(/mail/) })
            if (!lote) setLote(arq.name.replace(/\.[^.]+$/, '').slice(0, 60))
        } catch (err) { setErro(`Não consegui ler o arquivo: ${err.message}`) }
    }

    const importar = async () => {
        setErro(null); setResultado(null)
        if (!mapa.telefone) return setErro('Escolha qual coluna tem o telefone.')
        if (!baseLegal) return setErro('Informe a base legal (LGPD) para contatar estes clientes.')
        setEnviando(true)
        const total = { novos: 0, atualizados: 0, invalidos: 0, duplicados: 0, optoutMantidos: 0 }
        try {
            const convertidas = linhas.map(l => {
                const out = { telefone: l[mapa.telefone], nome: mapa.nome ? l[mapa.nome] : '', email: mapa.email ? l[mapa.email] : '' }
                for (const c of colunas) {
                    if ([mapa.telefone, mapa.nome, mapa.email].includes(c)) continue
                    const chave = c.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
                    if (chave) out[chave] = l[c]
                }
                return out
            })
            for (let i = 0; i < convertidas.length; i += 2000) {
                setProgresso(`${Math.min(i + 2000, convertidas.length)} de ${convertidas.length}`)
                const r = await api('/api/bases/import', {
                    method: 'POST',
                    body: JSON.stringify({ instanceId: chip.id, lote, consentimento: baseLegal, linhas: convertidas.slice(i, i + 2000) }),
                })
                for (const k of Object.keys(total)) total[k] += r[k] || 0
            }
            setResultado(total)
            setLinhas([]); setColunas([])
            onImportado?.()
        } catch (err) { setErro(err.message) } finally { setEnviando(false); setProgresso(null) }
    }

    const extras = colunas.filter(c => ![mapa.telefone, mapa.nome, mapa.email].includes(c))

    return (
        <Secao titulo="1 · Importar base de clientes" icone={Upload}>
            <p className="text-xs mb-4" style={{ color: C.muted }}>
                CSV ou Excel com os clientes da empresa. A coluna de telefone é obrigatória; as demais colunas
                (produto, última compra, valor...) viram dados que a IA e os templates podem usar.
            </p>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={lerArquivo}
                   className="text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-500 file:px-3 file:py-2 file:text-xs file:font-black file:text-black" />

            {linhas.length > 0 && (
                <div className="mt-5 space-y-4">
                    <p className="text-xs text-white"><b>{linhas.length}</b> linhas lidas. Diga qual coluna é qual:</p>
                    <div className="grid grid-cols-3 gap-3">
                        {[['telefone', 'Telefone *'], ['nome', 'Nome'], ['email', 'E-mail']].map(([k, l]) => (
                            <div key={k}>
                                <label className={labelCls} style={{ color: C.muted }}>{l}</label>
                                <select className={inputCls} value={mapa[k]} onChange={e => setMapa({ ...mapa, [k]: e.target.value })}>
                                    <option value="">— nenhuma —</option>
                                    {colunas.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                        ))}
                    </div>
                    {extras.length > 0 && (
                        <p className="text-[11px]" style={{ color: C.muted }}>
                            Também serão importadas como dados do cliente: {extras.join(', ')}
                        </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelCls} style={{ color: C.muted }}>Nome do lote</label>
                            <input className={inputCls} value={lote} onChange={e => setLote(e.target.value)} placeholder="ex.: inativos-2025" />
                        </div>
                        <div>
                            <label className={labelCls} style={{ color: C.muted }}>Base legal (LGPD) *</label>
                            <select className={inputCls} value={baseLegal} onChange={e => setBaseLegal(e.target.value)}>
                                <option value="">— selecione —</option>
                                <option value="legitimo_interesse_cliente">Clientes com relação comercial (legítimo interesse)</option>
                                <option value="consentimento">Consentimento expresso para contato</option>
                            </select>
                        </div>
                    </div>
                    <button style={botaoCls()} onClick={importar} disabled={enviando}>
                        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {enviando ? `Importando ${progresso || ''}` : 'Importar base'}
                    </button>
                </div>
            )}
            {erro && <Aviso>{erro}</Aviso>}
            {resultado && (
                <Aviso tipo="ok">
                    {resultado.novos} novos · {resultado.atualizados} atualizados · {resultado.invalidos} telefones inválidos
                    {resultado.duplicados ? ` · ${resultado.duplicados} repetidos na planilha` : ''}
                    {resultado.optoutMantidos ? ` · ${resultado.optoutMantidos} continuam bloqueados (pediram para sair)` : ''}
                </Aviso>
            )}
        </Secao>
    )
}

// ── 2. Nova campanha ────────────────────────────────────────────────────────
const passoVazio = () => ({ nome: '', idioma: 'pt_BR', texto: '', variaveis: [], esperaDias: 2 })

function NovaCampanha({ chip, lotes, onCriada, onCancelar }) {
    const [templates, setTemplates] = useState([])
    const [carregandoTpl, setCarregandoTpl] = useState(true)
    const [erroTpl, setErroTpl] = useState(null)
    const [form, setForm] = useState({
        nome: '', objetivo: 'reativacao', lotes: [], campo: '', operador: 'igual', valor: '',
        passos: [passoVazio()], prompt_campanha: '', janela_inicio: 9, janela_fim: 19, limite_diario: 100, frequencia_dias: 30,
    })
    const [salvando, setSalvando] = useState(false)
    const [erro, setErro] = useState(null)

    useEffect(() => {
        api(`/api/instance/${chip.id}/templates`)
            .then(r => setTemplates(r.templates || []))
            .catch(e => setErroTpl(e.message))
            .finally(() => setCarregandoTpl(false))
    }, [chip.id])

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
    const setPasso = (i, patch) => setForm(f => ({ ...f, passos: f.passos.map((p, j) => (j === i ? { ...p, ...patch } : p)) }))
    const escolherTemplate = (i, nome) => {
        const t = templates.find(x => x.nome === nome)
        if (!t) return setPasso(i, passoVazio())
        setPasso(i, {
            nome: t.nome, idioma: t.idioma, texto: t.texto,
            variaveis: Array.from({ length: t.qtdVariaveis }, (_, k) => ({ campo: k === 0 ? 'primeiro_nome' : '', padrao: '' })),
        })
    }
    const setVariavel = (i, k, patch) => setPasso(i, {
        variaveis: form.passos[i].variaveis.map((v, j) => (j === k ? { ...v, ...patch } : v)),
    })

    const lotesDoChip = lotes.filter(l => l.instanceId === chip.id)
    const publicoEstimado = form.lotes.length
        ? lotesDoChip.filter(l => form.lotes.includes(l.lote)).reduce((s, l) => s + l.total, 0)
        : null

    const salvar = async () => {
        setErro(null); setSalvando(true)
        try {
            const r = await api('/api/campanhas', {
                method: 'POST',
                body: JSON.stringify({
                    nome: form.nome, objetivo: form.objetivo, instance_id: chip.id,
                    filtro_segmento: { lotes: form.lotes, ...(form.campo && form.valor ? { campo: form.campo, operador: form.operador, valor: form.valor } : {}) },
                    templates: form.passos, prompt_campanha: form.prompt_campanha,
                    janela_inicio: Number(form.janela_inicio), janela_fim: Number(form.janela_fim),
                    limite_diario: Number(form.limite_diario), frequencia_dias: Number(form.frequencia_dias),
                }),
            })
            onCriada?.(r.campanha)
        } catch (e) { setErro(e.message) } finally { setSalvando(false) }
    }

    return (
        <Secao titulo="2 · Nova campanha" icone={Megaphone}
               acao={<button style={botaoCls(C.muted, false)} onClick={onCancelar}><X className="h-3.5 w-3.5" />Fechar</button>}>
            <div className="space-y-5">
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={labelCls} style={{ color: C.muted }}>Nome</label>
                        <input className={inputCls} value={form.nome} onChange={e => set('nome', e.target.value)} placeholder="ex.: Volta clientes inativos 90 dias" />
                    </div>
                    <div>
                        <label className={labelCls} style={{ color: C.muted }}>Objetivo</label>
                        <select className={inputCls} value={form.objetivo} onChange={e => set('objetivo', e.target.value)}>
                            <option value="reativacao">Reativar clientes inativos</option>
                            <option value="upsell">Vender mais para quem já é cliente</option>
                            <option value="outro">Outro</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label className={labelCls} style={{ color: C.muted }}>Público</label>
                    <div className="flex flex-wrap gap-2">
                        {lotesDoChip.length === 0 && <span className="text-xs" style={{ color: C.muted }}>Nenhum lote importado neste chip — sem lote, vai para todos os contatos do chip.</span>}
                        {lotesDoChip.map(l => {
                            const on = form.lotes.includes(l.lote)
                            return (
                                <button key={l.lote} onClick={() => set('lotes', on ? form.lotes.filter(x => x !== l.lote) : [...form.lotes, l.lote])}
                                        style={{ ...botaoCls(C.amber, on), padding: '5px 10px', fontSize: 11 }}>
                                    {l.lote} · {l.total}
                                </button>
                            )
                        })}
                    </div>
                    <p className="text-[11px] mt-2" style={{ color: C.muted }}>
                        {publicoEstimado !== null ? `~${publicoEstimado} contatos (antes de excluir quem pediu para sair).` : 'Nenhum lote marcado = todos os contatos deste chip.'}
                    </p>
                    <div className="grid grid-cols-3 gap-3 mt-3">
                        <input className={inputCls} value={form.campo} onChange={e => set('campo', e.target.value)} placeholder="filtro opcional: dados.produto" />
                        <select className={inputCls} value={form.operador} onChange={e => set('operador', e.target.value)}>
                            <option value="igual">é igual a</option><option value="contem">contém</option>
                        </select>
                        <input className={inputCls} value={form.valor} onChange={e => set('valor', e.target.value)} placeholder="valor" />
                    </div>
                </div>

                <div className="space-y-3">
                    <label className={labelCls} style={{ color: C.muted }}>Cadência (templates aprovados pela Meta)</label>
                    {carregandoTpl && <p className="text-xs" style={{ color: C.muted }}><Loader2 className="inline h-3 w-3 animate-spin" /> carregando templates...</p>}
                    {erroTpl && <Aviso>{erroTpl}</Aviso>}
                    {!carregandoTpl && !erroTpl && templates.length === 0 && (
                        <Aviso tipo="info">Nenhum template aprovado nesta WABA. Crie e aprove um template de Marketing no WhatsApp Manager (com um botão "Parar") e volte aqui.</Aviso>
                    )}
                    {form.passos.map((p, i) => (
                        <div key={i} className="rounded-xl p-4" style={{ border: `1px solid ${C.border}`, background: 'rgba(0,0,0,0.25)' }}>
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-xs font-black text-white">Passo {i + 1}</span>
                                {i > 0 && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px]" style={{ color: C.muted }}>enviar</span>
                                        <input type="number" min={1} max={30} className={`${inputCls} w-16 py-1`} value={p.esperaDias} onChange={e => setPasso(i, { esperaDias: e.target.value })} />
                                        <span className="text-[11px]" style={{ color: C.muted }}>dias depois, se não responder</span>
                                        <button onClick={() => set('passos', form.passos.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" style={{ color: C.red }} /></button>
                                    </div>
                                )}
                            </div>
                            <select className={inputCls} value={p.nome} onChange={e => escolherTemplate(i, e.target.value)}>
                                <option value="">— escolha o template —</option>
                                {templates.map(t => <option key={`${t.nome}-${t.idioma}`} value={t.nome}>{t.nome} ({t.idioma} · {t.categoria})</option>)}
                            </select>
                            {p.texto && <p className="text-xs mt-3 whitespace-pre-wrap rounded-lg p-3" style={{ background: 'rgba(16,185,129,0.06)', color: '#d1fae5' }}>{p.texto}</p>}
                            {p.variaveis.map((v, k) => (
                                <div key={k} className="grid grid-cols-[60px_1fr_1fr] gap-2 mt-2 items-center">
                                    <span className="text-xs font-black" style={{ color: C.amber }}>{`{{${k + 1}}}`}</span>
                                    <input className={inputCls} list="campos-lead" value={v.campo} onChange={e => setVariavel(i, k, { campo: e.target.value })} placeholder="campo (ex.: primeiro_nome, dados.produto)" />
                                    <input className={inputCls} value={v.padrao} onChange={e => setVariavel(i, k, { padrao: e.target.value })} placeholder="se vazio, usar..." />
                                </div>
                            ))}
                        </div>
                    ))}
                    <datalist id="campos-lead">{CAMPOS_FIXOS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}</datalist>
                    {form.passos.length < 3 && (
                        <button style={botaoCls(C.amber, false)} onClick={() => set('passos', [...form.passos, passoVazio()])}><Plus className="h-3.5 w-3.5" />Adicionar passo de follow-up</button>
                    )}
                </div>

                <div>
                    <label className={labelCls} style={{ color: C.muted }}>Orientações para a IA nesta campanha</label>
                    <textarea className={`${inputCls} min-h-[110px]`} value={form.prompt_campanha} onChange={e => set('prompt_campanha', e.target.value)}
                              placeholder="Ex.: Estes clientes não compram há 90+ dias. Ofereça 10% de desconto no retorno, válido até sexta. Se perguntarem do produto antigo, confirme que ainda temos. Encaminhe para um humano se pedirem condição especial." />
                    <p className="text-[11px] mt-1" style={{ color: C.muted }}>Somado ao prompt principal da conta. Quando o cliente fechar, a IA marca a conversão sozinha.</p>
                </div>

                <div className="grid grid-cols-4 gap-3">
                    <div><label className={labelCls} style={{ color: C.muted }}>Das (h)</label><input type="number" className={inputCls} value={form.janela_inicio} onChange={e => set('janela_inicio', e.target.value)} /></div>
                    <div><label className={labelCls} style={{ color: C.muted }}>Até (h)</label><input type="number" className={inputCls} value={form.janela_fim} onChange={e => set('janela_fim', e.target.value)} /></div>
                    <div><label className={labelCls} style={{ color: C.muted }}>Envios/dia</label><input type="number" className={inputCls} value={form.limite_diario} onChange={e => set('limite_diario', e.target.value)} /></div>
                    <div><label className={labelCls} style={{ color: C.muted }}>Intervalo entre campanhas (dias)</label><input type="number" className={inputCls} value={form.frequencia_dias} onChange={e => set('frequencia_dias', e.target.value)} /></div>
                </div>

                {erro && <Aviso>{erro}</Aviso>}
                <button style={botaoCls()} onClick={salvar} disabled={salvando}>
                    {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Salvar como rascunho
                </button>
            </div>
        </Secao>
    )
}

// ── 3. Lista + funil ────────────────────────────────────────────────────────
function Funil({ campanha }) {
    const [f, setF] = useState(null)
    const [contatos, setContatos] = useState([])
    const [erro, setErro] = useState(null)

    const carregar = useCallback(async () => {
        try {
            const [m, c] = await Promise.all([
                api(`/api/campanhas/${campanha.id}/metricas`),
                api(`/api/campanhas/${campanha.id}/contatos`),
            ])
            setF(m.funil); setContatos(c.contatos || []); setErro(null)
        } catch (e) { setErro(e.message) }
    }, [campanha.id])

    useEffect(() => {
        const primeiro = setTimeout(carregar, 0)
        const t = setInterval(carregar, 30000)
        return () => { clearTimeout(primeiro); clearInterval(t) }
    }, [carregar])

    const converter = async (leadId) => {
        await api(`/api/campanhas/${campanha.id}/convertido`, { method: 'POST', body: JSON.stringify({ leadId }) }).catch(() => {})
        carregar()
    }

    if (erro) return <Aviso>{erro}</Aviso>
    if (!f) return <p className="text-xs mt-3" style={{ color: C.muted }}><Loader2 className="inline h-3 w-3 animate-spin" /> carregando funil...</p>

    const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—')
    const etapas = [
        { l: 'Na fila', v: f.pendentes, ic: Users, cor: C.muted },
        { l: 'Enviados', v: f.enviados, ic: Send, cor: C.cyan },
        { l: 'Entregues', v: f.entregues, ic: CheckCircle2, cor: C.cyan, sub: pct(f.entregues, f.enviados) },
        { l: 'Lidos', v: f.lidos, ic: Eye, cor: C.violet, sub: pct(f.lidos, f.entregues) },
        { l: 'Responderam', v: f.responderam, ic: MessageSquare, cor: C.amber, sub: pct(f.responderam, f.entregues) },
        { l: 'Convertidos', v: f.convertidos, ic: Trophy, cor: C.green, sub: pct(f.convertidos, f.responderam) },
    ]
    return (
        <div className="mt-4 space-y-4">
            <div className="grid grid-cols-6 gap-2">
                {etapas.map(e => (
                    <div key={e.l} className="rounded-xl p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${e.cor}30` }}>
                        <e.ic className="h-3.5 w-3.5 mb-1" style={{ color: e.cor }} />
                        <p className="text-lg font-black text-white leading-none">{e.v}</p>
                        <p className="text-[9px] font-bold uppercase tracking-wider mt-1" style={{ color: C.muted }}>{e.l}{e.sub ? ` · ${e.sub}` : ''}</p>
                    </div>
                ))}
            </div>
            <p className="text-[11px]" style={{ color: C.muted }}>
                <Ban className="inline h-3 w-3" /> {f.optout} pediram para sair · {f.falhas} falhas de entrega · {f.ignorados} ignorados (opt-out, frequência, número inválido)
                · custo estimado R$ {(f.custo_cents / 100).toFixed(2)}
            </p>
            {contatos.length > 0 && (
                <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
                    {contatos.slice(0, 50).map(c => (
                        <div key={c.id} className="flex items-center justify-between px-3 py-2 text-xs border-b border-white/5">
                            <span className="text-white">{c.leads?.dono || c.leads?.name || 'Cliente'} <span style={{ color: C.muted }}>{c.leads?.phone}</span></span>
                            <span className="flex items-center gap-2">
                                <span style={{ color: { respondeu: C.amber, convertido: C.green, optout: C.red, falhou: C.red }[c.status] }}>
                                    {{ respondeu: 'respondeu', convertido: 'convertido', optout: 'saiu', falhou: `falhou${c.erro ? `: ${c.erro.slice(0, 40)}` : ''}` }[c.status]}
                                </span>
                                {c.status === 'respondeu' && (
                                    <button style={{ ...botaoCls(C.green, false), padding: '3px 8px', fontSize: 10 }} onClick={() => converter(c.lead_id)}>
                                        <Trophy className="h-3 w-3" />Marcar convertido
                                    </button>
                                )}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function CartaoCampanha({ c, onMudou }) {
    const [aberto, setAberto] = useState(c.status !== 'rascunho')
    const [ocupado, setOcupado] = useState(false)
    const [erro, setErro] = useState(null)
    const acao = async (caminho, metodo = 'POST') => {
        setErro(null); setOcupado(true)
        try { await api(caminho, { method: metodo }); onMudou() } catch (e) { setErro(e.message) } finally { setOcupado(false) }
    }
    return (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 18 }}>
            <div className="flex items-center justify-between gap-3">
                <button className="text-left flex-1" onClick={() => setAberto(!aberto)}>
                    <p className="text-sm font-black text-white">{c.nome}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>
                        {c.templates?.length} passo(s) · {c.janela_inicio}h–{c.janela_fim}h · até {c.limite_diario}/dia
                        {c.motivo_pausa ? ` · ${c.motivo_pausa}` : ''}
                    </p>
                </button>
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md"
                      style={{ color: STATUS_COR[c.status], border: `1px solid ${STATUS_COR[c.status]}55` }}>{STATUS_ROTULO[c.status] || c.status}</span>
                {['rascunho', 'pausada'].includes(c.status) && (
                    <button style={botaoCls(C.green)} disabled={ocupado} onClick={() => acao(`/api/campanhas/${c.id}/iniciar`)}>
                        {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{c.status === 'rascunho' ? 'Iniciar' : 'Retomar'}
                    </button>
                )}
                {c.status === 'ativa' && (
                    <button style={botaoCls(C.amber, false)} disabled={ocupado} onClick={() => acao(`/api/campanhas/${c.id}/pausar`)}><Pause className="h-3.5 w-3.5" />Pausar</button>
                )}
                {c.status === 'rascunho' && (
                    <button style={botaoCls(C.red, false)} disabled={ocupado} onClick={() => confirm('Excluir este rascunho?') && acao(`/api/campanhas/${c.id}`, 'DELETE')}><Trash2 className="h-3.5 w-3.5" /></button>
                )}
            </div>
            {erro && <Aviso>{erro}</Aviso>}
            {aberto && c.status !== 'rascunho' && <Funil campanha={c} />}
        </div>
    )
}

// ── Configuração do WABA ID ─────────────────────────────────────────────────
function ConfigurarWaba({ chip, onSalvo }) {
    const [waba, setWaba] = useState('')
    const [erro, setErro] = useState(null)
    const salvar = async () => {
        setErro(null)
        try { await api(`/api/instance/${chip.id}/waba`, { method: 'POST', body: JSON.stringify({ wabaId: waba }) }); onSalvo() }
        catch (e) { setErro(e.message) }
    }
    return (
        <Aviso tipo="info">
            <p className="mb-2">Para listar os templates aprovados, informe o <b>WABA ID</b> (WhatsApp Business Account ID) deste chip.
                Ele fica no Meta Business Manager → WhatsApp Manager → Visão geral da conta.</p>
            <div className="flex gap-2">
                <input className={inputCls} value={waba} onChange={e => setWaba(e.target.value)} placeholder="ex.: 104857362918273" />
                <button style={botaoCls()} onClick={salvar}>Salvar</button>
            </div>
            {erro && <p className="mt-2">{erro}</p>}
        </Aviso>
    )
}

export default function Campanhas() {
    const [chips, setChips] = useState([])
    const [chipId, setChipId] = useState('')
    const [lotes, setLotes] = useState([])
    const [campanhas, setCampanhas] = useState([])
    const [criando, setCriando] = useState(false)
    const [carregando, setCarregando] = useState(true)
    const [erro, setErro] = useState(null)

    const carregar = useCallback(async () => {
        // allSettled: uma rota falhando (ex.: tabela de campanhas ainda não criada) não pode esconder
        // os chips. Antes tudo zerava e a tela dizia "conecte um número oficial" mesmo com um conectado.
        const [ch, lo, ca] = await Promise.allSettled([api('/api/campanhas/chips'), api('/api/bases/lotes'), api('/api/campanhas')])
        const ok = (r, campo) => (r.status === 'fulfilled' ? r.value[campo] || [] : [])
        setChips(ok(ch, 'chips')); setLotes(ok(lo, 'lotes')); setCampanhas(ok(ca, 'campanhas'))
        setChipId(id => id || ok(ch, 'chips').find(c => c.oficial)?.id || '')
        const falha = [ch, lo, ca].find(r => r.status === 'rejected')?.reason?.message || null
        setErro(falha && /schema cache|does not exist/i.test(falha)
            ? 'O banco ainda não tem as tabelas de campanhas. Rode o arquivo db/campanhas.sql no SQL Editor do Supabase (uma vez só) e clique em Atualizar.'
            : falha)
        setCarregando(false)
    }, [])
    useEffect(() => { carregar() }, [carregar])

    const oficiais = chips.filter(c => c.oficial)
    const chip = useMemo(() => oficiais.find(c => c.id === chipId), [oficiais, chipId])
    const doChip = campanhas.filter(c => c.instance_id === chipId)

    if (carregando) return <div className="p-10 text-center" style={{ color: C.muted }}><Loader2 className="inline h-5 w-5 animate-spin" /></div>

    return (
        <div className="h-full overflow-y-auto p-6">
            <div className="max-w-5xl mx-auto space-y-5">
                <div className="flex items-end justify-between">
                    <div>
                        <h2 className="text-lg font-black text-white">Campanhas de reaquecimento</h2>
                        <p className="text-xs mt-1" style={{ color: C.muted }}>A IA conversa com a base de clientes da empresa: reativa quem sumiu e vende mais para quem já compra.</p>
                    </div>
                    <button style={botaoCls(C.muted, false)} onClick={carregar}><RefreshCw className="h-3.5 w-3.5" />Atualizar</button>
                </div>
                {erro && <Aviso>{erro}</Aviso>}

                {oficiais.length === 0 ? (
                    <Aviso tipo="info">Campanhas para a base rodam só em chips da <b>API oficial da Meta</b> (disparo em massa pelo WhatsApp Web bane o número). Conecte um número oficial para começar.</Aviso>
                ) : (
                    <>
                        {oficiais.length > 1 && (
                            <select className={`${inputCls} max-w-xs`} value={chipId} onChange={e => { setChipId(e.target.value); setCriando(false) }}>
                                {oficiais.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                            </select>
                        )}
                        {chip && !chip.wabaConfigurada && <ConfigurarWaba chip={chip} onSalvo={carregar} />}
                        {chip && <ImportarBase chip={chip} onImportado={carregar} />}

                        {chip && (criando
                            ? <NovaCampanha chip={chip} lotes={lotes} onCancelar={() => setCriando(false)} onCriada={() => { setCriando(false); carregar() }} />
                            : <button style={botaoCls()} onClick={() => setCriando(true)} disabled={!chip.wabaConfigurada}><Plus className="h-4 w-4" />Nova campanha</button>
                        )}

                        <div className="space-y-3">
                            {doChip.length === 0 && <p className="text-xs" style={{ color: C.muted }}>Nenhuma campanha ainda.</p>}
                            {doChip.map(c => <CartaoCampanha key={c.id} c={c} onMudou={carregar} />)}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

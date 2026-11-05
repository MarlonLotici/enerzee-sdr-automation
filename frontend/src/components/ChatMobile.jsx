import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, EllipsisVertical, CheckCheck, SendHorizontal, CalendarClock, X, Copy, ExternalLink, UserRound, XCircle, CheckCircle2, Play } from 'lucide-react'
import AudioMensagem from './AudioMensagem'
import { agruparPorDia, autorDaMensagem, horaCurta, partirLinks, telefoneDoLead } from '@/lib/formatoChat'
import { minutosParaIAVoltar, rotuloPausa, textoDoBalao } from '@/lib/pausaHumana'
import { useAreaVisivel } from '@/lib/useMobile'

// ─────────────────────────────────────────────────────────────────────────────────────────────
// CONVERSA NO CELULAR — visual do WhatsApp (balões verde/cinza, separador de dia, ✓✓ azul, campo
// arredondado + botão verde). Tela cheia por cima do menu, como no app. Só é usada em tela < 768px.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const COR = {
    fundo: '#0b141a', barra: '#202c33', balaoLead: '#202c33', balaoNos: '#005c4b',
    texto: '#e9edef', suave: '#8696a0', verde: '#00a884', azulTique: '#53bdeb', folha: '#111b21',
}

function Texto({ valor }) {
    return partirLinks(valor).map((p, i) => p.tipo === 'link'
        ? <a key={i} href={p.valor} target="_blank" rel="noopener noreferrer" className="underline decoration-[#53bdeb]/60 break-all" style={{ color: COR.azulTique }}>{p.valor}</a>
        : <span key={i}>{p.valor}</span>)
}

function Folha({ aberta, aoFechar, titulo, children }) {
    if (!aberta) return null
    return (
        <div className="fixed inset-0 z-[80]" onClick={aoFechar}>
            <div className="absolute inset-0 bg-black/60" />
            <div className="absolute inset-x-0 bottom-0 rounded-t-2xl max-h-[85%] overflow-y-auto" style={{ background: COR.folha, paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
                <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/15" />
                {titulo && <p className="px-5 pt-3 pb-1 text-[13px] font-semibold uppercase tracking-wide" style={{ color: COR.suave }}>{titulo}</p>}
                {children}
            </div>
        </div>
    )
}

function ItemMenu({ icone: Icone, texto, aoClicar, perigo = false }) {
    return (
        <button onClick={aoClicar} className="w-full min-h-14 flex items-center gap-4 px-5 text-left active:bg-white/5" style={{ color: perigo ? '#f87171' : COR.texto }}>
            <Icone className="h-5 w-5 shrink-0" style={{ color: perigo ? '#f87171' : COR.suave }} />
            <span className="text-[16px]">{texto}</span>
        </button>
    )
}

export default function ChatMobile({
    lead, instances = [], mensagens = [], texto, setTexto, aoEnviar,
    aoAlternarIA, aoBaixa, aoFechar, aoVoltar, followUp,
}) {
    const area = useAreaVisivel()
    const fimRef = useRef(null)
    const campoRef = useRef(null)
    const [menu, setMenu] = useState(false)
    const [perfil, setPerfil] = useState(false)
    const [copiado, setCopiado] = useState(false)

    const pausada = !!(lead.is_paused || lead.manual_pause)
    const mVolta = minutosParaIAVoltar(lead)
    const chipNome = instances.find(i => i.id === lead.instance_id)?.name
    const tel = useMemo(() => telefoneDoLead(lead), [lead])
    const grupos = useMemo(() => agruparPorDia(mensagens), [mensagens])
    const inicial = (lead.name || '?')[0].toUpperCase()

    // sempre mostra a última mensagem (abrir conversa, chegar mensagem, teclado abrindo)
    useEffect(() => { fimRef.current?.scrollIntoView({ block: 'end' }) }, [mensagens.length, lead.id, area?.altura])

    // campo cresce até 5 linhas e volta ao tamanho de 1 linha depois de enviar
    useEffect(() => {
        const el = campoRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = Math.min(el.scrollHeight, 128) + 'px'
    }, [texto])

    const subtitulo = pausada
        ? (mVolta === null ? 'IA pausada' : mVolta > 0 ? `IA volta em ${mVolta} min` : 'IA volta na próxima mensagem')
        : `IA ativa${chipNome ? ` · via ${chipNome}` : ''}`

    const estiloContainer = area
        ? { top: area.topo, height: area.altura }
        : { top: 0, height: '100dvh' }

    const copiar = async () => {
        if (!tel) return
        try { await navigator.clipboard.writeText(tel.exibicao); setCopiado(true); setTimeout(() => setCopiado(false), 1800) } catch { /* sem permissão: ignora */ }
    }

    return (
        <div className="fixed inset-x-0 z-[60] flex flex-col" style={{ ...estiloContainer, background: COR.fundo }}>
            {/* ── Cabeçalho ── */}
            <header className="shrink-0 flex items-center gap-1 pr-1" style={{ background: COR.barra, paddingTop: 'env(safe-area-inset-top)' }}>
                <button onClick={aoVoltar} aria-label="Voltar às conversas" className="h-12 w-12 shrink-0 flex items-center justify-center active:bg-white/10 rounded-full" style={{ color: COR.texto }}>
                    <ArrowLeft className="h-6 w-6" />
                </button>
                <button onClick={() => setPerfil(true)} className="flex-1 min-w-0 h-14 flex items-center gap-3 text-left">
                    <div className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-[17px] font-semibold" style={{ background: '#6a7175', color: '#fff' }}>{inicial}</div>
                    <div className="min-w-0">
                        <p className="text-[17px] font-medium leading-tight truncate" style={{ color: COR.texto }}>{lead.name || 'Sem nome'}</p>
                        <p className="text-[12.5px] leading-tight truncate" style={{ color: pausada ? '#fbbf24' : COR.suave }}>{subtitulo}</p>
                    </div>
                </button>
                <button onClick={aoAlternarIA} className="h-9 shrink-0 px-3 rounded-full text-[12px] font-semibold active:opacity-70"
                    style={pausada ? { background: 'rgba(251,191,36,.15)', color: '#fbbf24' } : { background: 'rgba(0,168,132,.18)', color: '#25d3a5' }}>
                    {pausada ? 'Reativar IA' : 'IA ativa'}
                </button>
                <button onClick={() => setMenu(true)} aria-label="Mais opções" className="h-12 w-10 shrink-0 flex items-center justify-center active:bg-white/10 rounded-full" style={{ color: COR.texto }}>
                    <EllipsisVertical className="h-5 w-5" />
                </button>
            </header>

            {/* ── Aviso de pausa ── */}
            {pausada && (
                <div className="shrink-0 px-4 py-2 text-[12.5px] leading-snug" style={{ background: 'rgba(251,191,36,.12)', color: '#fcd34d' }}>
                    ⏸️ A IA está calada. {mVolta !== null
                        ? (mVolta > 0 ? `Ela volta sozinha em ${mVolta} min, lendo a conversa toda.` : 'Ela volta sozinha quando o contato escrever, lendo a conversa toda.')
                        : 'Toque em "Reativar IA" para ela voltar.'}
                </div>
            )}

            {/* ── Mensagens ── */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2.5 py-2"
                 style={{ background: COR.fundo, backgroundImage: 'radial-gradient(rgba(255,255,255,.045) 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
                {mensagens.length === 0 ? (
                    <p className="text-center text-[13px] mt-10" style={{ color: COR.suave }}>Nenhuma mensagem registrada.</p>
                ) : grupos.map(g => (
                    <div key={g.chave}>
                        <div className="flex justify-center my-3">
                            <span className="px-3 py-1 rounded-lg text-[12px] uppercase" style={{ background: '#182229', color: COR.suave }}>{g.rotulo}</span>
                        </div>
                        {g.itens.map((m, i) => {
                            const autor = autorDaMensagem(m)
                            const nos = autor !== 'lead'
                            const anterior = g.itens[i - 1]
                            const primeiroDoBloco = !anterior || autorDaMensagem(anterior) !== autor
                            return (
                                <div key={m.id ?? `${g.chave}-${i}`} className={`flex ${nos ? 'justify-end' : 'justify-start'} ${primeiroDoBloco ? 'mt-2' : 'mt-0.5'}`}>
                                    <div className="max-w-[86%] px-2.5 pt-1.5 pb-1 shadow-sm"
                                         style={{
                                             background: nos ? COR.balaoNos : COR.balaoLead, color: COR.texto, borderRadius: 8,
                                             ...(primeiroDoBloco ? (nos ? { borderTopRightRadius: 0 } : { borderTopLeftRadius: 0 }) : {}),
                                         }}>
                                        {nos && primeiroDoBloco && (
                                            <p className="text-[12px] font-semibold mb-0.5" style={{ color: autor === 'humano' ? '#ffd479' : '#7ee0c3' }}>
                                                {autor === 'humano' ? 'Você' : '🤖 IA'}
                                            </p>
                                        )}
                                        {m.media_path && <AudioMensagem path={m.media_path} />}
                                        <p className="text-[15px] leading-[1.35] whitespace-pre-wrap break-words">
                                            <Texto valor={textoDoBalao(m.content)} />
                                            <span className="inline-block w-[4.2rem]" />
                                        </p>
                                        <div className="flex items-center justify-end gap-1 -mt-[15px] float-right relative top-[1px]" style={{ color: COR.suave }}>
                                            <span className="text-[11px]">{horaCurta(m.created_at)}</span>
                                            {nos && <CheckCheck className="h-[15px] w-[15px]" style={{ color: COR.azulTique }} />}
                                        </div>
                                        <div className="clear-both" />
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                ))}
                <div ref={fimRef} />
            </div>

            {/* ── Campo de mensagem ── */}
            <div className="shrink-0 flex items-end gap-2 px-2 pt-2" style={{ background: COR.fundo, paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
                <div className="flex-1 min-w-0 flex items-end rounded-3xl pl-1 pr-4" style={{ background: COR.barra }}>
                    <button onClick={() => followUp?.setAberto(true)} aria-label="Agendar follow-up" className="h-11 w-11 shrink-0 flex items-center justify-center active:opacity-60" style={{ color: COR.suave }}>
                        <CalendarClock className="h-6 w-6" />
                    </button>
                    <textarea
                        ref={campoRef} rows={1} value={texto} onChange={(e) => setTexto(e.target.value)}
                        placeholder="Mensagem"
                        enterKeyHint="enter"
                        className="flex-1 min-w-0 bg-transparent outline-none resize-none py-[11px] text-[16px] leading-[22px] placeholder:text-[#8696a0]"
                        style={{ color: COR.texto, maxHeight: 128 }}
                    />
                </div>
                <button onClick={aoEnviar} disabled={!texto.trim()} aria-label="Enviar"
                        className="h-12 w-12 shrink-0 rounded-full flex items-center justify-center active:scale-95 disabled:opacity-50 transition"
                        style={{ background: COR.verde, color: '#0b141a' }}>
                    <SendHorizontal className="h-6 w-6" />
                </button>
            </div>

            {/* ── Menu ⋮ ── */}
            <Folha aberta={menu} aoFechar={() => setMenu(false)}>
                <div className="py-1">
                    <ItemMenu icone={UserRound} texto="Dados do contato" aoClicar={() => { setMenu(false); setPerfil(true) }} />
                    <ItemMenu icone={CalendarClock} texto="Agendar follow-up" aoClicar={() => { setMenu(false); followUp?.setAberto(true) }} />
                    {pausada && <ItemMenu icone={Play} texto="Reativar a IA" aoClicar={() => { setMenu(false); aoAlternarIA() }} />}
                    <ItemMenu icone={CheckCircle2} texto="Fechar negócio" aoClicar={() => { setMenu(false); aoFechar() }} />
                    <ItemMenu icone={XCircle} texto="Dar baixa (descartar)" perigo aoClicar={() => { setMenu(false); aoBaixa() }} />
                </div>
            </Folha>

            {/* ── Follow-up ── */}
            <Folha aberta={!!followUp?.aberto} aoFechar={() => followUp?.setAberto(false)} titulo="Agendar follow-up">
                <div className="px-5 pb-3 pt-2 space-y-3">
                    <p className="text-[13px]" style={{ color: COR.suave }}>A IA volta a falar com este contato na data escolhida.</p>
                    <input type="datetime-local" value={followUp?.valor || ''} onChange={(e) => followUp?.setValor(e.target.value)}
                           min={new Date().toISOString().slice(0, 16)}
                           className="w-full h-12 rounded-xl px-3 text-[16px] outline-none" style={{ background: COR.barra, color: COR.texto, colorScheme: 'dark' }} />
                    <div className="flex gap-3">
                        <button onClick={() => followUp?.setAberto(false)} className="flex-1 h-12 rounded-xl text-[15px] font-medium active:opacity-70" style={{ background: COR.barra, color: COR.texto }}>Cancelar</button>
                        <button onClick={followUp?.confirmar} disabled={!followUp?.valor} className="flex-1 h-12 rounded-xl text-[15px] font-semibold disabled:opacity-40 active:opacity-80" style={{ background: COR.verde, color: '#0b141a' }}>Confirmar</button>
                    </div>
                </div>
            </Folha>

            {/* ── Dados do contato ── */}
            <Folha aberta={perfil} aoFechar={() => setPerfil(false)}>
                <div className="px-5 pt-3 pb-4">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="h-16 w-16 rounded-full flex items-center justify-center text-[26px] font-semibold" style={{ background: '#6a7175', color: '#fff' }}>{inicial}</div>
                        <div className="min-w-0">
                            <p className="text-[19px] font-medium truncate" style={{ color: COR.texto }}>{lead.name || 'Sem nome'}</p>
                            {lead.dono && <p className="text-[13px] truncate" style={{ color: COR.suave }}>Responsável: {lead.dono}</p>}
                        </div>
                        <button onClick={() => setPerfil(false)} aria-label="Fechar" className="ml-auto h-10 w-10 flex items-center justify-center rounded-full active:bg-white/10" style={{ color: COR.suave }}><X className="h-5 w-5" /></button>
                    </div>

                    {tel && (
                        <div className="rounded-xl p-3 mb-3" style={{ background: COR.barra }}>
                            <p className="text-[12px] uppercase tracking-wide mb-1" style={{ color: COR.suave }}>Telefone</p>
                            <p className="text-[18px] font-medium tabular-nums" style={{ color: COR.texto }}>{tel.exibicao}</p>
                            <div className="flex gap-2 mt-3">
                                <button onClick={copiar} className="flex-1 h-11 rounded-lg flex items-center justify-center gap-2 text-[14px] font-medium active:opacity-70" style={{ background: 'rgba(255,255,255,.07)', color: COR.texto }}>
                                    <Copy className="h-4 w-4" /> {copiado ? 'Copiado!' : 'Copiar'}
                                </button>
                                <a href={tel.wa} target="_blank" rel="noopener noreferrer" className="flex-1 h-11 rounded-lg flex items-center justify-center gap-2 text-[14px] font-semibold active:opacity-80" style={{ background: COR.verde, color: '#0b141a' }}>
                                    <ExternalLink className="h-4 w-4" /> Abrir no WhatsApp
                                </a>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="rounded-xl p-3" style={{ background: COR.barra }}>
                            <p className="text-[12px] uppercase tracking-wide mb-1" style={{ color: COR.suave }}>Nicho</p>
                            <p className="text-[15px] truncate" style={{ color: COR.texto }}>{lead.niche || '—'}</p>
                        </div>
                        <div className="rounded-xl p-3" style={{ background: COR.barra }}>
                            <p className="text-[12px] uppercase tracking-wide mb-1" style={{ color: COR.suave }}>IA</p>
                            <p className="text-[15px] truncate" style={{ color: pausada ? '#fbbf24' : '#25d3a5' }}>{pausada ? subtitulo : 'Ativa'}</p>
                        </div>
                    </div>

                    {lead.current_stage > 0 && (
                        <div className="rounded-xl p-3" style={{ background: COR.barra }}>
                            <p className="text-[12px] uppercase tracking-wide mb-2" style={{ color: COR.suave }}>Etapa da conversa</p>
                            <div className="flex gap-1.5 mb-1.5">
                                {[1, 2, 3, 4, 5].map(s => (
                                    <div key={s} className="h-2 flex-1 rounded-full" style={{ background: s <= lead.current_stage ? (s <= 2 ? '#f59e0b' : s <= 4 ? '#f97316' : '#10b981') : '#2a3942' }} />
                                ))}
                            </div>
                            <p className="text-[14px]" style={{ color: COR.texto }}>{['', 'Situação', 'Dor', 'Solução', 'Agendamento', 'Fechamento'][lead.current_stage]}</p>
                        </div>
                    )}
                </div>
            </Folha>
        </div>
    )
}

import React, { useState, useEffect, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Search, BrainCircuit, Clock, RefreshCw } from 'lucide-react'

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
const supabase = createClient(
    'https://vptfedhzynyhvhrlcfqd.supabase.co',
    'sb_publishable_T0-4c2bm3I5lNTw7tUGmcg_xVInIQKR'
)

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function timeAgo(isoStr) {
    if (!isoStr) return '—'
    const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
    if (diff < 60)    return 'agora'
    if (diff < 3600)  return `${Math.floor(diff / 60)}min`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`
    return `${Math.floor(diff / 86400)}d`
}

// Limpa tags internas antes de exibir na preview
function limparPreview(content) {
    if (!content) return '...'
    if (content.startsWith('[AUTORESPOSTA]')) return '🤖 Autoresposta detectada'
    if (content.startsWith('<<Áudio'))        return '🎤 Áudio enviado'
    if (content.startsWith('(Áudio)'))        return '🎤 ' + content.replace('(Áudio)', '').trim()
    return content.replace(/\[QUEBRA\]/g, ' ').slice(0, 60) + (content.length > 60 ? '…' : '')
}

// Resolve o estado operacional de cada conversa
// Retorna: { label, color, dot }
function resolveEstado(lead, ultimaMsg) {
    if (lead.manual_pause) {
        return { label: 'Pausado',         color: '#F43F5E', dot: '#F43F5E' }
    }
    if (lead.is_paused) {
        return { label: 'Intervenção',     color: '#F59E0B', dot: '#F59E0B' }
    }
    if (!ultimaMsg) {
        return { label: 'Sem mensagens',   color: 'rgba(255,255,255,0.2)', dot: 'rgba(255,255,255,0.2)' }
    }
    if (ultimaMsg.role === 'user') {
        return { label: 'Aguardando IA',   color: '#F59E0B', dot: '#F59E0B' }
    }
    // Última mensagem é do assistant → IA respondeu, aguardando lead
    return     { label: 'IA Ativa',        color: '#10B981', dot: '#10B981' }
}

// ─── CARD DE CONVERSA ─────────────────────────────────────────────────────────
function ConversaCard({ lead, ultimaMsg, isActive, onClick }) {
    const estado   = resolveEstado(lead, ultimaMsg)
    const isUser   = ultimaMsg?.role === 'user'
    const preview  = limparPreview(ultimaMsg?.content)
    const tempo    = timeAgo(ultimaMsg?.created_at || lead.last_contact_at)
    const inicial  = (lead.name || '?')[0].toUpperCase()

    return (
        <div
            onClick={onClick}
            style={{
                display:       'flex',
                alignItems:    'flex-start',
                gap:           10,
                padding:       '10px 12px',
                borderRadius:  '0.75rem',
                cursor:        'pointer',
                background:    isActive ? 'rgba(59,130,246,0.12)' : 'transparent',
                border:        `1px solid ${isActive ? 'rgba(59,130,246,0.3)' : 'transparent'}`,
                transition:    'all .15s',
                position:      'relative',
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
        >
            {/* Avatar + dot de status */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: isActive ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${isActive ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.1)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 900, color: isActive ? '#93C5FD' : 'rgba(255,255,255,0.6)',
                }}>
                    {inicial}
                </div>
                {/* Dot de estado */}
                <div style={{
                    position: 'absolute', bottom: 0, right: 0,
                    width: 9, height: 9, borderRadius: '50%',
                    background: estado.dot,
                    border: '2px solid #020617',
                    boxShadow: `0 0 6px ${estado.dot}`,
                    animation: estado.color === '#10B981' ? 'pulse 2s infinite' : 'none',
                }} />
            </div>

            {/* Conteúdo */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 }}>
                    <p style={{
                        fontSize: 12, fontWeight: 900, color: '#fff',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        maxWidth: 140, textTransform: 'uppercase', letterSpacing: '-0.01em',
                    }}>
                        {lead.name || 'Sem nome'}
                    </p>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontWeight: 700, flexShrink: 0, marginLeft: 6 }}>
                        {tempo}
                    </span>
                </div>

                <p style={{
                    fontSize: 10, color: isUser ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.3)',
                    fontWeight: isUser ? 700 : 400,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    marginBottom: 5,
                }}>
                    {!ultimaMsg
                        ? '...'
                        : ultimaMsg.role === 'assistant'
                        ? `🤖 ${preview}`
                        : preview
                    }
                </p>

                {/* Badge de estado */}
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: estado.color + '15',
                    border: `1px solid ${estado.color}30`,
                    borderRadius: '999px', padding: '2px 6px',
                }}>
                    <span style={{ fontSize: 8, fontWeight: 900, color: estado.color, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                        {estado.label}
                    </span>
                </div>
            </div>

            {/* Indicador de não-lida: última msg é do lead e IA ainda não respondeu */}
            {isUser && !lead.is_paused && !lead.manual_pause && (
                <div style={{
                    position: 'absolute', top: 10, right: 10,
                    width: 7, height: 7, borderRadius: '50%',
                    background: '#F59E0B',
                    boxShadow: '0 0 6px #F59E0B',
                    animation: 'pulse 1.5s infinite',
                }} />
            )}
        </div>
    )
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
/**
 * Props:
 *   onSelect  (lead) => void  — chamado ao clicar numa conversa
 *   activeId  string          — id do lead ativo para highlight
 *   socket    — instância socket.io para ouvir new_lead e atualizações em tempo real
 */
export default function ConversaList({ onSelect, activeId, socket }) {
    const [conversas, setConversas] = useState([])   // [{ lead, ultimaMsg }]
    const [busca,     setBusca]     = useState('')
    const [loading,   setLoading]   = useState(true)

    const fetchConversas = useCallback(async () => {
        setLoading(true)
        try {
            // 1. Busca leads em atendimento ativo
            const { data: leads, error } = await supabase
                .from('leads')
                .select('id, name, whatsapp_id, status, is_paused, manual_pause, last_contact_at, instance_id, dono, niche, bairro, phone, cnpj, capital_social_numeric, porte')
                .in('status', ['contact', 'waiting_analysis'])
                .order('last_contact_at', { ascending: false })

            if (error || !leads?.length) {
                setConversas([])
                return
            }

            // 2. Para cada lead, busca a última mensagem
            const comUltimaMsg = await Promise.all(
                leads.map(async lead => {
                    const { data: msgs } = await supabase
                        .from('messages')
                        .select('role, content, created_at')
                        .eq('whatsapp_id', lead.whatsapp_id)
                        .order('created_at', { ascending: false })
                        .limit(1)

                    return {
                        lead,
                        ultimaMsg: msgs?.[0] ?? null,
                    }
                })
            )

            setConversas(comUltimaMsg)
        } finally {
            setLoading(false)
        }
    }, [])

    // Fetch inicial + polling a cada 20s
    useEffect(() => {
        fetchConversas()
        const id = setInterval(fetchConversas, 20_000)
        return () => clearInterval(id)
    }, [fetchConversas])

    // Quando IA responder para um lead, atualiza a lista em tempo real
    useEffect(() => {
        if (!socket) return
        // Novo lead capturado → pode ter entrado em contact
        socket.on('new_lead', fetchConversas)
        // Qualquer mudança de status via socket
        socket.on('whatsapp_status', fetchConversas)
        return () => {
            socket.off('new_lead', fetchConversas)
            socket.off('whatsapp_status', fetchConversas)
        }
    }, [socket, fetchConversas])

    // Filtra pelo campo de busca
    const conversasFiltradas = conversas.filter(({ lead }) => {
        if (!busca) return true
        const q = busca.toLowerCase()
        return (
            lead.name?.toLowerCase().includes(q) ||
            lead.dono?.toLowerCase().includes(q)  ||
            lead.phone?.includes(q)
        )
    })

    // Agrupa por estado para exibir seções
    const aguardando = conversasFiltradas.filter(({ lead, ultimaMsg }) =>
        !lead.is_paused && !lead.manual_pause && ultimaMsg?.role === 'user'
    )
    const iaAtiva = conversasFiltradas.filter(({ lead, ultimaMsg }) =>
        !lead.is_paused && !lead.manual_pause && ultimaMsg?.role === 'assistant'
    )
    const pausadas = conversasFiltradas.filter(({ lead }) =>
        lead.is_paused || lead.manual_pause
    )

    return (
        <div style={{
            display: 'flex', flexDirection: 'column',
            height: '100%', fontFamily: "'DM Sans', system-ui, sans-serif",
        }}>

            {/* ── Header ── */}
            <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <BrainCircuit size={14} color='#3B82F6' />
                        <span style={{ fontSize: 11, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                            War Room
                        </span>
                        {conversas.length > 0 && (
                            <div style={{
                                background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)',
                                borderRadius: '999px', padding: '1px 7px',
                                fontSize: 9, fontWeight: 900, color: '#93C5FD',
                            }}>
                                {conversas.length}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={fetchConversas}
                        disabled={loading}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'rgba(255,255,255,0.3)', padding: 4,
                        }}
                        title="Atualizar"
                    >
                        <RefreshCw size={11} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                    </button>
                </div>

                {/* Campo de busca */}
                <div style={{ position: 'relative' }}>
                    <Search size={11} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.25)' }} />
                    <input
                        value={busca}
                        onChange={e => setBusca(e.target.value)}
                        placeholder="Buscar conversa..."
                        style={{
                            width: '100%', boxSizing: 'border-box',
                            height: 32, paddingLeft: 26, paddingRight: 10,
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '0.5rem',
                            color: '#fff', fontSize: 11, fontWeight: 600,
                            outline: 'none', fontFamily: 'inherit',
                        }}
                    />
                </div>
            </div>

            {/* ── Lista ── */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>

                {loading && conversas.length === 0 ? (
                    <div style={{ padding: '30px 0', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                        Carregando…
                    </div>
                ) : conversasFiltradas.length === 0 ? (
                    <div style={{ padding: '40px 0', textAlign: 'center' }}>
                        <BrainCircuit size={24} color='rgba(255,255,255,0.1)' style={{ margin: '0 auto 10px' }} />
                        <p style={{ color: 'rgba(255,255,255,0.15)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                            {busca ? 'Sem resultados' : 'Nenhuma conversa ativa'}
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Seção: Aguardando IA */}
                        {aguardando.length > 0 && (
                            <Section label="Aguardando IA" color="#F59E0B" count={aguardando.length}>
                                {aguardando.map(({ lead, ultimaMsg }) => (
                                    <ConversaCard
                                        key={lead.id}
                                        lead={lead}
                                        ultimaMsg={ultimaMsg}
                                        isActive={lead.id === activeId}
                                        onClick={() => onSelect?.(lead)}
                                    />
                                ))}
                            </Section>
                        )}

                        {/* Seção: IA Ativa */}
                        {iaAtiva.length > 0 && (
                            <Section label="IA Ativa" color="#10B981" count={iaAtiva.length}>
                                {iaAtiva.map(({ lead, ultimaMsg }) => (
                                    <ConversaCard
                                        key={lead.id}
                                        lead={lead}
                                        ultimaMsg={ultimaMsg}
                                        isActive={lead.id === activeId}
                                        onClick={() => onSelect?.(lead)}
                                    />
                                ))}
                            </Section>
                        )}

                        {/* Seção: Pausadas */}
                        {pausadas.length > 0 && (
                            <Section label="Pausadas" color="#F43F5E" count={pausadas.length}>
                                {pausadas.map(({ lead, ultimaMsg }) => (
                                    <ConversaCard
                                        key={lead.id}
                                        lead={lead}
                                        ultimaMsg={ultimaMsg}
                                        isActive={lead.id === activeId}
                                        onClick={() => onSelect?.(lead)}
                                    />
                                ))}
                            </Section>
                        )}
                    </>
                )}
            </div>

            <style>{`
                @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
                @keyframes spin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
                ::-webkit-scrollbar { width: 4px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
            `}</style>
        </div>
    )
}

// ─── SECTION HEADER ───────────────────────────────────────────────────────────
function Section({ label, color, count, children }) {
    return (
        <div style={{ marginBottom: 6 }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 8px',
            }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: color, boxShadow: `0 0 5px ${color}` }} />
                <span style={{ fontSize: 8, fontWeight: 900, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
                    {label}
                </span>
                <span style={{ fontSize: 8, fontWeight: 900, color: color, marginLeft: 2 }}>
                    {count}
                </span>
            </div>
            {children}
        </div>
    )
}
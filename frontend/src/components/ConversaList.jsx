import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Search, BrainCircuit, Clock, RefreshCw, Cpu } from 'lucide-react'

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
function ConversaCard({ lead, ultimaMsg, isActive, onClick, onUpdate }) {
    const estado   = resolveEstado(lead, ultimaMsg)
    const isUser   = ultimaMsg?.role === 'user'
    const preview  = limparPreview(ultimaMsg?.content)
    const tempo    = timeAgo(ultimaMsg?.created_at || lead.last_contact_at)
    const inicial  = (lead.name || '?')[0].toUpperCase()

    // 🔥 Marca como Hot manualmente
    const marcarComoHot = async (e) => {
        e.stopPropagation()
        if (lead.lead_temperature === 'hot') {
            // Toggle: se já é hot, volta pra warm
            const { error } = await supabase.from('leads').update({ lead_temperature: 'warm' }).eq('id', lead.id)
            if (!error && onUpdate) onUpdate()
        } else {
            const { error } = await supabase.from('leads').update({ lead_temperature: 'hot' }).eq('id', lead.id)
            if (!error && onUpdate) onUpdate()
        }
    }

    // 💀 Marca como Dead (descarta o lead)
    const marcarComoDead = async (e) => {
        e.stopPropagation()
        if (!confirm(`Descartar "${lead.name}" como lead morto? Ele sairá do War Room e não receberá mais follow-ups.`)) return
        
        const { error } = await supabase.from('leads').update({ 
            status: 'dead', 
            lead_temperature: 'dead',
            is_paused: true,
            internal_notes: `Marcado como morto manualmente via War Room em ${new Date().toLocaleString('pt-BR')}`
        }).eq('id', lead.id)
        
        if (!error && onUpdate) onUpdate()
    }
    return (
        <div
            onClick={onClick}
            data-conversa-card
            style={{
                display:       'flex',
                alignItems:    'center',
                gap:           8,
                padding:       '6px 10px',
                borderRadius:  '0.5rem',
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
                    width: 28, height: 28, borderRadius: '50%',
                   background: isActive ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.06)',
                   border: `1px solid ${isActive ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.1)'}`,                    
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 900, color: isActive ? '#FBBF24' : 'rgba(255,255,255,0.6)',
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
                {/* Badge de temperatura */}
                {lead.lead_temperature && lead.lead_temperature !== 'cold' && (
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        background: lead.lead_temperature === 'hot' ? '#ef444418' : lead.lead_temperature === 'warm' ? '#f59e0b18' : '#64748b18',
                        border: `1px solid ${lead.lead_temperature === 'hot' ? '#ef444430' : lead.lead_temperature === 'warm' ? '#f59e0b30' : '#64748b30'}`,
                        borderRadius: '999px', padding: '2px 6px',
                        marginLeft: 4,
                    }}>
                        <span style={{ fontSize: 8, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em',
                            color: lead.lead_temperature === 'hot' ? '#ef4444' : lead.lead_temperature === 'warm' ? '#f59e0b' : '#64748b',
                        }}>
                            {lead.lead_temperature === 'hot' ? '🔥' : lead.lead_temperature === 'warm' ? '🟡' : '💀'} {lead.lead_temperature}
                        </span>
                    </div>
                )}

                {/* 🎯 Badge de estágio SPIN — só aparece se passou da qualificação */}
{lead.current_stage > 0 && (
    <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        background: lead.current_stage >= 4 ? '#10b98118' :
                   lead.current_stage === 3 ? '#8b5cf618' :
                   lead.current_stage === 2 ? '#06b6d418' :
                   '#3b82f618',
        border: `1px solid ${
            lead.current_stage >= 4 ? '#10b98130' :
            lead.current_stage === 3 ? '#8b5cf630' :
            lead.current_stage === 2 ? '#06b6d430' :
            '#3b82f630'
        }`,
        borderRadius: '999px', padding: '2px 6px',
        marginLeft: 4,
    }}>
        <span style={{
            fontSize: 8, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em',
            color: lead.current_stage >= 4 ? '#10b981' :
                   lead.current_stage === 3 ? '#8b5cf6' :
                   lead.current_stage === 2 ? '#06b6d4' :
                   '#3b82f6'
        }}>
            {lead.current_stage === 1 ? '💬 Situação' :
             lead.current_stage === 2 ? '⚡ Dor' :
             lead.current_stage === 3 ? '💡 Solução' :
             lead.current_stage === 4 ? '📅 Agenda' :
             lead.current_stage === 5 ? '✅ Fechado' : ''}
        </span>
    </div>
)}
            </div>

            {/* Timeline de follow-up + indicadores de progresso */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                {/* D0 → D1 → D3 */}
                {[
                    { label: 'D0', done: true },
                    { label: 'D1', done: (lead.followup_count || 0) >= 1 },
                    { label: 'D3', done: (lead.followup_count || 0) >= 2 },
                ].map((step, i) => (
                    <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        {i > 0 && <div style={{ width: 10, height: 1, background: 'rgba(255,255,255,0.1)' }} />}
                        <span style={{
                            fontSize: 7, fontWeight: 900,
                            padding: '1px 5px', borderRadius: 4,
                            background: step.done ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
                            color: step.done ? '#10b981' : 'rgba(255,255,255,0.2)',
                            border: `1px solid ${step.done ? '#10b98130' : 'rgba(255,255,255,0.07)'}`,
                        }}>
                            {step.label}
                        </span>
                    </div>
                ))}
                {/* Calendly enviado */}
                {lead.link_sent_at && !lead.calendly_booked && (
                    <span style={{ fontSize: 7, fontWeight: 900, padding: '1px 5px', borderRadius: 4, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid #f59e0b25' }}>
                        🔗 Link enviado
                    </span>
                )}
                {lead.calendly_booked && (
                    <span style={{ fontSize: 7, fontWeight: 900, padding: '1px 5px', borderRadius: 4, background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid #10b98130' }}>
                        ✅ Agendado
                    </span>
                )}
                {/* Dias em conversa */}
                {lead.created_at && (() => {
                    const dias = Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000)
                    return dias > 0 ? (
                        <span style={{ fontSize: 7, fontWeight: 700, color: dias > 7 ? '#ef4444' : 'rgba(255,255,255,0.2)', marginLeft: 2 }}>
                            {dias}d
                        </span>
                    ) : null
                })()}
            </div>

            {/* Indicador de não-lida: última msg é do lead e IA ainda não respondeu */}
{isUser && !lead.is_paused && !lead.manual_pause && (
    <div style={{
        position: 'absolute', top: 10, right: 10,
        width: 7, height: 7, borderRadius: '50%',
        background: '#F59E0B',
        boxShadow: '0 0 6px #F59E0B',
        animation: 'pulse 1.5s infinite',
    }} className="quick-action-indicator" />
)}

{/* 🎯 Quick Actions — aparecem no hover */}
<div 
    className="quick-actions"
    style={{
        position: 'absolute',
        bottom: 6, right: 6,
        display: 'flex',
        gap: 4,
        opacity: 0,
        transition: 'opacity 0.15s',
        pointerEvents: 'none',
    }}
>
    <button
        onClick={marcarComoHot}
        title={lead.lead_temperature === 'hot' ? 'Remover Hot' : 'Marcar como Hot 🔥'}
        style={{
            width: 22, height: 22,
            borderRadius: 6,
            background: lead.lead_temperature === 'hot' ? '#ef444425' : 'rgba(0,0,0,0.6)',
            border: `1px solid ${lead.lead_temperature === 'hot' ? '#ef444460' : 'rgba(255,255,255,0.1)'}`,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11,
            backdropFilter: 'blur(8px)',
            transition: 'all .15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#ef444440'}
        onMouseLeave={e => e.currentTarget.style.background = lead.lead_temperature === 'hot' ? '#ef444425' : 'rgba(0,0,0,0.6)'}
    >
        🔥
    </button>
    <button
        onClick={marcarComoDead}
        title="Marcar como Dead 💀"
        style={{
            width: 22, height: 22,
            borderRadius: 6,
            background: 'rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.1)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11,
            backdropFilter: 'blur(8px)',
            transition: 'all .15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#64748b40'}
        onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0.6)'}
    >
        💀
    </button>
</div>
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
export default function ConversaList({ onSelect, activeId, socket, instances = [], selectedInstanceId = null }) {
    const [conversas, setConversas] = useState([])
    const [busca,     setBusca]     = useState('')
    const [loading,   setLoading]   = useState(true)
    const [filtro,    setFiltro]    = useState('todos')
    const [chipFiltro, setChipFiltro] = useState('todos')

    // 🔗 Sincroniza com o chip selecionado no App principal
    useEffect(() => {
        if (selectedInstanceId) {
            setChipFiltro(selectedInstanceId)
        } else {
            setChipFiltro('todos')
        }
    }, [selectedInstanceId])

    const fetchConversas = useCallback(async () => {
        setLoading(true)
        try {
           const instanceIds = instances.map(i => i.id).filter(Boolean)
           if (!instanceIds.length) { setConversas([]); return }

           const { data: leads, error } = await supabase
    .from('leads')
    .select('id, name, whatsapp_id, status, is_paused, manual_pause, last_contact_at, created_at, instance_id, dono, niche, bairro, phone, cnpj, capital_social_numeric, porte, current_stage, lead_temperature, internal_notes, followup_count, link_sent_at, calendly_booked')
    .in('status', ['contact', 'waiting_analysis'])
    .in('instance_id', instanceIds)
    .order('last_contact_at', { ascending: false })
    .limit(300)

            if (error || !leads?.length) {
                setConversas([])
                return
            }

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

    useEffect(() => {
        fetchConversas()
        const id = setInterval(fetchConversas, 20_000)
        return () => clearInterval(id)
    }, [fetchConversas])

    useEffect(() => {
        if (!socket) return
        socket.on('new_lead', fetchConversas)
        socket.on('whatsapp_status', fetchConversas)
        return () => {
            socket.off('new_lead', fetchConversas)
            socket.off('whatsapp_status', fetchConversas)
        }
    }, [socket, fetchConversas])

    // === FILTROS ===
const conversasFiltradas = conversas.filter(({ lead, ultimaMsg }) => {
    // Filtro por busca textual
    if (busca) {
        const q = busca.toLowerCase()
        const match = lead.name?.toLowerCase().includes(q) || lead.dono?.toLowerCase().includes(q) || lead.phone?.includes(q)
        if (!match) return false
    }
    // Filtro por chip
    if (chipFiltro !== 'todos' && lead.instance_id !== chipFiltro) return false
    // Filtro por estado/tipo
    switch (filtro) {
        case 'a_responder':
            return !lead.is_paused && !lead.manual_pause && ultimaMsg?.role === 'user'
        case 'ia_ativa':
            return !lead.is_paused && !lead.manual_pause && ultimaMsg?.role === 'assistant'
        case 'pausadas':
            return lead.is_paused || lead.manual_pause
        case 'hot':
            return lead.lead_temperature === 'hot'
        case 'warm':
            return lead.lead_temperature === 'warm'
        case 'estagio_dor':
            return (lead.current_stage || 0) === 2
        case 'estagio_solucao':
            return (lead.current_stage || 0) === 3
        case 'estagio_agenda':
            return (lead.current_stage || 0) >= 4
        default:
            return true
    }
})

// 🎯 SORT TÁTICO: ordena por prioridade comercial, não cronológica
// Quanto MENOR o número de prioridade, mais alto na lista
function calcularPrioridade({ lead, ultimaMsg }) {
    const aguardandoResposta = !lead.is_paused && !lead.manual_pause && ultimaMsg?.role === 'user'
    const pausado = lead.is_paused || lead.manual_pause
    
    // 1. Hot lead aguardando resposta — DINHEIRO ESCORRENDO, atenção total
    if (lead.lead_temperature === 'hot' && aguardandoResposta) return 1
    
    // 2. Lead em Estágio 4+ (Agenda) aguardando — quase fechando
    if ((lead.current_stage || 0) >= 4 && aguardandoResposta) return 2
    
    // 3. Hot lead (mesmo se IA já respondeu) — manter no radar
    if (lead.lead_temperature === 'hot') return 3
    
    // 4. Estágio 4+ em geral — agenda em andamento
    if ((lead.current_stage || 0) >= 4) return 4
    
    // 5. Aguardando resposta (qualquer estágio) — vácuo da IA
    if (aguardandoResposta) return 5
    
    // 6. Warm leads — em construção
    if (lead.lead_temperature === 'warm') return 6
    
    // 7. IA ativa em conversa normal
    if (!pausado) return 7
    
    // 8. Pausados (no fim da lista)
    return 8
}

const conversasOrdenadas = [...conversasFiltradas].sort((a, b) => {
    const prioA = calcularPrioridade(a)
    const prioB = calcularPrioridade(b)
    
    // Se prioridade igual, desempata pelo last_contact_at mais recente
    if (prioA === prioB) {
        const tA = new Date(a.lead.last_contact_at || 0).getTime()
        const tB = new Date(b.lead.last_contact_at || 0).getTime()
        return tB - tA
    }
    
    return prioA - prioB
})

// Agrupa por chip para separação visual
const chipGroups = {}
conversasOrdenadas.forEach(item => {     // 👈 USA conversasOrdenadas, NÃO conversasFiltradas
    const chipId = item.lead.instance_id || 'sem_chip'
    if (!chipGroups[chipId]) chipGroups[chipId] = []
    chipGroups[chipId].push(item)
})

    // Contadores para os badges dos filtros
    const contadores = {
        todos: conversas.length,
        a_responder: conversas.filter(({ lead, ultimaMsg }) => !lead.is_paused && !lead.manual_pause && ultimaMsg?.role === 'user').length,
        ia_ativa: conversas.filter(({ lead, ultimaMsg }) => !lead.is_paused && !lead.manual_pause && ultimaMsg?.role === 'assistant').length,
        pausadas: conversas.filter(({ lead }) => lead.is_paused || lead.manual_pause).length,
        hot: conversas.filter(({ lead }) => lead.lead_temperature === 'hot').length,
        warm: conversas.filter(({ lead }) => lead.lead_temperature === 'warm').length,
    }

    // Definição dos filtros
    const FILTROS = [
        { key: 'todos',          label: 'Todos',      color: '#3B82F6' },
        { key: 'a_responder',    label: 'A Responder', color: '#F59E0B' },
        { key: 'ia_ativa',       label: 'IA Ativa',    color: '#10B981' },
        { key: 'pausadas',       label: 'Pausadas',    color: '#F43F5E' },
        { key: 'hot',            label: '🔥 Hot',      color: '#EF4444' },
        { key: 'warm',           label: '🟡 Warm',     color: '#F59E0B' },
        { key: 'estagio_dor',    label: 'Dor',         color: '#06B6D4' },
        { key: 'estagio_solucao',label: 'Solução',     color: '#8B5CF6' },
        { key: 'estagio_agenda', label: 'Agenda+',     color: '#10B981' },
    ]

    return (
        <div style={{
            display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
            fontFamily: "'DM Sans', system-ui, sans-serif",
        }}>

            {/* ── Header ── */}
            <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                           <BrainCircuit size={14} color='#F59E0B' />
                        <span style={{ fontSize: 11, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                            War Room
                        </span>
                        {conversas.length > 0 && (
                            <div style={{
                            background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
                                borderRadius: '999px', padding: '1px 7px',
                           fontSize: 9, fontWeight: 900, color: '#FBBF24',
}}>
                                {conversasOrdenadas.length}{filtro !== 'todos' ? `/${conversas.length}` : ''}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={fetchConversas}
                        disabled={loading}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: 4 }}
                        title="Atualizar"
                    >
                        <RefreshCw size={11} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                    </button>
                </div>

                {/* Campo de busca */}
                <div style={{ position: 'relative', marginBottom: 8 }}>
                    <Search size={11} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.25)' }} />
                    <input
                        value={busca}
                        onChange={e => setBusca(e.target.value)}
                        placeholder="Buscar conversa..."
                        style={{
                            width: '100%', boxSizing: 'border-box',
                            height: 28, paddingLeft: 26, paddingRight: 10,
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '0.4rem',
                            color: '#fff', fontSize: 10, fontWeight: 600,
                            outline: 'none', fontFamily: 'inherit',
                        }}
                    />
                </div>

                {/* === FILTROS POR ESTADO === */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                    {FILTROS.map(f => {
                        const count = contadores[f.key] ?? 0
                        const isActive = filtro === f.key
                        return (
                            <button
                                key={f.key}
                                onClick={() => setFiltro(f.key)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 3,
                                    background: isActive ? f.color + '20' : 'transparent',
                                    border: `1px solid ${isActive ? f.color + '50' : 'rgba(255,255,255,0.06)'}`,
                                    borderRadius: '999px', padding: '2px 7px',
                                    cursor: 'pointer', transition: 'all .15s',
                                    fontSize: 8, fontWeight: 900,
                                    color: isActive ? f.color : 'rgba(255,255,255,0.3)',
                                    textTransform: 'uppercase', letterSpacing: '0.08em',
                                }}
                            >
                                {f.label}
                                {count > 0 && (
                                    <span style={{
                                        fontSize: 7, fontWeight: 900,
                                        color: isActive ? f.color : 'rgba(255,255,255,0.2)',
                                        marginLeft: 1,
                                    }}>
                                        {count}
                                    </span>
                                )}
                            </button>
                        )
                    })}
                </div>

               
            </div>

            {/* ── Lista agrupada por chip ── */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px', minHeight: 0 }}>

                {loading && conversas.length === 0 ? (
                    <div style={{ padding: '30px 0', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                        Carregando…
                    </div>
                ) : conversasOrdenadas.length === 0 ? (
                    <div style={{ padding: '40px 0', textAlign: 'center' }}>
                        <BrainCircuit size={24} color='rgba(255,255,255,0.1)' style={{ margin: '0 auto 10px' }} />
                        <p style={{ color: 'rgba(255,255,255,0.15)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                            {busca ? 'Sem resultados' : filtro !== 'todos' ? 'Nenhuma conversa neste filtro' : 'Nenhuma conversa ativa'}
                        </p>
                    </div>
                ) : (
                    Object.entries(chipGroups).map(([chipId, items]) => {
                        const chipName = instances.find(i => i.id === chipId)?.name || 'Chip desconhecido'
                        const showChipHeader = instances.length > 1 && chipFiltro === 'todos'
                        return (
                            <div key={chipId} style={{ marginBottom: showChipHeader ? 8 : 0 }}>
                                {showChipHeader && (
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 5,
                                        padding: '6px 8px', marginBottom: 2,
                                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                                    }}>
                                        <Cpu size={9} color="rgba(255,255,255,0.2)" />
                                        <span style={{ fontSize: 8, fontWeight: 900, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>
                                            {chipName}
                                        </span>
                                        <span style={{ fontSize: 8, fontWeight: 900, color: 'rgba(59,130,246,0.4)' }}>
                                            {items.length}
                                        </span>
                                    </div>
                                )}
                               {items.map(({ lead, ultimaMsg }) => (
    <ConversaCard
        key={lead.id}
        lead={lead}
        ultimaMsg={ultimaMsg}
        isActive={lead.id === activeId}
        onClick={() => onSelect?.(lead)}
        onUpdate={fetchConversas}
    />
))}
                            </div>
                        )
                    })
                )}
            </div>

            <style>{`
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
    @keyframes spin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
    
    /* 🎯 Quick Actions: aparecem no hover do card */
    [data-conversa-card]:hover .quick-actions {
        opacity: 1 !important;
        pointer-events: auto !important;
    }
    [data-conversa-card]:hover .quick-action-indicator {
        opacity: 0.3;
    }
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
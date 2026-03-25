import React, { useState, useEffect, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Cpu, Wifi, WifiOff, Loader2, RefreshCw, Zap, User, Building2, Target, Clock } from 'lucide-react'

// FORMA CORRETA - ALTA PERFORMANCE
const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL, 
    import.meta.env.VITE_SUPABASE_ANON_KEY
)

// ─── PALETA ───────────────────────────────────────────────────────────────────
const C = {
    connected:    '#10B981',
    disconnected: '#F43F5E',
    connecting:   '#F59E0B',
    blue:         '#3B82F6',
    grid:         'rgba(255,255,255,0.04)',
    border:       'rgba(255,255,255,0.07)',
    muted:        'rgba(255,255,255,0.35)',
}

// Retorna cor e label de acordo com whatsapp_status do banco
function resolveStatus(instance, connectingSet) {
    if (connectingSet.has(instance.id)) {
        return { color: C.connecting, label: 'Conectando', icon: 'loading' }
    }
    if (instance.whatsapp_status === 'CONNECTED') {
        return { color: C.connected,    label: 'Conectado',  icon: 'on'  }
    }
    return     { color: C.disconnected, label: 'Offline',    icon: 'off' }
}

// Formata "há X min" / "há X h" a partir de ISO string
function timeAgo(isoStr) {
    if (!isoStr) return '—'
    const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
    if (diff < 60)   return 'agora'
    if (diff < 3600) return `há ${Math.floor(diff / 60)}min`
    if (diff < 86400)return `há ${Math.floor(diff / 3600)}h`
    return `há ${Math.floor(diff / 86400)}d`
}

// ─── CHIP CARD ────────────────────────────────────────────────────────────────
function ChipCard({ instance, dailyCount, statusInfo }) {
    const limit    = instance.daily_limit || 55
    const pct      = Math.min(Math.round(dailyCount / limit * 100), 100)
    const isMaxed  = pct >= 100

    const barColor = isMaxed
        ? C.disconnected
        : pct >= 75
        ? C.connecting
        : C.connected

    return (
        <div
            style={{
               background:    'rgba(255,255,255,0.02)',
                border:        `1px solid ${statusInfo.color}25`,
                borderTop:     `2px solid ${statusInfo.color}`,
                borderRadius:  '1rem',
                padding:       '14px 16px',
                display:       'flex',
                flexDirection: 'column',
                gap:           14,
                position:      'relative',
                overflow:      'hidden',
                transition:    'border-color .3s',
            }}
        >
            {/* Glow blob */}
            <div style={{
                position: 'absolute', top: -20, right: -20,
                width: 80, height: 80, borderRadius: '50%',
                background: statusInfo.color, opacity: .06,
                filter: 'blur(24px)', pointerEvents: 'none',
            }} />

            {/* ── Header: nome + status badge ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                        background: statusInfo.color + '18',
                        border:     `1px solid ${statusInfo.color}35`,
                        borderRadius: '0.6rem', padding: '7px',
                        boxShadow: `0 0 12px ${statusInfo.color}25`,
                    }}>
                        <Cpu size={16} color={statusInfo.color} />
                    </div>
                    <div>
                        <p style={{ fontSize: 13, fontWeight: 900, color: '#fff', lineHeight: 1, marginBottom: 3 }}>
                            {instance.name}
                        </p>
                        <p style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                            {instance.id.slice(0, 8)}…
                        </p>
                    </div>
                </div>

                {/* Status badge */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: statusInfo.color + '12',
                    border: `1px solid ${statusInfo.color}30`,
                    borderRadius: '999px', padding: '4px 10px',
                }}>
                    {statusInfo.icon === 'loading'
                        ? <Loader2 size={10} color={statusInfo.color} style={{ animation: 'spin 1s linear infinite' }} />
                        : statusInfo.icon === 'on'
                        ? <Wifi    size={10} color={statusInfo.color} />
                        : <WifiOff size={10} color={statusInfo.color} />
                    }
                    <span style={{ fontSize: 9, fontWeight: 900, color: statusInfo.color, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                        {statusInfo.label}
                    </span>
                </div>
            </div>

            {/* ── Agente e empresa ── */}
            <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: '0.75rem', padding: '8px 10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                        <User size={9} color={C.blue} />
                        <span style={{ fontSize: 8, fontWeight: 900, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Agente</span>
                    </div>
                    <p style={{ fontSize: 11, fontWeight: 900, color: '#fff' }}>
                        {instance.agent_name || '—'}
                    </p>
                </div>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: '0.75rem', padding: '8px 10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                        <Building2 size={9} color={C.blue} />
                        <span style={{ fontSize: 8, fontWeight: 900, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Empresa</span>
                    </div>
                    <p style={{ fontSize: 11, fontWeight: 900, color: '#fff' }}>
                        {instance.company_name || '—'}
                    </p>
                </div>
            </div>

            {/* ── Progress bar diária ── */}
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Target size={10} color={barColor} />
                        <span style={{ fontSize: 9, fontWeight: 900, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                            Meta Diária
                        </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                        <span style={{ fontSize: 16, fontWeight: 900, color: isMaxed ? C.disconnected : '#fff', lineHeight: 1 }}>
                            {dailyCount}
                        </span>
                        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700 }}>
                            / {limit}
                        </span>
                        <span style={{ fontSize: 9, color: barColor, fontWeight: 900, marginLeft: 4 }}>
                            {pct}%
                        </span>
                    </div>
                </div>

                {/* Barra */}
                <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.04)' }}>
                    <div style={{
                        height: '100%',
                        width:  `${pct}%`,
                        borderRadius: 999,
                        background: barColor,
                        boxShadow: `0 0 8px ${barColor}`,
                        transition: 'width 0.8s ease',
                    }} />
                </div>

                {isMaxed && (
                    <p style={{ fontSize: 9, color: C.disconnected, fontWeight: 900, marginTop: 5, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        🌙 Meta atingida — dormindo até amanhã
                    </p>
                )}
            </div>

            {/* ── Último contato ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                <Clock size={9} color="rgba(255,255,255,0.25)" />
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontWeight: 700 }}>
                    Último disparo: {timeAgo(instance.last_contact_at)}
                </span>
            </div>
        </div>
    )
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
/**
 * Props:
 *   instances — array vindo do estado do App.jsx (socket 'instances_list')
 *   socket    — instância do socket.io já conectada
 */
export default function ChipStatus({ instances = [], socket }) {
    // dailyCounts: { [instanceId]: number }
    const [dailyCounts,   setDailyCounts]   = useState({})
    const [connectingSet, setConnectingSet] = useState(new Set())
    const [loading,       setLoading]       = useState(true)
    const [lastSync,      setLastSync]      = useState(null)

    // Busca contagem diária de disparos por chip direto no Supabase
    // Replica getDailyContactCount do database.js:
    // conta leads com status='contact' e last_contact_at >= hoje
    const fetchDailyCounts = useCallback(async () => {
        if (!instances.length) { setLoading(false); return }
        setLoading(true)
        try {
            const hoje = new Date().toISOString().split('T')[0] // YYYY-MM-DD

            // Uma query só com group-by não existe no client Supabase,
            // então fazemos uma query por chip em paralelo (máx ~10 chips)
            const results = await Promise.all(
                instances.map(inst =>
                    supabase
                        .from('leads')
                        .select('*', { count: 'exact', head: true })
                        .eq('instance_id', inst.id)
                        .eq('status', 'contact')
                        .gte('last_contact_at', hoje)
                )
            )

            const counts = {}
            instances.forEach((inst, i) => {
                counts[inst.id] = results[i].count ?? 0
            })
            setDailyCounts(counts)
            setLastSync(new Date())
        } finally {
            setLoading(false)
        }
    }, [instances])

    // Fetch inicial e a cada 30s
    useEffect(() => {
        fetchDailyCounts()
        const id = setInterval(fetchDailyCounts, 30_000)
        return () => clearInterval(id)
    }, [fetchDailyCounts])

    // Escuta eventos de status do socket para atualizar connecting em tempo real
    useEffect(() => {
        if (!socket) return

        const onStatus = ({ status, instanceId }) => {
            if (status === 'CONNECTED') {
                setConnectingSet(prev => {
                    const next = new Set(prev)
                    next.delete(instanceId)
                    return next
                })
                // Refaz contagem após conexão
                fetchDailyCounts()
            }
        }

        const onQr = ({ instanceId }) => {
            // QR sendo exibido = chip está conectando
            setConnectingSet(prev => new Set(prev).add(instanceId))
        }

        socket.on('whatsapp_status', onStatus)
        socket.on('qr_code',         onQr)
        return () => {
            socket.off('whatsapp_status', onStatus)
            socket.off('qr_code',         onQr)
        }
    }, [socket, fetchDailyCounts])

    // ── Sumários globais ──────────────────────────────────────────────────────
    const totalConectados = instances.filter(i => i.whatsapp_status === 'CONNECTED').length
    const totalDisparos   = Object.values(dailyCounts).reduce((s, v) => s + v, 0)
    const totalLimite     = instances.reduce((s, i) => s + (i.daily_limit || 55), 0)

    return (
        <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", color: '#fff' }}>

            {/* ── Header ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <Cpu size={16} color={C.blue} />
                        <h2 style={{ fontSize: 14, fontWeight: 900, letterSpacing: '-0.02em', textTransform: 'uppercase' }}>
                            Status dos Chips
                        </h2>
                    </div>
                    <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 700 }}>
                        {totalConectados}/{instances.length} conectados · sync {lastSync ? lastSync.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '...'}
                    </p>
                </div>

                <button
                    onClick={fetchDailyCounts}
                    disabled={loading}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '999px', padding: '5px 12px',
                        cursor: 'pointer', color: 'rgba(255,255,255,0.45)',
                        fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em',
                    }}
                >
                    <RefreshCw size={10} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                    Atualizar
                </button>
            </div>

                    {/* ── Resumo global ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {[
                    { label: 'Chips Ativos',    value: `${totalConectados} / ${instances.length}`, color: C.connected,    icon: <Wifi size={11} color={C.connected} />, span: false },
                    { label: 'Disparos Hoje',   value: totalDisparos,                               color: C.blue,         icon: <Zap  size={11} color={C.blue} />, span: false },
                    { label: 'Capacidade Total',value: `${totalLimite}/dia`,                        color: 'rgba(255,255,255,0.5)', icon: <Target size={11} color="rgba(255,255,255,0.4)" />, span: true },
                ].map(({ label, value, color, icon, span }) => (
                    <div key={label} style={{ gridColumn: span ? 'span 2' : 'auto', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '0.75rem', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '5px', borderRadius: '0.4rem' }}>
                            {icon}
                        </div>
                        <div>
                            <p style={{ fontSize: 7, fontWeight: 900, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>{label}</p>
                            <p style={{ fontSize: 13, fontWeight: 900, color, lineHeight: 1 }}>{value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Grid de chips ── */}
            {instances.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.2)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em' }}>
                    Nenhum chip cadastrado
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 14,
                }}>
                    {instances.map(inst => (
                        <ChipCard
                            key={inst.id}
                            instance={inst}
                            dailyCount={dailyCounts[inst.id] ?? 0}
                            statusInfo={resolveStatus(inst, connectingSet)}
                        />
                    ))}
                </div>
            )}

            <style>{`
                @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
            `}</style>
        </div>
    )
}
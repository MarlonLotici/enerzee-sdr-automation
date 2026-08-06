import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Activity, Loader2, AlertTriangle } from 'lucide-react'

// Painel de saúde ao vivo dos chips (receptivo): conectado/caído, última mensagem recebida,
// há quanto tempo parado. Faz polling em /api/health a cada 15s. Foco operacional: ver na hora
// se o chip de um cliente caiu, sem depender do Discord.
const C = {
    ok:    '#10B981',
    down:  '#F43F5E',
    warn:  '#F59E0B',
    muted: 'rgba(255,255,255,0.4)',
    border:'rgba(255,255,255,0.08)',
}

function haQuantoTempo(min) {
    if (min == null) return '—'
    if (min <= 0)   return 'agora'
    if (min < 60)   return `há ${min}min`
    if (min < 1440) return `há ${Math.floor(min / 60)}h`
    return `há ${Math.floor(min / 1440)}d`
}

export default function HealthPanel() {
    const [chips, setChips]   = useState([])
    const [erro, setErro]     = useState(null)
    const [carregando, setCarregando] = useState(true)
    const [atualizadoEm, setAtualizadoEm] = useState(null)
    const timerRef = useRef(null)

    const buscar = useCallback(async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const resp = await fetch('/api/health', {
                headers: { 'Authorization': `Bearer ${session?.access_token}` },
            })
            const json = await resp.json()
            if (!json.ok) throw new Error(json.error || 'Falha ao carregar saúde')
            setChips(json.chips || [])
            setErro(null)
            setAtualizadoEm(Date.now())
        } catch (e) {
            setErro(e.message)
        } finally {
            setCarregando(false)
        }
    }, [])

    useEffect(() => {
        buscar()
        timerRef.current = setInterval(buscar, 15000)
        return () => clearInterval(timerRef.current)
    }, [buscar])

    // Um chip está "conectado" pela verdade runtime (ready) OU pelo status do banco.
    const estaOk = (c) => c.ready || c.whatsapp_status === 'CONNECTED'
    const chipsCaidos = chips.filter((c) => !estaOk(c)).length

    return (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: '0.75rem', padding: '12px 14px', background: 'rgba(0,0,0,0.25)', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Activity size={13} color={chipsCaidos ? C.down : C.ok} />
                    <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' }}>
                        Saúde dos Chips
                    </span>
                    {chipsCaidos > 0 && (
                        <span style={{ fontSize: 9, fontWeight: 900, color: C.down, background: `${C.down}22`, border: `1px solid ${C.down}55`, borderRadius: 6, padding: '1px 6px' }}>
                            {chipsCaidos} caído{chipsCaidos > 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                <span style={{ fontSize: 8, color: C.muted }}>
                    {carregando ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} /> : (atualizadoEm ? `atualizado ${haQuantoTempo(0)}` : '')}
                </span>
            </div>

            {erro && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: C.warn }}>
                    <AlertTriangle size={11} /> {erro}
                </div>
            )}

            {!erro && chips.length === 0 && !carregando && (
                <div style={{ fontSize: 10, color: C.muted }}>Nenhum chip cadastrado.</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {chips.map((c) => {
                    const ok = estaOk(c)
                    const cor = ok ? C.ok : (c.recon > 0 ? C.warn : C.down)
                    return (
                        <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 8px', borderRadius: 8, background: 'rgba(255,255,255,0.02)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: cor, flexShrink: 0, boxShadow: `0 0 6px ${cor}` }} />
                                <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>{c.name}</span>
                                {c.abandonado && (
                                    <span style={{ fontSize: 8, fontWeight: 900, color: C.down, border: `1px solid ${C.down}55`, borderRadius: 5, padding: '0 4px' }}>ABANDONADO</span>
                                )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 9, color: C.muted, flexShrink: 0 }}>
                                <span title="Última mensagem recebida">📩 {haQuantoTempo(c.ultimoInboundHaMin)}</span>
                                {!ok && <span style={{ color: C.down }} title="Tempo caído">⏱ {haQuantoTempo(c.paradoHaMin)}</span>}
                                {c.recon > 0 && <span style={{ color: C.warn }} title="Tentativas de reconexão">↻ {c.recon}/10</span>}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

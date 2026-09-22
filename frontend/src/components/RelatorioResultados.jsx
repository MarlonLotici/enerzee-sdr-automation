import React, { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import PeriodSelector from './PeriodSelector'
import { MessageSquare, Users, CalendarCheck, Clock, Moon, Printer, Zap } from 'lucide-react'

// ============================================================================
// RELATÓRIO DE RESULTADOS — 1 página, limpo, pronto pra screenshot/PDF.
// Objetivo comercial: virar a PROVA que o dono do negócio manda pra um prospect
// (ou o print que segura um cliente atual). Fala em impacto, não em métrica crua.
// Isola por tenant (user_id da sessão) — cada cliente vê os SEUS números.
// ============================================================================

const AMBAR = '#F59E0B'
const VERDE = '#10B981'
const CIANO = '#06B6D4'
const ROXO = '#8B5CF6'

function getDateFrom(periodo) {
    if (periodo === 'all') return null
    const d = new Date()
    d.setDate(d.getDate() - parseInt(periodo))
    return d.toISOString()
}

// Horário comercial BRT (UTC-3). Fora disso = "que teria esperado sem a IA".
function ehForaDoHorario(dateISO) {
    const dt = new Date(dateISO)
    const horaBRT = (dt.getUTCHours() - 3 + 24) % 24
    const diaBRT = new Date(dt.getTime() - 3 * 3600000).getUTCDay() // 0=Dom, 6=Sáb
    const fimDeSemana = diaBRT === 0 || diaBRT === 6
    const foraHorario = horaBRT < 8 || horaBRT >= 19
    return fimDeSemana || foraHorario
}

function HeroCard({ icon: Icon, value, label, sub, color }) {
    return (
        <div style={{
            background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}30`,
            borderRadius: '1.25rem', padding: '22px 24px', position: 'relative', overflow: 'hidden',
        }}>
            <div style={{ position: 'absolute', top: -30, right: -30, width: 100, height: 100, borderRadius: '50%', background: color, opacity: .08, filter: 'blur(30px)', pointerEvents: 'none' }} />
            <div style={{ background: color + '18', border: `1px solid ${color}35`, borderRadius: '0.75rem', padding: 8, width: 'fit-content', marginBottom: 14 }}>
                <Icon size={18} color={color} />
            </div>
            <p style={{ fontSize: 34, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>{value}</p>
            <p style={{ fontSize: 12, fontWeight: 900, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>{label}</p>
            {sub && <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>{sub}</p>}
        </div>
    )
}

export default function RelatorioResultados() {
    const [periodo, setPeriodo] = useState('30d')
    const [loading, setLoading] = useState(true)
    const [empresa, setEmpresa] = useState('')
    const [raw, setRaw] = useState({ leads: [], mensagens: [] })

    useEffect(() => {
        let vivo = true
        ;(async () => {
            setLoading(true)
            try {
                const { data: { session: s } } = await supabase.auth.getSession()
                const uid = s?.user?.id
                if (!uid) { if (vivo) setLoading(false); return }

                const { data: inst } = await supabase.from('instances').select('name, company_name').eq('user_id', uid).limit(1)
                const nome = inst?.[0]?.company_name || inst?.[0]?.name || (s?.user?.email || '').split('@')[0] || 'Sua empresa'

                const dateFrom = getDateFrom(periodo) || new Date(Date.now() - 90 * 86400000).toISOString()
                const [{ data: leads }, { data: mensagens }] = await Promise.all([
                    supabase.from('leads')
                        .select('id, status, created_at, last_contact_at, current_stage, calendly_booked, whatsapp_id, followup_count')
                        .eq('user_id', uid).limit(50000),
                    supabase.from('messages')
                        .select('role, content, created_at, whatsapp_id')
                        .eq('user_id', uid).gte('created_at', dateFrom)
                        .order('created_at', { ascending: true }).limit(50000),
                ])
                if (!vivo) return
                setEmpresa(nome)
                setRaw({ leads: leads || [], mensagens: mensagens || [] })
            } catch (e) {
                console.error('Erro no relatório:', e)
            } finally {
                if (vivo) setLoading(false)
            }
        })()
        return () => { vivo = false }
    }, [periodo])

    const m = useMemo(() => {
        const { leads, mensagens } = raw

        const assistant = mensagens.filter(x => x.role === 'assistant')
        const userMsgs = mensagens.filter(x => x.role === 'user' && !x.content?.startsWith('[AUTORESPOSTA]'))

        const conversasAtendidas = new Set(assistant.map(x => x.whatsapp_id)).size
        const leadsResponderam = new Set(userMsgs.map(x => x.whatsapp_id)).size
        const mensagensRespondidas = assistant.length

        // Reunião é conversão PERMANENTE (não expira por período) — consistente com o resto
        // do Analytics (VisualAnalytics conta agendados all-time). Evita mostrar 1 aqui e 6 lá.
        const reunioes = leads.filter(l =>
            l.status === 'booked' || l.status === 'closed' || l.calendly_booked === true || (l.current_stage || 0) >= 4
        ).length

        // Fora do horário comercial (noite/fim de semana) — atendimento 24/7.
        // foraDoHorario = MENSAGENS (volume); conversasForaDoHorario = conversas distintas (contexto).
        const assistantFora = assistant.filter(x => ehForaDoHorario(x.created_at))
        const foraDoHorario = assistantFora.length
        const conversasForaDoHorario = new Set(assistantFora.map(x => x.whatsapp_id)).size

        // Tempo médio até a 1ª resposta do lead após o disparo (min), capado em 24h
        const primeiraUserPorJid = {}
        for (const u of userMsgs) {
            if (!primeiraUserPorJid[u.whatsapp_id]) primeiraUserPorJid[u.whatsapp_id] = new Date(u.created_at)
        }
        let soma = 0, cont = 0
        for (const l of leads) {
            if (!l.last_contact_at || !l.whatsapp_id) continue
            const envio = new Date(l.last_contact_at)
            const resp = primeiraUserPorJid[l.whatsapp_id]
            if (resp && resp > envio) {
                const diff = (resp - envio) / 60000
                if (diff > 0 && diff < 1440) { soma += diff; cont++ }
            }
        }
        const tempoMedio = cont > 0 ? Math.round(soma / cont) : null

        return { conversasAtendidas, leadsResponderam, mensagensRespondidas, reunioes, foraDoHorario, conversasForaDoHorario, tempoMedio }
    }, [raw, periodo])

    const rotuloPeriodo = { '1d': 'hoje', '7d': 'nos últimos 7 dias', '30d': 'nos últimos 30 dias', '90d': 'nos últimos 90 dias', '365d': 'no último ano', 'all': 'até agora' }[periodo] || 'no período'
    const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })

    return (
        <div style={{ background: '#020617', minHeight: '100vh', padding: '28px 28px 48px', fontFamily: "'DM Sans', system-ui, sans-serif", color: '#fff' }}>
            <style>{`
                @media print {
                    .sidebar, .antix-noprint { display: none !important; }
                    body, #root { background: #fff !important; }
                    .antix-relatorio { background: #fff !important; color: #111 !important; padding: 0 !important; }
                    .antix-relatorio * { color: #111 !important; }
                }
            `}</style>

            {/* Controles (não vão pro print) */}
            <div className="antix-noprint" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
                <PeriodSelector value={periodo} onChange={setPeriodo} />
                <button onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: 8, background: AMBAR, color: '#111', border: 'none', borderRadius: 10, padding: '9px 18px', fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'pointer' }}>
                    <Printer size={15} /> Imprimir / PDF
                </button>
            </div>

            {loading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'rgba(255,255,255,0.3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', fontSize: 13 }}>
                    Carregando relatório...
                </div>
            ) : (
                <div className="antix-relatorio">
                    {/* Cabeçalho do relatório */}
                    <div style={{ marginBottom: 26 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                            <div style={{ background: 'linear-gradient(135deg,#D97706,#F59E0B)', borderRadius: '0.6rem', padding: 6 }}>
                                <Zap size={16} color="#111" />
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 900, color: AMBAR, textTransform: 'uppercase', letterSpacing: '0.2em' }}>Relatório de Resultados · IA Antix</span>
                        </div>
                        <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 4 }}>
                            O que a IA fez por <span style={{ color: AMBAR }}>{empresa}</span>
                        </h1>
                        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>Resultados {rotuloPeriodo} · gerado em {hoje}</p>
                    </div>

                    {/* Hero numbers */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
                        <HeroCard icon={MessageSquare} value={m.conversasAtendidas.toLocaleString('pt-BR')} label="Conversas atendidas" sub={`${m.mensagensRespondidas.toLocaleString('pt-BR')} mensagens respondidas pela IA`} color={AMBAR} />
                        <HeroCard icon={Users} value={m.leadsResponderam.toLocaleString('pt-BR')} label="Leads engajados" sub="responderam e avançaram na conversa" color={CIANO} />
                        <HeroCard icon={CalendarCheck} value={m.reunioes.toLocaleString('pt-BR')} label="Reuniões agendadas" sub="sem ninguém precisar responder na mão" color={VERDE} />
                        <HeroCard icon={Clock} value={m.tempoMedio != null ? `${m.tempoMedio} min` : '—'} label="Tempo de 1ª resposta" sub="do contato à resposta da IA" color={ROXO} />
                        <HeroCard icon={Moon} value={m.foraDoHorario.toLocaleString('pt-BR')} label="Mensagens fora do horário" sub={`respondidas à noite/fim de semana em ${m.conversasForaDoHorario} ${m.conversasForaDoHorario === 1 ? 'conversa' : 'conversas'} — 24/7`} color="#F43F5E" />
                    </div>

                    {/* Narrativa de impacto */}
                    <div style={{ background: 'rgba(245,158,11,0.06)', border: `1px solid ${AMBAR}30`, borderRadius: '1.25rem', padding: '22px 26px' }}>
                        <p style={{ fontSize: 12, fontWeight: 900, color: AMBAR, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 12 }}>Traduzindo em impacto</p>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <li style={{ fontSize: 15, lineHeight: 1.5, color: 'rgba(255,255,255,0.85)' }}>
                                A IA conduziu <b style={{ color: '#fff' }}>{m.conversasAtendidas.toLocaleString('pt-BR')} conversas</b> e respondeu <b style={{ color: '#fff' }}>{m.mensagensRespondidas.toLocaleString('pt-BR')} mensagens</b> {rotuloPeriodo} — automaticamente, sem sobrecarregar o time.
                            </li>
                            {m.reunioes > 0 && (
                                <li style={{ fontSize: 15, lineHeight: 1.5, color: 'rgba(255,255,255,0.85)' }}>
                                    Gerou <b style={{ color: VERDE }}>{m.reunioes} {m.reunioes === 1 ? 'reunião agendada' : 'reuniões agendadas'}</b> direto na conversa — oportunidades reais de venda.
                                </li>
                            )}
                            {m.tempoMedio != null && (
                                <li style={{ fontSize: 15, lineHeight: 1.5, color: 'rgba(255,255,255,0.85)' }}>
                                    Respondeu em <b style={{ color: '#fff' }}>{m.tempoMedio} minuto{m.tempoMedio === 1 ? '' : 's'}</b> em média. Lead respondido na hora converte muito mais do que lead que espera horas por um humano.
                                </li>
                            )}
                            {m.foraDoHorario > 0 && (
                                <li style={{ fontSize: 15, lineHeight: 1.5, color: 'rgba(255,255,255,0.85)' }}>
                                    Respondeu <b style={{ color: '#F43F5E' }}>{m.foraDoHorario.toLocaleString('pt-BR')} mensagens</b> à noite ou no fim de semana (em {m.conversasForaDoHorario} {m.conversasForaDoHorario === 1 ? 'conversa' : 'conversas'}) — leads que provavelmente esfriariam esperando o próximo dia útil.
                                </li>
                            )}
                        </ul>
                    </div>

                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: 600, marginTop: 18, textAlign: 'center' }}>
                        Antix · Inteligência artificial de atendimento e vendas no WhatsApp
                    </p>
                </div>
            )}
        </div>
    )
}

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
    AreaChart, Area, BarChart, Bar,
    PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import {
    TrendingUp, TrendingDown, Zap, Users, Target,
    Activity, Flame, RefreshCw, Cpu, MapPin,
} from 'lucide-react'
import PeriodSelector from './PeriodSelector'

function getDateFrom(periodo) {
    if (periodo === 'all') return null
    const d = new Date()
    d.setDate(d.getDate() - parseInt(periodo))
    return d.toISOString()
}



// ─── PALETA ───────────────────────────────────────────────────────────────────
const NEON = {
    blue:    '#F59E0B',
    cyan:    '#06B6D4',
    emerald: '#10B981',
    amber:   '#F59E0B',
    violet:  '#8B5CF6',
    rose:    '#F43F5E',
    grid:    'rgba(255,255,255,0.04)',
    muted:   'rgba(255,255,255,0.35)',
}
const NICHE_COLORS  = [NEON.blue, NEON.violet, NEON.cyan, NEON.emerald, NEON.amber, NEON.rose]
const MES_LABEL     = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
const DIA_LABEL     = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']

// ─── COMPUTAÇÃO ───────────────────────────────────────────────────────────────
function computeMetrics(leads, instances, realTotalLeads, realAgendados = 0, realAbordados = 0) {
    if (!leads?.length) return null

    // 🛡️ FILTRO BLINDADO: leads válidos = exclui inválidos, blacklisted e erros
    // Esses 3 status pertencem a leads que NUNCA foram realmente abordados,
    // então não devem contaminar nenhuma taxa de conversão.
    const leadsValidos = leads.filter(l => 
        !['invalid', 'blacklisted', 'error'].includes(l.status)
    )

    const now    = new Date()
    const cutoff = new Date(now)
    cutoff.setMonth(cutoff.getMonth() - 5)
    cutoff.setDate(1)
    cutoff.setHours(0, 0, 0, 0)

    // ── 1. Evolução mensal: criados vs abordados ──
    const monthBuckets = {}
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now)
        d.setMonth(d.getMonth() - i)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        monthBuckets[key] = { mes: MES_LABEL[d.getMonth()], criados: 0, abordados: 0 }
    }

    leadsValidos.forEach(lead => {
        const created = new Date(lead.created_at)
        if (created >= cutoff) {
            const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`
            if (monthBuckets[key]) monthBuckets[key].criados++
        }
        if (lead.last_contact_at) {
            const contacted = new Date(lead.last_contact_at)
            if (contacted >= cutoff) {
                const key = `${contacted.getFullYear()}-${String(contacted.getMonth() + 1).padStart(2, '0')}`
                if (monthBuckets[key]) monthBuckets[key].abordados++
            }
        }
    })
    const monthly = Object.values(monthBuckets)

    // ── 2. Funil por status ──
    const sc = { new: 0, contact: 0, waiting_analysis: 0, booked: 0, closed: 0, error: 0, invalid: 0, blacklisted: 0, dead: 0 }
    leadsValidos.forEach(l => { if (sc[l.status] !== undefined) sc[l.status]++ })

    // 🎯 AGENDAMENTOS REAIS: count vem do servidor (bypassa limite de 1000 rows do Supabase)
    // realAgendados é calculado com query server-side em fetchData
    const totalAgendamentosReais = realAgendados || leadsValidos.filter(l =>
        l.status === 'booked'        ||
        l.status === 'closed'        ||
        l.calendly_booked === true   ||
        (l.current_stage || 0) >= 4
    ).length

    // Funil usa valores server-side para Capturados e Abordados (bypassa limite de 1000 rows)
    const emConversaQtd = sc.contact + sc.waiting_analysis + sc.booked + sc.closed
    const funnel = [
        { etapa: 'Capturados',   qtd: realTotalLeads || leadsValidos.length,    fill: NEON.blue    },
        { etapa: 'Abordados',    qtd: realAbordados  || leadsValidos.filter(l => !!l.last_contact_at).length, fill: NEON.cyan },
        { etapa: 'Em Conversa',  qtd: emConversaQtd,                             fill: '#6366f1'   },
        { etapa: 'Em análise',   qtd: sc.waiting_analysis + sc.booked + sc.closed, fill: NEON.violet },
        { etapa: 'Agendados',    qtd: totalAgendamentosReais,                    fill: NEON.emerald },
    ]
    // ── 3. Nichos (top 6) ──
    const nicheCount = {}
    leadsValidos.forEach(l => {
        if (!l.niche) return
        const n = String(l.niche).trim()
        nicheCount[n] = (nicheCount[n] || 0) + 1
    })
    const nicheData = Object.entries(nicheCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count], i) => ({
            name: name.length > 14 ? name.slice(0, 14) + '…' : name,
            value: leadsValidos.length > 0 ? Math.round(count / leadsValidos.length * 100) : 0,
            abs: count,
            fill: NICHE_COLORS[i % NICHE_COLORS.length],
        }))

    // ── 4. Disparos por chip (instance_id) ──
    const chipCount = {}
    leadsValidos.forEach(l => {
        if (!l.last_contact_at || !l.instance_id) return
        chipCount[l.instance_id] = (chipCount[l.instance_id] || 0) + 1
    })
    const chipData = Object.entries(chipCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([id, qtd]) => {
            const inst = instances?.find(i => i.id === id)
            return {
                chip: inst?.name ? (inst.name.length > 12 ? inst.name.slice(0, 12) + '…' : inst.name) : id.slice(0, 8),
                disparos: qtd,
                fill: inst?.whatsapp_status === 'CONNECTED' ? NEON.emerald : NEON.violet,
            }
        })

    // ── 5. Leads capturados por dia da semana ──
    const diaCriados = [0, 0, 0, 0, 0, 0, 0]
    leadsValidos.forEach(l => {
        if (!l.created_at) return
        diaCriados[new Date(l.created_at).getDay()]++
    })
    const dailyCapture = DIA_LABEL.map((dia, i) => ({ dia, leads: diaCriados[i] }))

    // ── 6. Funil SPIN por estágio (0-5) ──
    // Usa contagem CUMULATIVA: um lead no stage 4 também conta nos stages 0-3
    // Isso representa o fluxo histórico ("quantos chegaram a cada stage") não o snapshot atual
    const estagioLabels = ['Qualificação', 'Situação', 'Dor/Implicação', 'Solução', 'Agendamento', 'Fechamento']
    const estagioColors = ['#64748b', '#3B82F6', '#06B6D4', '#8B5CF6', '#F59E0B', '#10B981']
    const estagioCount = [0, 0, 0, 0, 0, 0]
    leadsValidos.forEach(l => {
        if (l.status === 'new') return
        const stage = Math.min(l.current_stage || 0, 5)
        // Acumula: um lead no stage 3 passou pelos stages 0, 1, 2 e 3
        for (let i = 0; i <= stage; i++) estagioCount[i]++
    })
    const funnelSpin = estagioLabels.map((label, i) => ({
        etapa: label,
        qtd: estagioCount[i],
        fill: estagioColors[i],
    }))

    // ── 7. Distribuição de temperatura ──
    const tempCount = { cold: 0, warm: 0, hot: 0, dead: 0 }
    leadsValidos.forEach(l => {
        const t = l.lead_temperature || 'cold'
        if (tempCount[t] !== undefined) tempCount[t]++
    })
    const temperatureData = [
        { name: 'Cold ❄️',  value: tempCount.cold, fill: '#3B82F6' },
        { name: 'Warm 🟡',  value: tempCount.warm, fill: '#F59E0B' },
        { name: 'Hot 🔥',   value: tempCount.hot,  fill: '#EF4444' },
        { name: 'Dead 💀',  value: tempCount.dead, fill: '#64748b' },
    ].filter(d => d.value > 0)

    // ── 8. A/B Testing de aberturas ──
    // "responderam" = avançaram além do estágio 0 (melhor proxy disponível sem histórico de mensagens)
    const templateStats = {}
    leadsValidos.forEach(l => {
        if (!l.opening_template || !l.last_contact_at) return
        const baseTemplate = l.opening_template.replace('_decisor', '') // merge variantes decisor/não-decisor
        if (!templateStats[baseTemplate]) {
            templateStats[baseTemplate] = { enviados: 0, responderam: 0 }
        }
        templateStats[baseTemplate].enviados++
        if ((l.current_stage || 0) > 0) {
            templateStats[baseTemplate].responderam++
        }
    })
    const abTestData = Object.entries(templateStats)
        .map(([template, stats]) => ({
            template: template.replace('abertura_', '').toUpperCase(),
            enviados: stats.enviados,
            responderam: stats.responderam,
            taxa: stats.enviados > 0 ? Math.round(stats.responderam / stats.enviados * 100) : 0,
        }))
        .sort((a, b) => b.taxa - a.taxa)

    // ── 9. Taxa de resposta por nicho ──
    // Denominador: apenas leads que foram efetivamente disparados (têm last_contact_at)
    // Proxy de resposta: avançou além do estágio 0 (sem acesso a mensagens históricas aqui)
    const nicheResponse = {}
    leadsValidos.forEach(l => {
        if (!l.niche || !l.last_contact_at) return
        const n = String(l.niche).trim()
        if (!nicheResponse[n]) nicheResponse[n] = { total: 0, responderam: 0 }
        nicheResponse[n].total++
        if ((l.current_stage || 0) > 0) nicheResponse[n].responderam++
    })
    const nicheResponseData = Object.entries(nicheResponse)
        .filter(([_, v]) => v.total >= 3)
        .map(([name, stats]) => ({
            name: name.length > 16 ? name.slice(0, 16) + '…' : name,
            taxa: Math.round(stats.responderam / stats.total * 100),
            total: stats.total,
            responderam: stats.responderam,
        }))
        .sort((a, b) => b.taxa - a.taxa)
        .slice(0, 8)

    // ── 10. Taxa de passagem entre estágios SPIN — COM CLAMP ANTI-200% ──
    const spinPassagem = []
    for (let i = 0; i < 5; i++) {
        const atual = estagioCount[i]
        const proximo = estagioCount[i + 1]
        // 🛡️ Blindagem matemática: taxa nunca passa de 100%, perdidos nunca fica negativo
        const taxa = atual > 0 ? Math.min(Math.round(proximo / atual * 100), 100) : 0
        const perdidos = Math.max(atual - proximo, 0)
        spinPassagem.push({
            de: estagioLabels[i],
            para: estagioLabels[i + 1],
            taxa,
            saem: perdidos,
            passam: proximo,
        })
    }

   // ── 11. Performance Geográfica ──
    const geoPerformance = {}
    leadsValidos.forEach(l => {
        if (!l.estado || l.estado.trim() === '') return
        const uf = l.estado.toUpperCase().trim()
        if (!geoPerformance[uf]) geoPerformance[uf] = { total: 0, agendados: 0 }
        geoPerformance[uf].total++
        // 🎯 Mesma regra blindada: status booked, calendly_booked, ou estágio 4+
        if (l.status === 'booked' || l.calendly_booked === true || (l.current_stage || 0) >= 4) {
            geoPerformance[uf].agendados++
        }
    })

    const geoData = Object.entries(geoPerformance)
        .map(([uf, stats]) => ({
            uf,
            total: stats.total,
            taxa: Math.round((stats.agendados / stats.total) * 100) || 0
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5)

   // ── 12. Métrica de Engajamento Real ──
    let visualizados = 0
    let responderamAposVer = 0
    leadsValidos.forEach(l => {
        if (l.last_seen_at) {
            visualizados++
            // 🎯 Se passou do estágio 0 OU se a temperatura esquentou, ele engajou
            if ((l.current_stage || 0) > 0 || l.lead_temperature === 'warm' || l.lead_temperature === 'hot') {
                responderamAposVer++
            }
        }
    })
    const engagementRate = visualizados > 0 ? Math.round((responderamAposVer / visualizados) * 100) : 0

    // ── KPIs — todos usam valores server-side quando disponíveis ──
    const totalLeads     = realTotalLeads || leadsValidos.length
    const totalAbordados = realAbordados  || leadsValidos.filter(l => l.last_contact_at).length
    const totalAgendados = totalAgendamentosReais
    const taxaAbordagem  = totalLeads > 0 ? Math.round(totalAbordados / totalLeads * 100) : 0

    const last2 = monthly.slice(-2)
    const deltaCriados   = last2.length === 2 && last2[0].criados   > 0 ? Math.round((last2[1].criados   - last2[0].criados)   / last2[0].criados   * 100) : 0
    const deltaAbordados = last2.length === 2 && last2[0].abordados > 0 ? Math.round((last2[1].abordados - last2[0].abordados) / last2[0].abordados * 100) : 0

    return {
        monthly, funnel, nicheData, chipData, dailyCapture,
        totalLeads, totalAbordados, totalAgendados, taxaAbordagem,
        deltaCriados, deltaAbordados,
        statusCounts: sc,
        funnelSpin, temperatureData, abTestData,
        nicheResponseData, spinPassagem,
        geoData, engagementRate
    }
}


// ─── TOOLTIP ──────────────────────────────────────────────────────────────────
const NeonTooltip = ({ active, payload, label, prefix = '', suffix = '' }) => {
    if (!active || !payload?.length) return null
    return (
        <div style={{ background: 'rgba(2,6,23,0.97)', border: '1px solid rgba(59,130,246,0.35)', borderRadius: '1rem', padding: '10px 16px', boxShadow: '0 0 24px rgba(59,130,246,0.12)' }}>
            <p style={{ color: NEON.muted, fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 6 }}>{label}</p>
            {payload.map((p, i) => (
                <p key={i} style={{ color: p.color || '#fff', fontSize: 14, fontWeight: 900, margin: '2px 0' }}>
                    {prefix}{typeof p.value === 'number' ? p.value.toLocaleString('pt-BR') : p.value}{suffix}
                </p>
            ))}
        </div>
    )
}

// ─── INFO TOOLTIP ──────────────────────────────────────────────────────────────
function InfoTooltip({ text }) {
    const [pos, setPos] = useState(null)
    const ref = useRef(null)

    const show = () => {
        if (!ref.current) return
        const r = ref.current.getBoundingClientRect()
        const W = 224
        let left = r.left
        if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8
        if (left < 8) left = 8
        const openBelow = r.top < 160
        setPos({ left, triggerTop: r.top, triggerBottom: r.bottom, openBelow })
    }
    const hide = () => setPos(null)

    return (
        <>
            <span ref={ref} onMouseEnter={show} onMouseLeave={hide} onClick={() => pos ? hide() : show()}
                  style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 5, cursor: 'pointer', flexShrink: 0 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', fontSize: 9, fontWeight: 900, color: 'rgba(255,255,255,0.4)', lineHeight: 1 }}>?</span>
            </span>
            {pos && createPortal(
                <div style={{ position: 'fixed', left: pos.left, ...(pos.openBelow ? { top: pos.triggerBottom + 6 } : { bottom: window.innerHeight - pos.triggerTop + 6 }), zIndex: 99999, background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '10px 14px', fontSize: 11, color: 'rgba(255,255,255,0.75)', fontWeight: 500, width: 224, lineHeight: 1.6, boxShadow: '0 8px 32px rgba(0,0,0,0.9)', pointerEvents: 'none', whiteSpace: 'normal' }}>
                    {text}
                </div>,
                document.body
            )}
        </>
    )
}

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, delta, color, info }) {
    const isUp = delta >= 0
    return (
        <div
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '1.5rem', padding: '20px 24px', position: 'relative', overflow: 'hidden', transition: 'border-color .3s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = color + '55'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'}
        >
            <div style={{ position: 'absolute', top: -30, right: -30, width: 110, height: 110, borderRadius: '50%', background: color, opacity: .07, filter: 'blur(32px)', pointerEvents: 'none' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div style={{ background: color + '18', border: `1px solid ${color}35`, borderRadius: '0.75rem', padding: '8px', boxShadow: `0 0 14px ${color}30` }}>
                    <Icon size={18} color={color} />
                </div>
                {delta !== null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: isUp ? 'rgba(16,185,129,0.1)' : 'rgba(244,63,94,0.1)', border: `1px solid ${isUp ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.2)'}`, borderRadius: '999px', padding: '3px 8px' }}>
                        {isUp ? <TrendingUp size={11} color={NEON.emerald} /> : <TrendingDown size={11} color={NEON.rose} />}
                        <span style={{ fontSize: 10, fontWeight: 900, color: isUp ? NEON.emerald : NEON.rose }}>{isUp ? '+' : ''}{delta}%</span>
                    </div>
                )}
            </div>
            <p style={{ fontSize: 11, fontWeight: 900, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 4, display: 'flex', alignItems: 'center' }}>
                {label}{info && <InfoTooltip text={info} />}
            </p>
            <p style={{ fontSize: 28, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 4 }}>{value}</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', fontWeight: 700 }}>{sub}</p>
        </div>
    )
}

const SectionTitle = ({ children, accent = NEON.blue, info }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <div style={{ width: 3, height: 18, borderRadius: 2, background: accent, boxShadow: `0 0 8px ${accent}`, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.25em', color: 'rgba(255,255,255,0.45)', display: 'flex', alignItems: 'center' }}>
            {children}{info && <InfoTooltip text={info} />}
        </span>
    </div>
)

const ChartCard = ({ children, style = {} }) => (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '1.5rem', padding: '22px 20px', ...style }}>
        {children}
    </div>
)

const Skeleton = ({ h = 200 }) => (
    <div style={{ height: h, borderRadius: '1.5rem', background: 'rgba(255,255,255,0.04)', animation: 'shimmer 1.5s infinite' }} />
)

// ─── COMPONENTE PRINCIPAL ──────────────
export default function VisualAnalytics() {
    const [leads,              setLeads]              = useState([])
    const [instances,          setInstances]          = useState([])
    const [loading,            setLoading]            = useState(true)
    const [lastSync,           setLastSync]           = useState(null)
    const [realTotalLeads,     setRealTotalLeads]     = useState(0)
    const [realAgendados,      setRealAgendados]      = useState(0)
    const [realAbordados,      setRealAbordados]      = useState(0)
    const [periodo,            setPeriodo]            = useState('30d')

    const fetchData = async () => {
        setLoading(true)
        try {
            const { data: { session: s } } = await supabase.auth.getSession()
            const uid = s?.user?.id
            if (!uid) { setLoading(false); return }

            const { data: instData } = await supabase.from('instances').select('id, name, whatsapp_status').eq('user_id', uid)
            const instIds = instData?.map(i => i.id) || []
            if (!instIds.length) { setLoading(false); return }

            const dateFrom = getDateFrom(periodo)

            let leadsQ = supabase
                .from('leads')
                .select('id, status, niche, created_at, last_contact_at, instance_id, capital_social_numeric, current_stage, lead_temperature, opening_template, last_seen_at, calendly_booked')
                .in('instance_id', instIds)
                .order('current_stage', { ascending: false })
                .limit(10000)
            if (dateFrom) leadsQ = leadsQ.gte('created_at', dateFrom)

            let countQ = supabase.from('leads').select('*', { count: 'exact', head: true }).in('instance_id', instIds)
            if (dateFrom) countQ = countQ.gte('created_at', dateFrom)

            let agendQ = supabase.from('leads').select('*', { count: 'exact', head: true })
                .in('instance_id', instIds)
                .not('status', 'in', '(invalid,blacklisted,error)')
                .or('status.eq.booked,status.eq.closed,calendly_booked.eq.true,current_stage.gte.4')
            if (dateFrom) agendQ = agendQ.gte('last_contact_at', dateFrom)

            let aborQ = supabase.from('leads').select('*', { count: 'exact', head: true })
                .in('instance_id', instIds)
                .not('last_contact_at', 'is', null)
                .not('status', 'in', '(invalid,blacklisted,error)')
            if (dateFrom) aborQ = aborQ.gte('last_contact_at', dateFrom)

            const [leadsRes, countRes, agendadosRes, abordadosRes] = await Promise.all([leadsQ, countQ, agendQ, aborQ])
            const instRes = { data: instData, error: null }
            if (!leadsRes.error && leadsRes.data)            setLeads(leadsRes.data)
            if (!instRes.error  && instRes.data)             setInstances(instRes.data)
            if (!countRes.error && countRes.count != null)   setRealTotalLeads(countRes.count)
            if (!agendadosRes.error && agendadosRes.count != null) setRealAgendados(agendadosRes.count)
            if (!abordadosRes.error && abordadosRes.count != null) setRealAbordados(abordadosRes.count)

            setLastSync(new Date())

        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
        const id = setInterval(fetchData, 60_000)
        return () => clearInterval(id)
    }, [periodo])

        const metrics = useMemo(() => computeMetrics(leads, instances, realTotalLeads, realAgendados, realAbordados), [leads, instances, realTotalLeads, realAgendados, realAbordados])
    // ── LOADING ───────────────────────────────────────────────────────────────
    if (loading && !metrics) {
        return (
            <div style={{ background: '#020617', minHeight: '100vh', padding: '28px', fontFamily: "'DM Sans', system-ui, sans-serif" }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 16, marginBottom: 24 }}>
                    {[1,2,3,4].map(i => <Skeleton key={i} h={130} />)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, marginBottom: 16 }}>
                    <Skeleton h={280} /><Skeleton h={280} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px 240px', gap: 16 }}>
                    <Skeleton h={240} /><Skeleton h={240} /><Skeleton h={240} />
                </div>
                <style>{`@keyframes shimmer{0%,100%{opacity:.4}50%{opacity:.8}}`}</style>
            </div>
        )
    }

    if (!metrics) {
        return (
            <div style={{ background: '#020617', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Sans', system-ui, sans-serif", color: 'rgba(255,255,255,0.25)', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em' }}>
                Nenhum lead encontrado no banco
            </div>
        )
    }

    const {
    monthly, funnel, nicheData, chipData, dailyCapture,
    totalLeads, totalAbordados, totalAgendados, taxaAbordagem,
    deltaCriados, deltaAbordados,
    funnelSpin, temperatureData, abTestData,
    nicheResponseData, spinPassagem,
    geoData, engagementRate,
} = metrics

    return (
        <div style={{ background: '#020617', minHeight: '100vh', padding: '28px 28px 40px', fontFamily: "'DM Sans', system-ui, sans-serif", color: '#fff' }}>

            {/* HEADER */}
            <div style={{ marginBottom: 28 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                            <div style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '0.75rem', padding: '6px', boxShadow: '0 0 16px rgba(59,130,246,0.3)' }}>
                                <Zap size={18} color={NEON.blue} />
                            </div>
                            <h1 style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1 }}>
                                Resultados <span style={{ color: NEON.blue }}>Comerciais</span>
                            </h1>
                        </div>
                        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontWeight: 700, letterSpacing: '0.05em' }}>
                            {leads.length.toLocaleString('pt-BR')} leads · sync {lastSync ? lastSync.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '...'}
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <button
                            onClick={fetchData}
                            disabled={loading}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '999px', padding: '6px 14px', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em' }}
                        >
                            <RefreshCw size={11} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                            Atualizar
                        </button>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '999px', padding: '6px 14px' }}>
                            <div style={{ width: 7, height: 7, borderRadius: '50%', background: NEON.emerald, boxShadow: `0 0 8px ${NEON.emerald}`, animation: 'pulse 2s infinite' }} />
                            <span style={{ fontSize: 10, fontWeight: 900, color: NEON.emerald, textTransform: 'uppercase', letterSpacing: '0.15em' }}>Live</span>
                        </div>
                    </div>
                </div>
                <PeriodSelector value={periodo} onChange={setPeriodo} />
            </div>

            {/* ── KPIs ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
                <KpiCard
                    icon={Users}   label="Leads Capturados"
                    value={totalLeads.toLocaleString('pt-BR')}
                    sub="total na base"
                    delta={deltaCriados}   color={NEON.blue}
                    info="Total de empresas capturadas pelo radar e salvas no banco. Inclui leads em qualquer status — novos, em conversa, inválidos e mortos."
                />
                <KpiCard
                    icon={Zap}     label="Leads Abordados"
                    value={totalAbordados.toLocaleString('pt-BR')}
                    sub="receberam disparo"
                    delta={deltaAbordados} color={NEON.cyan}
                    info="Leads que efetivamente receberam a primeira mensagem do SDR. Exclui leads capturados mas ainda não disparados (status 'new')."
                />
                <KpiCard
                    icon={Target}  label="Agendamentos"
                    value={totalAgendados.toLocaleString('pt-BR')}
                    sub="booked, closed ou stage 4+"
                    delta={null}           color={NEON.emerald}
                    info="Leads que agendaram a validação. Conta quem tem status booked/closed, calendly_booked ativo ou chegou ao estágio 4 do funil (link enviado e aceito)."
                />
                <KpiCard
                    icon={Activity} label="Conversão Total"
                    value={(() => {
                        if (!totalAbordados || totalAbordados <= 0) return '—'
                        const taxa = (totalAgendados / totalAbordados * 100)
                        if (!isFinite(taxa)) return '—'
                        return taxa.toFixed(1).replace('.', ',') + '%'
                    })()}
                    sub="agendamentos ÷ abordados"
                    delta={null} color={NEON.emerald}
                    info="Percentual de leads abordados que chegaram ao agendamento. Mede a eficiência geral do funil: de quem recebeu mensagem, quantos converteram."
                />
                <KpiCard
                    icon={Flame} label="Engajamento Real"
                    value={engagementRate + '%'}
                    sub="responderam após ver"
                    delta={null} color={NEON.rose}
                    info="De todos os leads que leram a mensagem (confirmado pelo visto azul), quantos avançaram além do estágio 0. Mede qualidade da abertura, não quantidade de disparos."
                />
            </div>

            {/* ── ROW 2: Evolução Mensal + Funil ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, marginBottom: 16 }}>

                {/* EVOLUÇÃO MENSAL — criados vs abordados (ambos reais) */}
                <ChartCard>
                    <SectionTitle accent={NEON.blue} info="Capturados = leads salvos pelo radar no mês. Abordados = leads que efetivamente receberam a primeira mensagem. A diferença representa leads em fila de espera ou descartados antes do disparo.">Evolução Mensal — Capturados vs Abordados</SectionTitle>
                    <ResponsiveContainer width="100%" height={230}>
                        <AreaChart data={monthly} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                            <defs>
                                <linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%"  stopColor={NEON.blue} stopOpacity={0.28} />
                                    <stop offset="95%" stopColor={NEON.blue} stopOpacity={0.02} />
                                </linearGradient>
                                <linearGradient id="gCyan" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%"  stopColor={NEON.cyan} stopOpacity={0.35} />
                                    <stop offset="95%" stopColor={NEON.cyan} stopOpacity={0.02} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid stroke={NEON.grid} vertical={false} />
                            <XAxis dataKey="mes" tick={{ fill: NEON.muted, fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: NEON.muted, fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                            <Tooltip content={<NeonTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.06)', strokeWidth: 1 }} />
                            <Area type="monotone" dataKey="criados"   name="Capturados" stroke={NEON.blue} strokeWidth={2} fill="url(#gBlue)" dot={{ r: 3, fill: NEON.blue, stroke: '#020617', strokeWidth: 2 }} />
                            <Area type="monotone" dataKey="abordados" name="Abordados"  stroke={NEON.cyan} strokeWidth={2} fill="url(#gCyan)" dot={{ r: 3, fill: NEON.cyan, stroke: '#020617', strokeWidth: 2 }} />
                        </AreaChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', gap: 20, marginTop: 10, justifyContent: 'flex-end' }}>
                        {[{ c: NEON.blue, l: 'Capturados' }, { c: NEON.cyan, l: 'Abordados' }].map(({ c, l }) => (
                            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: 24, height: 2, borderRadius: 2, background: c, boxShadow: `0 0 6px ${c}` }} />
                                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{l}</span>
                            </div>
                        ))}
                    </div>
                </ChartCard>

                {/* FUNIL — por status real */}
                <ChartCard>
                    <SectionTitle accent={NEON.violet} info="Mostra a progressão dos leads pelo funil comercial. Capturados → Abordados → Em análise (conta de luz recebida) → Agendados. Cada etapa é subconjunto da anterior.">Funil de Status</SectionTitle>
                    <ResponsiveContainer width="100%" height={190}>
                        <BarChart data={funnel} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: -10 }}>
                            <CartesianGrid stroke={NEON.grid} horizontal={false} />
                            <XAxis type="number" tick={{ fill: NEON.muted, fontSize: 9 }} axisLine={false} tickLine={false} />
                            <YAxis type="category" dataKey="etapa" tick={{ fill: NEON.muted, fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} width={80} />
                            <Tooltip content={<NeonTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                            <Bar dataKey="qtd" radius={[0, 6, 6, 0]} name="Leads">
                                {funnel.map((d, i) => <Cell key={i} fill={d.fill} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 7 }}>
                        {funnel.map(d => (
                            <div key={d.etapa} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: d.fill, boxShadow: `0 0 6px ${d.fill}`, flexShrink: 0 }} />
                                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.38)', width: 80 }}>{d.etapa}</span>
                                <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', borderRadius: 2, width: `${funnel[0].qtd > 0 ? Math.round(d.qtd / funnel[0].qtd * 100) : 0}%`, background: d.fill, boxShadow: `0 0 6px ${d.fill}`, transition: 'width 1.2s ease' }} />
                                </div>
                                <span style={{ fontSize: 10, fontWeight: 900, color: '#fff', width: 32, textAlign: 'right' }}>{d.qtd}</span>
                            </div>
                        ))}
                    </div>
                </ChartCard>
            </div>

            {/* ── ROW 3: Disparos por chip + Nichos + Leads por dia ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px 240px', gap: 16 }}>

                {/* DISPAROS POR CHIP — substitui Economia Gerada */}
                <ChartCard>
                    <SectionTitle accent={NEON.amber}>
                        <Cpu size={12} color={NEON.amber} style={{ display: 'inline', marginRight: 6 }} />
                        Disparos por Chip
                    </SectionTitle>
                    {chipData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={chipData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                                <CartesianGrid stroke={NEON.grid} vertical={false} />
                                <XAxis dataKey="chip" tick={{ fill: NEON.muted, fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: NEON.muted, fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                                <Tooltip content={<NeonTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                                <Bar dataKey="disparos" name="Disparos" radius={[6, 6, 0, 0]}>
                                    {chipData.map((d, i) => (
                                        <Cell key={i} fill={d.fill} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 11, fontWeight: 700 }}>
                            Nenhum disparo registrado
                        </div>
                    )}
                    {/* legenda status chip */}
                    <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                        {[{ c: NEON.emerald, l: 'Chip conectado' }, { c: NEON.violet, l: 'Chip desconectado' }].map(({ c, l }) => (
                            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <div style={{ width: 8, height: 8, borderRadius: 2, background: c, boxShadow: `0 0 5px ${c}` }} />
                                <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)' }}>{l}</span>
                            </div>
                        ))}
                    </div>
                </ChartCard>

                {/* NICHOS — donut real */}
                <ChartCard>
                    <SectionTitle accent={NEON.cyan} info="Top 6 nichos por volume de leads capturados. A % é calculada sobre o total de leads válidos. Útil para entender quais setores o radar está priorizando.">
                        <MapPin size={12} color={NEON.cyan} style={{ display: 'inline', marginRight: 6 }} />
                        Nichos
                    </SectionTitle>
                    {nicheData.length > 0 ? (
                        <>
                            <ResponsiveContainer width="100%" height={140}>
                                <PieChart>
                                    <Pie data={nicheData} cx="50%" cy="50%" innerRadius={42} outerRadius={64} paddingAngle={3} dataKey="value" stroke="none">
                                        {nicheData.map((d, i) => (
                                            <Cell key={i} fill={d.fill} style={{ filter: `drop-shadow(0 0 5px ${d.fill}70)` }} />
                                        ))}
                                    </Pie>
                                    <Tooltip content={<NeonTooltip suffix="%" />} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
                                {nicheData.map(d => (
                                    <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <div style={{ width: 6, height: 6, borderRadius: 2, background: d.fill, boxShadow: `0 0 5px ${d.fill}` }} />
                                            <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.42)' }}>{d.name}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontWeight: 700 }}>{d.abs}</span>
                                            <span style={{ fontSize: 10, fontWeight: 900, color: d.fill, minWidth: 28, textAlign: 'right' }}>{d.value}%</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 11, fontWeight: 700 }}>
                            Sem dados de nicho
                        </div>
                    )}
                </ChartCard>

                {/* LEADS POR DIA DA SEMANA — substitui Taxa por Dia, via created_at (nunca null) */}
                <ChartCard>
                    <SectionTitle accent={NEON.rose} info="Quantidade de leads capturados por dia da semana, baseado em created_at. Mostra quais dias o radar está mais ativo. Não é o dia do disparo — é o dia em que o lead entrou na base.">
                        <Flame size={12} color={NEON.rose} style={{ display: 'inline', marginRight: 4 }} />
                        Captura por Dia
                    </SectionTitle>
                    <ResponsiveContainer width="100%" height={165}>
                        <BarChart data={dailyCapture} margin={{ top: 4, right: 0, bottom: 0, left: -28 }}>
                            <CartesianGrid stroke={NEON.grid} vertical={false} />
                            <XAxis dataKey="dia" tick={{ fill: NEON.muted, fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: NEON.muted, fontSize: 9 }} axisLine={false} tickLine={false} />
                            <Tooltip content={<NeonTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                            <Bar dataKey="leads" name="Leads" radius={[4, 4, 0, 0]}>
                                {dailyCapture.map((d, i) => {
                                    const max = Math.max(...dailyCapture.map(x => x.leads))
                                    return <Cell key={i} fill={d.leads === max ? NEON.rose : d.leads >= max * 0.6 ? NEON.violet : NEON.blue} />
                                })}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                    <div style={{ display: 'flex', gap: 10, marginTop: 10, justifyContent: 'center' }}>
                        {[{ c: NEON.rose, l: 'Pico' }, { c: NEON.violet, l: '≥60% pico' }, { c: NEON.blue, l: 'Baixo' }].map(({ c, l }) => (
                            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <div style={{ width: 8, height: 8, borderRadius: 2, background: c, boxShadow: `0 0 5px ${c}` }} />
                                <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)' }}>{l}</span>
                            </div>
                        ))}
                    </div>
                    <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.18)', fontWeight: 700, marginTop: 8, textAlign: 'center', fontStyle: 'italic' }}>
                        via created_at · mostra quando o radar está ativo
                    </p>
                </ChartCard>
            </div>
                  {/* ── ROW 4: RESPOSTA POR NICHO + PASSAGEM SPIN + A/B TESTING ── */}
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 260px', gap: 16, marginTop: 16 }}>

    {/* TAXA DE RESPOSTA POR NICHO */}
    <ChartCard>
        <SectionTitle accent={NEON.cyan} info="% de leads por nicho que avançaram além do estágio 0 (proxy de resposta). Mínimo de 3 leads por nicho para aparecer. Verde ≥30%, amarelo ≥15%, vermelho abaixo disso.">Resposta por nicho</SectionTitle>
        {nicheResponseData && nicheResponseData.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {nicheResponseData.map((d, i) => (
                    <div key={i}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.45)' }}>{d.name}</span>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                                <span style={{ fontSize: 12, fontWeight: 900, color: d.taxa >= 30 ? NEON.emerald : d.taxa >= 15 ? NEON.amber : NEON.rose }}>
                                    {d.taxa}%
                                </span>
                                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontWeight: 700 }}>
                                    {d.responderam}/{d.total}
                                </span>
                            </div>
                        </div>
                        <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                                height: '100%', borderRadius: 2, width: `${d.taxa}%`,
                                background: d.taxa >= 30 ? NEON.emerald : d.taxa >= 15 ? NEON.amber : NEON.rose,
                                transition: 'width 1s ease',
                            }} />
                        </div>
                    </div>
                ))}
            </div>
        ) : (
            <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 11, fontWeight: 700 }}>
                Dados insuficientes (mín. 3 leads/nicho)
            </div>
        )}
        <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.18)', fontWeight: 700, marginTop: 12, textAlign: 'center', fontStyle: 'italic' }}>
            % de leads que responderam por nicho · mín. 3 leads
        </p>
    </ChartCard>

    {/* TAXA DE PASSAGEM ENTRE ESTÁGIOS */}
    <ChartCard>
        <SectionTitle accent={NEON.violet} info="Funil cumulativo: de todos os leads que chegaram ao estágio N, quantos avançaram para N+1. Verde ≥50%, amarelo ≥25%, vermelho abaixo. Pontos com baixa passagem indicam gargalos no pitch.">Passagem entre estágios</SectionTitle>
        {spinPassagem && spinPassagem.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {spinPassagem.map((d, i) => (
                    <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '0.75rem', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.4)' }}>
                                {d.de} → {d.para}
                            </span>
                            <span style={{
                                fontSize: 14, fontWeight: 900,
                                color: d.taxa >= 50 ? NEON.emerald : d.taxa >= 25 ? NEON.amber : NEON.rose,
                            }}>
                                {d.taxa}%
                            </span>
                        </div>
                        <div style={{ height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{
                                height: '100%', borderRadius: 2, width: `${d.taxa}%`,
                                background: d.taxa >= 50 ? NEON.emerald : d.taxa >= 25 ? NEON.amber : NEON.rose,
                                transition: 'width 1s ease',
                            }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'rgba(255,255,255,0.25)', fontWeight: 700, marginTop: 4 }}>
                            <span>{d.passam} passaram</span>
                            <span>{d.saem} perdidos</span>
                        </div>
                    </div>
                ))}
            </div>
        ) : (
            <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 11, fontWeight: 700 }}>
                Sem dados de estágio ainda
            </div>
        )}
    </ChartCard>

    {/* A/B TESTING DE ABERTURAS (mantém igual) */}
    <ChartCard>
        <SectionTitle accent={NEON.emerald} info="Compara as variações de mensagem de abertura. A taxa é a % de leads que avançaram além do estágio 0 após receber cada template. V1/V2/V3 correspondem aos templates cadastrados no Supabase.">A/B Testing — Aberturas</SectionTitle>
        {abTestData.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {abTestData.map((d, i) => (
                    <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '0.75rem', padding: '10px 12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 11, fontWeight: 900, color: '#fff' }}>{d.template}</span>
                            <span style={{ fontSize: 14, fontWeight: 900, color: i === 0 ? NEON.emerald : NEON.muted }}>
                                {d.taxa}%
                            </span>
                        </div>
                        <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                            <div style={{ height: '100%', borderRadius: 2, width: `${d.taxa}%`, background: i === 0 ? NEON.emerald : NEON.blue, transition: 'width 1s ease' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700 }}>
                            <span>{d.enviados} enviados</span>
                            <span>{d.responderam} responderam</span>
                        </div>
                    </div>
                ))}
            </div>
        ) : (
            <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 11, fontWeight: 700, textAlign: 'center' }}>
                Dados de A/B aparecerão<br/>após os primeiros disparos
            </div>
        )}
    </ChartCard>
</div>




            <style>{`
                @keyframes pulse   { 0%,100%{opacity:1}  50%{opacity:.4} }
                @keyframes spin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
                @keyframes shimmer { 0%,100%{opacity:.4} 50%{opacity:.8} }
            `}
            </style>
        </div>
    )
}
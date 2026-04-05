import React, { useState, useEffect, useMemo } from 'react'
import {
    AreaChart, Area, BarChart, Bar,
    PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { createClient } from '@supabase/supabase-js'
import {
    TrendingUp, TrendingDown, Zap, Users, Target,
    Activity, Flame, RefreshCw, Cpu, MapPin,
} from 'lucide-react'


// FORMA CORRETA - ALTA PERFORMANCE
const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL, 
    import.meta.env.VITE_SUPABASE_ANON_KEY
)

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
function computeMetrics(leads, instances) {
    if (!leads?.length) return null

    const now    = new Date()
    const cutoff = new Date(now)
    cutoff.setMonth(cutoff.getMonth() - 5)
    cutoff.setDate(1)
    cutoff.setHours(0, 0, 0, 0)

    // ── 1. Evolução mensal: criados vs abordados ──────────────────────────────
    // "criados"  = created_at dentro do período
    // "abordados"= last_contact_at not null dentro do período
    const monthBuckets = {}
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now)
        d.setMonth(d.getMonth() - i)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        monthBuckets[key] = { mes: MES_LABEL[d.getMonth()], criados: 0, abordados: 0 }
    }

    leads.forEach(lead => {
        // bucket de criação
        const created = new Date(lead.created_at)
        if (created >= cutoff) {
            const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`
            if (monthBuckets[key]) monthBuckets[key].criados++
        }
        // bucket de abordagem (só quem foi de fato contactado)
        if (lead.last_contact_at) {
            const contacted = new Date(lead.last_contact_at)
            if (contacted >= cutoff) {
                const key = `${contacted.getFullYear()}-${String(contacted.getMonth() + 1).padStart(2, '0')}`
                if (monthBuckets[key]) monthBuckets[key].abordados++
            }
        }
    })
    const monthly = Object.values(monthBuckets)

    // ── 2. Funil por status (exato, sem estimativa) ───────────────────────────
    const sc = { new: 0, contact: 0, waiting_analysis: 0, closed: 0, error: 0, invalid: 0, blacklisted: 0 }
    leads.forEach(l => { if (sc[l.status] !== undefined) sc[l.status]++ })

    const funnel = [
        { etapa: 'Capturados',  qtd: leads.length,                                         fill: NEON.blue },
        { etapa: 'Abordados',   qtd: sc.contact + sc.waiting_analysis + sc.closed,         fill: NEON.cyan },
        { etapa: 'Em análise',  qtd: sc.waiting_analysis + sc.closed,                      fill: NEON.violet },
        { etapa: 'Agendados',   qtd: sc.closed,                                            fill: NEON.emerald },
    ]

    // ── 3. Nichos (top 6) ─────────────────────────────────────────────────────
    const nicheCount = {}
    leads.forEach(l => {
        if (!l.niche) return
        const n = String(l.niche).trim()
        nicheCount[n] = (nicheCount[n] || 0) + 1
    })
    const nicheData = Object.entries(nicheCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count], i) => ({
            name: name.length > 14 ? name.slice(0, 14) + '…' : name,
            value: Math.round(count / leads.length * 100),
            abs: count,
            fill: NICHE_COLORS[i % NICHE_COLORS.length],
        }))

    // ── 4. Disparos por chip (instance_id) ────────────────────────────────────
    // Conta leads com last_contact_at not null agrupados por instance_id
    const chipCount = {}
    leads.forEach(l => {
        if (!l.last_contact_at || !l.instance_id) return
        chipCount[l.instance_id] = (chipCount[l.instance_id] || 0) + 1
    })
    // Resolve o nome do chip pelo array de instâncias (vindo do banco)
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

    // ── 5. Leads capturados por dia da semana (via created_at — sempre real) ──
    const diaCriados = [0, 0, 0, 0, 0, 0, 0]
    leads.forEach(l => {
        if (!l.created_at) return
        diaCriados[new Date(l.created_at).getDay()]++
    })
    const dailyCapture = DIA_LABEL.map((dia, i) => ({ dia, leads: diaCriados[i] }))

    // ── KPIs ──────────────────────────────────────────────────────────────────
    const totalLeads     = leads.length
    const totalAbordados = leads.filter(l => l.last_contact_at).length
    const totalAgendados = sc.closed
    const taxaAbordagem  = totalLeads > 0 ? Math.round(totalAbordados / totalLeads * 100) : 0

    // Delta: último mês vs penúltimo
    const last2 = monthly.slice(-2)
    const deltaCriados   = last2.length === 2 && last2[0].criados   > 0 ? Math.round((last2[1].criados   - last2[0].criados)   / last2[0].criados   * 100) : 0
    const deltaAbordados = last2.length === 2 && last2[0].abordados > 0 ? Math.round((last2[1].abordados - last2[0].abordados) / last2[0].abordados * 100) : 0
    // ── 6. Funil SPIN por estágio (0-5) ───────────────────────────────────────
    const estagioLabels = ['Qualificação', 'Situação', 'Dor/Implicação', 'Solução', 'Agendamento', 'Fechamento']
    const estagioColors = ['#64748b', '#3B82F6', '#06B6D4', '#8B5CF6', '#F59E0B', '#10B981']
    const estagioCount = [0, 0, 0, 0, 0, 0]
    leads.forEach(l => {
        const stage = l.current_stage || 0
        if (stage >= 0 && stage <= 5) estagioCount[stage]++
    })
    const funnelSpin = estagioLabels.map((label, i) => ({
        etapa: label,
        qtd: estagioCount[i],
        fill: estagioColors[i],
    }))

    // ── 7. Distribuição de temperatura ────────────────────────────────────────
    const tempCount = { cold: 0, warm: 0, hot: 0, dead: 0 }
    leads.forEach(l => {
        const t = l.lead_temperature || 'cold'
        if (tempCount[t] !== undefined) tempCount[t]++
    })
    const temperatureData = [
        { name: 'Cold ❄️',  value: tempCount.cold, fill: '#3B82F6' },
        { name: 'Warm 🟡',  value: tempCount.warm, fill: '#F59E0B' },
        { name: 'Hot 🔥',   value: tempCount.hot,  fill: '#EF4444' },
        { name: 'Dead 💀',  value: tempCount.dead, fill: '#64748b' },
    ].filter(d => d.value > 0)

    // ── 8. A/B Testing de aberturas ───────────────────────────────────────────
    const templateStats = {}
    leads.forEach(l => {
        if (!l.opening_template) return
        if (!templateStats[l.opening_template]) {
            templateStats[l.opening_template] = { enviados: 0, responderam: 0 }
        }
        templateStats[l.opening_template].enviados++
        // Se tem current_stage > 0, significa que respondeu e avançou
        if ((l.current_stage || 0) > 0) {
            templateStats[l.opening_template].responderam++
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
    // ── 9. Taxa de resposta por nicho ─────────────────────────────────────
    const nicheResponse = {}
    leads.forEach(l => {
        if (!l.niche) return
        const n = String(l.niche).trim()
        if (!nicheResponse[n]) nicheResponse[n] = { total: 0, responderam: 0 }
        nicheResponse[n].total++
        if ((l.current_stage || 0) > 0) nicheResponse[n].responderam++
    })
    const nicheResponseData = Object.entries(nicheResponse)
        .filter(([_, v]) => v.total >= 3) // só nichos com amostra mínima
        .map(([name, stats]) => ({
            name: name.length > 16 ? name.slice(0, 16) + '…' : name,
            taxa: Math.round(stats.responderam / stats.total * 100),
            total: stats.total,
            responderam: stats.responderam,
        }))
        .sort((a, b) => b.taxa - a.taxa)
        .slice(0, 8)

    // ── 10. Taxa de passagem entre estágios SPIN ──────────────────────────
    const spinPassagem = []
    for (let i = 0; i < 5; i++) {
        const atual = estagioCount[i]
        const proximo = estagioCount[i + 1]
        const taxa = atual > 0 ? Math.round(proximo / atual * 100) : 0
        spinPassagem.push({
            de: estagioLabels[i],
            para: estagioLabels[i + 1],
            taxa,
            saem: atual - proximo,
            passam: proximo,
        })
    }

    return {
        monthly, funnel, nicheData, chipData, dailyCapture,
        totalLeads, totalAbordados, totalAgendados, taxaAbordagem,
        deltaCriados, deltaAbordados,
        statusCounts: sc,
        funnelSpin, temperatureData, abTestData,
        nicheResponseData, spinPassagem,
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

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, delta, color }) {
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
            <p style={{ fontSize: 11, fontWeight: 900, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: 4 }}>{label}</p>
            <p style={{ fontSize: 28, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 4 }}>{value}</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', fontWeight: 700 }}>{sub}</p>
        </div>
    )
}

const SectionTitle = ({ children, accent = NEON.blue }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <div style={{ width: 3, height: 18, borderRadius: 2, background: accent, boxShadow: `0 0 8px ${accent}` }} />
        <span style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.25em', color: 'rgba(255,255,255,0.45)' }}>{children}</span>
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

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function VisualAnalytics() {
    const [leads,     setLeads]     = useState([])
    const [instances, setInstances] = useState([])
    const [loading,   setLoading]   = useState(true)
    const [lastSync,  setLastSync]  = useState(null)

    const fetchData = async () => {
        setLoading(true)
        try {
            // Busca leads e instâncias em paralelo
            const [leadsRes, instRes] = await Promise.all([
                supabase
                    .from('leads')
                    .select('id, status, niche, created_at, last_contact_at, instance_id, capital_social_numeric, current_stage, lead_temperature, opening_template')
                    .order('created_at', { ascending: false }),
                supabase
                    .from('instances')
                    .select('id, name, whatsapp_status'),
            ])
            if (!leadsRes.error && leadsRes.data)     setLeads(leadsRes.data)
            if (!instRes.error  && instRes.data)      setInstances(instRes.data)
            setLastSync(new Date())
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
        const id = setInterval(fetchData, 60_000)
        return () => clearInterval(id)
    }, [])

    const metrics = useMemo(() => computeMetrics(leads, instances), [leads, instances])

    // ── LOADING ───────────────────────────────────────────────────────────────
    if (loading && !metrics) {
        return (
            <div style={{ background: '#020617', minHeight: '100vh', padding: '28px', fontFamily: "'DM Sans', system-ui, sans-serif" }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
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
} = metrics

    return (
        <div style={{ background: '#020617', minHeight: '100vh', padding: '28px 28px 40px', fontFamily: "'DM Sans', system-ui, sans-serif", color: '#fff' }}>

            {/* HEADER */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
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
                <div style={{ display: 'flex', gap: 10 }}>
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

            {/* ── KPIs ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
                <KpiCard
                    icon={Users}   label="Leads Capturados"
                    value={totalLeads.toLocaleString('pt-BR')}
                    sub="total na base"
                    delta={deltaCriados}   color={NEON.blue}
                />
                <KpiCard
                    icon={Zap}     label="Leads Abordados"
                    value={totalAbordados.toLocaleString('pt-BR')}
                    sub="receberam disparo"
                    delta={deltaAbordados} color={NEON.cyan}
                />
                <KpiCard
                    icon={Target}  label="Agendamentos"
                    value={totalAgendados.toLocaleString('pt-BR')}
                    sub="status closed no CRM"
                    delta={null}           color={NEON.emerald}
                />
                <KpiCard
    icon={Activity} label="Conversão Total"
    value={(totalLeads > 0 ? Math.round(totalAgendados / totalLeads * 100) : 0) + '%'}
    sub="agendados / capturados"
    delta={null} color={NEON.emerald}
                   />
            </div>

            {/* ── ROW 2: Evolução Mensal + Funil ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, marginBottom: 16 }}>

                {/* EVOLUÇÃO MENSAL — criados vs abordados (ambos reais) */}
                <ChartCard>
                    <SectionTitle accent={NEON.blue}>Evolução Mensal — Capturados vs Abordados</SectionTitle>
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
                    <SectionTitle accent={NEON.violet}>Funil de Status</SectionTitle>
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
                    <SectionTitle accent={NEON.cyan}>
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
                    <SectionTitle accent={NEON.rose}>
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
        <SectionTitle accent={NEON.cyan}>Resposta por nicho</SectionTitle>
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
        <SectionTitle accent={NEON.violet}>Passagem entre estágios</SectionTitle>
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
        <SectionTitle accent={NEON.emerald}>A/B Testing — Aberturas</SectionTitle>
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
            `}</style>
        </div>
    )
}
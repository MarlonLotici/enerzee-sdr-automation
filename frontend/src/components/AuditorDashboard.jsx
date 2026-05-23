import React, { useState, useEffect, useMemo } from 'react'
import {
    BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { RefreshCw, Star, AlertTriangle, CheckCircle, XCircle, TrendingUp, FileText } from 'lucide-react'

const CORES = {
    verde:    '#10B981',
    amarelo:  '#F59E0B',
    vermelho: '#F43F5E',
    azul:     '#06B6D4',
    roxo:     '#8B5CF6',
    cinza:    '#64748B',
}

const DESFECHO_COR = {
    AGENDADO:        CORES.verde,
    PERDIDO_SOLAR:   CORES.azul,
    PERDIDO_CARO:    CORES.amarelo,
    PERDIDO_SILENCIO:CORES.cinza,
    PERDIDO_ROBO:    CORES.roxo,
    PERDIDO_OUTRO:   CORES.vermelho,
}

const DESFECHO_LABEL = {
    AGENDADO:        'Agendado ✅',
    PERDIDO_SOLAR:   'Já tem solar',
    PERDIDO_CARO:    'Conta baixa',
    PERDIDO_SILENCIO:'Sem resposta',
    PERDIDO_ROBO:    'Robô/URA',
    PERDIDO_OUTRO:   'Outros',
}

function KpiCard({ icon: Icon, label, value, sub, color }) {
    return (
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5 flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <Icon size={14} style={{ color }} />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</span>
            </div>
            <div className="text-3xl font-black tracking-tighter" style={{ color }}>{value}</div>
            {sub && <div className="text-[10px] text-slate-600">{sub}</div>}
        </div>
    )
}

function NotaBadge({ nota }) {
    const n = parseFloat(nota) || 0
    const cor = n >= 7 ? CORES.verde : n >= 5 ? CORES.amarelo : CORES.vermelho
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black"
              style={{ background: `${cor}20`, color: cor, border: `1px solid ${cor}40` }}>
            <Star size={9} /> {n.toFixed(1)}
        </span>
    )
}

export default function AuditorDashboard({ socket }) {
    const [leads, setLeads]       = useState([])
    const [loading, setLoading]   = useState(true)
    const [lastSync, setLastSync] = useState(null)
    const [filtroNota, setFiltroNota] = useState('todos') // 'todos' | 'baixa' | 'alta'

    const fetchData = async () => {
        setLoading(true)
        try {
            const { data: { session: s } } = await supabase.auth.getSession()
            const uid = s?.user?.id
            if (!uid) { setLoading(false); return }

            const { data: instData } = await supabase.from('instances').select('id').or(`user_id.eq.${uid},user_id.is.null`)
            const instIds = instData?.map(i => i.id) || []
            if (!instIds.length) { setLoading(false); return }

            const { data } = await supabase
                .from('leads')
                .select('id, name, niche, created_at, audit_report, current_stage')
                .eq('is_audited', true)
                .not('audit_report', 'is', null)
                .in('instance_id', instIds)
                .order('created_at', { ascending: false })
                .limit(1000)

            if (data) {
                const parsed = data.map(l => {
                    let report = l.audit_report
                    // audit_report pode vir como string JSON, objeto JSONB, ou string simples
                    if (typeof report === 'string') {
                        if (report.startsWith('{')) {
                            try { report = JSON.parse(report) } catch { report = null }
                        } else {
                            report = null // string simples como "Sem interação suficiente."
                        }
                    }
                    return { ...l, report }
                }).filter(l => l.report && typeof l.report === 'object' && l.report.desfecho)

                setLeads(parsed)
                setLastSync(new Date())
            }
        } catch (e) {
            console.error('Erro ao carregar auditoria:', e)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
        const interval = setInterval(fetchData, 120000)
        return () => clearInterval(interval)
    }, [])

    useEffect(() => {
        if (!socket) return
        socket.on('audit_complete', fetchData)
        return () => socket.off('audit_complete', fetchData)
    }, [socket])

    const metrics = useMemo(() => {
        if (!leads.length) return null

        const total = leads.length
        const agendados = leads.filter(l => l.report.desfecho === 'AGENDADO').length
        const notas = leads.map(l => parseFloat(l.report.nota_ia) || 0).filter(n => n > 0)
        const notaMedia = notas.length ? (notas.reduce((a, b) => a + b, 0) / notas.length) : 0
        const comErro = leads.filter(l => l.report.erro_critico_ia && l.report.erro_critico_ia !== 'null' && l.report.erro_critico_ia !== null).length

        // Distribuição de desfechos
        const desfechoCont = {}
        leads.forEach(l => {
            const d = l.report.desfecho || 'PERDIDO_OUTRO'
            desfechoCont[d] = (desfechoCont[d] || 0) + 1
        })
        const distribuicao = Object.entries(desfechoCont)
            .map(([key, val]) => ({
                name: DESFECHO_LABEL[key] || key,
                value: val,
                pct: Math.round(val / total * 100),
                fill: DESFECHO_COR[key] || CORES.cinza,
            }))
            .sort((a, b) => b.value - a.value)

        // Notas por faixa
        const faixas = { alta: 0, media: 0, baixa: 0 }
        notas.forEach(n => {
            if (n >= 7) faixas.alta++
            else if (n >= 5) faixas.media++
            else faixas.baixa++
        })
        const notasDist = [
            { name: '7-10 Ótima', value: faixas.alta,  fill: CORES.verde },
            { name: '5-6 Ok',     value: faixas.media, fill: CORES.amarelo },
            { name: '0-4 Ruim',   value: faixas.baixa, fill: CORES.vermelho },
        ].filter(d => d.value > 0)

        // Erros mais frequentes
        const erroCont = {}
        leads.forEach(l => {
            const e = l.report.erro_critico_ia
            if (e && e !== 'null' && e !== null && e.trim().length > 5) {
                // Agrupa por palavras-chave para não ter 100 erros únicos
                const chave = e.substring(0, 60)
                erroCont[chave] = (erroCont[chave] || 0) + 1
            }
        })
        const errosTop = Object.entries(erroCont)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([texto, count]) => ({ texto, count }))

        // Leads com nota baixa para revisão
        const pararevisao = leads
            .filter(l => (parseFloat(l.report.nota_ia) || 0) < 5 && l.report.erro_critico_ia)
            .slice(0, 10)

        return { total, agendados, notaMedia, comErro, distribuicao, notasDist, errosTop, pararevisao }
    }, [leads])

    const leadsFiltrados = useMemo(() => {
        if (filtroNota === 'baixa') return leads.filter(l => (parseFloat(l.report?.nota_ia) || 0) < 5)
        if (filtroNota === 'alta')  return leads.filter(l => (parseFloat(l.report?.nota_ia) || 0) >= 7)
        return leads
    }, [leads, filtroNota])

    if (loading) return (
        <div className="flex items-center justify-center h-64 text-slate-500 text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> Carregando auditorias...
        </div>
    )

    if (!metrics) return (
        <div className="flex items-center justify-center h-64 text-slate-600 text-sm">
            Nenhuma auditoria disponível ainda. O loop roda a cada 2 horas.
        </div>
    )

    return (
        <div className="p-6 space-y-6 text-white">

            {/* HEADER */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-base font-black tracking-tighter text-white">QA · Auditor de IA</h2>
                    <p className="text-[10px] text-slate-500 mt-0.5">{metrics.total} conversas analisadas · sync {lastSync?.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <button onClick={fetchData} className="p-2 rounded-xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.06] transition-all">
                    <RefreshCw size={13} className="text-slate-400" />
                </button>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard icon={FileText}     label="Auditados"     value={metrics.total}                         sub="conversas analisadas"           color={CORES.azul}     />
                <KpiCard icon={CheckCircle}  label="Agendados"     value={metrics.agendados}                     sub={`${Math.round(metrics.agendados/metrics.total*100)}% do total auditado`} color={CORES.verde} />
                <KpiCard icon={Star}         label="Nota Média IA" value={metrics.notaMedia.toFixed(1)}          sub="0-10 (comportamento da IA)"      color={metrics.notaMedia >= 7 ? CORES.verde : metrics.notaMedia >= 5 ? CORES.amarelo : CORES.vermelho} />
                <KpiCard icon={AlertTriangle} label="Com Erro IA"  value={metrics.comErro}                       sub={`${Math.round(metrics.comErro/metrics.total*100)}% tiveram falha detectada`} color={CORES.vermelho} />
            </div>

            {/* GRÁFICOS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Distribuição de desfechos */}
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">Desfechos das conversas</h3>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={metrics.distribuicao} layout="vertical" margin={{ left: 8, right: 32 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                            <XAxis type="number" tick={{ fill: 'rgba(255,255,255,0.3)', fontSize: 10 }} />
                            <YAxis dataKey="name" type="category" width={110} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
                            <Tooltip
                                contentStyle={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                                formatter={(v, _, p) => [`${v} (${p.payload.pct}%)`, 'Qtd']}
                            />
                            <Bar dataKey="value" radius={4}>
                                {metrics.distribuicao.map((d, i) => <Cell key={i} fill={d.fill} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Distribuição de notas */}
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">Qualidade das respostas da IA</h3>
                    <ResponsiveContainer width="100%" height={160}>
                        <PieChart>
                            <Pie data={metrics.notasDist} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, pct, value }) => `${value}`} labelLine={false}>
                                {metrics.notasDist.map((d, i) => <Cell key={i} fill={d.fill} />)}
                            </Pie>
                            <Tooltip contentStyle={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-4 mt-2">
                        {metrics.notasDist.map(d => (
                            <span key={d.name} className="flex items-center gap-1 text-[10px] text-slate-400">
                                <span className="w-2 h-2 rounded-full" style={{ background: d.fill }} />
                                {d.name}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* ERROS CRÍTICOS MAIS FREQUENTES */}
            {metrics.errosTop.length > 0 && (
                <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-4">Erros críticos mais frequentes</h3>
                    <div className="space-y-2">
                        {metrics.errosTop.map((e, i) => (
                            <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-red-950/20 border border-red-900/20">
                                <span className="shrink-0 w-5 h-5 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center text-[10px] font-black">{e.count}x</span>
                                <span className="text-[11px] text-slate-300 leading-relaxed">{e.texto}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* LISTA DE CONVERSAS */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Conversas auditadas</h3>
                    <div className="flex gap-2">
                        {[
                            { key: 'todos', label: 'Todas' },
                            { key: 'baixa', label: '⚠️ Nota < 5' },
                            { key: 'alta',  label: '✅ Nota ≥ 7' },
                        ].map(f => (
                            <button key={f.key} onClick={() => setFiltroNota(f.key)}
                                className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                                    filtroNota === f.key
                                        ? 'bg-amber-600 text-black'
                                        : 'bg-white/[0.03] text-slate-500 border border-white/5 hover:border-amber-500/20'
                                }`}>
                                {f.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                    {leadsFiltrados.slice(0, 50).map(l => (
                        <div key={l.id} className="flex items-start gap-3 p-3 rounded-xl border border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.03] transition-all">
                            <div className="shrink-0 pt-0.5">
                                {l.report.desfecho === 'AGENDADO'
                                    ? <CheckCircle size={14} color={CORES.verde} />
                                    : <XCircle size={14} color={CORES.vermelho} />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[11px] font-black text-white">{l.name}</span>
                                    <NotaBadge nota={l.report.nota_ia} />
                                    <span className="text-[10px] px-2 py-0.5 rounded-full"
                                          style={{ background: `${DESFECHO_COR[l.report.desfecho] || CORES.cinza}20`, color: DESFECHO_COR[l.report.desfecho] || CORES.cinza }}>
                                        {DESFECHO_LABEL[l.report.desfecho] || l.report.desfecho}
                                    </span>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-1 truncate">{l.report.resumo_executivo}</p>
                                {l.report.erro_critico_ia && l.report.erro_critico_ia !== 'null' && (
                                    <p className="text-[10px] text-red-400 mt-0.5 truncate">⚠️ {l.report.erro_critico_ia}</p>
                                )}
                            </div>
                            {l.niche && <span className="shrink-0 text-[9px] text-slate-600 hidden lg:block">{l.niche}</span>}
                        </div>
                    ))}
                    {leadsFiltrados.length === 0 && (
                        <div className="text-center text-slate-600 text-sm py-8">Nenhuma conversa nesta faixa.</div>
                    )}
                </div>
            </div>
        </div>
    )
}

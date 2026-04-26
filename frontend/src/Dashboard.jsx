import React, { useState, useEffect, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
    AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import {
    TrendingUp, Users, Calendar, Bot, PhoneOff, Zap, Flame,
    Clock, Target, ChevronUp, ChevronDown, RefreshCw,
    Wifi, WifiOff, PauseCircle, CheckCircle2, XCircle,
    BarChart2, Activity, AlertTriangle
} from 'lucide-react'

// FORMA CORRETA - ALTA PERFORMANCE
const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL, 
    import.meta.env.VITE_SUPABASE_ANON_KEY
)

// ============================================================
// PALETA DE CORES
// ============================================================
const CORES = {
    azul:     '#F59E0B',
    verde:    '#10b981',
    amarelo:  '#f59e0b',
    vermelho: '#ef4444',
    roxo:     '#8b5cf6',
    ciano:    '#06b6d4',
    slate:    '#64748b',
}

const CORES_FUNIL = [CORES.slate, CORES.azul, CORES.ciano, CORES.amarelo, CORES.verde]

// ============================================================
// TOOLTIP CUSTOMIZADO
// ============================================================
function TooltipCustom({ active, payload, label }) {
    if (!active || !payload?.length) return null
    return (
        <div className="glass-panel px-4 py-3 rounded-2xl border border-white/10 shadow-2xl text-xs">
            <p className="text-blue-300 font-black uppercase tracking-widest mb-2">{label}</p>
            {payload.map((p, i) => (
                <p key={i} className="font-bold" style={{ color: p.color }}>
                    {p.name}: <span className="text-white">{p.value}</span>
                </p>
            ))}
        </div>
    )
}

// ============================================================
// KPI CARD
// ============================================================
function KpiCard({ icon: Icon, label, value, sub, color, trend }) {
    const trendPositivo = trend > 0
    return (
        <div className="glass-card rounded-3xl p-5 flex flex-col gap-3 border border-white/5 hover:border-blue-500/30 transition-all">
            <div className="flex justify-between items-start">
                <div className={`p-2.5 rounded-2xl`} style={{ background: `${color}20`, border: `1px solid ${color}30` }}>
                    <Icon className="h-5 w-5" style={{ color }} />
                </div>
                {trend !== undefined && (
                    <div className={`flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full ${trendPositivo ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                        {trendPositivo ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {Math.abs(trend)}%
                    </div>
                )}
            </div>
            <div>
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em] mb-1">{label}</p>
                <p className="text-3xl font-black text-white leading-none italic tracking-tighter">{value}</p>
                {sub && <p className="text-[10px] text-slate-500 font-bold mt-1">{sub}</p>}
            </div>
        </div>
    )
}

// ============================================================
// CHIP STATUS CARD
// ============================================================
function ChipCard({ chip, disparosHoje, limite }) {
    const pct = Math.min(Math.round((disparosHoje / limite) * 100), 100)
    const conectado = chip.whatsapp_status === 'CONNECTED'
    return (
        <div className="glass-card rounded-2xl p-4 border border-white/5 space-y-3">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${conectado ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-red-400'}`} />
                    <span className="text-[11px] font-black text-white uppercase tracking-wider truncate max-w-[140px]">{chip.name}</span>
                </div>
                <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                    style={{ background: conectado ? '#10b98120' : '#ef444420', color: conectado ? '#10b981' : '#ef4444' }}>
                    {conectado ? 'Online' : 'Offline'}
                </span>
            </div>
            <div>
                <div className="flex justify-between text-[9px] font-black text-slate-500 uppercase mb-1.5">
                    <span>Disparos hoje</span>
                    <span style={{ color: pct >= 90 ? CORES.vermelho : pct >= 70 ? CORES.amarelo : CORES.verde }}>
                        {disparosHoje}/{limite}
                    </span>
                </div>
                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                    <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                            width: `${pct}%`,
                            background: pct >= 90 ? CORES.vermelho : pct >= 70 ? CORES.amarelo : CORES.azul,
                            boxShadow: `0 0 8px ${pct >= 90 ? CORES.vermelho : CORES.azul}`
                        }}
                    />
                </div>
            </div>
        </div>
    )
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================
export default function Dashboard() {
    const [dados, setDados] = useState(null)
    const [carregando, setCarregando] = useState(true)
    const [ultimaAtualizacao, setUltimaAtualizacao] = useState(null)
    const [periodoGrafico, setPeriodoGrafico] = useState('7d') // '7d' | '30d'

const carregarDados = useCallback(async () => {
        setCarregando(true)
        try {
            // === BUSCA PARALELA DE DADOS ===
            // 🛡️ FIX: limit explícito de 50000 para mensagens (default Supabase é 1000)
            // E filtra mensagens dos últimos 30 dias pra não puxar histórico antigo inútil
            const trintaDiasAtras = new Date(Date.now() - 30 * 86400000).toISOString()
            
            const [
                { data: leads },
                { data: mensagens },
                { data: instancias },
            ] = await Promise.all([
                supabase
                    .from('leads')
                    .select('id, status, created_at, instance_id, is_paused, manual_pause, last_contact_at, current_stage, lead_temperature, followup_count, calendly_booked, whatsapp_id')
                    .limit(50000),
                supabase
                    .from('messages')
                    .select('role, content, created_at, whatsapp_id')
                    .gte('created_at', trintaDiasAtras)  // 🛡️ Só mensagens dos últimos 30 dias
                    .limit(50000),                        // 🛡️ Limite explícito alto
                supabase.from('instances').select('id, name, whatsapp_status'),
            ])

            const agora = new Date()
            const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())
            const diasAtras = (n) => new Date(hoje.getTime() - n * 86400000)

            // 🎯 MAPA DE LEAD: lead.id → lead.whatsapp_id (pra cruzar com mensagens corretamente)
            const mapaLeadJid = {}
            leads?.forEach(l => { 
                if (l.whatsapp_id) mapaLeadJid[l.id] = l.whatsapp_id 
            })

            // === AGENDAMENTOS REAIS — Regra blindada ===
            // 🎯 BÔNUS: detecta agendamentos verbais procurando padrões na última mensagem da IA
            // Ex: "amanhã às 14h", "quinta às 10h", "pode ser segunda às 15h"
            const padroesAgendamentoVerbal = /(amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|hoje)\s*(?:às|as|de)?\s*\d{1,2}\s*(?:h|:|hr|horas)/i
            
            const ultimaMsgAssistantPorLead = {}
            mensagens?.forEach(m => {
                if (m.role !== 'assistant') return
                if (!ultimaMsgAssistantPorLead[m.whatsapp_id] || 
                    new Date(m.created_at) > new Date(ultimaMsgAssistantPorLead[m.whatsapp_id].created_at)) {
                    ultimaMsgAssistantPorLead[m.whatsapp_id] = m
                }
            })

            const agendamentosReais = leads?.filter(l => {
                // Regra 1: status booked
                if (l.status === 'booked') return true
                // Regra 2: Calendly confirmou
                if (l.calendly_booked === true) return true
                // Regra 3: chegou no estágio 4 ou 5 do funil
                if ((l.current_stage || 0) >= 4) return true
                // Regra 4 (BÔNUS): última mensagem da IA pro lead menciona dia/horário
                const ultimaMsg = ultimaMsgAssistantPorLead[l.whatsapp_id]
                if (ultimaMsg && padroesAgendamentoVerbal.test(ultimaMsg.content || '')) return true
                
                return false
            }) || []
            const agendados = agendamentosReais.length

            // === KPIs PRINCIPAIS ===
            const totalDisparados  = leads?.filter(l => l.status !== 'new').length || 0
            const emAtendimento    = leads?.filter(l => l.status === 'contact').length || 0
            const aguardandoHumano = leads?.filter(l => l.is_paused && !l.manual_pause).length || 0
            const pausadoManual    = leads?.filter(l => l.manual_pause).length || 0

            // 🛡️ Mensagens REAIS do cliente (exclui autoresposta)
            const mensagensDoCliente = mensagens?.filter(m => 
                m.role === 'user' && !m.content?.startsWith('[AUTORESPOSTA]')
            ) || []
            
            // Leads únicos que responderam (não conta mensagens totais)
            const leadsQueResponderam = new Set(mensagensDoCliente.map(m => m.whatsapp_id)).size
            const taxaResposta = totalDisparados > 0 
                ? Math.round((leadsQueResponderam / totalDisparados) * 100) 
                : 0

            // === FUNIL DE CONVERSÃO (corrigido) ===
            const funil = [
                { nome: 'Disparados',     valor: totalDisparados,                                                       cor: CORES.slate    },
                { nome: 'Responderam',    valor: leadsQueResponderam,                                                   cor: CORES.azul     },
                { nome: 'Em Conversa',    valor: emAtendimento,                                                         cor: CORES.ciano    },
                { nome: 'Fatura Enviada', valor: leads?.filter(l => l.status === 'waiting_analysis').length || 0,       cor: CORES.amarelo  },
                { nome: 'Agendados',      valor: agendados,                                                             cor: CORES.verde    },
            ]

            // === ROBÔS E KNOCK-OUTS ===
            const totalRobos     = mensagens?.filter(m => m.content?.startsWith('[AUTORESPOSTA]')).length || 0
            const leadsRobo      = new Set(mensagens?.filter(m => m.content?.startsWith('[AUTORESPOSTA]')).map(m => m.whatsapp_id)).size
            const leadsInvalidos = leads?.filter(l => l.status === 'invalid' || l.status === 'blacklisted').length || 0

            // === DISPAROS POR DIA — corrigido pra contar leads únicos por dia ===
            const diasPeriodo = periodoGrafico === '7d' ? 7 : 30
            const disparosPorDia = Array.from({ length: diasPeriodo }, (_, i) => {
                const dia = diasAtras(diasPeriodo - 1 - i)
                const fimDia = new Date(dia.getTime() + 86400000)
                const diaStr = dia.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                
                // Disparos: leads contactados nesse dia
                const count = leads?.filter(l => {
                    if (l.status === 'new' || !l.last_contact_at) return false
                    const d = new Date(l.last_contact_at)
                    return d >= dia && d < fimDia
                }).length || 0
                
                // 🛡️ Respostas: LEADS ÚNICOS que mandaram mensagem nesse dia (não contagem de mensagens)
                const jidsQueResponderamHoje = new Set(
                    mensagensDoCliente
                        .filter(m => {
                            const d = new Date(m.created_at)
                            return d >= dia && d < fimDia
                        })
                        .map(m => m.whatsapp_id)
                )
                const respostas = jidsQueResponderamHoje.size
                
                return { dia: diaStr, Disparos: count, Respostas: respostas }
            })

            // === RESPOSTAS POR HORA DO DIA ===
            const respostasPorHora = Array.from({ length: 24 }, (_, h) => {
                const count = mensagensDoCliente.filter(m => new Date(m.created_at).getHours() === h).length
                return { hora: `${h}h`, Respostas: count }
            })

            // === DISTRIBUIÇÃO POR STATUS ===
            const statusDist = [
                { nome: 'Em Atendimento',  valor: emAtendimento,                                                         cor: CORES.azul    },
                { nome: 'Agendados',       valor: agendados,                                                             cor: CORES.verde   },
                { nome: 'Fatura',          valor: leads?.filter(l => l.status === 'waiting_analysis').length || 0,       cor: CORES.amarelo },
                { nome: 'Robô/Inválido',   valor: leadsRobo + leadsInvalidos,                                            cor: CORES.vermelho},
                { nome: 'Pausa Manual',    valor: pausadoManual,                                                          cor: CORES.roxo    },
            ].filter(s => s.valor > 0)

            // === SAÚDE DOS CHIPS ===
            const CONFIG_LIMITE = {
                "2ff1fd4d-c3a4-4b2f-977b-8472eb9c80f1": 55,
                "74905749-7b50-4b13-92e8-b12663c1d67d": 55,
            }
            const chipsSaude = (instancias || []).map(inst => {
                const disparosHoje = leads?.filter(l => {
                    if (l.instance_id !== inst.id) return false
                    if (!l.last_contact_at) return false
                    const d = new Date(l.last_contact_at)
                    return d >= hoje
                }).length || 0
                return {
                    chip: inst,
                    disparosHoje,
                    limite: CONFIG_LIMITE[inst.id] || 20,
                }
            })

            // === TEMPO MÉDIO DE RESPOSTA — CORRIGIDO ===
            // 🛡️ Bug antes: filtrava por lead.id quando messages tem whatsapp_id (JID)
            let somaTempos = 0, contTempos = 0
            const leadsComResposta = leads?.filter(l => l.last_contact_at && l.whatsapp_id) || []
            for (const lead of leadsComResposta) {
                const envio = new Date(lead.last_contact_at)
                const primeiraResposta = mensagensDoCliente
                    .filter(m => m.whatsapp_id === lead.whatsapp_id)  // ← CORRIGIDO
                    .filter(m => new Date(m.created_at) > envio)       // só respostas APÓS o disparo
                    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0]
                
                if (primeiraResposta) {
                    const diff = (new Date(primeiraResposta.created_at) - envio) / 60000 // minutos
                    if (diff > 0 && diff < 1440) {  // ignora respostas após 24h (provável outro contexto)
                        somaTempos += diff
                        contTempos++
                    }
                }
            }
            const tempoMedioResposta = contTempos > 0 ? Math.round(somaTempos / contTempos) : null

            // === TEMPERATURA DOS LEADS ===
            const tempCounts = { hot: 0, warm: 0, cold: 0, dead: 0 }
            leads?.forEach(l => {
                const t = l.lead_temperature || 'cold'
                if (tempCounts[t] !== undefined) tempCounts[t]++
            })

            // === FUNIL SPIN (0-5) ===
            const spinLabels = ['Qualificação', 'Situação', 'Dor', 'Solução', 'Agendamento', 'Fechamento']
            const spinCores  = [CORES.slate, CORES.azul, CORES.ciano, CORES.roxo, CORES.amarelo, CORES.verde]
            const spinFunil = spinLabels.map((nome, i) => ({
                nome,
                valor: leads?.filter(l => (l.current_stage || 0) === i).length || 0,
                cor: spinCores[i],
            }))

            setDados({
                kpis: { 
                    totalDisparados, 
                    taxaResposta, 
                    agendados, 
                    leadsQueResponderam, 
                    aguardandoHumano, 
                    pausadoManual, 
                    leadsRobo, 
                    tempoMedioResposta, 
                    tempCounts 
                },
                funil,
                spinFunil,
                disparosPorDia,
                respostasPorHora,
                statusDist,
                chipsSaude,
            })
            setUltimaAtualizacao(new Date())
        } catch (err) {
            console.error('Erro ao carregar dashboard:', err)
        } finally {
            setCarregando(false)
        }
    }, [periodoGrafico])

    useEffect(() => { carregarDados() }, [carregarDados])

    // Auto-refresh a cada 2 minutos
    useEffect(() => {
        const timer = setInterval(carregarDados, 120000)
        return () => clearInterval(timer)
    }, [carregarDados])

    if (carregando && !dados) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-12 w-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-blue-400 font-black uppercase tracking-widest text-xs">Carregando dados...</p>
                </div>
            </div>
        )
    }

    const d = dados

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-950/20 p-8 space-y-8">

            {/* === HEADER === */}
            <div className="flex justify-between items-center">
                <div>

                    <h2 className="text-2xl font-black text-white uppercase italic tracking-tighter">
                            Painel <span className="text-amber-500 neon-text">Operacional</span>
                   </h2>

                    {ultimaAtualizacao && (
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                            Atualizado às {ultimaAtualizacao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                    )}
                </div>
                <button
                    onClick={carregarDados}
                    disabled={carregando}
                    className="flex items-center gap-2 glass-card px-5 py-2.5 rounded-2xl border border-white/10 text-[11px] font-black text-amber-400 uppercase tracking-widest hover:border-amber-500/40 transition-all disabled:opacity-50"
                >
                    <RefreshCw className={`h-4 w-4 ${carregando ? 'animate-spin' : ''}`} />
                    Atualizar
                </button>
            </div>

            {/* === KPIs OPERACIONAIS === */}
                          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
             <KpiCard icon={Zap}           label="Disparos Hoje"      value={d?.kpis.totalDisparados || 0}     sub="leads contactados"              color={CORES.azul}     />
             <KpiCard icon={Clock}         label="Tempo Médio Resposta" value={d?.kpis.tempoMedioResposta ? `${d.kpis.tempoMedioResposta}min` : '--'} sub="do disparo à 1ª resposta" color={CORES.ciano} />
             <KpiCard icon={Flame}         label="Leads Hot"           value={d?.kpis.tempCounts?.hot || 0}     sub="prontos pra fechar"             color={CORES.vermelho} />
             <KpiCard icon={Bot}           label="Robôs Detectados"    value={d?.kpis.leadsRobo || 0}           sub="silenciados"                    color={CORES.slate}    />
                          </div>

            

            {/* === LINHA 1: FUNIL + DISTRIBUIÇÃO === */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* LEADS QUE PRECISAM DE AÇÃO */}
<div className="lg:col-span-2 glass-panel rounded-3xl p-6 border border-white/5">
    <p className="text-[10px] font-black text-amber-400 uppercase tracking-[0.3em] mb-4 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" /> Leads que precisam de ação
    </p>
    <div className="space-y-2">
        {[
            {
                label: 'Aguardando resposta da IA',
                desc: 'Lead respondeu mas IA ainda não processou',
                value: d?.kpis.aguardandoHumano || 0,
                color: CORES.amarelo,
            },
            {
                label: 'Pausados manualmente',
                desc: 'Operador pausou — verificar se pode retomar',
                value: d?.kpis.pausadoManual || 0,
                color: CORES.roxo,
            },
            {
                label: 'Leads Warm esfriando',
                desc: 'Engajaram mas pararam — oportunidade de retomada',
                value: d?.kpis.tempCounts?.warm || 0,
                color: CORES.amarelo,
            },
            {
                label: 'Leads Dead (sem resposta)',
                desc: 'Completaram 3 follow-ups sem responder',
                value: d?.kpis.tempCounts?.dead || 0,
                color: CORES.slate,
            },
        ].filter(item => item.value > 0).map((item, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-white/5 bg-white/[0.02]">
                <div className="flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full" style={{ background: item.color, boxShadow: `0 0 6px ${item.color}` }} />
                    <div>
                        <p className="text-[11px] font-black text-white uppercase tracking-wider">{item.label}</p>
                        <p className="text-[9px] text-slate-500 font-medium">{item.desc}</p>
                    </div>
                </div>
                <span className="text-lg font-black" style={{ color: item.color }}>{item.value}</span>
            </div>
        ))}
        {[d?.kpis.aguardandoHumano, d?.kpis.pausadoManual, d?.kpis.tempCounts?.warm, d?.kpis.tempCounts?.dead].every(v => !v || v === 0) && (
            <div className="text-center py-8">
                <p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest">Tudo em dia — nenhuma ação pendente</p>
            </div>
        )}
    </div>
</div>

                {/* DISTRIBUIÇÃO STATUS */}
                <div className="glass-panel rounded-3xl p-6 border border-white/5">
                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-[0.3em] mb-4 flex items-center gap-2">
                        <Activity className="h-4 w-4" /> Distribuição Atual
                    </p>
                    <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                            <Pie
                                data={d?.statusDist}
                                cx="50%"
                                cy="50%"
                                innerRadius={50}
                                outerRadius={75}
                                paddingAngle={3}
                                dataKey="valor"
                            >
                                {d?.statusDist.map((s, i) => (
                                    <Cell key={i} fill={s.cor} stroke="transparent" />
                                ))}
                            </Pie>
                            <Tooltip content={<TooltipCustom />} />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-2 mt-2">
                        {d?.statusDist.map((s, i) => (
                            <div key={i} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="h-2 w-2 rounded-full" style={{ background: s.cor, boxShadow: `0 0 6px ${s.cor}` }} />
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">{s.nome}</span>
                                </div>
                                <span className="text-[11px] font-black text-white">{s.valor}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
                        {/* === FUNIL SPIN (ESTÁGIO 0-5) === */}
            <div className="glass-panel rounded-3xl p-6 border border-white/5">
                <p className="text-[10px] font-black text-blue-400 uppercase tracking-[0.3em] mb-6 flex items-center gap-2">
                    <Target className="h-4 w-4" /> Funil SPIN — Estágio da Conversa
                </p>
                <div className="grid grid-cols-6 gap-3">
                    {d?.spinFunil?.map((etapa, i) => {
                        const max = Math.max(...(d?.spinFunil?.map(e => e.valor) || [1]))
                        const pct = max > 0 ? Math.round(etapa.valor / max * 100) : 0
                        return (
                            <div key={i} className="flex flex-col items-center gap-2">
                                <span className="text-2xl font-black text-white">{etapa.valor}</span>
                                <div className="w-full h-24 bg-slate-800/60 rounded-xl overflow-hidden flex flex-col justify-end">
                                    <div
                                        className="w-full rounded-t-lg transition-all duration-1000"
                                        style={{ height: `${Math.max(pct, 4)}%`, background: etapa.cor, boxShadow: `0 0 10px ${etapa.cor}50` }}
                                    />
                                </div>
                                <span className="text-[8px] font-black text-slate-500 uppercase tracking-wider text-center leading-tight">
                                    {etapa.nome}
                                </span>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* === LINHA 2: DISPAROS POR DIA === */}
            <div className="glass-panel rounded-3xl p-6 border border-white/5">
                <div className="flex justify-between items-center mb-6">
                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-[0.3em] flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" /> Disparos vs Respostas
                    </p>
                    <div className="flex gap-2">
                        {['7d', '30d'].map(p => (
                            <button
                                key={p}
                                onClick={() => setPeriodoGrafico(p)}
                                className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase transition-all ${
                            periodoGrafico === p
                             ? 'bg-amber-600 text-black'
                               : 'glass-card text-slate-400 border-white/10 hover:border-amber-500/30'
                            }`}                            >
                                {p === '7d' ? '7 dias' : '30 dias'}
                            </button>
                        ))}
                    </div>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={d?.disparosPorDia} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                        <defs>
                            <linearGradient id="gradDisparos" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor={CORES.azul}  stopOpacity={0.3} />
                                <stop offset="95%" stopColor={CORES.azul}  stopOpacity={0}   />
                            </linearGradient>
                            <linearGradient id="gradRespostas" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor={CORES.verde} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={CORES.verde} stopOpacity={0}   />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                        <XAxis dataKey="dia" tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }} axisLine={false} tickLine={false} />
                        <Tooltip content={<TooltipCustom />} />
                        <Legend wrapperStyle={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }} />
                        <Area type="monotone" dataKey="Disparos"  stroke={CORES.azul}  strokeWidth={2} fill="url(#gradDisparos)"  dot={false} />
                        <Area type="monotone" dataKey="Respostas" stroke={CORES.verde} strokeWidth={2} fill="url(#gradRespostas)" dot={false} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* === LINHA 3: HORÁRIO + CHIPS === */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* RESPOSTAS POR HORA */}
                <div className="glass-panel rounded-3xl p-6 border border-white/5">
                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-[0.3em] mb-6 flex items-center gap-2">
                        <Clock className="h-4 w-4" /> Melhor Horário para Disparar
                    </p>
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={d?.respostasPorHora} margin={{ top: 5, right: 5, bottom: 5, left: -25 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                            <XAxis
                                dataKey="hora"
                                tick={{ fill: '#64748b', fontSize: 9, fontWeight: 700 }}
                                axisLine={false}
                                tickLine={false}
                                interval={2}
                            />
                            <YAxis tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
                            <Tooltip content={<TooltipCustom />} />
                            <Bar dataKey="Respostas" fill={CORES.azul} radius={[4, 4, 0, 0]}>
                                {d?.respostasPorHora.map((entry, i) => {
                                    const h = parseInt(entry.hora)
                                    const isPico = entry.Respostas === Math.max(...(d?.respostasPorHora.map(r => r.Respostas) || [0]))
                                    return <Cell key={i} fill={isPico ? CORES.amarelo : (h >= 8 && h <= 18 ? CORES.azul : CORES.slate)} />
                                })}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                    <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest mt-3 text-center">
                        Barra amarela = horário com mais respostas
                    </p>
                </div>

                {/* SAÚDE DOS CHIPS */}
                <div className="glass-panel rounded-3xl p-6 border border-white/5">
                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-[0.3em] mb-6 flex items-center gap-2">
                        <Wifi className="h-4 w-4" /> Saúde dos Chips
                    </p>
                    <div className="space-y-3">
                        {d?.chipsSaude.length > 0 ? (
                            d.chipsSaude.map((c, i) => (
                                <ChipCard key={i} chip={c.chip} disparosHoje={c.disparosHoje} limite={c.limite} />
                            ))
                        ) : (
                            <div className="flex flex-col items-center justify-center py-10 opacity-30">
                                <WifiOff className="h-10 w-10 text-slate-500 mb-3" />
                                <p className="text-xs font-black text-slate-500 uppercase">Nenhum chip configurado</p>
                            </div>
                        )}
                    </div>

                    {/* Legenda de status geral */}
                    <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-3 gap-2">
                        {[
                            { label: 'Online',  cor: CORES.verde,    icon: CheckCircle2 },
                            { label: 'Offline', cor: CORES.vermelho, icon: XCircle      },
                            { label: 'Pausado', cor: CORES.amarelo,  icon: PauseCircle  },
                        ].map((s, i) => (
                            <div key={i} className="flex items-center gap-1.5">
                                <s.icon className="h-3 w-3" style={{ color: s.cor }} />
                                <span className="text-[9px] font-black text-slate-500 uppercase">{s.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
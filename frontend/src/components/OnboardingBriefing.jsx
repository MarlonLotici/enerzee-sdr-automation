import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Building2, Package, Users, Target, MessageSquare,
    Brain, Shield, ChevronRight, ChevronLeft, Check,
    Loader2, Zap, Send, FileText
} from 'lucide-react'

// Steps do formulário
const STEPS = [
    { key: 'company', icon: Building2, title: 'Sua Empresa', subtitle: 'Nos conte sobre seu negócio' },
    { key: 'product', icon: Package, title: 'Produto / Serviço', subtitle: 'O que você vende ou oferece' },
    { key: 'audience', icon: Users, title: 'Público Alvo', subtitle: 'Quem são seus clientes ideais' },
    { key: 'strategy', icon: Target, title: 'Estratégia Comercial', subtitle: 'Como você vende hoje' },
    { key: 'agent', icon: Brain, title: 'Agente IA', subtitle: 'Personalidade e regras da IA' },
    { key: 'leads', icon: MessageSquare, title: 'Leads & Operação', subtitle: 'Origem dos leads e preferências' },
]

// Componente de campo
function Field({ label, hint, required, children }) {
    return (
        <div className="space-y-1.5">
            <Label className="text-[10px] font-black text-amber-300/80 uppercase tracking-widest flex items-center gap-1">
                {label}
                {required && <span className="text-red-400">*</span>}
            </Label>
            {children}
            {hint && <p className="text-[9px] text-slate-600 font-medium">{hint}</p>}
        </div>
    )
}

function TextInput({ value, onChange, placeholder, ...props }) {
    return (
        <Input
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className="h-10 bg-black/30 border-white/10 text-white text-sm font-medium rounded-lg px-3 focus:border-amber-500 transition-colors"
            {...props}
        />
    )
}

function TextArea({ value, onChange, placeholder, rows = 3 }) {
    return (
        <textarea
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            rows={rows}
            className="w-full bg-black/30 border border-white/10 text-white text-sm font-medium rounded-lg px-3 py-2 focus:border-amber-500 focus:outline-none transition-colors resize-none"
        />
    )
}

function SelectInput({ value, onChange, options, placeholder }) {
    return (
        <select
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            className="w-full h-10 bg-black/30 border border-white/10 text-white text-sm font-medium rounded-lg px-3 focus:border-amber-500 outline-none transition-colors"
        >
            <option value="" className="bg-[#111]">{placeholder || 'Selecione...'}</option>
            {options.map(opt => (
                <option key={opt} value={opt} className="bg-[#111]">{opt}</option>
            ))}
        </select>
    )
}

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function OnboardingBriefing({ userId, onComplete, isModal = false }) {
    const [step, setStep] = useState(0)
    const [data, setData] = useState({})
    const [saving, setSaving] = useState(false)
    const [existingId, setExistingId] = useState(null)

    // Carregar briefing existente (se já preencheu parcialmente)
    useEffect(() => {
        if (!userId) return
        const load = async () => {
            const { data: existing } = await supabase
                .from('client_briefings')
                .select('*')
                .eq('user_id', userId)
                .limit(1)
                .single()
            if (existing) {
                setData(existing)
                setExistingId(existing.id)
            }
        }
        load()
    }, [userId])

    const set = (key, value) => setData(prev => ({ ...prev, [key]: value }))

    const save = async (isFinal = false) => {
        setSaving(true)
        try {
            const payload = {
                ...data,
                user_id: userId,
                updated_at: new Date().toISOString(),
                status: isFinal ? 'pending' : 'draft',
            }
            // Remove campos do Supabase que não devem ser enviados
            delete payload.id
            delete payload.created_at

            if (existingId) {
                await supabase.from('client_briefings').update(payload).eq('id', existingId)
            } else {
                const { data: inserted } = await supabase.from('client_briefings').insert(payload).select().single()
                if (inserted) setExistingId(inserted.id)
            }

            if (isFinal) {
                // Notificar admin (via edge function ou webhook futuro)
                // Por enquanto salva com status 'pending' e admin vê no banco
                try {
                    await fetch('https://formsubmit.co/ajax/marlonlotici6@gmail.com', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            _subject: `🔥 ANTIX — Novo briefing: ${data.company_name || 'Cliente'}`,
                            empresa: data.company_name,
                            segmento: data.company_segment,
                            cidade: `${data.company_city} - ${data.company_state}`,
                            produto: data.product_description?.slice(0, 200),
                            agente: data.agent_name,
                            _template: 'table',
                        })
                    })
                } catch (e) {
                    console.log('Email notification failed (non-blocking)', e)
                }

                onComplete?.()
            }
        } finally {
            setSaving(false)
        }
    }

    const next = () => {
        save(false) // Salva progresso parcial
        setStep(s => Math.min(s + 1, STEPS.length - 1))
    }
    const prev = () => setStep(s => Math.max(s - 1, 0))
    const isLast = step === STEPS.length - 1

    // ── RENDERIZAR STEP ATUAL ──
    const renderStep = () => {
        switch (STEPS[step].key) {
            case 'company':
                return (
                    <div className="space-y-4">
                        <Field label="Nome da empresa" required>
                            <TextInput value={data.company_name} onChange={v => set('company_name', v)} placeholder="Ex: Antix, Lince" />
                        </Field>
                        <Field label="Segmento de atuação" required hint="Ex: Energia solar, Seguros, Telecom, Contabilidade">
                            <TextInput value={data.company_segment} onChange={v => set('company_segment', v)} placeholder="Em qual mercado você atua?" />
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Cidade">
                                <TextInput value={data.company_city} onChange={v => set('company_city', v)} placeholder="Florianópolis" />
                            </Field>
                            <Field label="Estado">
                                <SelectInput value={data.company_state} onChange={v => set('company_state', v)} placeholder="UF"
                                    options={['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']} />
                            </Field>
                        </div>
                        <Field label="Porte da empresa">
                            <SelectInput value={data.company_size} onChange={v => set('company_size', v)}
                                options={['MEI', 'ME (Microempresa)', 'EPP (Pequeno Porte)', 'Médio Porte', 'Grande Empresa']} />
                        </Field>
                        <Field label="Website (opcional)">
                            <TextInput value={data.company_website} onChange={v => set('company_website', v)} placeholder="https://..." />
                        </Field>
                    </div>
                )

            case 'product':
                return (
                    <div className="space-y-4">
                        <Field label="Descreva seu produto/serviço em detalhes" required hint="Quanto mais detalhes, melhor será o prompt da IA. O que é, como funciona, qual o benefício principal.">
                            <TextArea value={data.product_description} onChange={v => set('product_description', v)} placeholder="Ex: Oferecemos [produto/serviço]. O cliente [benefício principal]. Sem [objeção comum]. O processo é [como funciona e o que acontece após o contato]..." rows={5} />
                        </Field>
                        <Field label="Diferenciais competitivos" hint="O que te diferencia dos concorrentes?">
                            <TextArea value={data.product_differentials} onChange={v => set('product_differentials', v)} placeholder="Ex: Entrega em 48h, sem burocracia, garantia de resultado, atendimento dedicado, sem fidelidade..." rows={3} />
                        </Field>
                        <Field label="Faixa de preço ou modelo de cobrança">
                            <TextInput value={data.product_price_range} onChange={v => set('product_price_range', v)} placeholder="Ex: Planos a partir de R$ 299/mês, pacotes por projeto, modelo de success fee" />
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Forma de entrega">
                                <SelectInput value={data.product_delivery} onChange={v => set('product_delivery', v)}
                                    options={['Digital/Remoto', 'Presencial', 'Instalação no local', 'Misto (digital + presencial)', 'SaaS/Plataforma']} />
                            </Field>
                            <Field label="Tipo de contrato">
                                <SelectInput value={data.product_contract_type} onChange={v => set('product_contract_type', v)}
                                    options={['Sem fidelidade', '3 meses', '6 meses', '12 meses', '24 meses', 'Varia por caso']} />
                            </Field>
                        </div>
                        <Field label="Tem adesão gratuita / período grátis?">
                            <div className="flex gap-4">
                                {['Sim', 'Não'].map(opt => (
                                    <label key={opt} className="flex items-center gap-2 cursor-pointer">
                                        <div className={`h-4 w-4 rounded border flex items-center justify-center transition-all ${
                                            (opt === 'Sim' ? data.product_no_cost_entry : !data.product_no_cost_entry)
                                                ? 'bg-amber-500 border-amber-400' : 'border-white/20 bg-transparent'
                                        }`}
                                            onClick={() => set('product_no_cost_entry', opt === 'Sim')}>
                                            {(opt === 'Sim' ? data.product_no_cost_entry : !data.product_no_cost_entry) &&
                                                <Check className="h-3 w-3 text-black" />}
                                        </div>
                                        <span className="text-xs text-slate-300 font-bold">{opt}</span>
                                    </label>
                                ))}
                            </div>
                        </Field>
                    </div>
                )

            case 'audience':
                return (
                    <div className="space-y-4">
                        <Field label="Quem é seu cliente ideal?" required hint="Descreva o perfil: tipo de empresa, porte, segmento, cargo do decisor">
                            <TextArea value={data.target_audience} onChange={v => set('target_audience', v)} placeholder="Ex: Médias e grandes empresas com equipe de 10+ pessoas, preferencialmente o dono, sócio ou gerente responsável pela área..." rows={4} />
                        </Field>
                        <Field label="Porte das empresas alvo">
                            <SelectInput value={data.target_company_size} onChange={v => set('target_company_size', v)}
                                options={['MEI/ME (muito pequenas)', 'ME/EPP (pequenas)', 'Médio porte', 'Grandes empresas', 'Qualquer porte']} />
                        </Field>
                        <Field label="Nichos específicos que quer atingir" hint="Separados por vírgula">
                            <TextInput value={data.target_niches} onChange={v => set('target_niches', v)} placeholder="Ex: Supermercados, padarias, postos de gasolina, academias" />
                        </Field>
                        <Field label="Regiões de atuação" hint="Cidades, estados ou 'Brasil todo'">
                            <TextInput value={data.target_regions} onChange={v => set('target_regions', v)} placeholder="Ex: SC e PR, foco em Florianópolis e Curitiba" />
                        </Field>
                        <Field label="Quem é o decisor dentro da empresa?">
                            <SelectInput value={data.target_decision_maker} onChange={v => set('target_decision_maker', v)}
                                options={['Dono/Sócio', 'Gerente', 'Financeiro', 'Compras', 'TI', 'Varia por empresa']} />
                        </Field>
                    </div>
                )

            case 'strategy':
                return (
                    <div className="space-y-4">
                        <Field label="Estilo de abordagem preferido" required>
                            <SelectInput value={data.approach_style} onChange={v => set('approach_style', v)}
                                options={['Consultivo (educa e orienta)', 'Direto (vai ao ponto)', 'Curioso (gera interesse antes)', 'Educativo (ensina sobre o tema)', 'Social proof (mostra cases)']} />
                        </Field>
                        <Field label="Tom da conversa">
                            <SelectInput value={data.approach_tone} onChange={v => set('approach_tone', v)}
                                options={['Informal e amigável', 'Profissional mas leve', 'Formal e técnico', 'Descontraído e direto', 'Autoritativo (especialista)']} />
                        </Field>
                        <Field label="Como prefere que a IA abra a conversa?" hint="Descreva a primeira mensagem ideal ou a estratégia">
                            <TextArea value={data.opening_strategy} onChange={v => set('opening_strategy', v)} placeholder="Ex: Gerar curiosidade com uma dor conhecida do setor antes de revelar o produto, confirmar se a pessoa é o decisor..." rows={3} />
                        </Field>
                        <Field label="Principais dores que seu produto resolve" required hint="Liste as dores do cliente que fazem ele comprar">
                            <TextArea value={data.main_pain_points} onChange={v => set('main_pain_points', v)} placeholder="Ex: Custo operacional elevado, retrabalho frequente, falta de previsibilidade, dificuldade de escalar sem perder qualidade..." rows={3} />
                        </Field>
                        <Field label="Objeções mais comuns" hint="O que as pessoas falam quando não querem comprar?">
                            <TextArea value={data.main_objections} onChange={v => set('main_objections', v)} placeholder="Ex: 'Não tenho interesse', 'Já tenho fornecedor', 'Quem te deu meu número?', 'Manda por email', 'Vou ver com o sócio'" rows={3} />
                        </Field>
                        <Field label="Como você responde essas objeções?" hint="Isso ajuda a IA a argumentar como você faria">
                            <TextArea value={data.objection_responses} onChange={v => set('objection_responses', v)} placeholder="Ex: Para 'já tenho fornecedor': 'Entendo! Muitos clientes tinham também — a diferença é que [diferencial único]. Vale 15min pra mostrar?'" rows={4} />
                        </Field>
                        <Field label="Objetivo final da conversa">
                            <SelectInput value={data.sales_goal} onChange={v => set('sales_goal', v)}
                                options={['Agendar reunião/consultoria', 'Enviar proposta comercial', 'Fechar venda na conversa', 'Qualificar e passar pro closer', 'Capturar dados de contato']} />
                        </Field>
                        <Field label="Link do Calendly ou agendamento (se tiver)">
                            <TextInput value={data.calendly_link} onChange={v => set('calendly_link', v)} placeholder="https://calendly.com/sua-empresa" />
                        </Field>
                    </div>
                )

            case 'agent':
                return (
                    <div className="space-y-4">
                        <Field label="Nome do agente IA" required hint="O nome que a IA vai usar nas conversas">
                            <TextInput value={data.agent_name} onChange={v => set('agent_name', v)} placeholder="Ex: Marlon, Ana, Carlos" />
                        </Field>
                        <Field label="Personalidade do agente" hint="Como o agente deve se comportar?">
                            <SelectInput value={data.agent_persona} onChange={v => set('agent_persona', v)}
                                options={['Vendedor experiente', 'Consultor especialista', 'Assistente prestativo', 'Executivo de contas', 'Representante comercial']} />
                        </Field>
                        <Field label="Palavras ou temas PROIBIDOS" hint="O que a IA nunca pode mencionar?">
                            <TextArea value={data.agent_forbidden_words} onChange={v => set('agent_forbidden_words', v)} placeholder="Ex: Nunca mencionar concorrente X, nunca falar preço antes de agendar, nunca prometer desconto acima de 20%..." rows={3} />
                        </Field>
                        <Field label="Informações que DEVEM ser mencionadas" hint="O que a IA precisa falar obrigatoriamente?">
                            <TextArea value={data.agent_mandatory_info} onChange={v => set('agent_mandatory_info', v)} placeholder="Ex: Sempre mencionar que não tem fidelidade, sempre perguntar o principal desafio atual, sempre oferecer diagnóstico gratuito..." rows={3} />
                        </Field>
                        <Field label="Restrições legais ou compliance">
                            <TextArea value={data.compliance_notes} onChange={v => set('compliance_notes', v)} placeholder="Ex: Não pode prometer resultados específicos de ROI, não mencionar preço antes de agendar, respeitar o LGPD..." rows={2} />
                        </Field>
                    </div>
                )

            case 'leads':
                return (
                    <div className="space-y-4">
                        <Field label="De onde vêm seus leads hoje?">
                            <SelectInput value={data.lead_source} onChange={v => set('lead_source', v)}
                                options={['Google Maps (scraper)', 'Lista própria (Excel/CSV)', 'Indicações', 'Site/Landing page', 'Redes sociais', 'Misto (várias fontes)']} />
                        </Field>
                        <Field label="Já tem lista de leads pronta?">
                            <div className="flex gap-4">
                                {['Sim', 'Não'].map(opt => (
                                    <label key={opt} className="flex items-center gap-2 cursor-pointer">
                                        <div className={`h-4 w-4 rounded border flex items-center justify-center transition-all ${
                                            (opt === 'Sim' ? data.lead_has_own_list : !data.lead_has_own_list)
                                                ? 'bg-amber-500 border-amber-400' : 'border-white/20 bg-transparent'
                                        }`}
                                            onClick={() => set('lead_has_own_list', opt === 'Sim')}>
                                            {(opt === 'Sim' ? data.lead_has_own_list : !data.lead_has_own_list) &&
                                                <Check className="h-3 w-3 text-black" />}
                                        </div>
                                        <span className="text-xs text-slate-300 font-bold">{opt}</span>
                                    </label>
                                ))}
                            </div>
                        </Field>
                        <Field label="Nichos prioritários para prospecção" hint="Os nichos mais rentáveis do seu negócio">
                            <TextInput value={data.lead_preferred_niches} onChange={v => set('lead_preferred_niches', v)} placeholder="Ex: Supermercados, indústrias, hotéis" />
                        </Field>
                        <Field label="Horário de disparo permitido">
                            <SelectInput value={data.working_hours} onChange={v => set('working_hours', v)}
                                options={['8h-18h (comercial)', '8h-20h (estendido)', '9h-17h (curto)', '7h-19h (amplo)', 'Personalizado']} />
                        </Field>
                        <Field label="Limite diário de disparos por chip">
                            <SelectInput value={String(data.daily_limit || '45')} onChange={v => set('daily_limit', parseInt(v))}
                                options={['20', '30', '45', '55', '70', '100']} />
                        </Field>
                        <Field label="Preferência de follow-up">
                            <SelectInput value={data.follow_up_preference} onChange={v => set('follow_up_preference', v)}
                                options={['Agressivo (D1, D2, D3)', 'Moderado (D1, D3, D7)', 'Suave (D1, D7)', 'Sem follow-up automático']} />
                        </Field>
                        <Field label="Nomes dos concorrentes principais" hint="Ajuda a IA a se posicionar contra eles">
                            <TextInput value={data.competitor_names} onChange={v => set('competitor_names', v)} placeholder="Ex: Empresa A, Empresa B, Empresa C" />
                        </Field>
                        <Field label="Algo mais que devemos saber?">
                            <TextArea value={data.additional_notes} onChange={v => set('additional_notes', v)} placeholder="Qualquer informação adicional que ajude a montar sua estratégia..." rows={3} />
                        </Field>
                    </div>
                )
        }
    }

    return (
        <div className={`flex flex-col ${isModal ? 'max-h-[80vh]' : 'h-full'}`}>
            {/* Header */}
            <div className="shrink-0 p-5 border-b border-white/5">
                <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-xl flex items-center justify-center"
                         style={{ background: 'linear-gradient(135deg, #D97706, #F59E0B)', boxShadow: '0 0 16px rgba(245,158,11,0.2)' }}>
                        <FileText className="h-5 w-5 text-black" />
                    </div>
                    <div>
                        <h2 className="text-base font-black text-white uppercase tracking-wider">Briefing Comercial</h2>
                        <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Preencha para configurarmos sua IA</p>
                    </div>
                </div>

                {/* Progress steps */}
                <div className="flex gap-1">
                    {STEPS.map((s, i) => (
                        <div
                            key={s.key}
                            onClick={() => { save(false); setStep(i); }}
                            className="flex-1 cursor-pointer group"
                        >
                            <div className={`h-1 rounded-full transition-all ${
                                i < step ? 'bg-amber-500' :
                                i === step ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.4)]' :
                                'bg-white/10'
                            }`} />
                            <p className={`text-[7px] font-black uppercase tracking-wider mt-1 transition-colors ${
                                i <= step ? 'text-amber-400' : 'text-slate-600'
                            }`}>
                                {s.title}
                            </p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Step content */}
            <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
                <div className="flex items-center gap-2 mb-5">
                    {React.createElement(STEPS[step].icon, { className: "h-5 w-5 text-amber-400" })}
                    <div>
                        <h3 className="text-sm font-black text-white uppercase tracking-wider">{STEPS[step].title}</h3>
                        <p className="text-[9px] text-slate-500 font-bold">{STEPS[step].subtitle}</p>
                    </div>
                </div>
                {renderStep()}
            </div>

            {/* Footer */}
            <div className="shrink-0 p-4 border-t border-white/5 flex justify-between items-center">
                <Button
                    onClick={prev}
                    disabled={step === 0}
                    className="h-9 px-4 bg-white/5 border border-white/10 text-slate-400 text-[10px] font-black uppercase tracking-wider rounded-lg hover:bg-white/10 disabled:opacity-30"
                >
                    <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
                </Button>

                <span className="text-[9px] text-slate-600 font-black">{step + 1} / {STEPS.length}</span>

                {isLast ? (
                    <Button
                        onClick={() => save(true)}
                        disabled={saving || !data.company_name}
                        className="h-9 px-5 bg-amber-600 text-black text-[10px] font-black uppercase tracking-wider rounded-lg hover:bg-amber-500 disabled:opacity-50"
                        style={{ boxShadow: '0 0 12px rgba(245,158,11,0.3)' }}
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Enviar Briefing <Send className="h-3.5 w-3.5 ml-1" /></>}
                    </Button>
                ) : (
                    <Button
                        onClick={next}
                        className="h-9 px-5 bg-amber-600 text-black text-[10px] font-black uppercase tracking-wider rounded-lg hover:bg-amber-500"
                    >
                        Próximo <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                )}
            </div>
        </div>
    )
}
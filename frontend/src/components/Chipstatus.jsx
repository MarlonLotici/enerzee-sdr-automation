import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { QRCodeSVG } from 'qrcode.react'
import { Cpu, Wifi, WifiOff, Loader2, RefreshCw, Zap, User, Building2, Target, Clock, RotateCcw, Pencil, Check, KeyRound, HelpCircle, Pause, Play } from 'lucide-react'

// ─── PALETA ───────────────────────────────────────────────────────────────────
const C = {
    connected:    '#10B981',
    disconnected: '#F43F5E',
    connecting:   '#F59E0B',
    brand:        '#F59E0B',
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
    if (instance.whatsapp_status === 'NEEDS_REAUTH') {
        return { color: '#f59e0b', label: 'Re-escanear QR', icon: 'off' }
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
function ChipCard({ instance, dailyCount, statusInfo, onReconnect, onResetSession, qrCode, onLimitChange, onTogglePause, onToggleFlag, onSaveCampaignFields }) {
    const [editingLimit, setEditingLimit] = useState(false)
    const [localLimit,   setLocalLimit]   = useState(instance.daily_limit ?? 30)
    const [saving,       setSaving]       = useState(false)
    const [showResetInfo, setShowResetInfo] = useState(false)
    const [pausando,     setPausando]     = useState(false)
    const [togglingFlag, setTogglingFlag] = useState(null) // nome da flag em voo, evita duplo-clique

    // ── Configuração de campanha de email — formulário guiado, à prova de leigo ──
    const briefInicial = instance.email_brief || {}
    const [campVende,   setCampVende]   = useState(briefInicial.vende || '')
    const [campDor,     setCampDor]     = useState(briefInicial.dor || '')
    const [campProva,   setCampProva]   = useState(briefInicial.prova || '')
    const [campTom,     setCampTom]     = useState(briefInicial.tom || 'amigável')
    const [campFromAddress, setCampFromAddress] = useState(instance.email_from_address || '')
    const [campWebsiteUrl,  setCampWebsiteUrl]  = useState(instance.email_website_url || '')
    const [campOwnerPhone,  setCampOwnerPhone]  = useState(instance.owner_phone || '')
    const [savingCampaign,  setSavingCampaign]  = useState(false)
    const [campaignSaved,   setCampaignSaved]   = useState(false)
    const [previewLoading,  setPreviewLoading]  = useState(false)
    const [previewData,     setPreviewData]     = useState(null) // { assunto, corpo } ou null

    useEffect(() => { setLocalLimit(instance.daily_limit ?? 30) }, [instance.daily_limit])
    useEffect(() => {
        const b = instance.email_brief || {}
        setCampVende(b.vende || ''); setCampDor(b.dor || ''); setCampProva(b.prova || ''); setCampTom(b.tom || 'amigável')
    }, [instance.email_brief])
    useEffect(() => { setCampFromAddress(instance.email_from_address || '') }, [instance.email_from_address])
    useEffect(() => { setCampWebsiteUrl(instance.email_website_url || '') }, [instance.email_website_url])
    useEffect(() => { setCampOwnerPhone(instance.owner_phone || '') }, [instance.owner_phone])

    // Monta o prompt técnico (o que o motor lê) a partir das respostas simples do formulário.
    const montarEmailPrompt = () => [
        'Você escreve emails de prospecção fria B2B para esta empresa. Use SOMENTE os dados abaixo, não invente números nem benefícios.',
        campVende ? `O QUE A EMPRESA OFERECE: ${campVende}` : '',
        campDor ? `DOR DO CLIENTE QUE ISSO RESOLVE: ${campDor}` : '',
        campProva ? `PROVA/NÚMERO QUE PODE CITAR: ${campProva}` : '',
        `TOM DA MENSAGEM: ${campTom}`,
    ].filter(Boolean).join('\n')

    const briefSalvo = instance.email_brief || {}
    const campanhaAlterada =
        campVende !== (briefSalvo.vende || '') || campDor !== (briefSalvo.dor || '') ||
        campProva !== (briefSalvo.prova || '') || campTom !== (briefSalvo.tom || 'amigável') ||
        campFromAddress !== (instance.email_from_address || '') ||
        campWebsiteUrl !== (instance.email_website_url || '') ||
        campOwnerPhone !== (instance.owner_phone || '')

    const salvarCampanha = async () => {
        setSavingCampaign(true)
        setCampaignSaved(false)
        await onSaveCampaignFields?.(instance.id, {
            email_prompt: montarEmailPrompt(),
            email_brief: { vende: campVende, dor: campDor, prova: campProva, tom: campTom },
            email_from_address: campFromAddress,
            email_website_url: campWebsiteUrl,
            owner_phone: campOwnerPhone,
        })
        setSavingCampaign(false)
        setCampaignSaved(true)
        setTimeout(() => setCampaignSaved(false), 2500)
    }

    const verExemplo = async () => {
        setPreviewLoading(true)
        setPreviewData(null)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const resp = await fetch(`/api/instance/${instance.id}/preview-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
                body: JSON.stringify({ email_prompt: montarEmailPrompt(), owner_phone: campOwnerPhone, email_website_url: campWebsiteUrl }),
            })
            const json = await resp.json()
            setPreviewData(json.ok ? { assunto: json.assunto, corpo: json.corpo } : { assunto: '⚠️ Erro', corpo: json.error || 'Falha ao gerar o exemplo.' })
        } catch (e) {
            setPreviewData({ assunto: '⚠️ Erro', corpo: e.message })
        }
        setPreviewLoading(false)
    }

    const saveLimit = async () => {
        setEditingLimit(false)
        if (localLimit === (instance.daily_limit ?? 30)) return
        setSaving(true)
        await onLimitChange?.(instance.id, localLimit)
        setSaving(false)
    }

    const limit    = Math.max(localLimit || 1, 1)
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

            {/* ── Badges de canal ── */}
            {(instance.inbound_only || instance.use_email_outbound || instance.use_sms_outbound) && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {instance.inbound_only && (
                        <span style={{ fontSize: 8, fontWeight: 900, color: '#3B82F6', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '999px', padding: '3px 8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                            Inbound Only
                        </span>
                    )}
                    {instance.use_email_outbound && (
                        <span style={{ fontSize: 8, fontWeight: 900, color: '#10B981', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '999px', padding: '3px 8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                            Email
                        </span>
                    )}
                    {instance.use_sms_outbound && (
                        <span style={{ fontSize: 8, fontWeight: 900, color: '#F59E0B', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '999px', padding: '3px 8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                            SMS
                        </span>
                    )}
                </div>
            )}

            {/* ── QR Code (aparece quando Baileys emite novo QR) ── */}
            {qrCode && (
                <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                    background: '#fff', borderRadius: '0.75rem', padding: '16px',
                }}>
                    <QRCodeSVG value={qrCode} size={180} />
                    <p style={{ fontSize: 10, fontWeight: 900, color: '#111', textAlign: 'center', letterSpacing: '0.05em' }}>
                        Abra o WhatsApp → Aparelhos conectados → Conectar aparelho
                    </p>
                </div>
            )}

            {/* ── Botão reconectar (só aparece quando offline e sem QR pendente) ── */}
            {statusInfo.icon === 'off' && onReconnect && !qrCode && (
                <button
                    onClick={() => onReconnect(instance.id)}
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        width: '100%', padding: '7px 0',
                        background: 'rgba(245,158,11,0.08)',
                        border: '1px solid rgba(245,158,11,0.25)',
                        borderRadius: '0.6rem',
                        cursor: 'pointer',
                        color: '#F59E0B',
                        fontSize: 10, fontWeight: 900,
                        textTransform: 'uppercase', letterSpacing: '0.12em',
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(245,158,11,0.15)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(245,158,11,0.08)'}
                >
                    <RotateCcw size={10} />
                    Reconectar
                </button>
            )}

            {/* ── Agente e empresa ── */}
            <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: '0.75rem', padding: '8px 10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                        <User size={9} color={C.brand} />
                        <span style={{ fontSize: 8, fontWeight: 900, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Agente</span>
                    </div>
                    <p style={{ fontSize: 11, fontWeight: 900, color: '#fff' }}>
                        {instance.agent_name || '—'}
                    </p>
                </div>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', borderRadius: '0.75rem', padding: '8px 10px', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                        <Building2 size={9} color={C.brand} />
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
                        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 700 }}>/</span>
                        {editingLimit ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <input
                                    type="number"
                                    min={1}
                                    max={200}
                                    value={localLimit}
                                    onChange={e => setLocalLimit(Number(e.target.value))}
                                    onBlur={saveLimit}
                                    onKeyDown={e => e.key === 'Enter' && saveLimit()}
                                    autoFocus
                                    style={{
                                        width: 42, background: 'rgba(255,255,255,0.08)',
                                        border: `1px solid ${C.brand}60`, borderRadius: 4,
                                        color: '#fff', fontSize: 11, fontWeight: 700,
                                        textAlign: 'center', padding: '1px 4px', outline: 'none',
                                    }}
                                />
                                <Check size={10} color={C.brand} style={{ cursor: 'pointer' }} onClick={saveLimit} />
                            </div>
                        ) : (
                            <span
                                onClick={() => setEditingLimit(true)}
                                title="Clique para editar o limite diário"
                                style={{ fontSize: 9, color: saving ? C.brand : 'rgba(255,255,255,0.3)', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}
                            >
                                {limit} <Pencil size={8} color="rgba(255,255,255,0.25)" />
                            </span>
                        )}
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

            {/* ── Pausar / Retomar Disparos (oculto só quando Inbound Only SEM email outbound —
                 chip puramente receptivo não tem o que pausar. Com email outbound ligado, o
                 chip prospecta por email mesmo com inbound_only=true, então o botão precisa aparecer) ── */}
            {(!instance.inbound_only || instance.use_email_outbound) && (
                <button
                    onClick={async () => {
                        setPausando(true)
                        await onTogglePause?.(instance.id, !instance.firing_paused)
                        setPausando(false)
                    }}
                    disabled={pausando}
                    title="Pausar Disparos: interrompe a prospecção agora, mas o chip CONTINUA respondendo contatos já salvos na base. Reversível a qualquer momento."
                    style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                        width: '100%', padding: '7px 0',
                        background: instance.firing_paused
                            ? 'rgba(16,185,129,0.08)'
                            : 'rgba(245,158,11,0.08)',
                        border: instance.firing_paused
                            ? '1px solid rgba(16,185,129,0.25)'
                            : '1px solid rgba(245,158,11,0.25)',
                        borderRadius: '0.6rem',
                        cursor: pausando ? 'not-allowed' : 'pointer',
                        color: instance.firing_paused ? '#10B981' : '#F59E0B',
                        fontSize: 10, fontWeight: 900,
                        textTransform: 'uppercase', letterSpacing: '0.12em',
                        opacity: pausando ? 0.6 : 1,
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={e => !pausando && (e.currentTarget.style.background = instance.firing_paused ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)')}
                    onMouseLeave={e => e.currentTarget.style.background = instance.firing_paused ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)'}
                >
                    {pausando
                        ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
                        : instance.firing_paused
                        ? <Play size={10} />
                        : <Pause size={10} />
                    }
                    {instance.firing_paused ? 'Retomar Disparos' : 'Pausar Disparos'}
                </button>
            )}

            {/* ── Toggles de canal: Inbound Only / Email Outbound / SMS Outbound ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                <div
                    title="Estes botões definem o COMPORTAMENTO do chip. Passe o mouse sobre cada um (?) para entender. Você pode combinar: ex. Email Outbound + Somente Receptivo faz o chip prospectar por email e responder qualquer um que chegar pelo WhatsApp."
                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 8, fontWeight: 900, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'help' }}
                >
                    Canais & Comportamento <HelpCircle size={10} />
                </div>
                {[
                    { key: 'inbound_only',       label: 'Somente Receptivo', color: '#3B82F6', tip: 'SOMENTE RECEPTIVO: o chip NUNCA prospecta. Responde qualquer pessoa que mandar mensagem primeiro — inclusive contatos novos que não estão na base (cria o lead na hora). Ideal para o número que recebe as respostas dos e-mails.' },
                    { key: 'use_email_outbound', label: 'Email Outbound',    color: '#10B981', tip: 'EMAIL OUTBOUND: a prospecção fria é feita por E-MAIL (via Resend), não por WhatsApp. Cada e-mail leva um link que traz o lead para conversar no WhatsApp. O WhatsApp deste chip fica livre de disparos frios (evita banimento).' },
                    { key: 'use_sms_outbound',   label: 'SMS Outbound',      color: '#F59E0B', tip: 'SMS OUTBOUND: reservado para uso futuro. A infraestrutura existe, mas ligar agora NÃO dispara nada — falta a regra de negócio (ex. SMS após 48h sem abrir o e-mail).' },
                    { key: 'dry_run',            label: 'Modo Teste (Dry-Run)', color: '#F43F5E', tip: 'MODO TESTE: o motor decide o canal e prepara a mensagem, mas NÃO envia nada de verdade (nem e-mail, nem WhatsApp) — só loga a decisão no servidor. Use para testar mudança de canal em leads reais sem risco. Lembre de desligar depois do teste.' },
                ].map(({ key, label, color, tip }) => {
                    const ativo = !!instance[key]
                    const busy = togglingFlag === key
                    return (
                        <button
                            key={key}
                            onClick={async () => {
                                setTogglingFlag(key)
                                await onToggleFlag?.(instance.id, key, !ativo)
                                setTogglingFlag(null)
                            }}
                            disabled={busy}
                            title={tip}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                width: '100%', padding: '6px 10px',
                                background: ativo ? `${color}14` : 'rgba(255,255,255,0.02)',
                                border: `1px solid ${ativo ? `${color}40` : 'rgba(255,255,255,0.08)'}`,
                                borderRadius: '0.5rem',
                                cursor: busy ? 'not-allowed' : 'pointer',
                                opacity: busy ? 0.6 : 1,
                                transition: 'background 0.2s',
                            }}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, fontWeight: 800, color: ativo ? color : 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                {label}
                                <HelpCircle size={10} style={{ opacity: 0.5 }} />
                            </span>
                            {busy
                                ? <Loader2 size={12} color={color} style={{ animation: 'spin 1s linear infinite' }} />
                                : (
                                    <div style={{
                                        width: 28, height: 15, borderRadius: 999,
                                        background: ativo ? color : 'rgba(255,255,255,0.15)',
                                        position: 'relative', transition: 'background 0.2s',
                                    }}>
                                        <div style={{
                                            position: 'absolute', top: 2, left: ativo ? 15 : 2,
                                            width: 11, height: 11, borderRadius: '50%',
                                            background: '#fff', transition: 'left 0.2s',
                                        }} />
                                    </div>
                                )
                            }
                        </button>
                    )
                })}
            </div>

            {/* ── Configuração de Campanha de Email — formulário guiado (só com Email Outbound ligado) ── */}
            {!!instance.use_email_outbound && (() => {
                const inputStyle = {
                    width: '100%', boxSizing: 'border-box',
                    background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '0.5rem', padding: '7px 10px',
                    color: '#fff', fontSize: 11, fontFamily: 'inherit',
                }
                const label = (txt) => (
                    <span style={{ fontSize: 8, fontWeight: 800, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{txt}</span>
                )
                const onFocus = e => e.currentTarget.style.borderColor = C.brand
                const onBlur  = e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
                return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 }}>
                    <div
                        title="Responda em português simples. O sistema monta o email sozinho a partir das suas respostas. Edite quando quiser trocar a campanha — sem mexer no banco de dados."
                        style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 8, fontWeight: 900, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.12em', cursor: 'help' }}
                    >
                        Campanha de Email — Passo a Passo <HelpCircle size={10} />
                    </div>

                    {label('1. O que sua empresa vende/oferece?')}
                    <textarea
                        value={campVende}
                        onChange={e => setCampVende(e.target.value)}
                        placeholder="Ex: energia solar por assinatura, sem obra, reduz a conta de luz."
                        rows={2} maxLength={600}
                        style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.4 }}
                        onFocus={onFocus} onBlur={onBlur}
                    />

                    {label('2. Qual a principal dor do cliente que isso resolve?')}
                    <textarea
                        value={campDor}
                        onChange={e => setCampDor(e.target.value)}
                        placeholder="Ex: conta de luz alta que sobe todo ano acima da inflação."
                        rows={2} maxLength={600}
                        style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.4 }}
                        onFocus={onFocus} onBlur={onBlur}
                    />

                    {label('3. Alguma prova/número que pode citar? (opcional)')}
                    <input
                        type="text" value={campProva}
                        onChange={e => setCampProva(e.target.value)}
                        placeholder="Ex: parceira WEG 5 estrelas / +500 clientes."
                        maxLength={300} style={inputStyle}
                        onFocus={onFocus} onBlur={onBlur}
                    />

                    {label('4. Tom da mensagem')}
                    <select
                        value={campTom}
                        onChange={e => setCampTom(e.target.value)}
                        style={{ ...inputStyle, cursor: 'pointer' }}
                        onFocus={onFocus} onBlur={onBlur}
                    >
                        <option value="amigável">Amigável</option>
                        <option value="formal">Formal</option>
                        <option value="direto">Direto ao ponto</option>
                    </select>

                    <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

                    {label('WhatsApp do CTA (recebe as conversas)')}
                    <input
                        type="text" value={campOwnerPhone}
                        onChange={e => setCampOwnerPhone(e.target.value)}
                        placeholder="Ex: 5548998203038"
                        title="Vira o link wa.me dentro do email. Use 55 + DDD + número com o 9. Número errado quebra o botão do email."
                        style={inputStyle} onFocus={onFocus} onBlur={onBlur}
                    />

                    {label('Remetente do email (opcional)')}
                    <input
                        type="text" value={campFromAddress}
                        onChange={e => setCampFromAddress(e.target.value)}
                        placeholder="Deixe vazio para usar o padrão"
                        title="Precisa ser de um domínio já verificado no Resend, senão o envio falha ou cai em spam."
                        style={inputStyle} onFocus={onFocus} onBlur={onBlur}
                    />
                    <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', marginTop: -3 }}>
                        ⚠️ Só use com domínio verificado no Resend — senão deixe vazio.
                    </div>

                    {label('Site oficial a citar (opcional)')}
                    <input
                        type="text" value={campWebsiteUrl}
                        onChange={e => setCampWebsiteUrl(e.target.value)}
                        placeholder="https://..."
                        style={inputStyle} onFocus={onFocus} onBlur={onBlur}
                    />

                    {/* Preview do email gerado */}
                    {previewData && (
                        <div style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${C.brand}40`, borderRadius: '0.5rem', padding: '8px 10px', marginTop: 2 }}>
                            <div style={{ fontSize: 8, fontWeight: 900, color: C.brand, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Exemplo gerado</div>
                            <div style={{ fontSize: 10, fontWeight: 800, color: '#fff', marginBottom: 4 }}>Assunto: {previewData.assunto}</div>
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{previewData.corpo}</div>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                        <button
                            onClick={verExemplo}
                            disabled={previewLoading}
                            style={{
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '6px 0',
                                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)',
                                borderRadius: '0.5rem', cursor: previewLoading ? 'wait' : 'pointer', opacity: previewLoading ? 0.6 : 1,
                                color: 'rgba(255,255,255,0.7)', fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em',
                            }}
                        >
                            {previewLoading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                            {previewLoading ? 'Gerando...' : 'Ver Exemplo'}
                        </button>
                        <button
                            onClick={salvarCampanha}
                            disabled={!campanhaAlterada || savingCampaign}
                            style={{
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '6px 0',
                                background: campanhaAlterada ? `${C.brand}20` : 'rgba(255,255,255,0.02)',
                                border: `1px solid ${campanhaAlterada ? `${C.brand}55` : 'rgba(255,255,255,0.08)'}`,
                                borderRadius: '0.5rem', cursor: (!campanhaAlterada || savingCampaign) ? 'not-allowed' : 'pointer',
                                opacity: savingCampaign ? 0.6 : 1, color: campanhaAlterada ? C.brand : 'rgba(255,255,255,0.3)',
                                fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', transition: 'background 0.2s',
                            }}
                        >
                            {savingCampaign ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : campaignSaved ? <Check size={11} /> : null}
                            {savingCampaign ? 'Salvando...' : campaignSaved ? 'Salvo!' : 'Salvar'}
                        </button>
                    </div>
                </div>
                )
            })()}

            {/* ── Resetar Sessão ── */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                    onClick={() => onResetSession?.(instance.id)}
                    style={{
                        flex: 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                        padding: '6px 0',
                        background: 'rgba(239,68,68,0.06)',
                        border: '1px solid rgba(239,68,68,0.18)',
                        borderRadius: '0.6rem',
                        cursor: 'pointer',
                        color: 'rgba(239,68,68,0.65)',
                        fontSize: 9, fontWeight: 900,
                        textTransform: 'uppercase', letterSpacing: '0.12em',
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.13)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(239,68,68,0.06)'}
                >
                    <KeyRound size={9} />
                    Resetar Sessão
                </button>

                {/* Ícone ? com tooltip explicativo */}
                <div
                    style={{ position: 'relative', cursor: 'help', flexShrink: 0 }}
                    onMouseEnter={() => setShowResetInfo(true)}
                    onMouseLeave={() => setShowResetInfo(false)}
                >
                    <HelpCircle size={14} color="rgba(255,255,255,0.2)" />
                    {showResetInfo && (
                        <div style={{
                            position: 'absolute', bottom: '100%', right: 0,
                            width: 230, marginBottom: 8,
                            background: '#1a1a2e',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '0.75rem',
                            padding: '12px 14px',
                            zIndex: 999,
                            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                            pointerEvents: 'none',
                        }}>
                            <p style={{ fontSize: 10, fontWeight: 900, color: '#ef4444', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                O que faz?
                            </p>
                            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, marginBottom: 8 }}>
                                Apaga as chaves de sessão do WhatsApp e força uma nova autenticação via QR code.
                            </p>
                            <p style={{ fontSize: 10, fontWeight: 900, color: '#f59e0b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                Quando usar?
                            </p>
                            <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6 }}>
                                Quando o chip aparece como <strong style={{ color: '#10B981' }}>Conectado</strong> mas nenhuma mensagem chega no celular. Isso acontece após atualizações internas do sistema onde as chaves antigas ficam incompatíveis com o novo protocolo.
                            </p>
                        </div>
                    )}
                </div>
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
    const [dailyCounts,   setDailyCounts]   = useState({})
    const [connectingSet, setConnectingSet] = useState(new Set())
    const [loading,       setLoading]       = useState(true)
    const [lastSync,      setLastSync]      = useState(null)
    const [qrMap,         setQrMap]         = useState({}) // instanceId → qr string

    // Busca contagem diária de disparos por chip direto no Supabase
    // Replica getDailyContactCount do database.js:
    // conta leads com status='contact' e last_contact_at >= hoje
    const fetchDailyCounts = useCallback(async () => {
        if (!instances.length) { setLoading(false); return }
        setLoading(true)
        try {

            const hoje = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().split('T')[0] // YYYY-MM-DD em BRT
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
                // Remove QR do mapa — chip conectou, não precisa mais exibir
                setQrMap(prev => {
                    const next = { ...prev }
                    delete next[instanceId]
                    return next
                })
                fetchDailyCounts()
            }
        }

        const onQr = ({ instanceId, qr }) => {
            setConnectingSet(prev => new Set(prev).add(instanceId))
            if (qr) setQrMap(prev => ({ ...prev, [instanceId]: qr }))
        }

        socket.on('whatsapp_status', onStatus)
        socket.on('qr_code',         onQr)
        return () => {
            socket.off('whatsapp_status', onStatus)
            socket.off('qr_code',         onQr)
        }
    }, [socket, fetchDailyCounts])

    const handleReconnect = useCallback((instanceId) => {
        if (!socket) return
        setConnectingSet(prev => new Set(prev).add(instanceId))
        socket.emit('reconnect_instance', instanceId)
        // Timeout de segurança: se em 30s não chegou CONNECTED nem qr_code, tira o spinner
        setTimeout(() => {
            setConnectingSet(prev => {
                const next = new Set(prev)
                next.delete(instanceId)
                return next
            })
        }, 30000)
    }, [socket])

    const handleResetSession = useCallback((instanceId) => {
        if (!socket) return
        setConnectingSet(prev => new Set(prev).add(instanceId))
        setQrMap(prev => { const next = { ...prev }; delete next[instanceId]; return next })
        socket.emit('reset_session', instanceId)
        setTimeout(() => {
            setConnectingSet(prev => {
                const next = new Set(prev)
                next.delete(instanceId)
                return next
            })
        }, 30000)
    }, [socket])

    const handleLimitChange = useCallback(async (instanceId, newLimit) => {
        await supabase.from('instances').update({ daily_limit: newLimit }).eq('id', instanceId)
    }, [])

    const handleToggleFlag = useCallback(async (instanceId, campo, valor) => {
        try {
            const { data: { session } } = await supabase.auth.getSession()
            await fetch(`/api/instance/${instanceId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({ [campo]: valor }),
            })
            socket?.emit('get_instances')
        } catch (e) {
            console.error('[ChipStatus] Falha ao atualizar flag do chip:', e)
        }
    }, [socket])

    const handleSaveCampaignFields = useCallback(async (instanceId, updates) => {
        try {
            const { data: { session } } = await supabase.auth.getSession()
            await fetch(`/api/instance/${instanceId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify(updates),
            })
            socket?.emit('get_instances')
        } catch (e) {
            console.error('[ChipStatus] Falha ao salvar configuração de campanha:', e)
        }
    }, [socket])

    const handleTogglePause = useCallback(async (instanceId, pausar) => {
        try {
            const { data: { session } } = await supabase.auth.getSession()
            await fetch(`/api/pause-chip/${instanceId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session?.access_token}`,
                },
                body: JSON.stringify({ paused: pausar }),
            })
            socket?.emit('get_instances') // força atualização imediata do estado no card
        } catch (e) {
            console.error('[ChipStatus] Falha ao pausar chip:', e)
        }
    }, [socket])

    // ── Sumários globais ──────────────────────────────────────────────────────
    const totalConectados = instances.filter(i => i.whatsapp_status === 'CONNECTED').length
    const totalDisparos   = Object.values(dailyCounts).reduce((s, v) => s + v, 0)
    const totalLimite     = instances.reduce((s, i) => s + (i.daily_limit ?? 30), 0)

    return (
        <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif", color: '#fff' }}>

            {/* ── Header ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <Cpu size={16} color={C.brand} />
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
                    { label: 'Disparos Hoje',   value: totalDisparos,                               color: C.brand,         icon: <Zap  size={11} color={C.brand} />, span: false },
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
                            onReconnect={handleReconnect}
                            onResetSession={handleResetSession}
                            onLimitChange={handleLimitChange}
                            onTogglePause={handleTogglePause}
                            onToggleFlag={handleToggleFlag}
                            onSaveCampaignFields={handleSaveCampaignFields}
                            qrCode={qrMap[inst.id] || null}
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
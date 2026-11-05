import { useState } from 'react'
import { Eye, EyeOff, Loader2, ShieldCheck, Zap, ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Telas de acesso: Login (com "ver senha" e "esqueci minha senha" funcionando) e "Definir nova senha".
// Tudo aqui é autocontido — o App só decide qual mostrar.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// Mesma regra do backend (lib/recuperarSenha.js). Antes a regex perdeu as barras (`[^s@]`) e rejeitava
// qualquer e-mail com a letra "s".
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ESTILO_INPUT = 'w-full h-14 rounded-xl bg-black/40 border border-white/10 text-white font-bold px-4 outline-none focus:border-amber-500 transition-colors placeholder:text-slate-600'

function Moldura({ children }) {
    return (
        <div className="min-h-[100dvh] bg-[#0A0A0A] flex items-center justify-center p-4 sm:p-6"
             style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            <div className="glass-panel p-6 sm:p-10 rounded-[2rem] sm:rounded-[2.5rem] border-amber-500/30 flex flex-col max-w-md w-full relative overflow-hidden"
                 style={{ boxShadow: '0 0 40px rgba(245,158,11,0.15)' }}>
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-600 via-amber-400 to-amber-600" />
                {children}
            </div>
        </div>
    )
}

function Cabecalho({ titulo, destaque, icone: Icone = ShieldCheck }) {
    return (
        <div className="flex flex-col items-center mb-7">
            <div className="bg-amber-600/20 p-4 rounded-3xl mb-5 border border-amber-500/30">
                <Icone className="h-9 w-9 text-amber-400" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white italic uppercase tracking-tighter leading-none text-center">
                {titulo} <span className="text-amber-500">{destaque}</span>
            </h2>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mt-2 text-center">Antix Flow</p>
        </div>
    )
}

// Campo de senha com o olho (mantém o foco e não vaza nada: só alterna o type do input).
export function CampoSenha({ valor, aoMudar, placeholder = '••••••••', autoComplete = 'current-password', rotulo, autoFocus = false }) {
    const [visivel, setVisivel] = useState(false)
    return (
        <div className="space-y-2">
            <label className="text-[10px] font-black text-amber-300 uppercase tracking-widest">{rotulo}</label>
            <div className="relative">
                <input
                    type={visivel ? 'text' : 'password'}
                    required
                    value={valor}
                    onChange={(e) => aoMudar(e.target.value)}
                    autoComplete={autoComplete}
                    autoFocus={autoFocus}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className={`${ESTILO_INPUT} pr-14`}
                    placeholder={placeholder}
                />
                <button
                    type="button"
                    onClick={() => setVisivel(v => !v)}
                    aria-label={visivel ? 'Esconder senha' : 'Mostrar senha'}
                    aria-pressed={visivel}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-11 w-11 flex items-center justify-center rounded-lg text-slate-400 hover:text-amber-400 active:bg-white/5 transition-colors"
                >
                    {visivel ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
            </div>
        </div>
    )
}

function Aviso({ tipo, children }) {
    const cores = tipo === 'ok'
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
        : 'bg-red-500/10 border-red-500/30 text-red-400'
    return (
        <div className={`border rounded-lg p-3 ${cores}`}>
            <p className="text-[11px] font-bold tracking-wide text-center leading-snug">{children}</p>
        </div>
    )
}

// ── LOGIN ───────────────────────────────────────────────────────────────────────────────────
export function LoginTela() {
    const [email, setEmail] = useState('')
    const [senha, setSenha] = useState('')
    const [erro, setErro] = useState(null)
    const [msg, setMsg] = useState(null)
    const [entrando, setEntrando] = useState(false)
    const [enviando, setEnviando] = useState(false)

    const entrar = async (e) => {
        e.preventDefault()
        setEntrando(true); setErro(null); setMsg(null)
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
        if (error) setErro(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message)
        setEntrando(false)
    }

    const esqueci = async () => {
        setErro(null); setMsg(null)
        if (!EMAIL_RE.test(email.trim())) {
            setErro('Digite seu e-mail no campo acima e toque de novo em "Esqueci minha senha".')
            return
        }
        setEnviando(true)
        try {
            const r = await fetch('/api/auth/esqueci-senha', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim() }),
            })
            if (!r.ok && r.status !== 429) throw new Error('falha')
            setMsg('Se este e-mail tiver conta, enviamos um link para criar uma nova senha. Pode levar alguns minutos. Confira também o spam.')
        } catch {
            setErro('Não consegui enviar agora. Verifique a conexão e tente de novo.')
        }
        setEnviando(false)
    }

    return (
        <Moldura>
            <Cabecalho titulo="Acesso" destaque="Restrito" />
            <form onSubmit={entrar} className="flex flex-col gap-4">
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-amber-300 uppercase tracking-widest">E-mail</label>
                    <input
                        type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                        autoComplete="username" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                        className={ESTILO_INPUT} placeholder="seu@email.com"
                    />
                </div>

                <CampoSenha rotulo="Senha" valor={senha} aoMudar={setSenha} />

                {erro && <Aviso tipo="erro">{erro}</Aviso>}
                {msg && <Aviso tipo="ok">{msg}</Aviso>}

                <button
                    type="submit" disabled={entrando}
                    className="w-full h-14 mt-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-70 text-black font-black rounded-xl shadow-lg uppercase italic text-sm transition-transform active:scale-95"
                >
                    {entrando ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : 'Entrar no Antix Flow'}
                </button>

                <button
                    type="button" onClick={esqueci} disabled={enviando}
                    className="min-h-11 text-[12px] text-slate-400 hover:text-amber-400 disabled:opacity-60 transition-colors text-center"
                >
                    {enviando ? 'Enviando…' : 'Esqueci minha senha'}
                </button>
            </form>
        </Moldura>
    )
}

// ── DEFINIR NOVA SENHA (depois de abrir o link do e-mail) ───────────────────────────────────
export function NovaSenhaTela({ estado, aoConcluir, aoVoltar }) {
    // estado: 'verificando' | 'pronto' | 'invalido'
    const [senha, setSenha] = useState('')
    const [confirma, setConfirma] = useState('')
    const [erro, setErro] = useState(null)
    const [salvando, setSalvando] = useState(false)

    if (estado === 'verificando') {
        return (
            <Moldura>
                <Cabecalho titulo="Validando" destaque="link" icone={Zap} />
                <Loader2 className="h-8 w-8 animate-spin text-amber-400 mx-auto" />
            </Moldura>
        )
    }

    if (estado === 'invalido') {
        return (
            <Moldura>
                <Cabecalho titulo="Link" destaque="expirado" />
                <Aviso tipo="erro">Este link já foi usado ou expirou. Peça um novo em "Esqueci minha senha".</Aviso>
                <button onClick={aoVoltar} className="mt-4 min-h-11 flex items-center justify-center gap-2 text-sm text-amber-400 font-bold">
                    <ArrowLeft className="h-4 w-4" /> Voltar ao login
                </button>
            </Moldura>
        )
    }

    const salvar = async (e) => {
        e.preventDefault()
        setErro(null)
        if (senha.length < 8) { setErro('A senha precisa ter pelo menos 8 caracteres.'); return }
        if (senha !== confirma) { setErro('As duas senhas não são iguais.'); return }
        setSalvando(true)
        const { error } = await supabase.auth.updateUser({ password: senha })
        setSalvando(false)
        if (error) { setErro(error.message); return }
        aoConcluir()
    }

    return (
        <Moldura>
            <Cabecalho titulo="Nova" destaque="senha" />
            <form onSubmit={salvar} className="flex flex-col gap-4">
                <CampoSenha rotulo="Nova senha" valor={senha} aoMudar={setSenha} autoComplete="new-password" placeholder="mínimo 8 caracteres" autoFocus />
                <CampoSenha rotulo="Repita a nova senha" valor={confirma} aoMudar={setConfirma} autoComplete="new-password" placeholder="repita a senha" />
                {erro && <Aviso tipo="erro">{erro}</Aviso>}
                <button
                    type="submit" disabled={salvando}
                    className="w-full h-14 mt-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-70 text-black font-black rounded-xl shadow-lg uppercase italic text-sm transition-transform active:scale-95"
                >
                    {salvando ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : 'Salvar e entrar'}
                </button>
            </form>
        </Moldura>
    )
}

// Barra de navegação inferior do celular (substitui a lateral). Alvos de toque de 56px, ícone + nome.
export default function NavInferior({ itens, ativo, aoMudar, badges = {} }) {
    return (
        <nav className="shrink-0 flex items-stretch z-40" role="tablist"
             style={{ background: '#0d0d0d', borderTop: '1px solid rgba(255,255,255,0.08)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            {itens.map(({ key, icon: Icone, label }) => {
                const on = ativo === key
                const badge = badges[key]
                return (
                    <button key={key} role="tab" aria-selected={on} onClick={() => aoMudar(key)}
                            className="relative flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 active:bg-white/5"
                            style={{ minHeight: 58, color: on ? '#F59E0B' : 'rgba(255,255,255,0.45)' }}>
                        <span className="relative">
                            <Icone className="h-[26px] w-[26px]" strokeWidth={on ? 2.4 : 1.9} />
                            {badge > 0 && (
                                <span className="absolute -top-1 -right-2 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: '#00a884', color: '#0b141a' }}>
                                    {badge > 99 ? '99+' : badge}
                                </span>
                            )}
                        </span>
                        <span className="text-[10.5px] leading-none font-semibold truncate max-w-full px-0.5">{label}</span>
                    </button>
                )
            })}
        </nav>
    )
}

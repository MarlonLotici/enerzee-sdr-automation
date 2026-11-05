import { useState } from 'react'
import { EllipsisVertical, Settings, LogOut, Cpu, X } from 'lucide-react'
import ConversaList from './ConversaList'
import ChatMobile from './ChatMobile'

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ABA WHATSAPP NO CELULAR — igual ao app: lista de conversas; tocar abre a conversa em tela cheia.
// O estado (conversa aberta, mensagens, envio, pausa) vem do App — é o mesmo do computador.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export default function WhatsAppMobile({
    instances, socket, selectedInstanceId,
    activeChat, setActiveChat, chatMessages,
    messageInput, setMessageInput, onSend, onTogglePause, onBaixa, onFechar, followUp,
    onConfig, onSair, painelChips,
}) {
    const [menu, setMenu] = useState(false)
    const [chips, setChips] = useState(false)
    const online = instances.filter(i => i.whatsapp_status === 'CONNECTED').length

    return (
        <div className="flex-1 flex flex-col min-h-0 w-full" style={{ background: '#111b21' }}>
            {/* Cabeçalho */}
            <header className="shrink-0 flex items-center justify-between pl-4 pr-1" style={{ paddingTop: 'env(safe-area-inset-top)', minHeight: 56 }}>
                <h1 className="text-[24px] font-bold tracking-tight" style={{ color: '#e9edef' }}>Conversas</h1>
                <div className="flex items-center">
                    <button onClick={() => setChips(true)} aria-label="Estado dos chips" className="h-11 px-3 flex items-center gap-2 rounded-full active:bg-white/10">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: online > 0 ? '#25d366' : '#f87171', boxShadow: online > 0 ? '0 0 6px #25d366' : 'none' }} />
                        <span className="text-[13px]" style={{ color: '#8696a0' }}>{online > 0 ? 'Online' : 'Offline'}</span>
                    </button>
                    <button onClick={() => setMenu(true)} aria-label="Mais opções" className="h-11 w-11 flex items-center justify-center rounded-full active:bg-white/10" style={{ color: '#e9edef' }}>
                        <EllipsisVertical className="h-5 w-5" />
                    </button>
                </div>
            </header>

            <div className="flex-1 min-h-0">
                <ConversaList
                    mobile
                    onSelect={setActiveChat}
                    activeId={activeChat?.id}
                    socket={socket}
                    instances={instances}
                    selectedInstanceId={selectedInstanceId}
                />
            </div>

            {/* Conversa aberta: tela cheia por cima de tudo */}
            {activeChat && (
                <ChatMobile
                    lead={activeChat}
                    instances={instances}
                    mensagens={chatMessages}
                    texto={messageInput}
                    setTexto={setMessageInput}
                    aoEnviar={onSend}
                    aoAlternarIA={onTogglePause}
                    aoBaixa={onBaixa}
                    aoFechar={onFechar}
                    aoVoltar={() => setActiveChat(null)}
                    followUp={followUp}
                />
            )}

            {/* Menu ⋮ da lista */}
            {menu && (
                <div className="fixed inset-0 z-[80]" onClick={() => setMenu(false)}>
                    <div className="absolute inset-0 bg-black/50" />
                    <div className="absolute right-2 rounded-xl overflow-hidden shadow-2xl" style={{ top: 'calc(env(safe-area-inset-top) + 52px)', background: '#233138', minWidth: 210 }} onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { setMenu(false); setChips(true) }} className="w-full min-h-12 flex items-center gap-3 px-4 text-left active:bg-white/5" style={{ color: '#e9edef' }}><Cpu className="h-5 w-5" style={{ color: '#8696a0' }} /><span className="text-[16px]">Estado dos chips</span></button>
                        <button onClick={() => { setMenu(false); onConfig?.() }} className="w-full min-h-12 flex items-center gap-3 px-4 text-left active:bg-white/5" style={{ color: '#e9edef' }}><Settings className="h-5 w-5" style={{ color: '#8696a0' }} /><span className="text-[16px]">Configurações</span></button>
                        <button onClick={() => { setMenu(false); onSair?.() }} className="w-full min-h-12 flex items-center gap-3 px-4 text-left active:bg-white/5" style={{ color: '#f87171' }}><LogOut className="h-5 w-5" /><span className="text-[16px]">Sair</span></button>
                    </div>
                </div>
            )}

            {/* Estado dos chips (saúde/painel completo) */}
            {chips && (
                <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: '#0b141a' }}>
                    <div className="shrink-0 flex items-center justify-between pl-4 pr-1" style={{ background: '#202c33', paddingTop: 'env(safe-area-inset-top)', minHeight: 56 }}>
                        <h2 className="text-[19px] font-medium" style={{ color: '#e9edef' }}>Estado dos chips</h2>
                        <button onClick={() => setChips(false)} aria-label="Fechar" className="h-12 w-12 flex items-center justify-center rounded-full active:bg-white/10" style={{ color: '#e9edef' }}><X className="h-6 w-6" /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>{painelChips}</div>
                </div>
            )}
        </div>
    )
}

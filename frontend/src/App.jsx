import React, { useState, useEffect, useRef, useMemo } from 'react'
// --- IMPORTAÇÕES DE UI ---
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import NicheSelect from './components/NicheSelect'
import VisualAnalytics from "@/components/VisualAnalytics"
import ChipStatus from "./components/Chipstatus"
import HealthPanel from "./components/HealthPanel"
import ConversaList from './components/ConversaList'
import OnboardingBriefing from './components/OnboardingBriefing'
import Dashboard from "./Dashboard"
import AuditorDashboard from "./components/AuditorDashboard"
import { textoTemperatura, rotuloTemperatura } from './lib/temperatura'
// --- ÍCONES (FULL SET 2026) ---
import { 
    Rocket, MapPin, LayoutDashboard, MessageSquare, Phone, Play, LocateFixed, Send,
    BrainCircuit, Search, Download, X, CheckSquare, Square, Users, StopCircle,
    Map as MapIcon, Loader2, Edit2, Trash2, Crosshair, Zap, Star, ShieldCheck, FileText,
    DollarSign, Briefcase, Building2, ArrowRight, ShieldAlert, Trash, Check, BarChart2, Flame, Cpu, Radio, Settings, LogOut, Menu, ChevronDown,
    ChevronLeft, ChevronRight, Calendar, XCircle, CheckCircle2, AlertTriangle, PanelLeftClose, PanelLeftOpen
} from 'lucide-react'

// --- MAPAS E SOCKET ---
import { io } from 'socket.io-client'
import { QRCodeSVG } from 'qrcode.react'
import { MapContainer, TileLayer, Circle, Marker, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet';

// Fix Ícones Leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
let DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

// Conexão Socket
const SOCKET_URL = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;
const socket = io(SOCKET_URL, { autoConnect: false });
// Som de notificação
const playNotificationSound = () => {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    audio.volume = 0.5;
    audio.play().catch(e => console.log("Audio play blocked", e));
}

// --- Componentes Mapa ---

import { supabase } from '@/lib/supabase'
    // --- COMPONENTES AUXILIARES DO MAPA --- //mudança
function MapController({ center }) {
    const map = useMap();
    useEffect(() => { 
        if (center && center[0] !== 0) map.flyTo(center, 13, { animate: true, duration: 1.5 }); 
    }, [center, map]);
    return null;
}

function MapClickHandler({ setCenter, setLocationName, setSearchMode }) {
    useMapEvents({
        click(e) {
            setCenter([e.latlng.lat, e.latlng.lng]);
            if (setLocationName) setLocationName(`📍 Ponto Selecionado (${e.latlng.lat.toFixed(4)})`);
            if (setSearchMode) setSearchMode("map");
        }
    });
    return null;
}

        // ── Sidebar Navigation ──
const NAV_ITEMS = [
    { key: 'search', icon: Radio, label: 'Radar', color: '#F59E0B' },
    { key: 'crm', icon: LayoutDashboard, label: 'Pipeline', color: '#F59E0B' },
    { key: 'connections', icon: MessageSquare, label: 'WhatsApp', color: '#F59E0B' },
    { key: 'dashboard', icon: BarChart2, label: 'Analytics', color: '#F59E0B' },
    { key: 'briefing', icon: FileText, label: 'Briefing', color: '#F59E0B' },
]

function AppSidebar({ activeTab, setActiveTab, leadsCount, onLogout }) {
    return (
        <div className="sidebar flex flex-col h-full py-3 px-2 z-50 shrink-0"
             style={{ background: '#0d0d0d', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
            {/* Logo */}
            <div className="flex items-center gap-3 px-3 mb-6">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                     style={{ background: 'linear-gradient(135deg, #D97706, #F59E0B, #FBBF24)', boxShadow: '0 0 20px rgba(245,158,11,0.3)' }}>
                    <Zap className="h-5 w-5 text-black" />
                </div>
                <div className="label overflow-hidden">
                    <p style={{ fontSize: 14, fontWeight: 900, color: '#fff', lineHeight: 1, letterSpacing: '0.05em' }}>
                    <span style={{ color: '#F59E0B' }}>A</span>NT<span style={{ color: '#F59E0B' }}>I</span>X
                       </p>
                       <p style={{ fontSize: 7, fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.2em' }}>by Antix</p>
               </div>
            </div>

            {/* Nav items */}
            <nav className="flex-1 flex flex-col gap-1 px-1">
                {NAV_ITEMS.map(item => (
                    <div
                        key={item.key}
                        onClick={() => setActiveTab(item.key)}
                        className={`sidebar-item ${activeTab === item.key ? 'active' : ''}`}
                    >
                        <item.icon className="h-5 w-5 shrink-0" />
                        <span className="label">{item.label}</span>
                        {/* Badge para WhatsApp (contador de conversas ativas) */}
                        {item.key === 'connections' && leadsCount > 0 && (
                            <span className="label" style={{
                                marginLeft: 'auto',
                                fontSize: 9, fontWeight: 900,
                                background: 'rgba(245,158,11,0.15)',
                                color: '#FBBF24',
                                padding: '1px 6px',
                                borderRadius: 999,
                                border: '1px solid rgba(245,158,11,0.3)',
                            }}>
                                {leadsCount}
                            </span>
                        )}
                    </div>
                ))}
            </nav>

            {/* Bottom */}
            <div className="flex flex-col gap-1 px-1 mt-auto pt-4 border-t border-white/5">
                {/* Leads counter */}
                <div className="sidebar-item" style={{ cursor: 'default' }}>
                    <Users className="h-5 w-5 shrink-0 text-slate-600" />
                    <span className="label" style={{ color: 'rgba(255,255,255,0.3)' }}>
                        {leadsCount} leads
                    </span>
                </div>
                {/* Logout */}
                <div className="sidebar-item" onClick={onLogout}>
                    <LogOut className="h-5 w-5 shrink-0" />
                    <span className="label">Sair</span>
                </div>
            </div>
        </div>
    )
}


// ==================================================================================
// COMPONENTE PRINCIPAL
// ==================================================================================
    export default function App() {
    const [session, setSession] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    // --- ESTADOS DO LOGIN ---
    const [loginEmail, setLoginEmail] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginError, setLoginError] = useState(null);
    const [isLoggingIn, setIsLoggingIn] = useState(false);

    // Monitora o estado de login
    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setAuthLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });

        return () => subscription.unsubscribe();
    }, []);

    // --- REFERÊNCIAS ---
   const kanbanRef = useRef(null);
    const logsEndRef = useRef(null);
    const chatEndRef = useRef(null);
    const notesTimerRef = useRef(null);
    const chipConnectTimerRef = useRef(null);

    // --- ESTADOS DE NAVEGAÇÃO E DADOS ---
    const [activeTab, setActiveTab] = useState("search");
    const [analyticsView, setAnalyticsView] = useState('overview')
    const [leads, setLeads] = useState([]);
    const [chats, setChats] = useState([]);
    const [activeChat, setActiveChat] = useState(null);
    const [chatMessages, setChatMessages] = useState([]);
    const [viewingLeadDetail, setViewingLeadDetail] = useState(null);
    const [editingLead, setEditingLead] = useState(null);
    const [selectedLeadIds, setSelectedLeadIds] = useState(new Set());
    const [messageInput, setMessageInput] = useState("");
    const [sessionLeadsCount, setSessionLeadsCount] = useState(0);
    const [liveCall, setLiveCall] = useState(null); // 📞 ligação de voz IA em andamento
    const [showBriefing, setShowBriefing] = useState(false)
    const [briefingCompleted, setBriefingCompleted] = useState(null) // null = loading, true/false
    // --- ESTADOS DO MOTOR IA (MULTI-INSTÂNCIA 2026) ---
const [isConnected, setIsConnected] = useState(false);
const [qrCodeData, setQrCodeData] = useState(null); // Agora guarda { qr, instanceId, name }
const [isConnectingChip, setIsConnectingChip] = useState(false);
const [instances, setInstances] = useState([]); // Lista de chips no banco
const [selectedInstanceId, setSelectedInstanceId] = useState(null);
const [isBotRunning, setIsBotRunning] = useState(false);
const [scraperLeadsCount, setScraperLeadsCount] = useState(0);
const [botProgress, setBotProgress] = useState(0);
const [botLogs, setBotLogs] = useState([]);

// --- ESTADOS DE BUSCA E MAPA ---
    const [filterText, setFilterText] = useState("");
    const [selectedNiche, setSelectedNiche] = useState(null);
    const [locationName, setLocationName] = useState("");
    const [searchRadius, setSearchRadius] = useState(2);
    const [mapCenter, setMapCenter] = useState([-27.5969, -48.5495]);
    const [isSearchingCity, setIsSearchingCity] = useState(false);
    const [citySuggestions, setCitySuggestions] = useState([]);
    const [showNotes, setShowNotes] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [settingsForm, setSettingsForm] = useState({ calendly_link: '', default_agent_name: '', default_company_name: '', default_daily_limit: '', opening_a: '', opening_b: '', opening_c: '' });
    const [savingSettings, setSavingSettings] = useState(false);
    const [settingsError, setSettingsError] = useState(null);
    const [settingsOk, setSettingsOk] = useState(false);
    const [applyingPersona, setApplyingPersona] = useState(false);
    const [personaMsg, setPersonaMsg] = useState(null);
    // — Google Agenda (confirmação diária de reuniões) —
    const [gcalConfig, setGcalConfig] = useState(null); // { google_email, calendar_id, confirmacao_ativa, confirmacao_hora }
    const [gcalConectado, setGcalConectado] = useState(false);
    const [gcalCalendars, setGcalCalendars] = useState([]);
    const [gcalMsg, setGcalMsg] = useState(null);
    const [gcalBusy, setGcalBusy] = useState(false);
    // Retorno do OAuth do Google (?gcal=ok|erro): abre Settings e mostra o resultado.
    useEffect(() => {
        const p = new URLSearchParams(window.location.search).get('gcal');
        if (!p) return;
        window.history.replaceState({}, '', window.location.pathname);
        if (p === 'ok') { setGcalMsg({ ok: true, text: '✓ Google Agenda conectada!' }); openSettings(); }
        else setGcalMsg({ ok: false, text: 'Não foi possível conectar a Google Agenda. Tente de novo.' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // — Cérebro da Conversa (tenant_prompts) —
    const [showPrompts, setShowPrompts] = useState(false);
    const [promptsForm, setPromptsForm] = useState({ system_prompt: '', qualifier_prompt: '', closer_prompt: '', objection_prompt: '' });
    const [activePromptTab, setActivePromptTab] = useState('system_prompt');
    const [loadingPrompts, setLoadingPrompts] = useState(false);
    const [savingPrompts, setSavingPrompts] = useState(false);
    const [promptsError, setPromptsError] = useState(null);
    const [promptsSaved, setPromptsSaved] = useState(false);
    const [copiedVar, setCopiedVar] = useState(null)
    const [isAtencaoOpen, setIsAtencaoOpen] = useState(false)
    const [showFollowUpPicker, setShowFollowUpPicker] = useState(false)
    const [followUpDateTime, setFollowUpDateTime] = useState('');
    const [notesContent, setNotesContent] = useState(() => localStorage.getItem('radar_notes') ?? '');
    const [showExportMenu, setShowExportMenu] = useState(false);

    // --- MÉTRICAS A/B/C DE ABERTURA ---
    const openingStats = useMemo(() => {
        const LABELS = { abertura_v1: 'A', abertura_v2: 'B', abertura_v3: 'C' };
        const stats = {};
        leads.forEach(lead => {
            if (!lead.opening_template) return;
            const base = lead.opening_template.replace('_decisor', '');
            if (!LABELS[base]) return; // ignora templates fora do padrão A/B/C
            if (!stats[base]) stats[base] = { label: LABELS[base], total: 0, responded: 0, booked: 0 };
            stats[base].total++;
            if (['contact', 'booked', 'closed', 'waiting_analysis'].includes(lead.status)) stats[base].responded++;
            if (lead.status === 'booked' || lead.status === 'closed') stats[base].booked++;
        });
        return Object.values(stats).sort((a, b) => a.label.localeCompare(b.label));
    }, [leads]);

    // --- PERFORMANCE: FILTRO MEMOIZADO ---
    const filteredLeads = useMemo(() => {
        const lower = filterText.toLowerCase();
        return leads.filter(l => 
            filterText === "" || 
            (l.name && String(l.name).toLowerCase().includes(lower)) ||
            (l.dono && String(l.dono).toLowerCase().includes(lower)) ||
            (l.phone && String(l.phone).includes(lower)) ||
            (l.cnpj && String(l.cnpj).includes(lower))
        );
    }, [leads, filterText]);

// 🎯 Roteador Inteligente do Kanban (Sincronizado com o Analytics V13)
const getLeadsByStatus = (coluna) => {
    return filteredLeads.filter(l => {
        // A mesma regra de ouro do Analytics:
        const isAgendado = l.status === 'booked' || l.calendly_booked === true || (l.current_stage || 0) >= 4;

        if (coluna === 'booked') return isAgendado;
        if (coluna === 'waiting_analysis') return l.status === 'waiting_analysis' && !isAgendado;
        if (coluna === 'contact') return l.status === 'contact' && !isAgendado;
        if (coluna === 'new') return l.status === 'new' && !isAgendado;
        if (coluna === 'error') return l.status === 'error';
        // Coluna "Fora do Fluxo": status que antes eram invisíveis no Kanban (buracos-negros).
        // O lead levou email frio, não tem email, ou está no meio de uma reserva atômica.
        if (coluna === 'fora_do_fluxo') return ['email_sent', 'no_email', 'reservado'].includes(l.status);
        // Coluna "Encerrados": CATCH-ALL real — qualquer lead que não caia em nenhuma outra coluna
        // (dead/invalid/closed/blacklisted/waiting_analysis/error/status desconhecido). Garante que
        // NENHUM lead fique invisível no pipeline, mesmo com o funil todo em status terminal.
        if (coluna === 'encerrados')
            return !isAgendado && !['new', 'contact', 'email_sent', 'no_email', 'reservado'].includes(l.status);

        return false;
    });
};
// 🔥 Hot Leads: temperatura quente, independente de status (exceto finalizados)
const getHotLeads = () => filteredLeads.filter(l => 
    l.lead_temperature === 'hot' && 
    !['booked', 'dead', 'invalid', 'blacklisted'].includes(l.status)
);

// 📭 Aguardando Resposta: IA enviou abertura mas lead ainda não avançou nem recebeu follow-up
// followup_count = 0 E stage = 0 = genuinamente aguardando primeira resposta
const getAwaitingReply = () => filteredLeads.filter(l =>
    l.status === 'contact' &&
    (!l.current_stage || l.current_stage === 0) &&
    (!l.followup_count || l.followup_count === 0)
);

   
    // --- LÓGICA: SCROLL LATERAL POR MOUSE (EDGE SCROLLING) ---
    useEffect(() => {
    let animationFrame = null;
    
    const handleMouseMove = (e) => {
        if (activeTab !== 'crm' || !kanbanRef.current) return;
        
        const threshold = 150;
        const maxSpeed = 8; // pixels por frame — muito mais suave
        const width = window.innerWidth;
        
        // Cancela animação anterior
        if (animationFrame) cancelAnimationFrame(animationFrame);
        
        const scrollStep = () => {
            if (!kanbanRef.current) return;
            
            if (e.pageX > width - threshold) {
                // Velocidade proporcional à proximidade da borda
                const intensity = (e.pageX - (width - threshold)) / threshold;
                kanbanRef.current.scrollLeft += maxSpeed * intensity;
                animationFrame = requestAnimationFrame(scrollStep);
            } else if (e.pageX < threshold) {
                const intensity = (threshold - e.pageX) / threshold;
                kanbanRef.current.scrollLeft -= maxSpeed * intensity;
                animationFrame = requestAnimationFrame(scrollStep);
            }
        };
        
        animationFrame = requestAnimationFrame(scrollStep);
    };
    
    const handleMouseLeave = () => {
        if (animationFrame) cancelAnimationFrame(animationFrame);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);

    return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseleave', handleMouseLeave);
        if (animationFrame) cancelAnimationFrame(animationFrame);
    };
}, [activeTab]);

    // --- SOCKETS E INICIALIZAÇÃO ---
    useEffect(() => {
        fetchLeadsFromDB();
         
       // Verifica se cliente já preencheu o briefing
const checkBriefing = async () => {
    const { data: briefings } = await supabase
        .from('client_briefings')
        .select('id, status')
        .eq('user_id', session?.user?.id)
        .limit(1)

    if (!briefings || briefings.length === 0) {
        setBriefingCompleted(false)
        setShowBriefing(true)
    } else {
        setBriefingCompleted(true)
    }
}
if (session?.user?.id) checkBriefing()
        // Pega a chave digital da sessão atual e injeta no motor antes de ligar
        supabase.auth.getSession().then(({ data }) => {
            if (data.session) {
                socket.auth = { token: data.session.access_token };
                socket.connect();
            }
        });

        // PEDIR LISTA AO CONECTAR
    socket.on('connect', () => {
            socket.emit('get_instances'); 
            socket.emit('check_scraper_status');
        });

        socket.on('instances_list', (list) => {
    setInstances(list);
    // Se a lista chegou e não temos nada selecionado, seleciona o primeiro chip automaticamente
    if (list.length > 0 && !selectedInstanceId) {
        setSelectedInstanceId(list[0].id);
    }
});

        socket.on('qr_code', (data) => {
            if (chipConnectTimerRef.current) { clearTimeout(chipConnectTimerRef.current); chipConnectTimerRef.current = null; }
            setIsConnectingChip(false);
            setQrCodeData(data);
        });

        socket.on('whatsapp_status', (statusData) => {
            const { status, instanceId } = statusData;
            if (status === 'CONNECTED') {
                setQrCodeData(null);
                setIsConnected(true);
                socket.emit('get_instances');
            } else {
                // Feedback imediato: vermelho na hora, sem esperar o DB
                setInstances(prev => prev.map(i =>
                    i.id === instanceId ? { ...i, whatsapp_status: 'DISCONNECTED' } : i
                ));
                // Re-sincroniza com DB após 2s (DB é atualizado de forma assíncrona no backend)
                setTimeout(() => socket.emit('get_instances'), 2000);
            }
        });

        socket.on('chip_needs_reauth', ({ instanceId, instanceName }) => {
            // Chip foi deslogado/banido — marca vermelho e exibe aviso específico
            setInstances(prev => prev.map(i =>
                i.id === instanceId ? { ...i, whatsapp_status: 'NEEDS_REAUTH' } : i
            ));
            console.warn(`[REAUTH] Chip ${instanceName} precisa re-escanear QR`);
        });

        socket.on('instance_removed', (removedId) => {
        setInstances(prev => prev.filter(i => i.id !== removedId));
        if (qrCodeData?.instanceId === removedId) setQrCodeData(null);
        if (selectedInstanceId === removedId) setSelectedInstanceId(null);
        });



        socket.on('new_lead', (l) => { 
            setLeads(prev => [l, ...prev]); 
            setSessionLeadsCount(c => c + 1);
            setRealTotalLeads(c => c + 1); // 🎯 Atualiza o contador visual na hora
            playNotificationSound();
        });

        socket.on('notification', (m) => {
            setBotLogs(prev => [...prev, m]);
            if (m.includes('extraído') || m.includes('Lead ')) setScraperLeadsCount(c => c + 1);
        });
        socket.on('scraping_stopped', () => { setIsBotRunning(false); });
        socket.on('scraper_status', (statusData) => {
            setIsBotRunning(statusData.isRunning);
            if (statusData.isRunning) {
                setBotLogs(statusData.recentLogs || []);
            } else {
                setScraperLeadsCount(0);
            }
        });

        // Ouve a emissão em broadcast para leads salvos no background
        socket.on('background_lead_saved', () => {
            // Recarrega a tabela silenciosamente para atualizar os contadores
            fetchLeadsFromDB();
        });

        // 📞 Eventos de ligação de voz da IA (painel flutuante ao vivo)
        socket.on('call_status', (d) => {
            setLiveCall(prev => {
                if (prev && prev.callId !== d.callId && prev.status !== 'ended') return prev;
                const base = (prev && prev.callId === d.callId) ? prev : { transcript: [] };
                return { ...base, callId: d.callId, leadId: d.leadId, leadName: d.leadName, status: d.status };
            });
        });
        socket.on('call_transcript_chunk', (d) => {
            if (d.parcial) return; // interim results só poluem o painel
            setLiveCall(prev => {
                if (!prev || prev.callId !== d.callId) return prev;
                return { ...prev, transcript: [...(prev.transcript || []), { speaker: d.speaker, text: d.text }].slice(-30) };
            });
        });
        socket.on('call_ended', (d) => {
            setLiveCall(prev => (prev && prev.callId === d.callId)
                ? { ...prev, status: 'ended', outcome: d.outcome, durationSeconds: d.durationSeconds }
                : prev);
            fetchLeadsFromDB();
        });

        return () => socket.disconnect();
    }, []);



    const [realTotalLeads, setRealTotalLeads] = useState(0);

    const fetchLeadsFromDB = async () => {
        // Lê a sessão atual direto do Supabase — evita closure stale quando chamado antes do auth
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        const userId = currentSession?.user?.id;
        if (!userId) return;

        // 2. Baixa leads por TENANT (user_id) — fonte de verdade confiável e independente de chip.
        // Chip é efêmero; lead de chip removido tem instance_id=null. Filtrar por user_id garante que
        // nenhum lead entre em "limbo" quando o chip cai/é deletado, inclusive com zero chip conectado.
        const { data } = await supabase.from('leads')
            .select('id, name, phone, status, niche, dono, cnpj, bairro, cep, porte, capital_social_numeric, whatsapp_id, instance_id, lat, lng, created_at, last_contact_at, is_paused, manual_pause, current_stage, lead_temperature, followup_count, opening_template, backup_phones, confirmacao_status')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(10000);
        if (data) setLeads(data);

        // 3. Total real filtrado por usuário
        const { count } = await supabase.from('leads')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);
        if (count !== null) setRealTotalLeads(count);
    };

    // --- LÓGICA DE BUSCA DAS MENSAGENS REAIS ---
    useEffect(() => {
        if (!activeChat) {
            setChatMessages([]);
            return;
        }

        const fetchMessages = async () => {
            const { data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('whatsapp_id', activeChat.whatsapp_id)
                .order('created_at', { ascending: true }); // Mais antigas em cima, mais novas embaixo

            if (data && !error) {
                setChatMessages(data);
                // Força a rolagem para a mensagem mais recente
                setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
            }
        };

        fetchMessages();
    }, [activeChat]);

    const handleMyLocation = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (p) => setMapCenter([p.coords.latitude, p.coords.longitude]),
                () => alert("Ative o GPS do seu navegador.")
            );
        }
    };

    const handleStartSDR = () => {
        if(!isConnected) return alert("Conecte o WhatsApp via QR Code primeiro.");
        socket.emit('start_sdr');
    };

    const startScraping = () => {
    console.log("Tentando iniciar Scraping com ID:", selectedInstanceId);
    if (!selectedInstanceId) return alert("Por favor, selecione um chip na aba Connections antes de iniciar.");
    
    setIsBotRunning(!isBotRunning);
    if (!isBotRunning) {
        setScraperLeadsCount(0);
        setBotLogs([]);
        socket.emit('start_scraping', {
            niche: selectedNiche?.keywords,
            radius: searchRadius,
            city: locationName,
            lat: mapCenter[0],
            lng: mapCenter[1],
            instanceId: selectedInstanceId
        });
        setActiveTab("crm");
    } else socket.emit('stop_scraping');
};

    const handleCitySearch = async (q) => {
        setLocationName(q);
        if (q.length < 3) return setCitySuggestions([]);
        setIsSearchingCity(true);
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&countrycodes=br&limit=5`);
            const data = await res.json();
            setCitySuggestions(data);
        } finally { setIsSearchingCity(false); }
    };

    const toggleSelectLead = (id) => {
        const n = new Set(selectedLeadIds);
        n.has(id) ? n.delete(id) : n.add(id);
        setSelectedLeadIds(n);
    };

    const openSettings = async () => {
        const { data: { session: s } } = await supabase.auth.getSession();
        if (!s?.user?.id) return;
        const { data } = await supabase.from('profiles')
            .select('calendly_link, default_agent_name, default_company_name, default_daily_limit, opening_templates, notes')
            .eq('id', s.user.id).maybeSingle();
        setSettingsForm({
            calendly_link: data?.calendly_link || '',
            default_agent_name: data?.default_agent_name || '',
            default_company_name: data?.default_company_name || '',
            default_daily_limit: data?.default_daily_limit || '',
            opening_a: data?.opening_templates?.padrao?.[0] || '',
            opening_b: data?.opening_templates?.padrao?.[1] || '',
            opening_c: data?.opening_templates?.padrao?.[2] || '',
        });
        if (data?.notes != null) setNotesContent(data.notes);
        setGcalMsg(null);
        fetchGcal();
        setShowSettings(true);
    };

    const saveSettings = async () => {
        setSavingSettings(true);
        setSettingsError(null);
        setSettingsOk(false);
        const { data: { session: s } } = await supabase.auth.getSession();
        if (!s?.user?.id) {
            setSavingSettings(false);
            setSettingsError('Sessão expirada. Faça login novamente.');
            return; // não fecha o modal — o usuário perderia o que digitou
        }
        const padrao = [settingsForm.opening_a, settingsForm.opening_b, settingsForm.opening_c].filter(Boolean);
        const { error } = await supabase.from('profiles').upsert({
            id: s.user.id,
            calendly_link: settingsForm.calendly_link || null,
            default_agent_name: settingsForm.default_agent_name || null,
            default_company_name: settingsForm.default_company_name || null,
            default_daily_limit: settingsForm.default_daily_limit ? Number(settingsForm.default_daily_limit) : null,
            opening_templates: padrao.length > 0 ? { padrao } : null,
        }, { onConflict: 'id' });
        setSavingSettings(false);
        if (error) {
            // Antes o erro era engolido e o modal fechava — o usuário achava que salvou (não salvava por RLS).
            setSettingsError('Não foi possível salvar: ' + error.message);
            return;
        }
        setSettingsOk(true);
        setTimeout(() => { setSettingsOk(false); setShowSettings(false); }, 900);
    };

    // Aplica nome do SDR / nome da empresa a TODOS os chips da conta (atalho "aplicar a todos").
    // A persona é por chip, mas normalmente o usuário quer o mesmo nome em todos.
    const aplicarPersonaATodos = async () => {
        setApplyingPersona(true);
        setPersonaMsg(null);
        try {
            const { data: { session: s } } = await supabase.auth.getSession();
            const resp = await fetch('/api/account/apply-persona', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s?.access_token}` },
                body: JSON.stringify({
                    agent_name: settingsForm.default_agent_name || '',
                    company_name: settingsForm.default_company_name || '',
                }),
            });
            const json = await resp.json();
            if (!resp.ok || !json.ok) throw new Error(json.error || 'Falha ao aplicar.');
            setPersonaMsg({ ok: true, text: `✓ Aplicado a ${json.chipsAtualizados} chip(s).` });
        } catch (err) {
            setPersonaMsg({ ok: false, text: err.message });
        } finally {
            setApplyingPersona(false);
        }
    };

    // ── Google Agenda ──────────────────────────────────────────────
    const _authHeader = async () => {
        const { data: { session: s } } = await supabase.auth.getSession();
        return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s?.access_token}` };
    };
    const fetchGcal = async () => {
        try {
            const headers = await _authHeader();
            const resp = await fetch('/api/google/confirmacao/config', { headers });
            const json = await resp.json();
            if (json.ok) {
                setGcalConectado(json.conectado);
                setGcalConfig(json.config || { calendar_id: '', confirmacao_ativa: false, confirmacao_hora: 11 });
                if (json.conectado) {
                    const rc = await fetch('/api/google/calendars', { headers });
                    const jc = await rc.json();
                    if (jc.ok) setGcalCalendars(jc.calendars || []);
                }
            }
        } catch { /* silencioso — a seção só não carrega */ }
    };
    const conectarGoogle = async () => {
        setGcalBusy(true); setGcalMsg(null);
        try {
            const resp = await fetch('/api/google/oauth/start', { headers: await _authHeader() });
            const json = await resp.json();
            if (!resp.ok || !json.url) throw new Error(json.error || 'Falha ao iniciar conexão.');
            window.location.href = json.url; // redireciona pro consentimento do Google
        } catch (err) {
            setGcalMsg({ ok: false, text: err.message }); setGcalBusy(false);
        }
    };
    const salvarGcalConfig = async (patch) => {
        setGcalBusy(true); setGcalMsg(null);
        try {
            const resp = await fetch('/api/google/confirmacao/config', {
                method: 'POST', headers: await _authHeader(), body: JSON.stringify(patch),
            });
            const json = await resp.json();
            if (!resp.ok || !json.ok) throw new Error(json.error || 'Falha ao salvar.');
            setGcalConfig(c => ({ ...c, ...patch }));
            setGcalMsg({ ok: true, text: '✓ Configuração salva.' });
        } catch (err) {
            setGcalMsg({ ok: false, text: err.message });
        } finally { setGcalBusy(false); }
    };
    const rodarConfirmacaoAgora = async () => {
        setGcalBusy(true); setGcalMsg(null);
        try {
            const resp = await fetch('/api/google/confirmacao/run-now', { method: 'POST', headers: await _authHeader() });
            const json = await resp.json();
            if (!resp.ok || !json.ok) throw new Error(json.error || 'Falha ao disparar.');
            const r = json.resultado || {};
            setGcalMsg({ ok: true, text: r.ok ? `✓ ${r.enviados || 0} confirmação(ões) enviada(s).` : `Nada enviado (${r.motivo || 'sem eventos'}).` });
        } catch (err) {
            setGcalMsg({ ok: false, text: err.message });
        } finally { setGcalBusy(false); }
    };

    const openPrompts = async () => {
        setPromptsError(null);
        setLoadingPrompts(true);
        setShowPrompts(true);
        try {
            const { data: { session: s } } = await supabase.auth.getSession();
            const resp = await fetch('/api/tenant-prompts', {
                headers: { 'Authorization': `Bearer ${s?.access_token}` },
            });
            const json = await resp.json();
            if (json.ok) {
                setPromptsForm({
                    system_prompt: json.prompts.system_prompt || '',
                    qualifier_prompt: json.prompts.qualifier_prompt || '',
                    closer_prompt: json.prompts.closer_prompt || '',
                    objection_prompt: json.prompts.objection_prompt || '',
                });
            } else {
                setPromptsError(json.error || 'Falha ao carregar os prompts.');
            }
        } catch (e) {
            setPromptsError(e.message);
        }
        setLoadingPrompts(false);
    };

    const savePrompts = async () => {
        setSavingPrompts(true);
        setPromptsError(null);
        setPromptsSaved(false);
        try {
            const { data: { session: s } } = await supabase.auth.getSession();
            const resp = await fetch('/api/tenant-prompts', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s?.access_token}` },
                body: JSON.stringify(promptsForm),
            });
            const json = await resp.json();
            if (json.ok) {
                setPromptsSaved(true);
                setTimeout(() => setPromptsSaved(false), 2500);
            } else {
                setPromptsError(json.error || 'Falha ao salvar.');
            }
        } catch (e) {
            setPromptsError(e.message);
        }
        setSavingPrompts(false);
    };

    const exportLeadsExcel = async (limit) => {
        const XLSX = await import('xlsx');
        const data = limit ? leads.slice(0, limit) : leads;
        if (data.length === 0) return alert('Nenhum lead para exportar');
        const rows = data.map(l => ({
            'Nome': l.name || '',
            'Telefone': l.phone || '',
            'CNPJ': l.cnpj || '',
            'Sócio/Dono': l.dono || '',
            'Nicho': l.niche || '',
            'Bairro': l.bairro || '',
            'CEP': l.cep || '',
            'Status': l.status || '',
            'Temperatura': l.lead_temperature || '',
            'Estágio SPIN': String(l.current_stage || 0),
            'Porte': l.porte || '',
            'Capital Social': l.capital_social_numeric || '',
            'Criado em': l.created_at ? new Date(l.created_at).toLocaleDateString('pt-BR') : '',
            'Último contato': l.last_contact_at ? new Date(l.last_contact_at).toLocaleDateString('pt-BR') : '',
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Leads');
        const filename = `leads_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`;
        XLSX.writeFile(wb, filename);
        setShowExportMenu(false);
    };

    const handleClearLeads = () => {
        if(confirm("Deseja limpar todos os leads da base visual?")) {
            setLeads([]);
            setSelectedLeadIds(new Set());
        }
    };

    const handleSaveEdit = async () => {
        const { error } = await supabase.from('leads').update(editingLead).eq('id', editingLead.id);
        if (!error) { fetchLeadsFromDB(); setEditingLead(null); }
    };

    const handleDeleteLead = async (id) => {
        if(!confirm("Excluir este lead permanentemente?")) return;
        const { error } = await supabase.from('leads').delete().eq('id', id);
        if (!error) {
            setLeads(prev => prev.filter(l => l.id !== id));
            setSelectedLeadIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        }
    };

    const handleBulkDelete = () => {
        if(!confirm(`Excluir ${selectedLeadIds.size} leads permanentemente?`)) return;
        selectedLeadIds.forEach(id => handleDeleteLead(id));
    };

    // Envio de mensagem manual — pausa a IA automaticamente
    const handleSendMessage = async () => {
        const text = messageInput.trim();
        if (!text || !activeChat) return;
        setMessageInput('');

        await supabase.from('leads').update({ is_paused: true, manual_pause: true }).eq('id', activeChat.id);
        setActiveChat(prev => ({ ...prev, is_paused: true, manual_pause: true }));

        try {
            const { data: { session: s } } = await supabase.auth.getSession();
            const res = await fetch('/api/send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s?.access_token}` },
                body: JSON.stringify({ instanceId: activeChat.instance_id, whatsappId: activeChat.whatsapp_id, text }),
            });
            if (res.ok) {
                const { data: msgs } = await supabase.from('messages').select('*').eq('whatsapp_id', activeChat.whatsapp_id).order('created_at', { ascending: true });
                if (msgs) setChatMessages(msgs);
                setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
            } else {
                const err = await res.json().catch(() => ({}));
                alert(`Erro ao enviar: ${err.error || 'Falha desconhecida'}`);
            }
        } catch (e) {
            alert(`Erro de rede: ${e.message}`);
        }
    };

    const handleAgendarFollowUp = async () => {
        if (!followUpDateTime || !activeChat) return
        const isoDate = new Date(followUpDateTime).toISOString()
        const { error } = await supabase.from('leads').update({
            is_paused:    true,
            manual_pause: true,
            follow_up_at: isoDate,
            internal_notes: `Follow-up agendado para ${new Date(followUpDateTime).toLocaleString('pt-BR')} via painel`
        }).eq('id', activeChat.id)
        if (!error) {
            setActiveChat(prev => ({ ...prev, is_paused: true, manual_pause: true, follow_up_at: isoDate }))
            setShowFollowUpPicker(false)
            setFollowUpDateTime('')
        }
    }

    // Toggle manual de pausa da IA
    const handleTogglePause = async () => {
        if (!activeChat) return;
        const nowPaused = activeChat.is_paused || activeChat.manual_pause;

        if (nowPaused) {
            // Reativar: passa pelo backend para acordar o motor imediatamente (não só atualizar o DB)
            const update = { is_paused: false, manual_pause: false, last_human_interaction: null, internal_notes: `IA reativada via dashboard em ${new Date().toLocaleString('pt-BR')}` };
            setActiveChat(prev => ({ ...prev, ...update }));
            try {
                const { data: { session: s } } = await supabase.auth.getSession();
                await fetch(`/api/unpause-lead/${activeChat.id}`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${s?.access_token}` },
                });
                // internal_notes não é setado pelo endpoint — grava separadamente
                await supabase.from('leads').update({ internal_notes: update.internal_notes }).eq('id', activeChat.id);
            } catch (e) {
                console.error('[App] Falha ao reativar lead:', e);
            }
        } else {
            const update = { is_paused: true, manual_pause: true };
            await supabase.from('leads').update(update).eq('id', activeChat.id);
            setActiveChat(prev => ({ ...prev, ...update }));
        }
        fetchLeadsFromDB();
    };

    // CRM rápido — descarte de lead
    const handleBaixa = async () => {
        if (!activeChat) return;
        if (!confirm(`Dar baixa em "${activeChat.name}"? O lead será descartado.`)) return;
        await supabase.from('leads').update({ status: 'dead', lead_temperature: 'dead', is_paused: true }).eq('id', activeChat.id);
        setActiveChat(null);
        fetchLeadsFromDB();
    };

    // CRM rápido — fechar negócio
    const handleFechamento = async () => {
        if (!activeChat) return;
        if (!confirm(`Marcar "${activeChat.name}" como negócio FECHADO?`)) return;
        await supabase.from('leads').update({ status: 'booked', is_paused: true }).eq('id', activeChat.id);
        setActiveChat(null);
        fetchLeadsFromDB();
    };

    // --- 📞 LIGAÇÃO DE VOZ IA ---
    const handleCallLead = async (lead) => {
        if (!lead?.instance_id) { alert('Lead sem chip vinculado — não é possível ligar.'); return; }
        if (!confirm(`Ligar agora para ${lead.name}?\nA IA vai conduzir a conversa por telefone.`)) return;

        const disparar = async (force = false) => {
            const { data: { session: s } } = await supabase.auth.getSession();
            const res = await fetch('/api/call-lead', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${s?.access_token}` },
                body: JSON.stringify({ instanceId: lead.instance_id, leadId: lead.id, force }),
            });
            return { ok: res.ok, dados: await res.json().catch(() => ({})) };
        };

        try {
            let { ok, dados } = await disparar(false);
            if (!ok && dados.foraDoHorario && confirm(`${dados.error}\n\nLigar mesmo assim?`)) {
                ({ ok, dados } = await disparar(true));
            }
            if (!ok) {
                alert(`Não foi possível ligar: ${dados.error || 'Falha desconhecida'}`);
            } else {
                setLiveCall({ callId: dados.callId, leadId: lead.id, leadName: lead.name, status: 'queued', transcript: [] });
            }
        } catch (e) {
            alert(`Erro de rede: ${e.message}`);
        }
    };

    
        // --- NÚCLEO DE SEGURANÇA: CONTROLE DE ACESSO ---
    if (authLoading) {
        return (
            <div className="h-screen bg-[#0A0A0A] flex flex-col items-center justify-center">
            <Zap className="h-12 w-12 text-amber-500 animate-bounce mb-4" />
            <div className="text-amber-500 font-black uppercase tracking-[0.5em] animate-pulse">Conectando Antix Flow...</div>
            </div>
        )
    }

    if (!session) {
        const handleLogin = async (e) => {
            e.preventDefault();
            setIsLoggingIn(true);
            setLoginError(null);
            const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
            if (error) setLoginError(error.message);
            setIsLoggingIn(false);
        };

        return (
                <div className="h-screen bg-[#0A0A0A] flex items-center justify-center p-6">
                    <div className="glass-panel p-10 rounded-[2.5rem] border-amber-500/30 flex flex-col max-w-md w-full relative overflow-hidden" style={{boxShadow:'0 0 40px rgba(245,158,11,0.15)'}}>
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-600 via-amber-400 to-amber-600"></div>
    
                    <div className="flex flex-col items-center mb-8">
                        <div className="bg-amber-600/20 p-4 rounded-3xl mb-6 border border-amber-500/30">
                        <ShieldCheck className="h-10 w-10 text-amber-400" />
                            </div>
                        <h2 className="text-3xl font-black text-white italic uppercase tracking-tighter leading-none text-center">
                       Acesso <span className="text-amber-500">Restrito</span>
                                </h2>
                        <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mt-2 text-center">Antix Flow</p>
                    </div>

                    <form onSubmit={handleLogin} className="flex flex-col gap-4">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black text-amber-300 uppercase tracking-widest">Credencial (E-mail)</Label>
                            <Input 
                                type="email" 
                                required
                                value={loginEmail}
                                onChange={(e) => setLoginEmail(e.target.value)}
                                className="glass-card h-14 rounded-xl bg-black/40 border-white/10 text-white font-bold px-4 focus:border-amber-500 transition-colors" 
                                placeholder="seu@email.com"
                            />
                        </div>
                        
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black text-amber-300 uppercase tracking-widest">Código de Acesso (Senha)</Label>
                            <Input 
                                type="password" 
                                required
                                value={loginPassword}
                                onChange={(e) => setLoginPassword(e.target.value)}
                                className="glass-card h-14 rounded-xl bg-black/40 border-white/10 text-white font-bold px-4 focus:border-amber-500 transition-colors" 
                                placeholder="••••••••"
                            />
                        </div>

                        {loginError && (
                            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mt-2">
                                <p className="text-[10px] font-black text-red-400 uppercase tracking-wider text-center">
                                    {loginError === 'Invalid login credentials' ? 'Credenciais Inválidas' : loginError}
                                </p>
                            </div>
                        )}

                        <Button 
                            type="submit"
                            disabled={isLoggingIn}
                            className="w-full h-14 mt-4 bg-amber-600 hover:bg-amber-500 text-black font-black rounded-xl shadow-lg uppercase italic text-sm transition-transform active:scale-95"
                        >
                            {isLoggingIn ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : "ENTRAR NO ANTIX FLOW"}
                        </Button>
                    </form>
                </div>
            </div>
        )
    }

    // Se estiver logado, libera o cockpit do sistema:
return (
    <div className="h-screen w-full flex relative bg-[#0A0A0A] overflow-hidden">

    {/* 📞 PAINEL DE LIGAÇÃO IA AO VIVO */}
    {liveCall && (
        <div className="fixed bottom-6 right-6 z-[70] w-80 bg-[#111] border border-sky-500/30 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-sky-600/10 border-b border-sky-500/20">
                <div className="flex items-center gap-2 min-w-0">
                    <Phone className={`h-3.5 w-3.5 text-sky-400 shrink-0 ${['queued','initiated','ringing','in-progress'].includes(liveCall.status) ? 'animate-pulse' : ''}`} />
                    <span className="text-[10px] font-black text-white uppercase tracking-widest truncate">{liveCall.leadName || 'Ligação IA'}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[9px] font-bold text-sky-400 uppercase tracking-wider">
                        {{ queued: 'Na fila', initiated: 'Chamando…', ringing: 'Tocando…', 'in-progress': 'Em conversa', ended: 'Encerrada' }[liveCall.status] || liveCall.status}
                    </span>
                    <button onClick={() => setLiveCall(null)} className="h-5 w-5 rounded bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                        <X className="h-3 w-3 text-slate-400" />
                    </button>
                </div>
            </div>
            <div className="max-h-48 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
                {(liveCall.transcript || []).length === 0 ? (
                    <p className="text-[10px] text-slate-500 text-center py-2">Aguardando conversa…</p>
                ) : (
                    liveCall.transcript.map((t, i) => (
                        <div key={i} className={`text-[11px] leading-snug ${t.speaker === 'ai' ? 'text-sky-300' : 'text-slate-300'}`}>
                            <span className="font-black uppercase text-[8px] mr-1 opacity-60">{t.speaker === 'ai' ? 'IA' : 'Lead'}</span>
                            {t.text}
                        </div>
                    ))
                )}
                {liveCall.status === 'ended' && (
                    <p className="text-[9px] font-black text-amber-400 uppercase tracking-wider pt-2 border-t border-white/5 mt-2">
                        Resultado: {liveCall.outcome || '—'} · {liveCall.durationSeconds || 0}s
                    </p>
                )}
            </div>
        </div>
    )}

    {/* MODAL DE CONFIGURAÇÕES DA CONTA */}
    {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowSettings(false)}>
            <div className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-5 shrink-0">
                    <div>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">Configurações da Conta</h2>
                        <p className="text-[10px] text-slate-500 mt-0.5">{session?.user?.email}</p>
                    </div>
                    <button onClick={() => setShowSettings(false)} className="h-7 w-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                        <X className="h-3.5 w-3.5 text-slate-400" />
                    </button>
                </div>

                <div className="overflow-y-auto flex-1 space-y-5 pr-1">

                    {/* — Identidade do SDR — */}
                    <div>
                        <p className="text-[9px] font-black text-amber-500/60 uppercase tracking-widest mb-3">Identidade do SDR</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-black text-amber-300/80 uppercase tracking-widest block mb-1.5">Nome do SDR</label>
                                <Input
                                    value={settingsForm.default_agent_name}
                                    onChange={e => setSettingsForm(f => ({ ...f, default_agent_name: e.target.value }))}
                                    placeholder="Ex: Sofia, Luna, Pedro"
                                    className="bg-black/30 border-white/10 text-white text-sm h-10 focus:border-amber-500"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-amber-300/80 uppercase tracking-widest block mb-1.5">Nome da Empresa</label>
                                <Input
                                    value={settingsForm.default_company_name}
                                    onChange={e => setSettingsForm(f => ({ ...f, default_company_name: e.target.value }))}
                                    placeholder="Ex: Lince, Antix, Empresa"
                                    className="bg-black/30 border-white/10 text-white text-sm h-10 focus:border-amber-500"
                                />
                            </div>
                        </div>
                        <p className="text-[9px] text-slate-600 mt-2">Este é o padrão da conta (chips novos herdam). Cada chip pode ter um nome próprio na aba de chips.</p>
                        <button
                            type="button"
                            onClick={aplicarPersonaATodos}
                            disabled={applyingPersona}
                            className="mt-2 w-full h-9 rounded-md bg-amber-500/10 border border-amber-500/25 text-amber-300 hover:bg-amber-500/20 text-[11px] font-black uppercase tracking-widest transition-colors disabled:opacity-50"
                        >
                            {applyingPersona ? 'Aplicando...' : 'Aplicar nome/empresa a TODOS os chips'}
                        </button>
                        {personaMsg && (
                            <p className={`text-[10px] mt-1.5 ${personaMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{personaMsg.text}</p>
                        )}
                    </div>

                    {/* — Limites e Agendamento — */}
                    <div>
                        <p className="text-[9px] font-black text-amber-500/60 uppercase tracking-widest mb-3">Limites e Agendamento</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-black text-amber-300/80 uppercase tracking-widest block mb-1.5">Limite Diário (leads/dia)</label>
                                <Input
                                    type="number"
                                    value={settingsForm.default_daily_limit}
                                    onChange={e => setSettingsForm(f => ({ ...f, default_daily_limit: e.target.value }))}
                                    placeholder="Ex: 50"
                                    className="bg-black/30 border-white/10 text-white text-sm h-10 focus:border-amber-500"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-amber-300/80 uppercase tracking-widest block mb-1.5">Link Calendly</label>
                                <Input
                                    value={settingsForm.calendly_link}
                                    onChange={e => setSettingsForm(f => ({ ...f, calendly_link: e.target.value }))}
                                    placeholder="https://calendly.com/..."
                                    className="bg-black/30 border-white/10 text-white text-sm h-10 focus:border-amber-500"
                                />
                            </div>
                        </div>
                    </div>

                    {/* — Aberturas A/B/C — */}
                    <div>
                        <p className="text-[9px] font-black text-amber-500/60 uppercase tracking-widest mb-1">Aberturas A / B / C</p>
                        <div className="grid grid-cols-3 gap-1.5 mb-3">
                            {[
                                { key: '${saudacao}',           desc: 'Saudação completa',          ex: 'Oi João'          },
                                { key: '${nomeDono}',           desc: 'Só o primeiro nome',          ex: 'João'             },
                                { key: '${nomeEmpresa}',        desc: 'Nome da empresa (CNPJ)',      ex: 'Padaria Central'  },
                                { key: '${nomeAgente}',         desc: 'Nome do SDR (deste chip)',    ex: 'Sofia'            },
                                { key: '${nomeMinhaEmpresa}',   desc: 'Sua empresa (deste chip)',    ex: 'Antix'            },
                                { key: '${bairroLead}',         desc: 'Bairro ou cidade',            ex: 'Vila Madalena'    },
                                { key: '${concessionariaLocal}',desc: 'Distribuidora local (solar)',  ex: 'Celesc'           },
                                { key: '${origem}',             desc: 'Empresa que indicou',         ex: 'Empresa XYZ'      },
                            ].map(({ key, desc, ex }) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => {
                                        navigator.clipboard.writeText(key);
                                        setCopiedVar(key);
                                        setTimeout(() => setCopiedVar(null), 1500);
                                    }}
                                    className="text-left p-2 rounded-lg border transition-all bg-amber-500/5 border-amber-500/15 hover:bg-amber-500/15 hover:border-amber-500/30"
                                >
                                    <p className="font-mono text-[9px] font-black text-amber-400 leading-none mb-1">
                                        {copiedVar === key ? '✓ copiado!' : key}
                                    </p>
                                    <p className="text-[8px] text-slate-500 leading-none">{desc}</p>
                                    <p className="text-[8px] text-slate-700 leading-none mt-0.5">ex: {ex}</p>
                                </button>
                            ))}
                        </div>
                        <div className="space-y-3">
                            {[
                                { key: 'opening_a', label: 'Abertura A' },
                                { key: 'opening_b', label: 'Abertura B' },
                                { key: 'opening_c', label: 'Abertura C' },
                            ].map(({ key, label }) => (
                                <div key={key}>
                                    <label className="text-[10px] font-black text-amber-300/80 uppercase tracking-widest block mb-1.5">{label}</label>
                                    <textarea
                                        value={settingsForm[key]}
                                        onChange={e => setSettingsForm(f => ({ ...f, [key]: e.target.value }))}
                                        placeholder={`${label}: escreva a mensagem de abertura. Use \${saudacao} para cumprimentar pelo nome.`}
                                        rows={3}
                                        className="w-full bg-black/30 border border-white/10 text-white text-sm rounded-md px-3 py-2 focus:outline-none focus:border-amber-500 resize-none placeholder:text-slate-700"
                                    />
                                </div>
                            ))}
                        </div>
                        <p className="text-[9px] text-slate-600 mt-2">O SDR sorteia uma das aberturas preenchidas a cada novo lead. Chips novos herdam essas mensagens automaticamente.</p>
                    </div>

                    {/* — Google Agenda: confirmação diária de reuniões — */}
                    <div>
                        <p className="text-[9px] font-black text-amber-500/60 uppercase tracking-widest mb-1">Google Agenda — Confirmação de Reuniões</p>
                        <p className="text-[9px] text-slate-600 mb-2">O SDR liga pra sua agenda e confirma no WhatsApp, todo dia, quem tem reunião marcada — marcando ✅/❌/❓ no card e no evento.</p>
                        {!gcalConectado ? (
                            <button
                                type="button"
                                onClick={conectarGoogle}
                                disabled={gcalBusy}
                                className="w-full h-10 rounded-md bg-white/5 border border-white/15 text-slate-200 hover:bg-white/10 text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                <Calendar className="h-3.5 w-3.5" /> Conectar Google Agenda
                            </button>
                        ) : (
                            <div className="space-y-2.5">
                                <p className="text-[10px] text-emerald-400">✓ Conectado{gcalConfig?.google_email ? `: ${gcalConfig.google_email}` : ''}</p>
                                <div>
                                    <label className="text-[10px] font-black text-amber-300/80 uppercase tracking-widest block mb-1.5">Agenda das reuniões</label>
                                    <select
                                        value={gcalConfig?.calendar_id || ''}
                                        onChange={e => salvarGcalConfig({ calendar_id: e.target.value })}
                                        className="w-full bg-black/30 border border-white/10 text-white text-sm rounded-md px-3 h-10 focus:outline-none focus:border-amber-500"
                                    >
                                        <option value="">Selecione a agenda…</option>
                                        {gcalCalendars.map(c => (
                                            <option key={c.id} value={c.id}>{c.summary}{c.primary ? ' (principal)' : ''}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center gap-3">
                                    <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={!!gcalConfig?.confirmacao_ativa}
                                            onChange={e => salvarGcalConfig({ confirmacao_ativa: e.target.checked })}
                                            className="accent-amber-500"
                                        />
                                        Confirmar reuniões automaticamente
                                    </label>
                                    <div className="flex items-center gap-1 ml-auto">
                                        <span className="text-[10px] text-slate-500">às</span>
                                        <input
                                            type="number" min={0} max={23}
                                            value={gcalConfig?.confirmacao_hora ?? 11}
                                            onChange={e => setGcalConfig(c => ({ ...c, confirmacao_hora: Number(e.target.value) }))}
                                            onBlur={e => salvarGcalConfig({ confirmacao_hora: Number(e.target.value) })}
                                            className="w-14 bg-black/30 border border-white/10 text-white text-sm h-9 rounded-md text-center focus:outline-none focus:border-amber-500"
                                        />
                                        <span className="text-[10px] text-slate-500">h</span>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={rodarConfirmacaoAgora}
                                    disabled={gcalBusy || !gcalConfig?.calendar_id}
                                    className="w-full h-9 rounded-md bg-amber-500/10 border border-amber-500/25 text-amber-300 hover:bg-amber-500/20 text-[11px] font-black uppercase tracking-widest transition-colors disabled:opacity-50"
                                >
                                    {gcalBusy ? 'Processando…' : 'Testar agora (disparar confirmações de hoje)'}
                                </button>
                            </div>
                        )}
                        {gcalMsg && (
                            <p className={`text-[10px] mt-1.5 ${gcalMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{gcalMsg.text}</p>
                        )}
                    </div>

                    {/* — Cérebro da Conversa — */}
                    <div>
                        <p className="text-[9px] font-black text-amber-500/60 uppercase tracking-widest mb-1">Cérebro da Conversa</p>
                        <p className="text-[9px] text-slate-600 mb-2">Os prompts que definem COMO o SDR conversa no WhatsApp (qualificação, fechamento, objeção). Antes só editáveis direto no banco.</p>
                        <button
                            type="button"
                            onClick={() => { setShowSettings(false); openPrompts(); }}
                            className="w-full h-10 rounded-md bg-amber-500/10 border border-amber-500/25 text-amber-300 hover:bg-amber-500/20 text-xs font-black uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                        >
                            <Cpu className="h-3.5 w-3.5" /> Editar Prompts do SDR
                        </button>
                    </div>

                </div>

                {settingsError && (
                    <p className="text-[11px] text-red-400 mt-3 shrink-0 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">{settingsError}</p>
                )}
                {settingsOk && (
                    <p className="text-[11px] text-emerald-400 mt-3 shrink-0">✓ Salvo com sucesso.</p>
                )}
                <div className="flex gap-3 mt-5 shrink-0">
                    <Button onClick={() => setShowSettings(false)} className="flex-1 h-9 bg-transparent border border-white/10 text-slate-400 hover:bg-white/5 text-xs">
                        Cancelar
                    </Button>
                    <Button onClick={saveSettings} disabled={savingSettings} className="flex-1 h-9 bg-amber-500 hover:bg-amber-400 text-black font-black text-xs">
                        {savingSettings ? 'Salvando...' : 'Salvar'}
                    </Button>
                </div>
            </div>
        </div>
    )}

    {/* MODAL — CÉREBRO DA CONVERSA (tenant_prompts) */}
    {showPrompts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setShowPrompts(false)}>
            <div className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-3xl shadow-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4 shrink-0">
                    <div>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">Cérebro da Conversa</h2>
                        <p className="text-[10px] text-slate-500 mt-0.5">Prompts do SDR no WhatsApp · {session?.user?.email}</p>
                    </div>
                    <button onClick={() => setShowPrompts(false)} className="h-7 w-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors">
                        <X className="h-3.5 w-3.5 text-slate-400" />
                    </button>
                </div>

                {/* Abas dos 4 prompts */}
                <div className="flex gap-1.5 mb-3 shrink-0 flex-wrap">
                    {[
                        { key: 'system_prompt',    label: 'Sistema (base)' },
                        { key: 'qualifier_prompt', label: 'Qualificação' },
                        { key: 'closer_prompt',    label: 'Fechamento' },
                        { key: 'objection_prompt', label: 'Objeção' },
                    ].map(({ key, label }) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setActivePromptTab(key)}
                            className={`px-3 h-8 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${
                                activePromptTab === key
                                    ? 'bg-amber-500 text-black'
                                    : 'bg-white/5 text-slate-400 hover:bg-white/10'
                            }`}
                        >
                            {label}{promptsForm[key]?.trim() ? '' : ' •'}
                        </button>
                    ))}
                </div>

                {/* Dica de roteamento */}
                <p className="text-[9px] text-slate-600 mb-2 shrink-0">
                    O roteador escolhe o prompt por intenção do lead: dúvida/continuação → <span className="text-amber-400/70">Qualificação</span>, aceite → <span className="text-amber-400/70">Fechamento</span>, resistência → <span className="text-amber-400/70">Objeção</span>. Vazios caem no <span className="text-amber-400/70">Sistema</span>. O “•” marca prompt ainda em branco.
                </p>

                {/* Chips de variáveis disponíveis */}
                <div className="flex gap-1.5 mb-3 shrink-0 flex-wrap">
                    {['${agentName}', '${companyName}', '${nomeLead}', '${calendlyLink}', '${estagioAtual}'].map(v => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => { navigator.clipboard.writeText(v); setCopiedVar(v); setTimeout(() => setCopiedVar(null), 1500); }}
                            className="px-2 py-1 rounded-md bg-amber-500/5 border border-amber-500/15 hover:bg-amber-500/15 font-mono text-[9px] font-black text-amber-400 transition-colors"
                            title="Clique para copiar — cole no prompt onde quiser que o sistema substitua pelo valor real"
                        >
                            {copiedVar === v ? '✓ copiado!' : v}
                        </button>
                    ))}
                </div>

                <div className="overflow-y-auto flex-1 pr-1">
                    {loadingPrompts ? (
                        <div className="flex items-center justify-center py-16 text-slate-500 text-xs">Carregando prompts…</div>
                    ) : (
                        <textarea
                            value={promptsForm[activePromptTab]}
                            onChange={e => setPromptsForm(f => ({ ...f, [activePromptTab]: e.target.value }))}
                            placeholder={activePromptTab === 'system_prompt'
                                ? 'Prompt base — a identidade e as regras gerais do SDR. Mínimo 100 caracteres (ou deixe vazio).'
                                : 'Deixe vazio para usar o prompt de Sistema como base neste caso.'}
                            rows={16}
                            className="w-full bg-black/30 border border-white/10 text-white text-[13px] leading-relaxed rounded-md px-3 py-3 focus:outline-none focus:border-amber-500 resize-y font-mono placeholder:text-slate-700"
                        />
                    )}
                    <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[9px] text-slate-600">{promptsForm[activePromptTab]?.length || 0} caracteres</span>
                        {activePromptTab === 'system_prompt' && promptsForm.system_prompt.trim().length > 0 && promptsForm.system_prompt.trim().length < 100 && (
                            <span className="text-[9px] text-rose-400 font-bold">⚠️ Mínimo 100 caracteres — abaixo disso o motor não responde.</span>
                        )}
                    </div>
                </div>

                {promptsError && (
                    <div className="mt-2 text-[10px] text-rose-400 font-bold shrink-0">⚠️ {promptsError}</div>
                )}

                <div className="flex gap-3 mt-4 shrink-0">
                    <Button onClick={() => setShowPrompts(false)} className="flex-1 h-9 bg-transparent border border-white/10 text-slate-400 hover:bg-white/5 text-xs">
                        Fechar
                    </Button>
                    <Button onClick={savePrompts} disabled={savingPrompts || loadingPrompts} className="flex-1 h-9 bg-amber-500 hover:bg-amber-400 text-black font-black text-xs">
                        {savingPrompts ? 'Salvando...' : promptsSaved ? '✓ Salvo!' : 'Salvar Prompts'}
                    </Button>
                </div>
            </div>
        </div>
    )}

    {/* SIDEBAR */}
    <AppSidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        leadsCount={realTotalLeads}
        onLogout={() => supabase.auth.signOut()}
    />

    {/* CONTEÚDO PRINCIPAL */}
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* TOP BAR */}
<div className="shrink-0 flex items-center justify-between px-6 py-2.5 border-b border-white/5 bg-[#0d0d0d]/80 backdrop-blur-md z-40">
    <div className="flex items-center gap-4">
        {/* Título da aba com ícone */}
        <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                {activeTab === 'search' ? <Radio className="h-4 w-4 text-amber-400" /> :
                 activeTab === 'crm' ? <LayoutDashboard className="h-4 w-4 text-amber-400" /> :
                 activeTab === 'connections' ? <MessageSquare className="h-4 w-4 text-amber-400" /> :
                 <BarChart2 className="h-4 w-4 text-amber-400" />}
            </div>
            <div>
                <h2 className="text-sm font-black text-white uppercase tracking-wider leading-none">
    {activeTab === 'search' ? 'Radar' :
     activeTab === 'Pipeline' ? 'Pipeline' :
     activeTab === 'connections' ? 'Central WhatsApp' :
     'Analytics'}
</h2>
<p className="text-[8px] font-bold uppercase tracking-widest mt-0.5" style={{ color: 'rgba(255,255,255,0.25)' }}>
    <span style={{ color: '#F59E0B', fontWeight: 900 }}>A</span>NT<span style={{ color: '#F59E0B', fontWeight: 900 }}>I</span>X
</p>
            </div>
        </div>

        {/* Indicador de scraping ativo */}
        {isBotRunning && (
            <div className="flex items-center gap-3 px-4 py-1.5 rounded-xl bg-amber-500/8 border border-amber-500/20" style={{ backdropFilter: 'blur(8px)' }}>
                {/* Pulso animado */}
                <div className="relative flex-shrink-0">
                    <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                    <div className="absolute inset-0 h-2 w-2 rounded-full bg-amber-400 animate-ping opacity-40" />
                </div>
                {/* Texto principal */}
                <div className="flex flex-col leading-none gap-0.5">
                    <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">
                        Radar Ativo
                        {scraperLeadsCount > 0 && (
                            <span className="ml-2 text-emerald-400">· {scraperLeadsCount} lead{scraperLeadsCount !== 1 ? 's' : ''}</span>
                        )}
                    </span>
                    {botLogs.length > 0 && (() => {
                        const ultimo = botLogs[botLogs.length - 1] || '';
                        const limpo = ultimo.replace(/^[\u{1F300}-\u{1FFFF}]\s*/u, '').replace(/\[.*?\]/g, '').trim();
                        return limpo ? (
                            <span className="text-[8px] text-amber-300/40 font-medium truncate max-w-[280px]">
                                {limpo}
                            </span>
                        ) : null;
                    })()}
                </div>
            </div>
        )}
    </div>

    <div className="flex items-center gap-3">
        {/* Usuário logado + botão de configurações */}
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
            <div className="h-5 w-5 rounded-full bg-amber-500/20 flex items-center justify-center">
                <span className="text-[8px] font-black text-amber-400 uppercase">
                    {session?.user?.email?.[0]}
                </span>
            </div>
            <span className="text-[9px] text-slate-400 font-bold truncate max-w-[120px]">
                {session?.user?.email}
            </span>
            <button onClick={openSettings} className="ml-1 h-5 w-5 rounded flex items-center justify-center hover:bg-white/10 transition-colors" title="Configurações da conta">
                <Settings className="h-3 w-3 text-slate-500 hover:text-amber-400 transition-colors" />
            </button>
        </div>
        {/* Chips online indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
            <div className="flex -space-x-1">
                {instances.filter(i => i.whatsapp_status === 'CONNECTED').length > 0 ? (
                    <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_4px_#10b981]" />
                ) : (
                    <div className="h-2 w-2 rounded-full bg-red-400" />
                )}
            </div>
            <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest">
                {instances.filter(i => i.whatsapp_status === 'CONNECTED').length} chip{instances.filter(i => i.whatsapp_status === 'CONNECTED').length !== 1 ? 's' : ''}
            </span>
        </div>

        {/* Leads counter */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/15">
            <Zap className="h-3 w-3 text-amber-500" />
            <span className="text-sm font-black text-white">{realTotalLeads}</span>
            <span className="text-[8px] text-amber-400/60 font-black uppercase">leads</span>
        </div>

        {/* Botão principal */}
        <Button
            onClick={startScraping}
            className={`h-9 px-5 rounded-lg font-black text-[10px] uppercase tracking-wider border transition-all ${
                isBotRunning
                    ? "bg-red-600/20 border-red-500/30 text-red-400 hover:bg-red-600/40"
                    : "bg-amber-600 border-amber-500 text-black hover:bg-amber-500"
            }`}
            style={!isBotRunning ? { boxShadow: '0 0 12px rgba(245,158,11,0.2)' } : {}}
        >
            {isBotRunning ? "Parar Motor" : "Iniciar Varredura"}
        </Button>
    </div>
</div>
        {/* ÁREA DE CONTEÚDO */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden min-h-0">
               <TabsList className="hidden">
    <TabsTrigger value="search">Radar</TabsTrigger>
    <TabsTrigger value="crm">CRM</TabsTrigger>
    <TabsTrigger value="connections">WhatsApp</TabsTrigger>
    <TabsTrigger value="dashboard">Analytics</TabsTrigger>
    <TabsTrigger value="briefing">Briefing</TabsTrigger>
              </TabsList>

                {selectedLeadIds.size > 0 && (
                    <div className="absolute right-6 top-14 z-50 flex gap-3 animate-in slide-in-from-right">
                        <Button onClick={handleBulkDelete} variant="destructive" className="h-9 rounded-lg font-black uppercase text-[10px] px-5 shadow-xl shadow-red-900/20">
                            <Trash2 className="mr-2 h-3.5 w-3.5" /> Deletar {selectedLeadIds.size}
                        </Button>
                        <Button onClick={() => setSelectedLeadIds(new Set())} variant="outline" className="h-9 rounded-lg font-black text-[10px] px-4 border-white/20 glass-card">
                            Cancelar
                        </Button>
                    </div>
                )}

                
                                {/* --- ABA 2: CRM (DESTAQUE PARA DADOS) --- */}
                            <TabsContent value="crm" className="w-full flex flex-col flex-1 m-0 overflow-y-auto custom-scrollbar">
                        <div className="shrink-0 flex justify-between items-center px-6 py-3 border-b border-white/5 bg-[#0d0d0d]/60 z-40">
                     <div className="relative glass-card rounded-xl group w-[400px] bg-black/20 border-white/10">
                      <Search className="absolute left-4 top-3 h-5 w-5 text-slate-600 group-focus-within:text-amber-500 transition-colors" />
                       <Input placeholder="Buscar por Nome, Sócio, CNPJ ou Celular..." className="bg-transparent border-none pl-12 text-white h-11 focus:ring-0 font-bold text-sm" value={filterText} onChange={e => setFilterText(e.target.value)} />
    </div>
    <div className="flex gap-3">
        <div className="relative">
            <div className="flex">
                <Button onClick={() => exportLeadsExcel(null)} className="glass-card hover:bg-white/10 text-white h-9 px-4 rounded-l-lg rounded-r-none font-black text-[10px] tracking-widest uppercase border-white/10 border-r-0">
                    <Download className="mr-2 h-4 w-4 text-amber-400" /> Excel
                </Button>
                <Button onClick={() => setShowExportMenu(v => !v)} className="glass-card hover:bg-white/10 text-white h-9 px-2 rounded-l-none rounded-r-lg font-black text-[10px] border-white/10">
                    <ChevronDown className="h-3.5 w-3.5 text-amber-400" />
                </Button>
            </div>
            {showExportMenu && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                    <div className="absolute right-0 top-10 z-50 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl overflow-hidden w-48">
                        {[200, 500, 1000, 5000].map(n => (
                            <button key={n} onClick={() => exportLeadsExcel(n)} className="w-full px-4 py-2.5 text-left text-xs text-white hover:bg-white/10 transition-colors">
                                \u00daltimos {n.toLocaleString('pt-BR')}
                            </button>
                        ))}
                        <div className="border-t border-white/10" />
                        <button onClick={() => exportLeadsExcel(null)} className="w-full px-4 py-2.5 text-left text-xs text-amber-400 font-bold hover:bg-white/10 transition-colors">
                            Todos ({leads.length.toLocaleString('pt-BR')})
                        </button>
                    </div>
                </>
            )}
        </div>

        <Button onClick={handleClearLeads} className="h-9 px-4 rounded-lg font-black text-[10px] text-red-500 hover:bg-red-500/10 glass-card border-transparent">
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Limpar
        </Button>
    </div>
</div>

                        <div ref={kanbanRef} className="flex-1 flex gap-6 overflow-x-auto p-8 custom-scrollbar bg-[#0A0A0A]/40 items-stretch" style={{ scrollBehavior: 'auto' }}>
    

            <KanbanColumn title="Novos Leads" count={getLeadsByStatus('new').length} color="from-slate-700 to-slate-900" icon={<Users className="h-6 w-6 text-slate-300"/>}>
    {getLeadsByStatus('new').map(l => (
        <LeadCard key={l.id} lead={l} isSelected={selectedLeadIds.has(l.id)} onSelect={() => toggleSelectLead(l.id)} onView={() => setViewingLeadDetail(l)} onEdit={() => setEditingLead(l)} onDelete={() => handleDeleteLead(l.id)} onChat={() => { setActiveChat(l); setActiveTab('connections'); }} onCall={() => handleCallLead(l)} />
    ))}
</KanbanColumn>
                            <KanbanColumn title="Em Atendimento IA" count={getLeadsByStatus('contact').length} color="from-blue-700 to-blue-950" icon={<BrainCircuit className="h-6 w-6 text-blue-300"/>} isActive={true}>
                                {getLeadsByStatus('contact').map(l => (
                                    <LeadCard key={l.id} lead={l} isSelected={selectedLeadIds.has(l.id)} onSelect={() => toggleSelectLead(l.id)} onView={() => setViewingLeadDetail(l)} onEdit={() => setEditingLead(l)} onDelete={() => handleDeleteLead(l.id)} onChat={() => { setActiveChat(l); setActiveTab('connections'); }} onCall={() => handleCallLead(l)} />
                                ))}
                            </KanbanColumn>
                            <KanbanColumn title="Aguardando Resposta" count={getAwaitingReply().length} color="from-slate-600 to-slate-800" icon={<MessageSquare className="h-6 w-6 text-slate-300"/>}>
                                {getAwaitingReply().map(l => (
                                    <LeadCard key={l.id} lead={l} isSelected={selectedLeadIds.has(l.id)} onSelect={() => toggleSelectLead(l.id)} onView={() => setViewingLeadDetail(l)} onEdit={() => setEditingLead(l)} onDelete={() => handleDeleteLead(l.id)} onChat={() => { setActiveChat(l); setActiveTab('connections'); }} onCall={() => handleCallLead(l)} />
                                ))}
                            </KanbanColumn>
                            <KanbanColumn title="🔥 Quentes" count={getHotLeads().length} color="from-red-700 to-orange-900" icon={<Flame className="h-6 w-6 text-red-300 animate-pulse"/>} isActive={true}>
                                {getHotLeads().map(l => (
                                    <LeadCard key={l.id} lead={l} isSelected={selectedLeadIds.has(l.id)} onSelect={() => toggleSelectLead(l.id)} onView={() => setViewingLeadDetail(l)} onEdit={() => setEditingLead(l)} onDelete={() => handleDeleteLead(l.id)} onChat={() => { setActiveChat(l); setActiveTab('connections'); }} onCall={() => handleCallLead(l)} />
                                ))}
                            </KanbanColumn>
                            <KanbanColumn title="Agendamentos" count={getLeadsByStatus('booked').length} color="from-emerald-700 to-green-900" icon={<CheckSquare className="h-6 w-6 text-emerald-300"/>}>
                                {getLeadsByStatus('booked').map(l => (
                                    <LeadCard key={l.id} lead={l} isSelected={selectedLeadIds.has(l.id)} onSelect={() => toggleSelectLead(l.id)} onView={() => setViewingLeadDetail(l)} onEdit={() => setEditingLead(l)} onDelete={() => handleDeleteLead(l.id)} onChat={() => { setActiveChat(l); setActiveTab('connections'); }} onCall={() => handleCallLead(l)} />
                                ))}
                            </KanbanColumn>
                            <KanbanColumn title="Fora do Fluxo" count={getLeadsByStatus('fora_do_fluxo').length} color="from-slate-700 to-slate-900" icon={<Send className="h-6 w-6 text-slate-300"/>}>
                                {getLeadsByStatus('fora_do_fluxo').map(l => (
                                    <LeadCard key={l.id} lead={l} isSelected={selectedLeadIds.has(l.id)} onSelect={() => toggleSelectLead(l.id)} onView={() => setViewingLeadDetail(l)} onEdit={() => setEditingLead(l)} onDelete={() => handleDeleteLead(l.id)} onChat={() => { setActiveChat(l); setActiveTab('connections'); }} onCall={() => handleCallLead(l)} />
                                ))}
                            </KanbanColumn>
                            <KanbanColumn title="Encerrados" count={getLeadsByStatus('encerrados').length} color="from-slate-800 to-slate-950" icon={<XCircle className="h-6 w-6 text-slate-400"/>}>
                                {getLeadsByStatus('encerrados').map(l => (
                                    <LeadCard key={l.id} lead={l} isSelected={selectedLeadIds.has(l.id)} onSelect={() => toggleSelectLead(l.id)} onView={() => setViewingLeadDetail(l)} onEdit={() => setEditingLead(l)} onDelete={() => handleDeleteLead(l.id)} onChat={() => { setActiveChat(l); setActiveTab('connections'); }} onCall={() => handleCallLead(l)} />
                                ))}
                            </KanbanColumn>
                        </div>


                    </TabsContent>

                    {/* ABA RADAR (CORREÇÃO DE CONTRASTE NICHO) */}
                            <TabsContent value="search" className="flex-1 flex flex-col lg:flex-row overflow-hidden m-0">
                        <div className="w-[420px] glass-panel p-10 space-y-10 overflow-y-auto h-full shadow-2xl z-20 border-r border-white/5">
                            <div className="space-y-4">
    <Label className="text-amber-400 font-black text-xs uppercase tracking-[0.4em] flex items-center gap-3"><Zap className="h-5 w-5 text-amber-500 animate-pulse"/> 1. Segmento Estratégico</Label>
    <div className="[&_button]:h-16 [&_button]:rounded-xl [&_button]:text-base [&_button]:font-bold [&_button]:border-white/10 [&_button]:bg-white/[0.02]">
        <NicheSelect onNicheSelect={setSelectedNiche} />
    </div>
</div>

                            <div className="space-y-4 relative z-50">
                               <Label className="text-amber-300 font-black text-xs uppercase tracking-[0.4em] flex items-center gap-3"><Search className="h-5 w-5 text-amber-500"/> 2. Vetor de Localização</Label>
                                <Input className="glass-card h-16 pl-6 text-xl font-bold border-white/10 focus:border-amber-500" placeholder="Cidade..." value={locationName} onChange={(e) => handleCitySearch(e.target.value)} />
                                {citySuggestions.length > 0 && (
                                    <div className="absolute top-full left-0 w-full glass-panel rounded-3xl mt-4 shadow-2xl p-3 border-amber-500/30 max-h-72 overflow-y-auto z-[100] bg-[#111111]">
                                        {citySuggestions.map((c, i) => (
                                            <div key={i} onClick={() => { setMapCenter([parseFloat(c.lat), parseFloat(c.lon)]); setLocationName(c.display_name.split(',')[0]); setCitySuggestions([]); }} className="p-5 hover:bg-amber-600/20 rounded-2xl cursor-pointer transition-all flex flex-col mb-2 border border-transparent hover:border-amber-500/20">
                                                <span className="font-black text-white text-lg">{c.display_name.split(',')[0]}</span>
                                              <span className="text-xs text-amber-200 uppercase font-black tracking-widest">{c.display_name.split(',')[1] || 'Brasil'}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="space-y-6">
                                <div className="flex justify-between items-center"><Label className="text-amber-300 font-black text-xs uppercase tracking-[0.3em]">3. Raio: {searchRadius} KM</Label><Badge className="bg-amber-600 text-black font-black px-6 py-2 rounded-full text-lg" style={{boxShadow:'0 0 12px rgba(245,158,11,0.3)'}}>{searchRadius} KM</Badge></div>
                                <input type="range" min="1" max="50" value={searchRadius} onChange={(e) => setSearchRadius(e.target.value)} className="w-full h-3 bg-slate-900 rounded-full appearance-none cursor-pointer accent-amber-500 border border-white/5 shadow-inner" />
                            </div>
                          <Button onClick={startScraping} className="w-full h-20 bg-amber-600 hover:bg-amber-500 text-black font-black text-2xl rounded-3xl mt-10 transition-transform active:scale-95 uppercase tracking-tighter italic" style={{boxShadow:'0 0 24px rgba(245,158,11,0.3)'}}>Iniciar Radar <ArrowRight className="ml-3 h-8 w-8"/></Button>

                          <button
                              onClick={() => setShowNotes(true)}
                              className="w-full flex items-center gap-3 px-5 py-3 rounded-2xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] transition-all text-left"
                          >
                              <FileText className="h-4 w-4 text-amber-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                  <p className="text-[10px] font-black text-amber-300 uppercase tracking-[0.25em]">Bloco de Notas</p>
                                  <p className="text-[9px] text-slate-500 font-bold truncate mt-0.5">
                                      {notesContent.trim() ? notesContent.trim().split('\n')[0].slice(0, 38) + (notesContent.trim().split('\n')[0].length > 38 ? '…' : '') : 'Cidades, nichos, anotações...'}
                                  </p>
                              </div>
                          </button>
                        </div>

                              <div className="flex-1 relative">

                                {/* Botão minha localização */}
<button
    onClick={handleMyLocation}
    className="absolute top-6 left-6 z-[999] glass-card border border-white/10 rounded-2xl px-4 py-2 flex items-center gap-2 hover:bg-white/10 transition-all active:scale-95"
>
    <LocateFixed className="h-4 w-4 text-blue-400" />
    <span className="text-[10px] font-black text-white uppercase tracking-widest">Minha Localização</span>
</button>
    {/* Badge contador */}
    <div className="absolute top-6 right-6 z-[999] bg-amber-600/90 backdrop-blur-md border border-amber-500/40 rounded-2xl px-4 py-2 shadow-lg">
        <span className="text-[10px] font-black text-white uppercase tracking-widest">
            📍 {leads.filter(l => l.lat && l.lng).length} leads mapeados
        </span>
    </div>

    <MapContainer
        center={mapCenter}
        zoom={13}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
    >
        <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        />
        <MapController center={mapCenter} />
        <MapClickHandler
            setCenter={setMapCenter}
            setLocationName={setLocationName}
            setSearchMode={() => {}}
        />

        {/* Círculo de raio de busca */}
        <Circle
            center={mapCenter}
            radius={searchRadius * 1000}
            pathOptions={{
    color: '#F59E0B',
    fillColor: '#F59E0B',
    fillOpacity: 0.06,
                weight: 1.5,
                dashArray: '6 4',
            }}
        />

        {/* Pins dos leads com coordenadas */}
        {leads
            .filter(l => l.lat && l.lng)
            .map(lead => {
                const color = lead.status === 'closed'        ? '#10B981'
                           : lead.status === 'contact'       ? '#F59E0B'
                         : lead.status === 'waiting_analysis' ? '#F59E0B'
                            : lead.status === 'error'         ? '#F43F5E'
                            : '#64748B'

                const pinIcon = L.divIcon({
                    className: '',
                    html: `<div style="
                        width:10px; height:10px; border-radius:50%;
                        background:${color};
                        border:2px solid rgba(255,255,255,0.6);
                        box-shadow:0 0 8px ${color};
                    "></div>`,
                    iconSize: [10, 10],
                    iconAnchor: [5, 5],
                })

                return (
                    <Marker
                        key={lead.id}
                        position={[lead.lat, lead.lng]}
                        icon={pinIcon}
                        eventHandlers={{
                            click: () => setViewingLeadDetail(lead)
                        }}
                    />
                )
            })
        }
    </MapContainer>

    {/* Legenda */}
    <div className="absolute bottom-6 left-6 z-[999] glass-card rounded-2xl px-4 py-3 border-white/10 space-y-1.5">
        {[
            { color: '#10B981', label: 'Agendado' },
            { color: '#F59E0B', label: 'Em atendimento' },
            { color: '#F59E0B', label: 'Auditoria' },
            { color: '#F43F5E', label: 'Erro' },
            { color: '#64748B', label: 'Novo' },
        ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 5px ${color}` }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
            </div>
        ))}
    </div>
</div>
                    </TabsContent>

                            {/* ABA 3: WHATSAPP */}

              <TabsContent value="connections" className="w-full flex flex-col flex-1 m-0 p-0 border-none overflow-hidden">
    <div className="flex h-full overflow-hidden bg-slate-950/40">

      {/* COLUNA 1 — Chips + Hub de Conversão (largura fixa) */}
<div className="w-[350px] shrink-0 border-r border-white/5 bg-[#0d0d0d]/60 flex flex-col h-full">

    {/* === CHIP SELECTOR — limpo e direto === */}
<div className="shrink-0 p-3 border-b border-white/5 space-y-2">
    {/* Botões de gerenciamento */}
    <div className="flex gap-2">
        <Button
            onClick={() => {
                const nome = prompt("Nome da nova unidade (Ex: Chip Claro 02):");
                if (!nome) return;
                setIsConnectingChip(true);
                socket.emit('create_instance', { name: nome, phone: null });
                // Safety timeout: reset se o QR demorar mais de 45s
                if (chipConnectTimerRef.current) clearTimeout(chipConnectTimerRef.current);
                chipConnectTimerRef.current = setTimeout(() => {
                    setIsConnectingChip(false);
                    chipConnectTimerRef.current = null;
                }, 45000);
            }}
            disabled={isConnectingChip}
            className="flex-1 h-8 text-[9px] uppercase font-black bg-orange-500 text-white hover:bg-orange-400 rounded-lg border-0 shadow-[0_0_12px_rgba(249,115,22,0.35)] disabled:opacity-60 disabled:cursor-not-allowed"
        >
            {isConnectingChip
                ? <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Conectando...</span>
                : '+ Adicionar Chip'
            }
        </Button>
        {selectedInstanceId && (
            <Button
                onClick={() => {
                    const inst = instances.find(i => i.id === selectedInstanceId);
                    if (!confirm(`Remover o chip "${inst?.name}"? Isso desconecta o WhatsApp vinculado.`)) return;
                    socket.emit('remove_instance', selectedInstanceId);
                    if (qrCodeData) setQrCodeData(null);
                    setSelectedInstanceId(null);
                    setInstances(prev => prev.filter(i => i.id !== selectedInstanceId));
                }}
                className="h-8 px-3 text-[9px] uppercase font-black bg-red-600/15 text-red-400 border border-red-500/25 hover:bg-red-600/30 rounded-lg"
            >
                Remover
            </Button>
        )}
    </div>

    {/* Pills clicáveis — agora são o ÚNICO ponto de seleção */}
    <div className="flex gap-1.5 flex-wrap">
        <div
            onClick={() => setSelectedInstanceId(null)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg cursor-pointer transition-all text-[9px] font-black uppercase tracking-wider border ${
                !selectedInstanceId
                    ? 'bg-blue-600/15 border-blue-500/30 text-blue-300'
                    : 'bg-white/[0.02] border-white/5 text-slate-500 hover:border-white/10'
            }`}
        >
            <Cpu className="h-2.5 w-2.5" />
            Todos
        </div>
        {instances.map(inst => {
            const conectado = inst.whatsapp_status === 'CONNECTED'
            const ativo = selectedInstanceId === inst.id
            return (
                <div
                    key={inst.id}
                    onClick={() => setSelectedInstanceId(inst.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg cursor-pointer transition-all text-[9px] font-black uppercase tracking-wider border ${
                        ativo
                            ? 'bg-amber-500/25 border-amber-400/60 text-amber-200 shadow-[0_0_8px_rgba(245,158,11,0.35)]'
                            : 'bg-white/[0.02] border-white/5 text-slate-500 hover:border-white/10'
                    }`}
                >
                    <div className={`h-2 w-2 rounded-full ${
                        conectado ? 'bg-emerald-400 shadow-[0_0_4px_#10b981]' : 'bg-red-400'
                    }`} />
                    {inst.name}
                </div>
            )
        })}
    </div>
</div>
    {/* === LEADS EM ATENÇÃO HUMANA === */}
    {(() => {
        const handoffLeads = leads.filter(l => (l.is_paused || l.manual_pause) && l.status !== 'closed' && l.status !== 'invalid').slice(0, 4);
        if (handoffLeads.length === 0) return null;
        return (
            <div className="shrink-0 flex flex-col border-b border-amber-500/10 bg-amber-950/10">
                <div
                    onClick={() => setIsAtencaoOpen(o => !o)}
                    className="px-3 pt-2.5 pb-2 flex items-center gap-2 shrink-0 cursor-pointer hover:bg-amber-500/5 transition-colors select-none"
                >
                    <AlertTriangle className="h-2.5 w-2.5 text-amber-500 shrink-0" />
                    <span className="text-[8px] font-black text-amber-500/80 uppercase tracking-widest">Atenção Humana</span>
                    <span className="ml-auto text-[7px] font-black bg-amber-500/15 border border-amber-500/25 text-amber-400 rounded-full px-1.5 py-0.5">
                        {handoffLeads.length}
                    </span>
                    <ChevronDown className={`h-3 w-3 text-amber-500/50 transition-transform duration-200 ${isAtencaoOpen ? 'rotate-180' : ''}`} />
                </div>
                {isAtencaoOpen && (
                    <div className="px-2 pb-2 space-y-1 overflow-y-auto max-h-44">
                        {handoffLeads.map(l => (
                            <div
                                key={l.id}
                                onClick={() => setActiveChat(l)}
                                className="handoff-pulse rounded-lg border border-amber-500/20 bg-amber-900/10 px-2.5 py-2 cursor-pointer hover:border-amber-500/40 hover:bg-amber-900/20 transition-all"
                            >
                                <div className="flex items-center justify-between gap-2 mb-0.5">
                                    <span className="text-[10px] font-black text-white truncate">{l.name}</span>
                                    {l.bairro && <span className="text-[8px] text-amber-400/60 font-bold shrink-0">{l.bairro}</span>}
                                </div>
                                {l.internal_notes && (
                                    <p className="text-[8px] text-amber-200/50 leading-snug line-clamp-2">
                                        {l.internal_notes}
                                    </p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    })()}

    {/* === HUB DE CONVERSÃO — flex:1 = todo o espaço restante === */}
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
<ConversaList
    onSelect={setActiveChat}
    activeId={activeChat?.id}
    socket={socket}
    instances={instances}
    selectedInstanceId={selectedInstanceId}
/>
    </div>
</div>
        {/* COLUNA 2 — Chat */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 chat-bg-pattern" style={{ position: 'relative' }}>
            {activeChat ? (
    <>
        <div className="shrink-0 px-3 py-2 border-b border-white/5 flex items-center justify-between backdrop-blur-md bg-[#0d0d0f]/90">
            <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 bg-amber-600/20 rounded-lg border border-amber-500/30 flex items-center justify-center font-black text-amber-400 text-xs shrink-0">
                    {activeChat.name?.[0]}
                </div>
                <div>
                    <h2 className="text-sm font-black text-white tracking-tighter uppercase leading-none">{activeChat.name}</h2>
                    {activeChat.instance_id && (
                        <span className="text-[7px] text-slate-600 font-bold uppercase tracking-widest">
                            via {instances.find(i => i.id === activeChat.instance_id)?.name || 'chip desconhecido'}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-1.5">
                {/* Toggle de pausa da IA — clicável */}
                <button
                    onClick={handleTogglePause}
                    className={`h-6 px-2.5 rounded-md text-[8px] font-black uppercase tracking-wide border transition-all ${
                        (activeChat.is_paused || activeChat.manual_pause)
                            ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25'
                            : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                    }`}
                    title={(activeChat.is_paused || activeChat.manual_pause) ? 'Clique para reativar a IA' : 'Clique para pausar a IA'}
                >
                    {(activeChat.is_paused || activeChat.manual_pause) ? '⏸️ IA PAUSADA' : '🟢 IA ATIVA'}
                </button>
                {/* CRM Rápido — mock, funções futuras */}
                <div className="flex items-center gap-1 ml-1 pl-1.5 border-l border-white/5">
                    <button
                        onClick={handleBaixa}
                        className="h-6 px-2 rounded-md flex items-center gap-1 text-[8px] font-black uppercase tracking-wide text-red-400 border border-red-500/30 bg-red-900/15 hover:border-red-500/50 hover:bg-red-900/30 transition-all"
                        title="Dar Baixa (descarte)"
                    >
                        <XCircle className="h-2.5 w-2.5" />
                        Baixa
                    </button>
                    <button
                        onClick={handleFechamento}
                        className="h-6 px-2 rounded-md flex items-center gap-1 text-[8px] font-black uppercase tracking-wide text-emerald-400 border border-emerald-500/30 bg-emerald-900/15 hover:border-emerald-500/50 hover:bg-emerald-900/30 transition-all"
                        title="Fechar Negócio"
                    >
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        Fechar
                    </button>
                </div>
                <button
                    onClick={() => setActiveChat(null)}
                    className="h-6 w-6 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all ml-0.5"
                    title="Fechar conversa"
                >
                    <X className="h-3 w-3 text-slate-400" />
                </button>
            </div>
        </div>

        {/* ⏸ BANNER IA PAUSADA — motivo da pausa */}
        {(activeChat.is_paused || activeChat.manual_pause) && (
            <div className="shrink-0 px-3 py-1.5 flex items-center gap-2 border-b border-amber-500/15 bg-amber-950/40">
                <span className="text-[9px] shrink-0">⏸️</span>
                <p className="text-[8px] font-bold text-amber-300/80 truncate min-w-0">
                    <span className="font-black text-amber-400 mr-1">IA PAUSADA —</span>
                    {activeChat.internal_notes
                        ? activeChat.internal_notes.slice(0, 100) + (activeChat.internal_notes.length > 100 ? '…' : '')
                        : activeChat.manual_pause ? 'Pausa manual (/pausar)' : 'Pausa automática — aguardando intervenção humana'}
                </p>
            </div>
        )}

        {/* Mensagens */}
        <div className="flex-1 overflow-y-auto px-4 py-3 custom-scrollbar flex flex-col gap-2 h-0">
            {chatMessages.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-xs text-slate-600 uppercase tracking-widest font-black">Nenhuma mensagem registrada</p>
                </div>
            ) : (
                chatMessages.map((msg) => {
                    const isLead = msg.role === 'user';
                    return (
                        <div
                            key={msg.id}
                            className={`flex flex-col max-w-[80%] ${isLead ? 'self-start items-start' : 'self-end items-end'}`}
                        >
                            <div
                                className={`px-3 py-2 rounded-xl shadow-sm ${
                                    isLead
                                    ? 'bg-[#2a2a2e] rounded-tl-none border border-white/5'
                                    : 'rounded-tr-none'
                                }`}
                                style={isLead ? {} : { backgroundColor: '#075E54', border: '1px solid rgba(255,255,255,0.08)' }}
                            >
                                <p className={`text-[11px] leading-relaxed ${isLead ? 'text-slate-200' : 'text-white'}`}>
                                    {msg.content}
                                </p>
                            </div>
                            <span className="text-[8px] mt-0.5 font-bold text-slate-600 px-1">
                                {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                {!isLead && <span className="ml-1 text-[#25D366]">✓✓</span>}
                            </span>
                        </div>
                    );
                })
            )}
            <div ref={chatEndRef} />
        </div>

                    {/* Input */}
                    <div className="shrink-0 px-3 py-2.5 bg-[#0d0d0f]/90 border-t border-white/5 flex items-center gap-2">
                        {/* Botão agendar follow-up */}
                        <div className="relative shrink-0">
                            <button
                                title="Agendar Follow-up"
                                onClick={() => { setShowFollowUpPicker(o => !o); setFollowUpDateTime('') }}
                                className={`h-9 w-9 rounded-lg border flex items-center justify-center transition-all ${showFollowUpPicker ? 'bg-amber-600/25 border-amber-500/50' : 'bg-white/[0.03] border-white/8 hover:border-amber-500/30 hover:bg-amber-900/15'}`}
                            >
                                <Calendar className={`h-3.5 w-3.5 ${showFollowUpPicker ? 'text-amber-400' : 'text-slate-500'}`} />
                            </button>
                            {showFollowUpPicker && (
                                <div className="absolute bottom-full left-0 mb-2 z-50 bg-[#0f0f13] border border-white/10 rounded-xl p-3 shadow-2xl" style={{ minWidth: 240 }}>
                                    <p className="text-[8px] font-black text-amber-500/80 uppercase tracking-widest mb-2">Agendar Follow-up</p>
                                    <input
                                        type="datetime-local"
                                        value={followUpDateTime}
                                        onChange={e => setFollowUpDateTime(e.target.value)}
                                        min={new Date().toISOString().slice(0, 16)}
                                        style={{
                                            width: '100%', boxSizing: 'border-box',
                                            background: 'rgba(255,255,255,0.04)',
                                            border: '1px solid rgba(255,255,255,0.1)',
                                            borderRadius: '0.5rem',
                                            color: '#fff', fontSize: 11, padding: '6px 8px',
                                            outline: 'none', colorScheme: 'dark',
                                        }}
                                    />
                                    <div className="flex gap-2 mt-2">
                                        <button
                                            onClick={handleAgendarFollowUp}
                                            disabled={!followUpDateTime}
                                            className="flex-1 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-[10px] font-black text-white disabled:opacity-40 transition-all"
                                        >
                                            Confirmar
                                        </button>
                                        <button
                                            onClick={() => setShowFollowUpPicker(false)}
                                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-slate-400 transition-all"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                        <Input
                            className="flex-1 h-9 rounded-lg bg-black/30 border-white/8 text-[11px] text-slate-200 placeholder:text-slate-600"
                            placeholder="Intervenção humana — digite e pressione Enter..."
                            value={messageInput}
                            onChange={e => setMessageInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                        />
                        <Button
                            onClick={handleSendMessage}
                            className="shrink-0 h-9 w-9 rounded-lg bg-amber-600 hover:bg-amber-500 px-0 transition-all"
                            style={{ boxShadow: '0 0 10px rgba(245,158,11,0.25)' }}
                        >
                            <Send className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </>
  ) : (
    <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto">
        {/* Header */}
        <div className="text-center mb-6">
            <div className="h-14 w-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3"
                 style={{ boxShadow: '0 0 24px rgba(245,158,11,0.1)' }}>
                <Cpu className="h-7 w-7 text-amber-400" />
            </div>
            <h3 className="text-base font-black text-white uppercase tracking-wider mb-1">Painel dos Chips</h3>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">
                Selecione uma conversa à esquerda para abrir o chat
            </p>
        </div>

        {/* ChipStatus detalhado */}
        <div className="w-full max-w-2xl">
            <HealthPanel />
            <ChipStatus instances={instances} socket={socket} />
        </div>
    </div>
)}
        </div>

        {/* COLUNA 3 — Perfil lateral */}
        {activeChat && (
            <div className="w-[260px] shrink-0 border-l border-white/5 bg-slate-900/60 p-4 space-y-4 hidden xl:flex xl:flex-col overflow-y-auto custom-scrollbar">
               <p className="text-amber-400 text-[8px] font-black uppercase tracking-[0.2em]">Perfil do Decisor</p>
                <div className="space-y-3">
                    <div className="bg-yellow-500/10 p-3 rounded-xl border border-yellow-500/20 shadow-inner">
                        <span className="text-[8px] text-yellow-600 uppercase font-black block mb-0.5 tracking-widest">Proprietário</span>
                        <span className="text-sm font-black text-yellow-500 uppercase tracking-tighter">{activeChat.dono || 'Não identificado'}</span>
                    </div>
                    <div className="bg-amber-500/10 p-3 rounded-xl border border-amber-500/20">
                            <p className="text-[8px] text-amber-400 font-black uppercase mb-0.5">Nicho</p>
                            <p className="text-sm font-black text-amber-300 italic leading-none">{activeChat.niche || '—'}</p>
                    </div>
                    <div className="space-y-1">
                        <span className="text-[8px] text-slate-500 uppercase font-black block tracking-widest">Telefone</span>
                        <span className="text-sm font-black text-white font-mono">{activeChat.phone || '—'}</span>
                    </div>
                    {/* Estágio SPIN no perfil lateral */}
                    {activeChat.current_stage > 0 && (
                        <div className="bg-violet-500/10 p-3 rounded-xl border border-violet-500/20">
                            <p className="text-[8px] text-violet-400 font-black uppercase mb-1">Estágio SPIN</p>
                            <div className="flex items-center gap-1">
                                {[1,2,3,4,5].map(s => (
                                    <div key={s} className={`h-1.5 flex-1 rounded-full ${
                                        s <= activeChat.current_stage
                                   ? s <= 2 ? 'bg-amber-500' : s <= 4 ? 'bg-orange-500' : 'bg-emerald-500'
                                        : 'bg-slate-800'
                                    }`} />
                                ))}
                            </div>
                            <p className="text-[9px] text-violet-300 font-bold mt-1">
                                {['','Situação','Dor','Solução','Agendamento','Fechamento'][activeChat.current_stage]}
                            </p>
                        </div>
                    )}
                    {/* Temperatura no perfil lateral */}
                    {activeChat.lead_temperature && activeChat.lead_temperature !== 'cold' && (
                        <div className={`p-3 rounded-xl border ${rotuloTemperatura(activeChat.lead_temperature).bg}`}>
                            <p className="text-[8px] font-black uppercase mb-0.5" style={{ color: rotuloTemperatura(activeChat.lead_temperature).cor }}>Temperatura</p>
                            <p className="text-sm font-black" style={{ color: rotuloTemperatura(activeChat.lead_temperature).cor }}>
                                {textoTemperatura(activeChat.lead_temperature)}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        )}
    </div>
</TabsContent>
                                 <TabsContent value="dashboard" className="flex-1 overflow-hidden m-0 flex flex-col">
    {/* Sub-navegação do Analytics */}
    <div className="shrink-0 flex items-center gap-2 px-6 py-2.5 border-b border-white/5 bg-[#0d0d0d]/60">
        <span className="text-[9px] text-slate-600 font-black uppercase tracking-widest mr-2">Visão:</span>
        {[
           { key: 'overview', label: 'Resultados' },
           { key: 'operations', label: 'Operação' },
           { key: 'auditor', label: 'QA · Auditor' },
        ].map(tab => (
            <button
                key={tab.key}
                onClick={() => setAnalyticsView(tab.key)}
                className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                    analyticsView === tab.key
                        ? 'bg-amber-600 text-black'
                        : 'bg-white/[0.03] text-slate-500 border border-white/5 hover:border-amber-500/20 hover:text-slate-300'
                }`}
            >
                {tab.label}
            </button>
        ))}
    </div>

    {/* Conteúdo */}
    <div className="flex-1 overflow-auto">
        {analyticsView === 'overview' ? <VisualAnalytics /> : analyticsView === 'operations' ? <Dashboard /> : <AuditorDashboard socket={socket} />}
    </div>
</TabsContent>



                        <TabsContent value="briefing" className="flex-1 overflow-hidden m-0">
    <div className="h-full flex items-start justify-center p-8 overflow-y-auto">
        <div className="w-full max-w-2xl glass-panel rounded-2xl border-white/5 overflow-hidden">
            <OnboardingBriefing
                userId={session?.user?.id}
                onComplete={() => {
                    setBriefingCompleted(true)
                    setActiveTab('search')
                }}
            />
        </div>
    </div>
                        </TabsContent>
              </Tabs>
        </div>
    </div>

                            {/* POPUP DE BRIEFING — primeiro acesso */}
<Dialog open={showBriefing && !briefingCompleted} onOpenChange={setShowBriefing}>
    <DialogContent className="glass-panel border-white/10 text-white max-w-2xl w-[90vw] max-h-[90vh] rounded-2xl p-0 overflow-hidden bg-[#0A0A0A]/98">
        <OnboardingBriefing
            userId={session?.user?.id}
            isModal={true}
            onComplete={() => {
                setBriefingCompleted(true)
                setShowBriefing(false)
                setActiveTab('search')
            }}
        />
    </DialogContent>
</Dialog>

{/* MODAL DE CONEXÃO MULTI-CHIP */}
            <Dialog
                open={isConnectingChip || !!qrCodeData}
                onOpenChange={() => {
                    setQrCodeData(null);
                    setIsConnectingChip(false);
                    if (chipConnectTimerRef.current) { clearTimeout(chipConnectTimerRef.current); chipConnectTimerRef.current = null; }
                }}
            >
                <DialogContent className="glass-panel border-white/20 text-white max-w-sm rounded-[2.5rem] p-10 bg-[#0A0A0A]/98 shadow-2xl flex flex-col items-center">
                    <div className="bg-amber-600/20 p-4 rounded-full mb-6 border border-amber-500/30" style={{boxShadow:'0 0 20px rgba(245,158,11,0.2)'}}>
                        <MessageSquare className="h-10 w-10 text-amber-400" />
                    </div>

                    <DialogTitle className="text-2xl font-black text-white uppercase italic tracking-tighter text-center">
                        Vincular Unidade
                    </DialogTitle>
                    <p className="text-amber-400 font-bold text-[10px] uppercase tracking-widest mb-8 text-center">
                        {qrCodeData?.name || 'Nova Instância'}
                    </p>

                    {isConnectingChip && !qrCodeData?.qr ? (
                        /* ── SPINNER DE CARREGAMENTO ── */
                        <div className="flex flex-col items-center gap-6 py-2">
                            {/* Spinner triplo em laranja Enerzee */}
                            <div className="relative flex items-center justify-center" style={{ width: 88, height: 88 }}>
                                {/* Anel externo — rotação lenta */}
                                <div className="absolute inset-0 rounded-full border-2 border-orange-500/20 border-t-orange-500"
                                     style={{ animation: 'spin 2.4s linear infinite' }} />
                                {/* Anel médio — rotação inversa */}
                                <div className="absolute inset-3 rounded-full border-2 border-amber-500/20 border-t-amber-400"
                                     style={{ animation: 'spin 1.6s linear infinite reverse' }} />
                                {/* Ícone central */}
                                <div className="absolute inset-6 rounded-full flex items-center justify-center"
                                     style={{ background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.25)' }}>
                                    <Loader2 className="h-5 w-5 text-orange-400" style={{ animation: 'spin 1s linear infinite' }} />
                                </div>
                            </div>

                            {/* Barra de progresso animada */}
                            <div className="w-full max-w-[200px] h-0.5 rounded-full overflow-hidden"
                                 style={{ background: 'rgba(255,255,255,0.06)' }}>
                                <div className="h-full rounded-full"
                                     style={{
                                         background: 'linear-gradient(90deg, #f97316, #fbbf24, #f97316)',
                                         backgroundSize: '200% 100%',
                                         animation: 'shimmer-bar 1.8s ease-in-out infinite',
                                         width: '60%',
                                     }} />
                            </div>

                            {/* Texto informativo */}
                            <div className="text-center space-y-1.5 max-w-[220px]">
                                <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest">
                                    Estabelecendo conexão segura
                                </p>
                                <p className="text-[9px] font-bold text-slate-500 leading-relaxed">
                                    Proxy BR · Criptografando chaves de sessão
                                </p>
                                <p className="text-[8px] font-bold text-amber-400/60 leading-relaxed">
                                    Por favor, aguarde o QR Code e não recarregue a página.
                                </p>
                            </div>

                            <style>{`
                                @keyframes shimmer-bar {
                                    0%   { background-position: 200% 0; }
                                    100% { background-position: -200% 0; }
                                }
                            `}</style>
                        </div>
                    ) : (
                        /* ── QR CODE ── */
                        <>
                            <div className="p-6 bg-white rounded-[2rem] shadow-2xl">
                                {qrCodeData?.qr && <QRCodeSVG value={qrCodeData.qr} size={200} />}
                            </div>
                            <p className="text-slate-500 text-[10px] font-bold uppercase mt-8 text-center leading-relaxed">
                                Abra o WhatsApp no celular <br/>
                                Menu &gt; Aparelhos Conectados <br/>
                                Escaneie o código acima
                            </p>
                        </>
                    )}
                </DialogContent>
            </Dialog>


{/* --- BLOCO DE NOTAS --- */}
<Dialog open={showNotes} onOpenChange={setShowNotes}>
    <DialogContent className="border-white/10 text-white max-w-2xl w-full rounded-[2rem] p-0 overflow-hidden bg-[#0d0d0d] shadow-2xl">
        <div className="flex flex-col h-[75vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
                        <FileText className="h-4 w-4 text-amber-400" />
                    </div>
                    <div>
                        <p className="text-xs font-black text-white uppercase tracking-[0.25em]">Bloco de Notas</p>
                        <p className="text-[9px] text-slate-600 font-bold">Auto-salvo · {notesContent.length} caracteres</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={async () => { if (confirm('Limpar tudo?')) { setNotesContent(''); localStorage.setItem('radar_notes', ''); const { data: { session: s } } = await supabase.auth.getSession(); if (s?.user?.id) await supabase.from('profiles').update({ notes: '' }).eq('id', s.user.id); } }}
                        className="text-[9px] font-black uppercase tracking-widest text-slate-600 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-500/10"
                    >Limpar</button>
                </div>
            </div>

            {/* Quick-insert chips */}
            <div className="flex gap-2 px-6 py-3 border-b border-white/[0.04] flex-wrap">
                {['📍 Cidade: ', '🎯 Nicho: ', '✅ Feito: ', '❌ Evitar: ', '📝 Obs: '].map(tag => (
                    <button
                        key={tag}
                        onClick={async () => {
                            const sep = notesContent && !notesContent.endsWith('\n') ? '\n' : '';
                            const newVal = notesContent + sep + tag;
                            setNotesContent(newVal);
                            localStorage.setItem('radar_notes', newVal);
                            if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
                            notesTimerRef.current = setTimeout(async () => {
                                const { data: { session: s } } = await supabase.auth.getSession();
                                if (s?.user?.id) await supabase.from('profiles').update({ notes: newVal }).eq('id', s.user.id);
                            }, 1500);
                        }}
                    >{tag.trim()}</button>
                ))}
            </div>

            {/* Textarea */}
            <textarea
                value={notesContent}
                onChange={e => {
                const val = e.target.value;
                setNotesContent(val);
                localStorage.setItem('radar_notes', val);
                if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
                notesTimerRef.current = setTimeout(async () => {
                    const { data: { session: s } } = await supabase.auth.getSession();
                    if (s?.user?.id) await supabase.from('profiles').update({ notes: val }).eq('id', s.user.id);
                }, 1500);
            }}
                placeholder={"📍 Cidade: Fortaleza CE\n🎯 Nicho: Padarias\n✅ Feito: Centro, Aldeota\n❌ Evitar: Messejana (saturado)\n📝 Obs: Segunda-feira tem mais respostas..."}
                className="flex-1 resize-none bg-transparent text-sm text-slate-300 font-mono leading-relaxed p-6 focus:outline-none placeholder:text-slate-700"
                autoFocus
                spellCheck={false}
            />
        </div>
    </DialogContent>
</Dialog>

          {/* --- MODAL DETALHES GIGANTE: O DOSSIÊ DE INTELIGÊNCIA --- */}
{/* --- MODAL DETALHES GIGANTE: O DOSSIÊ DE INTELIGÊNCIA --- */}
<Dialog open={!!viewingLeadDetail} onOpenChange={() => setViewingLeadDetail(null)}>
    <DialogContent 
className="glass-panel border-white/20 text-white max-w-5xl w-[95vw] max-h-[95vh] rounded-[2.5rem] p-0 overflow-y-auto custom-scrollbar shadow-[0_0_100px_rgba(0,0,0,1)] bg-[#0A0A0A]/98 border-t-4 border-t-amber-600"
>
        {/* Reduzi o padding de p-10 para p-6 e o espaçamento vertical de space-y-8 para space-y-4 */}
        <div className="p-6 space-y-4">
            
            {/* HEADER DO DOSSIÊ */}
            <div className="flex justify-between items-start">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                     <Badge className="bg-amber-600/20 text-amber-400 border-amber-500/30 px-3 py-0.5 text-[8px] uppercase font-black tracking-widest rounded-full">Antix Flow 2026</Badge>
                        {viewingLeadDetail?.priority_level >= 3 && <Badge className="bg-red-600/20 text-red-500 border-red-500/30 px-2 py-0.5 text-[8px] font-black uppercase animate-pulse">Alta Prioridade 🔥</Badge>}
                    </div>
                    {/* Diminuído de text-4xl para text-2xl */}
                    <h2 className="text-2xl font-black tracking-tighter text-white neon-text leading-tight uppercase italic drop-shadow-lg">{viewingLeadDetail?.name}</h2>
                    <div className="flex items-center gap-2 text-slate-500 font-bold text-[10px] uppercase tracking-widest italic opacity-80">
                     <Building2 className="h-3 w-3 text-amber-500" />
                         <span>{viewingLeadDetail?.razao_social || viewingLeadDetail?.name || 'Identificação não disponível'}</span>
                    </div>
                </div>
                {/* Reduzi o card de score e a fonte de 6xl para 4xl */}
                <div className="text-right glass-card p-4 rounded-3xl border-amber-500/20 bg-amber-500/5 min-w-[120px]">
    <p className="text-[8px] font-black text-slate-500 uppercase mb-1 tracking-widest">Estágio</p>
    <div className="text-4xl font-black text-amber-400 leading-none italic">
        {viewingLeadDetail?.current_stage || 0}<span className="text-lg text-slate-500">/5</span>
    </div>
    <p className="text-[9px] text-slate-500 font-bold mt-1">
        {['Qualificação','Situação','Dor','Solução','Agenda','Fechado'][viewingLeadDetail?.current_stage || 0]}
    </p>
</div>
            </div>

            {/* GRID DE INFORMAÇÕES TÉCNICAS - Gap reduzido para 4 */}
            <div className="grid grid-cols-3 gap-4">
                {/* Blocos com padding reduzido para p-4 e bordas menores */}
                <div className="glass-card p-4 rounded-3xl space-y-3 bg-white/5 border-white/10">
                    <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-2"><ShieldCheck className="h-3 w-3"/> Rastreio Fiscal</p>
                    <div className="space-y-2">
                        <div>
                            <span className="text-[8px] text-slate-600 uppercase font-black block opacity-60">CNPJ</span>
                            <span className="text-base font-black text-white tracking-widest font-mono">{viewingLeadDetail?.cnpj || '00.000.000/0000-00'}</span>
                        </div>
                        <div>
                            <span className="text-[8px] text-slate-600 uppercase font-black block opacity-60">Natureza</span>
                          <p className="text-[10px] font-bold text-blue-300 leading-tight uppercase">{viewingLeadDetail?.natureza_juridica || 'Sociedade Limitada'}</p>
                        </div>
                    </div>
                </div>

                <div className="glass-card p-4 rounded-3xl space-y-3 bg-white/5 border-white/10 relative overflow-hidden">
                    <DollarSign className="absolute -right-2 -bottom-2 h-16 w-16 text-white opacity-[0.03] rotate-12" />
                    <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest flex items-center gap-2"><Zap className="h-3 w-3"/> Poder de Compra</p>
                    <div className="space-y-2">
                        <div>
                            <span className="text-[8px] text-slate-600 uppercase font-black block opacity-60">Capital Social</span>
                            <span className="text-xl font-black text-white italic tracking-tighter">
                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(viewingLeadDetail?.capital_social_numeric || viewingLeadDetail?.capital_social || 0)}
                            </span>
                        </div>
                        <div className="flex gap-3">
                            <div><span className="text-[8px] text-slate-600 font-black block opacity-50 uppercase">Porte</span><span className="text-xs font-black text-amber-300 uppercase italic">{viewingLeadDetail?.porte || 'ME'}</span></div>
                            <div><span className="text-[8px] text-slate-600 font-black block opacity-50 uppercase">Abertura</span><span className="text-xs font-black text-slate-300 italic">2014</span></div>
                        </div>
                    </div>
                </div>

                <div className="glass-card p-4 rounded-3xl space-y-3 bg-white/5 border-white/10">
                    <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest flex items-center gap-2"><MapPin className="h-3 w-3"/> Localização</p>
                    <div className="space-y-2">
                        <div>
                            <span className="text-[8px] text-slate-600 font-black block opacity-50 uppercase">Endereço</span>
                            <p className="text-[10px] font-bold text-slate-300 leading-tight uppercase truncate">{viewingLeadDetail?.endereco_fiscal || viewingLeadDetail?.address || 'Não mapeado'}</p>
                        </div>
                        <div className="flex gap-3 border-t border-white/5 pt-2">
                            <div><span className="text-[8px] text-slate-600 font-black block">Bairro</span><span className="text-[10px] font-black text-white uppercase italic">{viewingLeadDetail?.bairro || 'Centro'}</span></div>
                            <div><span className="text-[8px] text-slate-600 font-black block">CEP</span><span className="text-[10px] font-black text-white font-mono tracking-tighter">{viewingLeadDetail?.cep || '00000-000'}</span></div>
                        </div>
                    </div>
                </div>
            </div>
            {/* DADOS DE CONVERSÃO (NOVAS MÉTRICAS V13) */}
            {(viewingLeadDetail?.current_stage > 0 || viewingLeadDetail?.lead_temperature || viewingLeadDetail?.followup_count > 0 || viewingLeadDetail?.opening_template) && (
                <div className="grid grid-cols-4 gap-3">
                    <div className="glass-card p-3 rounded-2xl border-white/5">
                        <span className="text-[8px] text-slate-600 uppercase font-black block mb-1">Estágio Funil</span>
                        <div className="flex items-center gap-2">
                            <span className="text-lg font-black text-white">{viewingLeadDetail?.current_stage || 0}</span>
                            <span className="text-[9px] text-slate-500 uppercase font-bold">
                                {['Qualif.','Situação','Dor','Solução','Agenda','Fechado'][viewingLeadDetail?.current_stage || 0]}
                            </span>
                        </div>
                    </div>
                    <div className="glass-card p-3 rounded-2xl border-white/5">
                        <span className="text-[8px] text-slate-600 uppercase font-black block mb-1">Temperatura</span>
                        <span className={`text-lg font-black ${rotuloTemperatura(viewingLeadDetail?.lead_temperature).tw}`}>
                            {textoTemperatura(viewingLeadDetail?.lead_temperature)}
                        </span>
                    </div>
                    <div className="glass-card p-3 rounded-2xl border-white/5">
                        <span className="text-[8px] text-slate-600 uppercase font-black block mb-1">Follow-ups</span>
                        <span className="text-lg font-black text-white">{viewingLeadDetail?.followup_count || 0}<span className="text-[10px] text-slate-500">/3</span></span>
                    </div>
                    <div className="glass-card p-3 rounded-2xl border-white/5">
                        <span className="text-[8px] text-slate-600 uppercase font-black block mb-1">Template</span>
                        <span className="text-[10px] font-black text-blue-400 uppercase">{viewingLeadDetail?.opening_template || '—'}</span>
                    </div>
                </div>
            )}
            {/* CONTATO DIRETO - Altura e padding reduzidos */}
          <div className="bg-amber-600/5 p-4 rounded-3xl border border-amber-500/20 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="h-12 w-12 bg-amber-600/20 rounded-full border border-amber-500/30 flex items-center justify-center" style={{boxShadow:'0 0 16px rgba(245,158,11,0.2)'}}>
    <Users className="h-6 w-6 text-amber-400" />
</div>
                    <div>
                       <span className="text-[8px] text-amber-400 font-black uppercase tracking-widest block">Decisor</span>
                        <span className="text-xl font-black text-white uppercase tracking-tighter italic leading-none">{viewingLeadDetail?.dono || 'Sócio Administrador'}</span>
                    </div>
                </div>
                <div className="text-right">
                    <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest block opacity-60">WhatsApp</span>
               <span className="text-xl font-black text-amber-400 tracking-widest font-mono">{viewingLeadDetail?.phone || '(48) 0000-0000'}</span>
                </div>
            </div>

            {/* BOTÕES DE AÇÃO - Altura reduzida de h-24 para h-14 */}
            <div className="flex gap-4 pt-2">
                   <Button className="flex-1 h-14 bg-amber-600 hover:bg-amber-500 text-black text-lg font-black rounded-2xl shadow-lg border border-amber-500/30 uppercase italic flex items-center justify-center gap-2 transition-all active:scale-95 group">
                    ABRIR CANAL DE FECHAMENTO <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button variant="outline" className="h-14 px-8 border border-white/10 glass-card text-xs font-black rounded-2xl uppercase tracking-widest hover:bg-white/5" onClick={() => setViewingLeadDetail(null)}>FECHAR</Button>
            </div>
        </div>
    </DialogContent>
</Dialog>

            {/* MODAL EDIÇÃO */}
            <Dialog open={!!editingLead} onOpenChange={() => setEditingLead(null)}>
                <DialogContent className="glass-panel border-white/20 text-white sm:max-w-md rounded-[3rem] p-12 bg-[#0A0A0A]/98 shadow-2xl backdrop-blur-3xl">
                    <DialogHeader className="mb-8 text-center"><DialogTitle className="text-4xl font-black text-amber-400 neon-text tracking-tighter uppercase italic">Ajustar Lead</DialogTitle></DialogHeader>
                    <div className="space-y-8">
                        <div className="space-y-3"><Label className="text-[11px] font-black text-amber-300 uppercase tracking-[0.3em]">Nome Comercial</Label><Input value={editingLead?.name || ""} onChange={e => setEditingLead({ ...editingLead, name: e.target.value })} className="glass-card h-16 rounded-2xl bg-slate-950 border-white/10 text-xl font-black tracking-tighter px-6" /></div>
                        <div className="space-y-3"><Label className="text-[11px] font-black text-amber-300 uppercase tracking-[0.3em]">Fase do Funil</Label><select value={editingLead?.status || "new"} onChange={e => setEditingLead({ ...editingLead, status: e.target.value })} className="w-full glass-card h-16 bg-slate-950 border-white/10 rounded-2xl px-6 text-lg font-black text-white uppercase appearance-none cursor-pointer"><option value="new" className="bg-slate-950 text-white">Novos Leads</option><option value="contact" className="bg-slate-950 text-white">Em Atendimento</option><option value="waiting_analysis" className="bg-slate-950 text-white">Auditoria</option><option value="booked" className="bg-slate-950 text-white">Agendado</option></select></div>
                    </div>
                    <DialogFooter className="flex justify-between gap-6 pt-10 mt-6 border-t border-white/10"><Button variant="ghost" onClick={() => handleDeleteLead(editingLead.id)} className="text-red-500 font-black h-16 rounded-2xl px-10 text-xs uppercase tracking-widest glass-card border-transparent hover:bg-red-500/10">EXCLUIR</Button><Button onClick={handleSaveEdit} className="bg-amber-600 hover:bg-amber-500 text-black font-black h-16 rounded-2xl px-12 text-sm uppercase italic" style={{boxShadow:'0 0 16px rgba(245,158,11,0.2)'}}>SALVAR DADOS</Button></DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    );
}

// --- AUXILIARES OTIMIZADOS ---

function KanbanColumn({ title, count, color, children, icon, isActive }) {
    return (
        /* flex-1 e h-full garantem que a coluna expanda dinamicamente quando o header sumir */
        <div className={`min-w-[310px] w-[310px] glass-panel rounded-3xl flex flex-col overflow-hidden border relative transition-all duration-500 

                ${isActive ? 'border-amber-500/30 bg-amber-900/5' : 'border-white/5'}`}
    style={{ height: '100%', minHeight: '65vh', boxShadow: isActive ? '0 0 24px rgba(245,158,11,0.08)' : 'none' }}>

            <div className={`p-4 border-b border-white/10 flex justify-between items-center bg-gradient-to-r ${color} shrink-0 sticky top-0 z-20`}>
                 <div className="flex items-center gap-3 relative z-10">
                    <div className="bg-white/10 p-2 rounded-xl backdrop-blur-md border border-white/5 shadow-sm">{icon}</div>
                    <span className="font-black text-[10px] uppercase tracking-widest text-white">{title}</span>
                </div>
                <Badge variant="secondary" className="bg-white/20 text-white border-none font-bold text-xs px-2 py-0.5 backdrop-blur-md relative z-10">{count}</Badge>
            </div>

            {/* O conteúdo agora flui naturalmente sem scroll interno forçado */}
                <div className="p-3 space-y-3 bg-slate-950/20 flex-1 overflow-y-auto custom-scrollbar">
                {children}
            </div>
        </div>
    )
}

function LeadCard({ lead, isSelected, onSelect, onView, onEdit, onChat, onCall }) {
    // Tenta pegar o valor de ambas as nomenclaturas possíveis do banco
    const valorPotencial = lead?.capital_social_numeric || lead?.capital_social || 0;
    
    return (
        <div onClick={onView} className={`glass-card p-3 rounded-2xl cursor-pointer relative group transition-all duration-500 border-2 ${
        isSelected ? 'border-amber-500/40 bg-amber-900/10' : 'border-white/5 hover:border-amber-500/20'
}`}>
            {/* LINHA 1: SCORE, PRIORIDADE E RATING */}
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                    <div onClick={(e) => { e.stopPropagation(); onSelect(); }} className="hover:scale-110 transition-transform">
                       {isSelected ? <CheckSquare className="h-4 w-4 text-amber-400" /> : <Square className="h-4 w-4 text-slate-700" />}
                    </div>
                    {/* Ícone de Prioridade 🔥 baseada no level do banco */}
                    {lead?.priority_level >= 3 && <Flame className="h-3.5 w-3.5 text-orange-500 animate-pulse shadow-neon-orange" />}
                    {lead?.niche && (
    <span className="text-[7px] font-bold text-slate-600 uppercase tracking-wider bg-white/[0.04] px-1.5 py-0.5 rounded">
        {lead.niche.length > 12 ? lead.niche.slice(0, 12) + '…' : lead.niche}
    </span>
)}
                </div>
                {lead?.bairro && (
    <span className="text-[8px] text-slate-500 font-bold truncate max-w-[80px]">
        📍 {lead.bairro}
    </span>
)}
                {lead?.lead_temperature && lead.lead_temperature !== 'cold' && (
                    <Badge className={`border-none text-[7px] h-4 px-1.5 font-black uppercase tracking-tighter ${rotuloTemperatura(lead.lead_temperature).tw}`}>
                        {textoTemperatura(lead.lead_temperature)}
                    </Badge>
                )}
            </div>

            {/* LINHA 2: IDENTIFICAÇÃO E CONTATO RÁPIDO */}
            <div className="mb-2">
                <h3 className="text-[13px] font-black text-white tracking-tight leading-none uppercase truncate group-hover:text-blue-400 transition-colors">{lead?.name || "Sem Nome"}</h3>
                {/* Confirmação de reunião (Google Agenda): ✅ confirmado / ❌ desmarcado / ❓ pendente */}
                {lead?.confirmacao_status && (
                    <span className={`inline-flex items-center gap-1 mt-1.5 text-[8px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded ${
                        lead.confirmacao_status === 'confirmado' ? 'bg-emerald-500/15 text-emerald-400' :
                        lead.confirmacao_status === 'desmarcado' ? 'bg-red-500/15 text-red-400' :
                        'bg-amber-500/15 text-amber-400'
                    }`}>
                        {lead.confirmacao_status === 'confirmado' ? '✅ Confirmado'
                            : lead.confirmacao_status === 'desmarcado' ? '❌ Desmarcou'
                            : '❓ Aguardando'}
                    </span>
                )}
                <div className="flex flex-col gap-1 mt-2">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-amber-500/10 text-amber-400 border-none text-[7px] h-3 px-1 uppercase leading-none">{lead?.porte || 'ME'}</Badge>
                        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter truncate max-w-[120px]">{lead?.niche}</span>
                    </div>
                    {/* NÚMERO VISÍVEL PARA OPERAÇÃO RÁPIDA */}
                    <div className="flex items-center gap-1.5 opacity-70 group-hover:opacity-100 transition-opacity">
                      <Phone className="h-2.5 w-2.5 text-amber-400" />
                        <span className="text-[10px] font-black text-slate-300 tracking-wider font-mono">{lead?.phone || '(00) 0000-0000'}</span>
                    </div>
                </div>
            </div>
                {/* LINHA 2.5: ESTÁGIO DO FUNIL + FOLLOW-UP */}
            {(lead?.current_stage > 0 || lead?.followup_count > 0) && (
                <div className="flex items-center gap-2 mb-2">
                    {lead?.current_stage > 0 && (
                        <div className="flex items-center gap-1">
                            {[1,2,3,4,5].map(s => (
                                <div key={s} className={`h-1 w-4 rounded-full transition-all ${
                                    s <= lead.current_stage 
                                        ? s <= 2 ? 'bg-blue-500' : s <= 4 ? 'bg-amber-500' : 'bg-emerald-500'
                                        : 'bg-slate-800'
                                }`} />
                            ))}
                            <span className="text-[8px] font-black text-slate-500 ml-1 uppercase">E{lead.current_stage}</span>
                        </div>
                    )}
                    {lead?.followup_count > 0 && (
                        <span className="text-[7px] font-black text-slate-600 uppercase bg-slate-800/60 px-1.5 py-0.5 rounded">
                            FU{lead.followup_count}
                        </span>
                    )}
                </div>
            )}
            {/* LINHA 3: POTENCIAL FINANCEIRO CORRIGIDO */}
            <div className="bg-black/40 p-2 rounded-xl border border-white/5 mb-2 flex justify-between items-center">
                <div>
                    <p className="text-[7px] font-black text-slate-500 uppercase tracking-widest leading-none italic">Potencial Estimado</p>
                    <p className="text-xs font-black text-white tracking-tighter mt-0.5 italic">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorPotencial)}
                    </p>
                </div>
                <Zap className={`h-3 w-3 ${valorPotencial > 100000 ? 'text-yellow-500 animate-pulse shadow-neon-yellow' : 'text-slate-700'}`} />
            </div>

            {/* LINHA 4: DECISOR E EDIT */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[8px] text-white font-bold uppercase border ${lead?.dono ? 'bg-amber-600/30 border-amber-500/40' : 'bg-slate-800 border-white/10'}`}>{lead?.dono?.[0] || 'G'}</div>
                    <span className={`text-[10px] font-bold uppercase truncate max-w-[110px] ${lead?.dono ? 'text-amber-400' : 'text-slate-400'}`}>{lead?.dono || 'Gestor Identificado'}</span>
                    {lead?.backup_phones?.length > 0 && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-900/40 border border-purple-500/20 text-[8px] text-purple-400 font-bold shrink-0" title={`Repasse: ${lead.backup_phones.length} número(s) anterior(es)`}>
                            <Phone className="h-2.5 w-2.5" />
                            {lead.backup_phones.length}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    {onCall && (
                        <div onClick={(e) => { e.stopPropagation(); onCall(); }} className="h-6 w-6 rounded-lg bg-sky-600/10 border border-sky-500/20 flex items-center justify-center" title="Ligar agora (IA por voz)">
                            <Phone className="h-3 w-3 text-sky-400" />
                        </div>
                    )}
                    {onChat && (
                        <div onClick={(e) => { e.stopPropagation(); onChat(); }} className="h-6 w-6 rounded-lg bg-emerald-600/10 border border-emerald-500/20 flex items-center justify-center" title="Abrir conversa">
                            <MessageSquare className="h-3 w-3 text-emerald-400" />
                        </div>
                    )}
                    <div onClick={(e) => { e.stopPropagation(); onEdit(); }} className="h-6 w-6 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center">
                        <Edit2 className="h-3 w-3 text-blue-400" />
                    </div>
                </div>
            </div>




        </div>
    );
}
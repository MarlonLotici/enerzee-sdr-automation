import React, { useState, useEffect, useRef, useMemo } from 'react'
// --- IMPORTAÇÕES DE UI ---
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { NicheSelect } from "@/components/NicheSelect"

// --- ÍCONES (FULL SET 2026) ---
import { 
    Rocket, MapPin, LayoutDashboard, MessageSquare, Phone, Play, LocateFixed, Send, 
    BrainCircuit, Search, Download, X, CheckSquare, Square, Users, StopCircle, 
    Map as MapIcon, Loader2, Edit2, Trash2, Crosshair, Zap, Star, ShieldCheck, 
    DollarSign, Briefcase, Building2, ArrowRight, ShieldAlert, Trash, Check
} from 'lucide-react'

// --- MAPAS E SOCKET ---
import { io } from 'socket.io-client'
import { QRCodeSVG } from 'qrcode.react'
import { MapContainer, TileLayer, Circle, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet';

// --- CORREÇÃO DE ÍCONES DO LEAFLET ---
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
let DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

import { createClient } from '@supabase/supabase-js'

// --- CONFIGURAÇÃO ---
const supabase = createClient("https://vptfedhzynyhvhrlcfqd.supabase.co", "sb_publishable_T0-4c2bm3I5lNTw7tUGmcg_xVInIQKR")
const socket = io('http://localhost:3001', { autoConnect: false });

// --- COMPONENTES AUXILIARES DO MAPA ---
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

// ==================================================================================
// COMPONENTE PRINCIPAL
// ==================================================================================
export default function App() {
    // --- REFERÊNCIAS ---
    const kanbanRef = useRef(null);
    const logsEndRef = useRef(null);

    // --- ESTADOS DE NAVEGAÇÃO E DADOS ---
    const [activeTab, setActiveTab] = useState("search");
    const [leads, setLeads] = useState([]);
    const [chats, setChats] = useState([]);
    const [activeChat, setActiveChat] = useState(null);
    const [viewingLeadDetail, setViewingLeadDetail] = useState(null);
    const [editingLead, setEditingLead] = useState(null);
    const [selectedLeadIds, setSelectedLeadIds] = useState(new Set());

    // --- ESTADOS DO MOTOR IA ---
    const [isConnected, setIsConnected] = useState(false);
    const [qrCode, setQrCode] = useState("");
    const [isBotRunning, setIsBotRunning] = useState(false);
    const [botProgress, setBotProgress] = useState(0);
    const [botLogs, setBotLogs] = useState([]);
    const [sessionLeadsCount, setSessionLeadsCount] = useState(0);
    const [messageInput, setMessageInput] = useState("");

    // --- ESTADOS DE BUSCA E MAPA ---
    const [filterText, setFilterText] = useState("");
    const [selectedNiche, setSelectedNiche] = useState(null);
    const [locationName, setLocationName] = useState("");
    const [searchRadius, setSearchRadius] = useState(2);
    const [mapCenter, setMapCenter] = useState([-27.5969, -48.5495]); 
    const [isSearchingCity, setIsSearchingCity] = useState(false);
    const [citySuggestions, setCitySuggestions] = useState([]);

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

    const getLeadsByStatus = (status) => filteredLeads.filter(l => l.status === status);

    // --- LÓGICA: SCROLL LATERAL POR MOUSE (EDGE SCROLLING) ---
    useEffect(() => {
        const handleMouseMove = (e) => {
            if (activeTab !== 'crm' || !kanbanRef.current) return;
            const threshold = 120;
            const speed = 40;
            const width = window.innerWidth;
            if (e.pageX > width - threshold) kanbanRef.current.scrollLeft += speed;
            else if (e.pageX < threshold) kanbanRef.current.scrollLeft -= speed;
        };
        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [activeTab]);

    // --- SOCKETS E INICIALIZAÇÃO ---
    useEffect(() => {
        fetchLeadsFromDB();
        socket.connect();
        socket.on('qr_code', (code) => setQrCode(code));
        socket.on('whatsapp_status', (s) => setIsConnected(s === 'CONNECTED'));
        socket.on('new_lead', (l) => { 
            setLeads(prev => [l, ...prev]); 
            setSessionLeadsCount(c => c + 1);
            playNotificationSound();
        });
        socket.on('notification', (m) => setBotLogs(prev => [...prev, `[IA] ${m}`]));
        return () => socket.disconnect();
    }, []);

    // --- FUNÇÕES DE AÇÃO ---
    const playNotificationSound = () => {
        try { new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3').play().catch(()=>{}); } catch(e){}
    }

    const fetchLeadsFromDB = async () => {
        const { data } = await supabase.from('leads').select('*').order('created_at', { ascending: false });
        if (data) setLeads(data);
    };

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
        setIsBotRunning(!isBotRunning);
        if (!isBotRunning) {
            socket.emit('start_scraping', { niche: selectedNiche?.keywords, radius: searchRadius, city: locationName, lat: mapCenter[0], lng: mapCenter[1] });
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

    return (
        <div className="min-h-screen w-full flex flex-col relative bg-[#020617] overflow-y-auto custom-scrollbar scroll-smooth">
            
            {/* HEADER RETRÁTIL */}
            <header className="glass-panel border-b-0 px-8 py-6 shrink-0 z-50 relative overflow-hidden transition-all duration-700 hover:py-8">
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
                <div className="flex justify-between items-center relative z-10">
                    <div className="flex items-center gap-5">
                        <div className="bg-blue-600/20 p-4 rounded-3xl border border-blue-500/30 shadow-neon-blue">
                            <Rocket className="h-8 w-8 text-blue-400" />
                        </div>
                        <h1 className="text-3xl font-black tracking-tighter text-white uppercase italic">
                            Enerzee SDR <span className="text-blue-500 neon-text">Neural 2026</span>
                        </h1>
                    </div>
                    <div className="flex gap-8 items-center">
                        <div className="flex flex-col items-end glass-card px-6 py-2 rounded-[2rem] border-blue-500/20 bg-blue-500/5">
                            <span className="text-[10px] text-blue-300 font-black uppercase tracking-[0.2em] mb-1">Métricas de Prospecção</span>
                            <span className="text-3xl font-black text-white neon-text">{leads.length} <span className="text-sm text-slate-500">Leads</span></span>
                        </div>
                        <Button 
                            onClick={startScraping} 
                            className={`h-16 px-10 rounded-[2rem] font-black text-lg border-2 transition-all ${isBotRunning ? "bg-red-600 hover:bg-red-500" : "bg-blue-600 hover:bg-blue-500"}`}
                        >
                            {isBotRunning ? "PARAR MOTOR" : "INICIAR VARREDURA"}
                        </Button>
                    </div>
                </div>
            </header>

            {/* DASHBOARD STATUS */}
            {isBotRunning && (
                <div className="glass-panel border-y-0 p-6 relative z-40 bg-slate-900/40">
                    <div className="max-w-full mx-auto flex gap-10 items-center px-4">
                        <div className="w-1/4">
                            <div className="flex justify-between text-[11px] text-blue-300 font-black mb-3 uppercase tracking-widest"><span>Sincronização</span><span>{botProgress}%</span></div>
                            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden border border-white/5 p-[1px]">
                                <div className="h-full bg-blue-500 shadow-neon-blue" style={{ width: `${botProgress}%` }}></div>
                            </div>
                        </div>
                        <div className="flex-1 glass-card rounded-2xl p-4 h-24 overflow-y-auto font-mono text-[12px] bg-black/50 custom-scrollbar border-white/5 shadow-inner">
                            {botLogs.map((log, i) => <div key={i} className="text-cyan-400/90 mb-1 border-l-2 border-cyan-900 pl-3">{log}</div>)}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                </div>
            )}

            <main className="w-full flex-1 relative z-30 flex flex-col">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full flex-1 flex flex-col h-full">
                    
                    {/* TABS STICKY BAR */}
                    <div className="glass-panel border-b-0 px-8 py-4 sticky top-0 z-[60] backdrop-blur-3xl bg-[#020617]/80 shadow-2xl">
                        <TabsList className="bg-slate-900/40 border border-white/5 p-1 h-auto rounded-[2rem] gap-2 shadow-inner">
                            <TabsTrigger value="search" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-400 px-10 py-4 rounded-2xl font-black uppercase text-[11px] transition-all"><MapPin className="mr-2 h-4 w-4" /> Radar</TabsTrigger>
                            <TabsTrigger value="crm" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-400 px-10 py-4 rounded-2xl font-black uppercase text-[11px] transition-all"><LayoutDashboard className="mr-2 h-4 w-4" /> CRM War Room</TabsTrigger>
                            <TabsTrigger value="connections" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-400 px-10 py-4 rounded-2xl font-black uppercase text-[11px] transition-all"><MessageSquare className="mr-2 h-4 w-4" /> Central WhatsApp</TabsTrigger>
                        </TabsList>
                        
                        {/* BULK ACTIONS BAR */}
                        {selectedLeadIds.size > 0 && (
                            <div className="absolute right-12 top-4 flex gap-4 animate-in slide-in-from-right">
                                <Button onClick={handleBulkDelete} variant="destructive" className="h-12 rounded-xl font-black uppercase text-xs px-6 shadow-xl shadow-red-900/20"><Trash2 className="mr-2 h-4 w-4" /> Deletar {selectedLeadIds.size}</Button>
                                <Button onClick={() => setSelectedLeadIds(new Set())} variant="outline" className="h-12 rounded-xl font-black text-xs px-6 border-white/20 glass-card">Cancelar</Button>
                            </div>
                        )}
                    </div>

                    {/* --- ABA 2: CRM (DESTAQUE PARA DADOS) --- */}
                    <TabsContent value="crm" className="w-full flex flex-col flex-1 m-0">
                        <div className="p-8 glass-panel border-b border-white/5 flex justify-between items-center px-12 shrink-0 bg-slate-950/40 z-40">
                            <div className="relative glass-card rounded-[2rem] group w-[500px] bg-black/20 border-white/10 shadow-inner">
                                <Search className="absolute left-6 top-5 h-7 w-7 text-slate-600 group-focus-within:text-blue-500 transition-colors" />
                                <Input placeholder="Buscar por Nome, Sócio, CNPJ ou Celular..." className="bg-transparent border-none pl-16 text-white h-16 focus:ring-0 font-bold text-xl" value={filterText} onChange={e => setFilterText(e.target.value)} />
                            </div>
                            <div className="flex gap-4">
                                <Button onClick={() => alert("Gerando Excel Comercial...")} className="glass-card hover:bg-white/10 text-white h-16 px-10 rounded-[2rem] font-black text-xs tracking-widest uppercase border-white/10 shadow-2xl"><Download className="mr-3 h-5 w-5 text-blue-400" /> Exportar Leads</Button>
                                <Button onClick={handleClearLeads} className="h-16 px-10 rounded-[2rem] font-black text-xs text-red-500 hover:bg-red-500/10 glass-card border-transparent"><Trash2 className="mr-3 h-5 w-5" /> Limpar Base</Button>
                            </div>
                        </div>

                        <div ref={kanbanRef} className="flex-1 flex gap-6 overflow-x-auto p-8 custom-scrollbar bg-slate-950/20 min-h-[500px] scroll-smooth items-start">
                            <KanbanColumn title="Novos Capturados" count={getLeadsByStatus('new').length} color="from-slate-800 to-slate-950" icon={<Zap className="h-6 w-6 text-slate-400"/>}>
                                {getLeadsByStatus('new').map(l => (
                                    <LeadCard key={l.id} lead={l} isSelected={selectedLeadIds.has(l.id)} onSelect={() => toggleSelectLead(l.id)} onView={() => setViewingLeadDetail(l)} onEdit={() => setEditingLead(l)} onDelete={() => handleDeleteLead(l.id)} />
                                ))}
                            </KanbanColumn>
                            <KanbanColumn title="Em Atendimento IA" count={getLeadsByStatus('contact').length} color="from-blue-700 to-blue-950" icon={<BrainCircuit className="h-6 w-6 text-blue-300"/>} isActive={true}>
                                {getLeadsByStatus('contact').map(l => (
                                    <LeadCard key={l.id} lead={l} isSelected={selectedLeadIds.has(l.id)} onSelect={() => toggleSelectLead(l.id)} onView={() => setViewingLeadDetail(l)} onEdit={() => setEditingLead(l)} onDelete={() => handleDeleteLead(l.id)} />
                                ))}
                            </KanbanColumn>
                            <KanbanColumn title="Auditoria de Fatura" count={getLeadsByStatus('waiting_analysis').length} color="from-amber-600 to-orange-800" icon={<Search className="h-6 w-6 text-amber-300"/>}>
                                {getLeadsByStatus('waiting_analysis').map(l => (
                                    <LeadCard key={l.id} lead={l} isSelected={selectedLeadIds.has(l.id)} onSelect={() => toggleSelectLead(l.id)} onView={() => setViewingLeadDetail(l)} onEdit={() => setEditingLead(l)} onDelete={() => handleDeleteLead(l.id)} />
                                ))}
                            </KanbanColumn>
                            <KanbanColumn title="Agendamentos" count={getLeadsByStatus('closed').length} color="from-emerald-700 to-green-900" icon={<CheckSquare className="h-6 w-6 text-emerald-300"/>}>
                                {getLeadsByStatus('closed').map(l => (
                                    <LeadCard key={l.id} lead={l} isSelected={selectedLeadIds.has(l.id)} onSelect={() => toggleSelectLead(l.id)} onView={() => setViewingLeadDetail(l)} onEdit={() => setEditingLead(l)} onDelete={() => handleDeleteLead(l.id)} />
                                ))}
                            </KanbanColumn>
                        </div>
                    </TabsContent>

                    {/* ABA RADAR (CORREÇÃO DE CONTRASTE NICHO) */}
                    <TabsContent value="search" className="h-[calc(100vh-140px)] flex flex-col lg:flex-row overflow-hidden m-0">
                        <div className="w-[420px] glass-panel p-10 space-y-10 overflow-y-auto h-full shadow-2xl z-20 border-r border-white/5">
                            <div className="space-y-4">
                                <Label className="text-blue-400 font-black text-xs uppercase tracking-[0.4em] flex items-center gap-3"><Zap className="h-5 w-5 text-blue-500 animate-pulse"/> 1. Segmento Estratégico</Label>
                                <div className="glass-card bg-slate-950 p-2 rounded-2xl border-blue-500/20 shadow-inner">
                                    <NicheSelect onNicheSelect={setSelectedNiche} />
                                </div>
                            </div>
                            <div className="space-y-4 relative z-50">
                                <Label className="text-blue-300 font-black text-xs uppercase tracking-[0.4em] flex items-center gap-3"><Search className="h-5 w-5 text-blue-500"/> 2. Vetor de Localização</Label>
                                <Input className="glass-card h-16 pl-6 text-xl font-bold border-white/10 focus:border-blue-500" placeholder="Cidade..." value={locationName} onChange={(e) => handleCitySearch(e.target.value)} />
                                {citySuggestions.length > 0 && (
                                    <div className="absolute top-full left-0 w-full glass-panel rounded-3xl mt-4 shadow-2xl p-3 border-blue-500/30 max-h-72 overflow-y-auto z-[100] bg-slate-950">
                                        {citySuggestions.map((c, i) => (
                                            <div key={i} onClick={() => { setMapCenter([parseFloat(c.lat), parseFloat(c.lon)]); setLocationName(c.display_name.split(',')[0]); setCitySuggestions([]); }} className="p-5 hover:bg-blue-600 rounded-2xl cursor-pointer transition-all flex flex-col mb-2 border border-transparent hover:border-white/10">
                                                <span className="font-black text-white text-lg">{c.display_name.split(',')[0]}</span>
                                                <span className="text-xs text-blue-200 uppercase font-black tracking-widest">{c.display_name.split(',')[1] || 'Brasil'}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="space-y-6">
                                <div className="flex justify-between items-center"><Label className="text-blue-300 font-black text-xs uppercase tracking-[0.3em]">3. Raio: {searchRadius} KM</Label><Badge className="bg-blue-600 text-white font-black px-6 py-2 rounded-full text-lg shadow-neon-blue">{searchRadius} KM</Badge></div>
                                <input type="range" min="1" max="50" value={searchRadius} onChange={(e) => setSearchRadius(e.target.value)} className="w-full h-3 bg-slate-900 rounded-full appearance-none cursor-pointer accent-blue-500 border border-white/5 shadow-inner" />
                            </div>
                            <Button onClick={startScraping} className="w-full h-20 bg-blue-600 hover:bg-blue-500 font-black text-2xl rounded-3xl shadow-neon-blue mt-10 transition-transform active:scale-95 uppercase tracking-tighter italic">Ativar Radar Neural <ArrowRight className="ml-3 h-8 w-8"/></Button>
                        </div>
                        <div className="flex-1 relative">
                            <MapContainer center={mapCenter} zoom={13} style={{ height: "100%", width: "100%" }} className="leaflet-map-dark">
                                <MapController center={mapCenter} />
                                <MapClickHandler setCenter={setMapCenter} setLocationName={setLocationName} setSearchMode={null} />
                                <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                                <Circle center={mapCenter} radius={searchRadius * 1000} pathOptions={{ color: '#3b82f6', weight: 4, fillOpacity: 0.15, className: 'radar-active' }} />
                            </MapContainer>
                            <Button onClick={handleMyLocation} className="absolute top-12 right-12 z-[400] glass-card px-10 h-20 border-2 border-blue-500/30 text-white font-black text-xs uppercase tracking-[0.3em] shadow-2xl hover:bg-blue-600 transition-all flex items-center gap-4"><LocateFixed className="h-8 w-8 text-blue-400" /> Meu GPS</Button>
                        </div>
                    </TabsContent>

                    {/* ABA 3: WHATSAPP (MANTIDA) */}
                   <TabsContent value="connections" className="h-[calc(100vh-140px)] flex flex-col overflow-hidden relative z-20 bg-slate-950/40 m-0">
    <div className="flex-1 flex overflow-hidden">
        {/* COLUNA 1: LISTA DE CHATS (Estilo Moderno) */}
        <div className="w-[320px] border-r border-white/5 overflow-y-auto bg-slate-900/40 custom-scrollbar flex flex-col">
            <div className="p-6 border-b border-white/5">
                <p className="text-blue-300 text-[10px] font-black uppercase tracking-[0.3em] mb-4">Fluxo SDR Neural</p>
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <Input className="h-10 bg-black/40 border-white/5 pl-9 text-xs rounded-xl" placeholder="Pesquisar conversa..." />
                </div>
            </div>
            <div className="flex-1 overflow-y-auto">
                {chats.length > 0 ? chats.map(c => (
                    <div key={c.id} onClick={() => setActiveChat(c)} className={`p-5 cursor-pointer transition-all border-b border-white/5 ${activeChat?.id === c.id ? 'bg-blue-600/20' : 'hover:bg-white/5'}`}>
                        <div className="flex justify-between items-start mb-1">
                            <p className="font-bold text-white text-sm truncate uppercase tracking-tighter">{c.name}</p>
                            <span className="text-[8px] text-slate-500 font-bold">14:02</span>
                        </div>
                        <p className="text-[11px] text-slate-400 truncate italic opacity-70">{c.lastMsg || "Aguardando IA..."}</p>
                    </div>
                )) : (
                    <div className="flex flex-col items-center justify-center h-full opacity-30 text-center p-10">
                        <MessageSquare className="h-12 w-12 mb-4 text-blue-400" />
                        <p className="text-[10px] font-black uppercase">Sem tráfego neural</p>
                    </div>
                )}
            </div>
        </div>

        {/* COLUNA 2: JANELA DE CHAT */}
        <div className="flex-1 flex flex-col bg-black/20 relative">
            {activeChat ? (
                <>
                    <div className="p-6 border-b border-white/5 flex items-center justify-between backdrop-blur-md bg-slate-900/40">
                        <div className="flex items-center gap-4">
                            <div className="h-10 w-10 bg-blue-600/20 rounded-xl border border-blue-500/30 flex items-center justify-center font-black text-blue-400">{activeChat.name[0]}</div>
                            <h2 className="text-xl font-black text-white tracking-tighter uppercase">{activeChat.name}</h2>
                        </div>
                        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[9px] font-black">AUDITORIA ATIVA</Badge>
                    </div>
                    <div className="flex-1 p-10 overflow-y-auto custom-scrollbar flex flex-col gap-6">
                        {/* Exemplo de Mensagem IA */}
                        <div className="max-w-[80%] bg-slate-800/60 p-4 rounded-2xl rounded-tl-none border border-white/5 self-start">
                            <p className="text-sm text-slate-300">Olá, vi que você é proprietário da {activeChat.name}. Como está a economia de energia por aí?</p>
                        </div>
                        <div className="max-w-[80%] bg-blue-600/80 p-4 rounded-2xl rounded-tr-none border border-blue-500/50 self-end text-white shadow-lg">
                            <p className="text-sm">Assumindo controle manual da negociação...</p>
                        </div>
                    </div>
                    <div className="p-6 bg-slate-900/40 border-t border-white/5 flex gap-4">
                        <Input className="h-12 rounded-xl bg-black/40 border-white/10" placeholder="Digite para intervir na IA..." value={messageInput} onChange={e => setMessageInput(e.target.value)} />
                        <Button className="h-12 w-12 rounded-xl bg-blue-600 shadow-neon-blue"><Send className="h-5 w-5" /></Button>
                    </div>
                </>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center opacity-30">
                    <BrainCircuit className="h-24 w-24 text-blue-400 animate-pulse mb-6" />
                    <p className="text-xl font-black uppercase tracking-[0.4em] text-blue-300">War Room SDR</p>
                </div>
            )}
        </div>

        {/* COLUNA 3: INTELIGÊNCIA LATERAL (Contexto do Lead) */}
        {activeChat && (
            <div className="w-[300px] border-l border-white/5 bg-slate-900/60 p-8 space-y-8 hidden xl:block overflow-y-auto custom-scrollbar">
                <p className="text-blue-400 text-[9px] font-black uppercase tracking-[0.3em]">Perfil do Decisor</p>
                <div className="space-y-4">
                    <div className="bg-yellow-500/10 p-4 rounded-2xl border border-yellow-500/20 shadow-inner">
                        <span className="text-[9px] text-yellow-600 uppercase font-black block mb-1 tracking-widest">Proprietário</span>
                        <span className="text-lg font-black text-yellow-500 uppercase tracking-tighter leading-none">MARCOS ZANIOLO</span>
                    </div>
                    <div className="space-y-2">
                        <span className="text-[9px] text-slate-500 uppercase font-black block tracking-widest">Capacidade de Fechamento</span>
                        <span className="text-2xl font-black text-white italic leading-none">R$ 150.000,00</span>
                    </div>
                    <div className="pt-6 border-t border-white/5">
                        <Button variant="outline" className="w-full text-[10px] font-black uppercase h-12 border-white/10 glass-card">Ver Dossiê Completo</Button>
                    </div>
                </div>
                <div className="p-4 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                    <p className="text-[9px] text-emerald-400 font-black uppercase mb-1">Qualificação IA</p>
                    <p className="text-3xl font-black text-emerald-400 italic leading-none">9.8</p>
                </div>
            </div>
        )}
    </div>
    
    {/* CONEXÃO FOOTER (Fixado na aba) */}
    <div className="p-6 border-t border-white/5 flex items-center justify-between bg-slate-900/80 shrink-0">
        <div className={`flex items-center gap-4 px-6 py-2 rounded-full border ${isConnected ? 'bg-green-500/10 border-green-500/30 shadow-neon-green' : 'bg-red-500/10 border-red-500/30'}`}>
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}></div>
            <span className="text-[10px] font-black uppercase tracking-widest">{isConnected ? 'SISTEMA ONLINE' : 'OFFLINE'}</span>
        </div>
        {!isConnected && qrCode && <Dialog><DialogTrigger asChild><Button className="bg-white text-black font-black px-10 h-12 rounded-xl text-xs">ABRIR QR CODE</Button></DialogTrigger><DialogContent className="glass-panel flex flex-col items-center p-12 rounded-[3rem] border-white/20"><QRCodeSVG value={qrCode} size={250} /></DialogContent></Dialog>}
        {!isConnected && !qrCode && <Button onClick={handleStartSDR} className="bg-blue-600 font-black px-10 h-12 rounded-xl text-xs shadow-neon-blue">CONECTAR</Button>}
    </div>
</TabsContent>
                </Tabs>
            </main>

            {/* --- MODAL DETALHES GIGANTE: O DOSSIÊ DE INTELIGÊNCIA --- */}
            <Dialog open={!!viewingLeadDetail} onOpenChange={() => setViewingLeadDetail(null)}>
                <DialogContent className="glass-panel border-white/20 text-white max-w-7xl rounded-[5rem] p-0 overflow-hidden shadow-[0_0_150px_rgba(0,0,0,1)] bg-[#020617]/99 border-t-[12px] border-t-blue-600">
                    <div className="p-20 space-y-16">
                        <div className="flex justify-between items-start">
                            <div className="space-y-6">
                                <Badge className="bg-blue-600/20 text-blue-400 border-blue-500/30 px-10 py-3 text-xs uppercase font-black tracking-[0.5em] shadow-inner rounded-full">Ficha de Inteligência Comercial 2026</Badge>
                                <h2 className="text-8xl font-black tracking-tighter text-white neon-text leading-none uppercase italic">{viewingLeadDetail?.name}</h2>
                                <p className="text-3xl text-slate-500 font-black uppercase tracking-widest italic">{viewingLeadDetail?.razao_social || 'Razão Social em processamento'}</p>
                            </div>
                            <div className="text-right glass-card p-10 rounded-[4rem] border-emerald-500/30 bg-emerald-500/5 shadow-2xl group"><p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Lead Scoring Neural</p><div className="text-9xl font-black text-emerald-400 leading-none group-hover:scale-110 transition-transform">9.8</div></div>
                        </div>
                        <div className="grid grid-cols-2 gap-12">
                            <div className="glass-card p-16 rounded-[4rem] space-y-12 bg-white/5 border-white/10 shadow-2xl relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-10 opacity-5 rotate-12 group-hover:opacity-10 transition-opacity"><DollarSign className="h-64 w-64 text-white" /></div>
                                <p className="text-xs font-black text-blue-400 uppercase tracking-[0.4em] flex items-center gap-4 relative z-10"><DollarSign className="h-7 w-7 text-blue-500 shadow-neon-blue"/> Análise de Poder de Compra</p>
                                <div className="space-y-10 relative z-10">
                                    <div><span className="text-xs text-slate-500 uppercase font-black block mb-5 tracking-[0.3em] underline underline-offset-8">Capital Social</span><span className="text-7xl font-black text-white italic tracking-tighter">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(viewingLeadDetail?.capital_social || 0)}</span></div>
                                    <div className="flex gap-10">
                                        <div><span className="text-xs text-slate-600 uppercase font-black block mb-2 tracking-widest">Porte Fiscal</span><span className="text-4xl font-black text-blue-300 uppercase tracking-tighter italic">{viewingLeadDetail?.porte || 'ME'}</span></div>
                                        <div><span className="text-xs text-slate-600 uppercase font-black block mb-2 tracking-widest">Abertura</span><span className="text-4xl font-black text-slate-300 uppercase tracking-tighter italic">2014</span></div>
                                    </div>
                                </div>
                            </div>
                            <div className="glass-card p-16 rounded-[4rem] space-y-12 bg-white/5 border-white/10 shadow-2xl relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-10 opacity-5 -rotate-12 group-hover:opacity-10 transition-opacity"><Users className="h-64 w-64 text-white" /></div>
                                <p className="text-xs font-black text-purple-400 uppercase tracking-[0.4em] flex items-center gap-4 relative z-10"><Users className="h-7 w-7 text-purple-500 shadow-neon-purple"/> Estrutura de Decisão</p>
                                <div className="bg-yellow-500/10 p-12 rounded-[3.5rem] border-2 border-yellow-500/30 shadow-[0_0_50px_rgba(234,179,8,0.15)] relative z-10">
                                    <span className="text-[11px] text-yellow-600 uppercase font-black block mb-5 tracking-[0.3em] underline decoration-yellow-900 underline-offset-8">Sócio Administrador / Decisor</span>
                                    <span className="text-7xl font-black text-yellow-500 uppercase tracking-tighter leading-tight drop-shadow-2xl italic">{viewingLeadDetail?.dono || 'Sócio Identificado'}</span>
                                </div>
                                <div className="pl-6 relative z-10">
                                    <span className="text-xs text-slate-500 uppercase font-black block mb-4 tracking-widest italic opacity-50">Contato Direto WhatsApp</span>
                                    <span className="text-5xl font-black text-white tracking-tighter border-b-4 border-blue-500/20 pb-4 block">{viewingLeadDetail?.phone}</span>
                                    <span className="text-xs text-slate-500 uppercase font-black block mt-6 tracking-widest opacity-50 italic">Endereço Registrado</span>
                                    <span className="text-2xl font-black text-slate-300 uppercase">{viewingLeadDetail?.bairro || viewingLeadDetail?.address}</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-10 pt-10 relative z-10">
                            <Button className="flex-1 h-32 bg-blue-600 hover:bg-blue-500 text-5xl font-black rounded-[3rem] shadow-[0_40px_80px_rgba(59,130,246,0.6)] border-2 border-white/20 uppercase italic flex items-center justify-center gap-8 group transform active:scale-95 transition-all">
                                ABRIR CANAL DE FECHAMENTO <ArrowRight className="h-12 w-12 group-hover:translate-x-6 transition-transform" />
                            </Button>
                            <Button variant="outline" className="h-32 px-24 border-2 border-white/10 glass-card text-2xl font-black rounded-[3rem] uppercase tracking-[0.3em] hover:bg-white/5 transition-all" onClick={() => setViewingLeadDetail(null)}>FECHAR FICHA</Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* MODAL EDIÇÃO */}
            <Dialog open={!!editingLead} onOpenChange={() => setEditingLead(null)}>
                <DialogContent className="glass-panel border-white/20 text-white sm:max-w-md rounded-[3rem] p-12 bg-[#020617]/98 shadow-2xl backdrop-blur-3xl">
                    <DialogHeader className="mb-8 text-center"><DialogTitle className="text-4xl font-black text-blue-400 neon-text tracking-tighter uppercase italic">Ajustar Lead</DialogTitle></DialogHeader>
                    <div className="space-y-8">
                        <div className="space-y-3"><Label className="text-[11px] font-black text-blue-300 uppercase tracking-[0.3em]">Nome Comercial</Label><Input value={editingLead?.name || ""} onChange={e => setEditingLead({ ...editingLead, name: e.target.value })} className="glass-card h-16 rounded-2xl bg-slate-950 border-white/10 text-xl font-black tracking-tighter px-6" /></div>
                        <div className="space-y-3"><Label className="text-[11px] font-black text-blue-300 uppercase tracking-[0.3em]">Fase do Funil Neural</Label><select value={editingLead?.status || "new"} onChange={e => setEditingLead({ ...editingLead, status: e.target.value })} className="w-full glass-card h-16 bg-slate-950 border-white/10 rounded-2xl px-6 text-lg font-black text-white uppercase appearance-none cursor-pointer"><option value="new" className="bg-slate-950 text-white">Novos Leads</option><option value="contact" className="bg-slate-950 text-white">Em Atendimento</option><option value="waiting_analysis" className="bg-slate-950 text-white">Auditoria</option><option value="closed" className="bg-slate-950 text-white">Agendado</option></select></div>
                    </div>
                    <DialogFooter className="flex justify-between gap-6 pt-10 mt-6 border-t border-white/10"><Button variant="ghost" onClick={() => handleDeleteLead(editingLead.id)} className="text-red-500 font-black h-16 rounded-2xl px-10 text-xs uppercase tracking-widest glass-card border-transparent hover:bg-red-500/10">EXCLUIR</Button><Button onClick={handleSaveEdit} className="bg-blue-600/80 hover:bg-blue-500 shadow-neon-blue font-black h-16 rounded-2xl px-12 text-sm uppercase italic">SALVAR DADOS</Button></DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    );
}

// --- AUXILIARES OTIMIZADOS ---

function KanbanColumn({ title, count, color, children, icon, isActive }) {
    return (
        /* min-w-[280px] é o segredo para o card não esticar */
        <div className={`min-w-[280px] w-[280px] glass-panel rounded-2xl flex flex-col mb-6 overflow-hidden border relative transition-all duration-300 
            ${isActive ? 'border-blue-500/40 bg-blue-900/5' : 'border-white/5'} 
            h-[calc(100vh-280px)]`}>
            
            <div className={`p-3 border-b border-white/10 flex justify-between items-center bg-gradient-to-r ${color} shrink-0`}>
                 <div className="flex items-center gap-2">
                    <div className="bg-white/10 p-1.5 rounded-lg text-white">{icon}</div>
                    <span className="font-black text-[9px] uppercase tracking-wider text-white">{title}</span>
                </div>
                <Badge className="bg-white/20 text-[10px] h-5">{count}</Badge>
            </div>

            <div className="p-3 space-y-3 flex-1 overflow-y-auto custom-scrollbar bg-slate-950/20">
                {children}
            </div>
        </div>
    )
}

function LeadCard({ lead, isSelected, onSelect, onView, onEdit }) {
    return (
        <div 
            onClick={onView} 
            className={`glass-card p-3 rounded-xl cursor-pointer relative group border-2 transition-all ${
                isSelected ? 'border-blue-500/60 bg-blue-900/20' : 'border-white/5 hover:border-blue-500/30'
            }`}
        >
            <div className="flex justify-between items-start mb-2">
                <div onClick={(e) => { e.stopPropagation(); onSelect(); }}>
                    {isSelected ? <CheckSquare className="h-4 w-4 text-blue-400" /> : <Square className="h-4 w-4 text-slate-700" />}
                </div>
                <Badge className="bg-yellow-500/10 text-yellow-500 border-none text-[8px] h-4 px-1">⭐ {lead?.rating || '4.5'}</Badge>
            </div>

            <div className="mb-2">
                <h3 className="text-sm font-bold text-white leading-tight uppercase truncate">{lead?.name || "Sem Nome"}</h3>
                <p className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter mt-0.5">{lead?.niche}</p>
            </div>

            <div className="bg-black/40 p-2 rounded-lg border border-white/5 mb-2">
                <p className="text-[7px] font-black text-blue-400 uppercase mb-0.5 opacity-70">Potencial</p>
                <p className="text-sm font-black text-white tracking-tighter">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lead?.capital_social || 0)}
                </p>
            </div>

            <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                <div className="flex flex-col">
                    <span className="text-[8px] text-blue-300 font-black uppercase opacity-60">Decisor</span>
                    <span className="text-[11px] font-black text-yellow-500 uppercase leading-none">
                        👤 {String(lead?.dono || 'GESTOR').split(' ')[0]}
                    </span>
                </div>
                <Zap className="h-3 w-3 text-blue-400" />
            </div>
        </div>
    );
}
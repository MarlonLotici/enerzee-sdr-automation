import React, { useState, useEffect, useRef, useMemo } from 'react'
import './index.css'
// --- IMPORTAÇÕES DE UI ---
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import NicheSelect from "@/components/NicheSelect"
import Dashboard from './Dashboard'
// --- ÍCONES (FULL SET 2026) ---
import { 
    Rocket, MapPin, LayoutDashboard, MessageSquare, Phone, Play, LocateFixed, Send, 
    BrainCircuit, Search, Download, X, CheckSquare, Square, Users, StopCircle, 
    Map as MapIcon, Loader2, Edit2, Trash2, Crosshair, Zap, Star, ShieldCheck, 
    DollarSign, Briefcase, Building2, ArrowRight, ShieldAlert, Trash, Check, BarChart2, Flame
} from 'lucide-react'

// --- MAPAS E SOCKET ---
import { io } from 'socket.io-client'
import { QRCodeSVG } from 'qrcode.react'
import { MapContainer, TileLayer, Circle, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet';


import { createClient } from '@supabase/supabase-js'

// --- CONFIGURAÇÃO ---
const supabase = createClient("https://vptfedhzynyhvhrlcfqd.supabase.co", "sb_publishable_T0-4c2bm3I5lNTw7tUGmcg_xVInIQKR")
const socketUrl = typeof window !== 'undefined' && window.location.hostname === 'localhost' 
    ? 'http://localhost:3001' 
    : '/';
const socket = io(socketUrl, { autoConnect: false });
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
    const [messageInput, setMessageInput] = useState("");
    const [sessionLeadsCount, setSessionLeadsCount] = useState(0);

    // --- ESTADOS DO MOTOR IA (MULTI-INSTÂNCIA 2026) ---
const [isConnected, setIsConnected] = useState(false);
const [qrCodeData, setQrCodeData] = useState(null); // Agora guarda { qr, instanceId, name }
const [instances, setInstances] = useState([]); // Lista de chips no banco
const [selectedInstanceId, setSelectedInstanceId] = useState(null); 
const [isBotRunning, setIsBotRunning] = useState(false);
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

        // PEDIR LISTA AO CONECTAR
        socket.on('connect', () => {
            socket.emit('get_instances'); 
        });

        socket.on('instances_list', (list) => {
    setInstances(list);
    // Se a lista chegou e não temos nada selecionado, seleciona o primeiro chip automaticamente
    if (list.length > 0 && !selectedInstanceId) {
        setSelectedInstanceId(list[0].id);
    }
});

        socket.on('qr_code', (data) => setQrCodeData(data));

        socket.on('whatsapp_status', (statusData) => {
            if (statusData.status === 'CONNECTED') {
                setQrCodeData(null);
                setIsConnected(true);
                socket.emit('get_instances'); // Atualiza a lista para mostrar a bolinha verde
            }
        });

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
    console.log("Tentando iniciar Scraping com ID:", selectedInstanceId);
    if (!selectedInstanceId) return alert("Por favor, selecione um chip na aba Connections antes de iniciar.");
    
    setIsBotRunning(!isBotRunning);
    if (!isBotRunning) {
        socket.emit('start_scraping', { 
            niche: selectedNiche?.keywords, 
            radius: searchRadius, 
            city: locationName, 
            lat: mapCenter[0], 
            lng: mapCenter[1],
            instanceId: selectedInstanceId // <--- ENVIANDO O ID DO CHIP
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
<div className="min-h-screen w-full flex flex-col relative bg-[#020617] overflow-x-hidden">            
{/* HEADER RETRÁTIL - VERSÃO COMPACTA 2026 */}
            <header className="glass-panel border-b-0 px-8 py-3 shrink-0 z-50 relative overflow-hidden transition-all duration-700">
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
                <div className="flex justify-between items-center relative z-10">
                    <div className="flex items-center gap-4">
                        <div className="bg-blue-600/20 p-2.5 rounded-2xl border border-blue-500/30 shadow-neon-blue">
                            <Rocket className="h-6 w-6 text-blue-400" />
                        </div>
                        <h1 className="text-2xl font-black tracking-tighter text-white uppercase italic leading-none">
                            Enerzee SDR <span className="text-blue-500 neon-text">Neural 2026</span>
                        </h1>
                    </div>
                    <div className="flex gap-6 items-center">
                        <div className="flex flex-col items-end glass-card px-4 py-1.5 rounded-2xl border-blue-500/20 bg-blue-500/5">
                            <span className="text-[9px] text-blue-300 font-black uppercase tracking-widest mb-0.5">Métricas de Prospecção</span>
                            <span className="text-xl font-black text-white leading-none">{leads.length} <span className="text-[10px] text-slate-500 uppercase">Leads</span></span>
                        </div>
                        <Button 
                            onClick={startScraping} 
                            className={`h-12 px-8 rounded-2xl font-black text-sm border-2 transition-all shadow-lg ${isBotRunning ? "bg-red-600 border-red-500 hover:bg-red-500" : "bg-blue-600 border-blue-500 hover:bg-blue-500"}`}
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

           <main className="flex-1 flex flex-col overflow-hidden relative z-30">
    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">                    
                    {/* TABS STICKY BAR */}
                    <div className="glass-panel border-b-0 px-8 py-4 sticky top-0 z-[60] backdrop-blur-3xl bg-[#020617]/90 shadow-2xl">
                        <TabsList className="bg-slate-900/40 border border-white/5 p-1 h-auto rounded-[2rem] gap-2 shadow-inner">
                            <TabsTrigger value="search" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-400 px-10 py-4 rounded-2xl font-black uppercase text-[11px] transition-all"><MapPin className="mr-2 h-4 w-4" /> Radar</TabsTrigger>
                            <TabsTrigger value="crm" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-400 px-10 py-4 rounded-2xl font-black uppercase text-[11px] transition-all"><LayoutDashboard className="mr-2 h-4 w-4" /> CRM War Room</TabsTrigger>
                            <TabsTrigger value="connections" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-400 px-10 py-4 rounded-2xl font-black uppercase text-[11px] transition-all"><MessageSquare className="mr-2 h-4 w-4" /> Central WhatsApp</TabsTrigger>
                            <TabsTrigger value="dashboard" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white text-slate-400 px-10 py-4 rounded-2xl font-black uppercase text-[11px] transition-all"><BarChart2 className="mr-2 h-4 w-4" /> Analytics</TabsTrigger>                        
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
                           {/* NOVA COLUNA: ERROS DE REGISTRO */}
<KanbanColumn 
    title="Erros de Registro" 
    count={getLeadsByStatus('error').length} 
    color="from-red-900 to-black" 
    icon={<ShieldAlert className="h-6 w-6 text-red-500 animate-pulse"/>}
>
    {getLeadsByStatus('error').map(l => (
        <LeadCard 
            key={l.id} 
            lead={l} 
            isSelected={selectedLeadIds.has(l.id)} 
            onSelect={() => toggleSelectLead(l.id)} 
            onView={() => setViewingLeadDetail(l)} 
            onEdit={() => setEditingLead(l)} 
            onDelete={() => handleDeleteLead(l.id)} 
        />
    ))}
</KanbanColumn>
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
                                <div className="relative z-[100] glass-card bg-slate-950 p-2 rounded-2xl border-blue-500/20">
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
                           <div className="flex-1 relative z-0 min-h-[400px]">
    <MapContainer center={mapCenter} zoom={13} style={{ height: "100%", width: "100%", position: "absolute", top: 0, left: 0 }} className="leaflet-map-dark">
    <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
</MapContainer>

    <Button onClick={handleMyLocation} className="absolute top-12 right-12 z-[400] glass-card px-10 h-20 border-2 border-blue-500/30 text-white font-black text-xs uppercase tracking-[0.3em] shadow-2xl hover:bg-blue-600 transition-all flex items-center gap-4">
        <LocateFixed className="h-8 w-8 text-blue-400" /> Meu GPS
    </Button>
</div>
                         
                            <Button onClick={handleMyLocation} className="absolute top-12 right-12 z-[400] glass-card px-10 h-20 border-2 border-blue-500/30 text-white font-black text-xs uppercase tracking-[0.3em] shadow-2xl hover:bg-blue-600 transition-all flex items-center gap-4"><LocateFixed className="h-8 w-8 text-blue-400" /> Meu GPS</Button>
                        </div>
                    </TabsContent>

                    {/* ABA 3: WHATSAPP (MANTIDA) */}
                 <TabsContent value="connections" className="h-[calc(100vh-160px)] flex flex-col overflow-hidden relative z-20 bg-slate-950/40 m-0">
    <div className="flex-1 flex overflow-hidde n">
        
        {/* COLUNA 1: LISTA DE CHATS - COM GESTÃO DE CHIPS */}
<div className="w-[280px] border-r border-white/5 overflow-y-auto bg-slate-900/40 custom-scrollbar flex flex-col h-full">
    <div className="p-4 border-b border-white/5 space-y-4">
        <div>
            <p className="text-blue-300 text-[9px] font-black uppercase tracking-[0.2em] mb-2">Unidade Ativa</p>
            <select 
                value={selectedInstanceId || ''} 
                onChange={(e) => setSelectedInstanceId(e.target.value)}
                className="w-full h-10 bg-black/40 border border-white/10 rounded-xl text-[11px] text-white font-bold px-3 outline-none focus:border-blue-500 transition-all"
            >
                <option value="">Selecione um Chip...</option>
                {instances.map(inst => (
                    <option key={inst.id} value={inst.id}>
                        {inst.whatsapp_status === 'CONNECTED' ? '🟢' : '🔴'} {inst.name}
                    </option>
                ))}
            </select>
            <Button 
                onClick={() => {
                    const nome = prompt("Nome da nova unidade (Ex: Chip Claro 02):");
                    if(nome) socket.emit('create_instance', { name: nome });
                }}
                className="w-full mt-2 h-7 text-[8px] uppercase font-black bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/40"
            >
                + Adicionar Unidade
            </Button>
        </div>
        <div className="relative">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
            <Input className="h-9 bg-black/40 border-white/5 pl-9 text-[11px] rounded-lg" placeholder="Pesquisar conversa..." />
        </div>
    </div>
    
</div>
        {/* COLUNA 2: JANELA DE CHAT - Foco em Conteúdo */}
        <div className="flex-1 flex flex-col bg-black/20 relative">
            {activeChat ? (
                <>
                    <div className="p-3 border-b border-white/5 flex items-center justify-between backdrop-blur-md bg-slate-900/40">
                        <div className="flex items-center gap-3">
                            <div className="h-8 w-8 bg-blue-600/20 rounded-lg border border-blue-500/30 flex items-center justify-center font-black text-blue-400 text-xs">{activeChat.name[0]}</div>
                            <h2 className="text-base font-black text-white tracking-tighter uppercase">{activeChat.name}</h2>
                        </div>
                        <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[8px] font-black">AUDITORIA ATIVA</Badge>
                    </div>
                    {/* Padding reduzido de 10 para 4 */}
                    <div className="flex-1 p-4 overflow-y-auto custom-scrollbar flex flex-col gap-3">
                        <div className="max-w-[85%] bg-slate-800/60 p-3 rounded-xl rounded-tl-none border border-white/5 self-start">
                            <p className="text-xs text-slate-300">Olá, vi que você é proprietário da {activeChat.name}. Como está a economia de energia por aí?</p>
                        </div>
                        <div className="max-w-[85%] bg-blue-600/80 p-3 rounded-xl rounded-tr-none border border-blue-500/50 self-end text-white shadow-lg">
                            <p className="text-xs font-medium">Assumindo controle manual da negociação...</p>
                        </div>
                    </div>
                    {/* Input mais fino */}
                    <div className="p-3 bg-slate-900/40 border-t border-white/5 flex gap-3">
                        <Input className="h-10 rounded-lg bg-black/40 border-white/10 text-xs" placeholder="Digite para intervir..." value={messageInput} onChange={e => setMessageInput(e.target.value)} />
                        <Button className="h-10 w-10 rounded-lg bg-blue-600 shadow-neon-blue px-0"><Send className="h-4 w-4" /></Button>
                    </div>
                </>
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center opacity-30">
                    <BrainCircuit className="h-16 w-16 text-blue-400 animate-pulse mb-4" />
                    <p className="text-sm font-black uppercase tracking-[0.4em] text-blue-300">War Room SDR</p>
                </div>
            )}
        </div>

        {/* COLUNA 3: INTELIGÊNCIA LATERAL - Grid Compacto */}
        {activeChat && (
            <div className="w-[260px] border-l border-white/5 bg-slate-900/60 p-4 space-y-4 hidden xl:block overflow-y-auto custom-scrollbar">
                <p className="text-blue-400 text-[8px] font-black uppercase tracking-[0.2em]">Perfil do Decisor</p>
                <div className="space-y-3">
                    <div className="bg-yellow-500/10 p-3 rounded-xl border border-yellow-500/20 shadow-inner">
                        <span className="text-[8px] text-yellow-600 uppercase font-black block mb-0.5 tracking-widest">Proprietário</span>
                        <span className="text-sm font-black text-yellow-500 uppercase tracking-tighter">MARCOS ZANIOLO</span>
                    </div>
                    <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20">
                        <p className="text-[8px] text-emerald-400 font-black uppercase mb-0.5">Qualificação IA</p>
                        <p className="text-xl font-black text-emerald-400 italic leading-none">9.8</p>
                    </div>
                    <div className="space-y-1">
                        <span className="text-[8px] text-slate-500 uppercase font-black block tracking-widest">Potencial de Fechamento</span>
                        <span className="text-lg font-black text-white italic leading-none">R$ 150k</span>
                    </div>
                </div>
            </div>
        )}
    </div>
</TabsContent>
                           <TabsContent value="dashboard" className="flex-1 overflow-hidden m-0">
    <div className="text-white text-2xl p-10 font-black">Área de Analytics em Construção...</div>
</TabsContent>

                </Tabs>
            </main>

{/* MODAL DE CONEXÃO MULTI-CHIP (POSIÇÃO CORRETA) */}
            <Dialog open={!!qrCodeData} onOpenChange={() => setQrCodeData(null)}>
                <DialogContent className="glass-panel border-white/20 text-white max-w-sm rounded-[2.5rem] p-10 bg-[#020617]/98 shadow-2xl flex flex-col items-center">
                    <div className="bg-blue-600/20 p-4 rounded-full mb-6 border border-blue-500/30 shadow-neon-blue">
                        <MessageSquare className="h-10 w-10 text-blue-400" />
                    </div>
                    <DialogTitle className="text-2xl font-black text-white uppercase italic tracking-tighter text-center">
                        Vincular Unidade
                    </DialogTitle>
                    <p className="text-blue-400 font-bold text-[10px] uppercase tracking-widest mb-8 text-center">
                        {qrCodeData?.name || 'Nova Instância'}
                    </p>
                    
                    <div className="p-6 bg-white rounded-[2rem] shadow-2xl">
                        {qrCodeData?.qr && <QRCodeSVG value={qrCodeData.qr} size={200} />}
                    </div>

                    <p className="text-slate-500 text-[10px] font-bold uppercase mt-8 text-center leading-relaxed">
                        Abra o WhatsApp no celular <br/> 
                        Menu &gt; Aparelhos Conectados <br/> 
                        Escaneie o código acima
                    </p>
                </DialogContent>
            </Dialog>

            
          {/* --- MODAL DETALHES GIGANTE: O DOSSIÊ DE INTELIGÊNCIA --- */}
{/* --- MODAL DETALHES GIGANTE: O DOSSIÊ DE INTELIGÊNCIA --- */}
<Dialog open={!!viewingLeadDetail} onOpenChange={() => setViewingLeadDetail(null)}>
    <DialogContent 
        className="glass-panel border-white/20 text-white max-w-5xl w-[95vw] max-h-[95vh] rounded-[2.5rem] p-0 overflow-y-auto custom-scrollbar shadow-[0_0_100px_rgba(0,0,0,1)] bg-[#020617]/98 border-t-4 border-t-blue-600"
    >
        {/* Reduzi o padding de p-10 para p-6 e o espaçamento vertical de space-y-8 para space-y-4 */}
        <div className="p-6 space-y-4">
            
            {/* HEADER DO DOSSIÊ */}
            <div className="flex justify-between items-start">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <Badge className="bg-blue-600/20 text-blue-400 border-blue-500/30 px-3 py-0.5 text-[8px] uppercase font-black tracking-widest rounded-full">Inteligência Neural 2026</Badge>
                        {viewingLeadDetail?.priority_level >= 3 && <Badge className="bg-red-600/20 text-red-500 border-red-500/30 px-2 py-0.5 text-[8px] font-black uppercase animate-pulse">Alta Prioridade 🔥</Badge>}
                    </div>
                    {/* Diminuído de text-4xl para text-2xl */}
                    <h2 className="text-2xl font-black tracking-tighter text-white neon-text leading-tight uppercase italic drop-shadow-lg">{viewingLeadDetail?.name}</h2>
                    <div className="flex items-center gap-2 text-slate-500 font-bold text-[10px] uppercase tracking-widest italic opacity-80">
                        <Building2 className="h-3 w-3 text-blue-500" />
                        <span>{viewingLeadDetail?.razao_social || viewingLeadDetail?.name || 'Identificação não disponível'}</span>
                    </div>
                </div>
                {/* Reduzi o card de score e a fonte de 6xl para 4xl */}
                <div className="text-right glass-card p-4 rounded-3xl border-emerald-500/20 bg-emerald-500/5 min-w-[120px]">
                    <p className="text-[8px] font-black text-slate-500 uppercase mb-1 tracking-widest">Score Qualificação</p>
                    <div className="text-4xl font-black text-emerald-400 leading-none italic">{viewingLeadDetail?.quality_score_int4 || '9.8'}</div>
                </div>
            </div>

            {/* GRID DE INFORMAÇÕES TÉCNICAS - Gap reduzido para 4 */}
            <div className="grid grid-cols-3 gap-4">
                {/* Blocos com padding reduzido para p-4 e bordas menores */}
                <div className="glass-card p-4 rounded-3xl space-y-3 bg-white/5 border-white/10">
                    <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-2"><ShieldCheck className="h-3 w-3"/> Rastreio Fiscal</p>
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
                            <div><span className="text-[8px] text-slate-600 font-black block opacity-50 uppercase">Porte</span><span className="text-xs font-black text-blue-300 uppercase italic">{viewingLeadDetail?.porte || 'ME'}</span></div>
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

            {/* CONTATO DIRETO - Altura e padding reduzidos */}
            <div className="bg-blue-600/5 p-4 rounded-3xl border border-blue-500/20 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="h-12 w-12 bg-blue-600/20 rounded-full border border-blue-500/30 flex items-center justify-center shadow-neon-blue">
                        <Users className="h-6 w-6 text-blue-400" />
                    </div>
                    <div>
                        <span className="text-[8px] text-blue-400 font-black uppercase tracking-widest block">Decisor</span>
                        <span className="text-xl font-black text-white uppercase tracking-tighter italic leading-none">{viewingLeadDetail?.dono || 'Sócio Administrador'}</span>
                    </div>
                </div>
                <div className="text-right">
                    <span className="text-[8px] text-slate-500 font-black uppercase tracking-widest block opacity-60">WhatsApp</span>
                    <span className="text-xl font-black text-blue-400 tracking-widest font-mono shadow-neon-blue">{viewingLeadDetail?.phone || '(48) 0000-0000'}</span>
                </div>
            </div>

            {/* BOTÕES DE AÇÃO - Altura reduzida de h-24 para h-14 */}
            <div className="flex gap-4 pt-2">
                <Button className="flex-1 h-14 bg-blue-600 hover:bg-blue-500 text-lg font-black rounded-2xl shadow-lg border border-white/10 uppercase italic flex items-center justify-center gap-2 transition-all active:scale-95 group">
                    ABRIR CANAL DE FECHAMENTO <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button variant="outline" className="h-14 px-8 border border-white/10 glass-card text-xs font-black rounded-2xl uppercase tracking-widest hover:bg-white/5" onClick={() => setViewingLeadDetail(null)}>FECHAR</Button>
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
        /* min-h-screen garante que a coluna encoste no final da página */
        <div className={`min-w-[310px] w-[310px] glass-panel rounded-3xl flex flex-col mb-10 overflow-hidden border relative transition-all duration-500 
            ${isActive ? 'border-blue-500/40 bg-blue-900/10 shadow-neon-blue' : 'border-white/5'} 
            min-h-screen h-fit`}> 
            
            <div className={`p-4 border-b border-white/10 flex justify-between items-center bg-gradient-to-r ${color} shrink-0 sticky top-0 z-20`}>
                 <div className="flex items-center gap-3 relative z-10">
                    <div className="bg-white/10 p-2 rounded-xl backdrop-blur-md border border-white/5 shadow-sm">{icon}</div>
                    <span className="font-black text-[10px] uppercase tracking-widest text-white">{title}</span>
                </div>
                <Badge variant="secondary" className="bg-white/20 text-white border-none font-bold text-xs px-2 py-0.5 backdrop-blur-md relative z-10">{count}</Badge>
            </div>

            {/* O conteúdo agora flui naturalmente sem scroll interno forçado */}
            <div className="p-3 space-y-3 bg-slate-950/20 flex-1">
                {children}
            </div>
        </div>
    )
}

function LeadCard({ lead, isSelected, onSelect, onView, onEdit }) {
    // Tenta pegar o valor de ambas as nomenclaturas possíveis do banco
    const valorPotencial = lead?.capital_social_numeric || lead?.capital_social || 0;
    
    return (
        <div onClick={onView} className={`glass-card p-3 rounded-2xl cursor-pointer relative group transition-all duration-500 border-2 ${
            isSelected ? 'border-blue-500/60 bg-blue-900/20 shadow-neon-blue' : 'border-white/5 hover:border-blue-500/30'
        }`}>
            {/* LINHA 1: SCORE, PRIORIDADE E RATING */}
            <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                    <div onClick={(e) => { e.stopPropagation(); onSelect(); }} className="hover:scale-110 transition-transform">
                        {isSelected ? <CheckSquare className="h-4 w-4 text-blue-400" /> : <Square className="h-4 w-4 text-slate-700" />}
                    </div>
                    {/* Ícone de Prioridade 🔥 baseada no level do banco */}
                    {lead?.priority_level >= 3 && <Flame className="h-3.5 w-3.5 text-orange-500 animate-pulse shadow-neon-orange" />}
                    <div className="flex gap-0.5">
                        {[1,2,3].map(i => (
                            <div key={i} className={`h-1 w-3 rounded-full ${lead?.quality_score_int4 >= (i*30) ? 'bg-emerald-500 shadow-neon-green' : 'bg-slate-800'}`}></div>
                        ))}
                    </div>
                </div>
                <Badge className="bg-yellow-500/10 text-yellow-500 border-none text-[8px] h-4 px-1.5 font-black uppercase tracking-tighter">⭐ {lead?.rating || '4.5'}</Badge>
            </div>

            {/* LINHA 2: IDENTIFICAÇÃO E CONTATO RÁPIDO */}
            <div className="mb-2">
                <h3 className="text-[13px] font-black text-white tracking-tight leading-none uppercase truncate group-hover:text-blue-400 transition-colors">{lead?.name || "Sem Nome"}</h3>
                <div className="flex flex-col gap-1 mt-2">
                    <div className="flex items-center gap-2">
                        <Badge className="bg-blue-500/10 text-blue-400 border-none text-[7px] h-3 px-1 uppercase leading-none">{lead?.porte || 'ME'}</Badge>
                        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter truncate max-w-[120px]">{lead?.niche}</span>
                    </div>
                    {/* NÚMERO VISÍVEL PARA OPERAÇÃO RÁPIDA */}
                    <div className="flex items-center gap-1.5 opacity-70 group-hover:opacity-100 transition-opacity">
                        <Phone className="h-2.5 w-2.5 text-blue-400" />
                        <span className="text-[10px] font-black text-slate-300 tracking-wider font-mono">{lead?.phone || '(00) 0000-0000'}</span>
                    </div>
                </div>
            </div>

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
                    <div className="h-5 w-5 rounded-full bg-slate-800 flex items-center justify-center text-[8px] text-white border border-white/10 font-bold uppercase">{lead?.dono?.[0] || 'G'}</div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase truncate max-w-[140px]">{lead?.dono || 'Gestor Identificado'}</span>
                </div>
                <div onClick={(e) => { e.stopPropagation(); onEdit(); }} className="h-6 w-6 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                    <Edit2 className="h-3 w-3 text-blue-400" />
                </div>
            </div>




        </div>
    );
}
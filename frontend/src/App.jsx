import React, { useState, useEffect, useRef } from 'react'
// --- IMPORTAÇÕES DE UI ---
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { NicheSelect } from "@/components/NicheSelect" 

// --- ÍCONES ---
import { 
  Rocket, MapPin, LayoutDashboard, MessageSquare, Phone, Play, LocateFixed, Send, 
  BrainCircuit, Search, Download, X, CheckSquare, Square, Facebook, 
  Instagram, Home, Users, StopCircle, Map as MapIcon, Loader2, Edit2, Trash2, Crosshair
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

// --- CONFIGURAÇÃO SOCKET ---
const socket = io('http://localhost:3001', { autoConnect: false });

// --- ÁUDIO ---
const playNotificationSound = () => {
    try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
        audio.volume = 0.5;
        audio.play().catch(e => console.warn("Audio bloqueado pelo navegador"));
    } catch (e) { console.error("Erro audio", e); }
}

// --- COMPONENTES DO MAPA ---
function MapController({ center }) {
  const map = useMap();
  useEffect(() => { 
      if(center && center[0] !== 0) map.flyTo(center, 13, { animate: true, duration: 1.5 }); 
  }, [center, map]);
  return null;
}

// Manipulador de cliques no mapa
function MapClickHandler({ setCenter, setLocationName, setSearchMode }) {
  useMapEvents({
    click(e) {
      setCenter([e.latlng.lat, e.latlng.lng]);
      if(setLocationName) setLocationName(`📍 Ponto Selecionado (${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)})`);
      if(setSearchMode) setSearchMode("map"); 
    },
    dragend(e) {
       // Opcional: Atualizar coordenadas ao arrastar (se desejar comportamento dinâmico)
    }
  });
  return null;
}

// ==================================================================================
// COMPONENTE PRINCIPAL
// ==================================================================================
export default function App() {
  // --- ESTADOS ---
  const [activeTab, setActiveTab] = useState("search");
  
  // Dados principais
  const [leads, setLeads] = useState(() => {
    try {
        const saved = localStorage.getItem('sdr_leads');
        return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [chats, setChats] = useState(() => {
    try {
        const saved = localStorage.getItem('sdr_chats');
        return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Controle de Chat e Conexão
  const [activeChat, setActiveChat] = useState(null);
  const [messageInput, setMessageInput] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isServerOnline, setIsServerOnline] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [isSdrRunning, setIsSdrRunning] = useState(false);
  
  // Controle do Robô
  const [pipelineStatus, setPipelineStatus] = useState('idle');
  const [pipelineStart, setPipelineStart] = useState(0);
  const [pipelineElapsedMs, setPipelineElapsedMs] = useState(0);
  const [isBotRunning, setIsBotRunning] = useState(false);
  const [sessionLeadsCount, setSessionLeadsCount] = useState(0);

  // Novos Estados (Híbrido)
  const [searchMode, setSearchMode] = useState("city"); 
  const [botProgress, setBotProgress] = useState(0);
  const [botLogs, setBotLogs] = useState([]);
  const [citySuggestions, setCitySuggestions] = useState([]);
  const [isSearchingCity, setIsSearchingCity] = useState(false);
  const logsEndRef = useRef(null);

  // Filtros e UI
  const [notification, setNotification] = useState(null);
  const [selectedNiche, setSelectedNiche] = useState(null);
  const [locationName, setLocationName] = useState(""); 
  const [searchRadius, setSearchRadius] = useState(2); 
  const [mapCenter, setMapCenter] = useState([-24.9555, -53.4552]); // Padrão Cascavel
  const [filterText, setFilterText] = useState("");
  
  // Seleção e Modais
  const [selectedLeadIds, setSelectedLeadIds] = useState(new Set());
  const [selectedLead, setSelectedLead] = useState(null);
  const [editingLead, setEditingLead] = useState(null);

  const chatContainerRef = useRef(null);

  // --- HELPERS ---
  const showToast = (msg) => { setNotification(msg); setTimeout(() => setNotification(null), 4000); }

  const formatDuration = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // --- EFEITOS ---
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [botLogs]);
  useEffect(() => { localStorage.setItem('sdr_leads', JSON.stringify(leads)); }, [leads]);
  useEffect(() => { localStorage.setItem('sdr_chats', JSON.stringify(chats)); }, [chats]);
  
  useEffect(() => {
    if (pipelineStatus === 'idle' || pipelineStatus === 'finished') return;
    const id = setInterval(() => { setPipelineElapsedMs(Date.now() - pipelineStart) }, 1000);
    return () => clearInterval(id);
  }, [pipelineStatus, pipelineStart])

  // SOCKETS
  useEffect(() => {
    socket.connect();
    socket.on('connect', () => setIsServerOnline(true));
    socket.on('disconnect', () => setIsServerOnline(false));
    
    socket.on('new_lead', (lead) => {
        console.log("🔍 LEAD RECEBIDO:", lead); 
        setSessionLeadsCount(prev => prev + 1);
        setLeads(prev => {
            const normalizedLead = {
                id: lead.id || Date.now() + Math.random(),
                name: lead.title || lead.name || "Sem Nome",
                phone: lead.phone || lead.telephone || "",
                niche: lead.niche || "Geral",
                ...lead,
                status: "new",
                value: "R$ 25.000 (Est.)"
            };
            if (prev.some(l => l.name === normalizedLead.name)) return prev;
            return [normalizedLead, ...prev];
        });
    });

    socket.on('progress_update', (data) => {
        if (data.percent) setBotProgress(data.percent);
        if (data.message) setBotLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${data.message}`]);
    });

    socket.on('bot_finished', () => {
        setIsBotRunning(false);
        setPipelineStatus("finished");
        setBotProgress(100);
        showToast("Processo finalizado!");
    });

    return () => { socket.disconnect() };
  }, []);

  // --- FUNÇÕES DE AÇÃO ---
  const handleCitySearch = async (query) => {
      setLocationName(query);
      setSearchMode("city");
      
      if (query.length < 3) { setCitySuggestions([]); return; }
      
      setIsSearchingCity(true);
      try {
          // Adicionei limit=10 para ter mais opções
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}&addressdetails=1&limit=10&countrycodes=br`);
          const data = await res.json();
          setCitySuggestions(data);
      } catch (e) { console.error(e); } 
      finally { setIsSearchingCity(false); }
  };

  const handleInputKeyDown = (e) => {
      if (e.key === 'Enter') {
          if (citySuggestions.length > 0) {
              // Se tiver sugestões, seleciona a primeira
              selectCity(citySuggestions[0]);
          } else {
              // Se não, apenas fecha a lista e mantém o texto
              setCitySuggestions([]);
              showToast("Local definido por texto.");
          }
      }
  };

  const selectCity = (cityData) => {
      setMapCenter([parseFloat(cityData.lat), parseFloat(cityData.lon)]);
      // Usa display_name para ser mais específico
      setLocationName(cityData.display_name);
      setCitySuggestions([]);
      setSearchMode("city");
  };

  const handleUseMapCenter = () => {
      // Pega o centro atual (simulado pelo mapCenter state, que é atualizado no click)
      // Idealmente pegaríamos do objeto map, mas usar o state atual funciona para o clique
      setSearchMode("map");
      setLocationName(`🎯 Alvo no Mapa (${mapCenter[0].toFixed(4)}, ${mapCenter[1].toFixed(4)})`);
      showToast("Modo de busca alterado para: Raio no Mapa");
  };

  const startScraping = () => {
      if (isBotRunning) {
          socket.emit('stop_scraping');
          setBotLogs(prev => [...prev, "[SISTEMA] Parando..."]);
          return;
      }
      if (!selectedNiche) return alert("Selecione um nicho!");
      
      setIsBotRunning(true);
      setPipelineStatus("scraping");
      setPipelineStart(Date.now());
      setBotProgress(0);
      setBotLogs(["[SISTEMA] Iniciando motor..."]);
      setSessionLeadsCount(0);

      const payload = {
          niche: selectedNiche.keywords,
          radius: searchRadius,
          mode: searchMode,
          city: locationName,
          lat: mapCenter[0],
          lng: mapCenter[1]
      };
      
      socket.emit('start_scraping', payload);
      setActiveTab("crm");
  };

  const handleClearLeads = () => { if(confirm("Apagar tudo?")) { setLeads([]); setSessionLeadsCount(0); } };

  const handleBulkAction = (action) => {
    if (action === 'delete' && confirm(`Excluir ${selectedLeadIds.size} leads?`)) {
        setLeads(prev => prev.filter(l => !selectedLeadIds.has(l.id)));
        setSelectedLeadIds(new Set());
    }
  }

  const toggleSelectLead = (id) => {
    const newSet = new Set(selectedLeadIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedLeadIds(newSet);
  }

  const handleExportCSV = () => {
      if (leads.length === 0) return showToast("Sem dados para exportar.");
      const headers = "Nome,Telefone,Nicho,CNPJ,Dono,Valor,Status\n";
      const rows = leads.map(l => `${l.name},${l.phone},${l.niche},${l.cnpj || ''},${l.dono || ''},${l.value},${l.status}`).join("\n");
      const csvContent = "data:text/csv;charset=utf-8," + headers + rows;
      const link = document.createElement("a");
      link.setAttribute("href", encodeURI(csvContent));
      link.setAttribute("download", "leads_export.csv");
      document.body.appendChild(link);
      link.click();
  }

  const getLeadsByStatus = (status) => {
      return leads.filter(l => l.status === status && (filterText === "" || l.name.toLowerCase().includes(filterText.toLowerCase())));
  };

  const handleOpenChatFromLead = (lead) => {
      setActiveTab("connections");
      showToast(`Abrindo chat com ${lead.name}`);
  }

  const handleStartSDR = () => {
    if (!isConnected) return showToast("Conecte o WhatsApp primeiro!");
    setIsSdrRunning(true);
    socket.emit('start_sdr');
  }

  const handleSaveEdit = () => {
      setLeads(prev => prev.map(l => l.id === editingLead.id ? editingLead : l));
      setEditingLead(null);
      showToast("Lead atualizado.");
  }

  const handleMyLocation = () => {
    if (navigator.geolocation) {
        showToast("Obtendo GPS...");
        navigator.geolocation.getCurrentPosition(
            (p) => {
                const newLat = p.coords.latitude;
                const newLng = p.coords.longitude;
                setMapCenter([newLat, newLng]);
                setLocationName("Minha Localização Atual");
                setSearchMode("map");
                showToast("Localização definida.");
            },
            () => showToast("Erro ao obter GPS.")
        );
    }
  }

  const handleSendMessage = () => {
      if(!messageInput.trim()) return;
      showToast("Mensagem enviada (Simulação)");
      setMessageInput("");
  }

  // --- RENDERIZAÇÃO ---
  return (
 <div className="bg-[#020617] text-slate-100 font-sans relative min-h-screen w-full flex flex-col">
    {/* O fundo azul agora irá até o final da página, não importa o tamanho */}
      
      {/* HEADER */}
      <header className="border-b border-slate-800 bg-slate-900/95 px-6 py-4 shrink-0 z-50">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="bg-blue-600 p-2 rounded-lg"><Rocket className="h-6 w-6 text-white" /></div>
            <h1 className="text-xl font-bold">Enerzee SDR <span className="text-blue-500">Solar</span></h1>
          </div>
          <div className="flex gap-4 items-center">
             <div className="flex flex-col items-end">
                <span className="text-[10px] text-slate-400 font-bold uppercase">Sessão</span>
                <span className="text-2xl font-bold">{sessionLeadsCount} Leads</span>
             </div>
             <Button 
                variant={isBotRunning ? "destructive" : "default"} 
                onClick={startScraping}
                className={isBotRunning ? "bg-red-600" : "bg-blue-600"}
             >
               {isBotRunning ? <><StopCircle className="mr-2 h-4 w-4"/> PARAR</> : <><Play className="mr-2 h-4 w-4"/> INICIAR</>}
             </Button>
          </div>
        </div>
      </header>

      {/* DASHBOARD EM TEMPO REAL */}
      {isBotRunning && (
          <div className="bg-slate-900 border-b border-slate-800 p-4">
             <div className="max-w-7xl mx-auto flex gap-6">
                <div className="w-1/3">
                    <div className="flex justify-between text-xs text-slate-300 font-bold mb-1">
                        <span>Progresso</span><span>{botProgress.toFixed(0)}%</span>
                    </div>
                    <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                        <div className="h-full bg-blue-600 transition-all" style={{ width: `${botProgress}%` }}></div>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">Status: {pipelineStatus.toUpperCase()}</div>
                </div>
                <div className="flex-1 bg-black rounded border border-slate-800 p-2 h-20 overflow-y-auto font-mono text-xs">
                    {botLogs.map((log, i) => <div key={i} className="text-green-400 mb-1">{log}</div>)}
                    <div ref={logsEndRef} />
                </div>
             </div>
          </div>
      )}

      {/* BODY */}
    <main className="w-full relative bg-[#020617]">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-slate-900 border-b border-slate-800 p-0 w-full h-12 justify-start px-4 sticky top-0 z-40 shadow-md">
            <TabsTrigger value="search" className="data-[state=active]:text-blue-400 px-6"><MapPin className="mr-2 h-4 w-4"/> Radar</TabsTrigger>
            <TabsTrigger value="crm" className="data-[state=active]:text-blue-400 px-6"><LayoutDashboard className="mr-2 h-4 w-4"/> CRM</TabsTrigger>
            <TabsTrigger value="connections" className="data-[state=active]:text-blue-400 px-6"><MessageSquare className="mr-2 h-4 w-4"/> WhatsApp</TabsTrigger>
          </TabsList>

          {/* ABA RADAR */}
          <TabsContent value="search" className="h-[calc(100vh-112px)] flex flex-col lg:flex-row gap-0 overflow-hidden data-[state=inactive]:hidden">
              <div className="w-full lg:w-[320px] bg-slate-900 border-r border-slate-800 p-4 space-y-4 overflow-y-auto z-20 shadow-xl">
                 <div className="space-y-2">
                    <Label>1. Nicho</Label>
                    <NicheSelect onNicheSelect={setSelectedNiche} />
                 </div>
                 
                 <div className="space-y-2 relative">
                    <Label>2. Localização</Label>
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500"/>
                        <Input 
                            className="bg-slate-800 border-slate-700 pl-9 text-white" 
                            placeholder="Digite Cidade e Enter..." 
                            value={locationName}
                            onChange={(e) => handleCitySearch(e.target.value)}
                            onKeyDown={handleInputKeyDown} // CORREÇÃO: Busca por Enter
                        />
                        {isSearchingCity && <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-blue-500"/>}
                    </div>
                    
                    {/* SUGESTÕES DE CIDADE (Z-INDEX ALTO) */}
                    {citySuggestions.length > 0 && (
                        <div className="absolute top-full left-0 w-full bg-slate-800 border border-slate-600 rounded z-50 mt-1 shadow-2xl max-h-60 overflow-y-auto">
                            {citySuggestions.map((c, i) => (
                                <div key={i} onClick={() => selectCity(c)} className="p-3 hover:bg-slate-700 cursor-pointer text-sm border-b border-slate-700/50 flex flex-col">
                                    <span className="font-bold text-white">{c.name || c.address.city}</span>
                                    <span className="text-xs text-slate-400 truncate">{c.display_name}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="text-center text-xs text-slate-500 my-2">- OU -</div>
                    
                    {/* BOTÃO USAR CENTRO DO MAPA (DESIGN MELHORADO) */}
                    <Button 
                        variant={searchMode === 'map' ? 'default' : 'outline'} 
                        className={`w-full border-slate-600 gap-2 ${searchMode === 'map' ? 'bg-purple-600 hover:bg-purple-500' : 'text-slate-300'}`}
                        onClick={handleUseMapCenter}
                    >
                        <Crosshair className="h-4 w-4"/> {searchMode === 'map' ? 'Alvo Definido na Mira' : 'Definir Alvo na Mira'}
                    </Button>
                 </div>

                 <div className="space-y-2">
                    <div className="flex justify-between"><Label>3. Raio</Label><span>{searchRadius} km</span></div>
                    <input type="range" min="1" max="50" value={searchRadius} onChange={(e) => setSearchRadius(e.target.value)} className="w-full accent-blue-500"/>
                 </div>
              </div>
              
              <div className="flex-1 relative bg-slate-900 z-0">
                  <MapContainer center={mapCenter} zoom={13} style={{ height: "100%", width: "100%" }}>
                      <MapController center={mapCenter} />
                      <MapClickHandler setCenter={setMapCenter} setLocationName={null} setSearchMode={null} />
                      <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                      <Circle center={mapCenter} pathOptions={{ fillColor: '#2563eb', color: '#2563eb', weight: 1 }} radius={searchRadius * 1000} />
                  </MapContainer>

                  {/* CORREÇÃO: BOTÃO MINHA POSIÇÃO DENTRO DO MAPA MAS COM Z-INDEX ALTO */}
                  <div className="absolute top-4 right-4 z-[400]">
                      <Button onClick={handleMyLocation} className="bg-slate-900/90 hover:bg-slate-800 text-white backdrop-blur border border-slate-600 shadow-xl gap-2">
                          <LocateFixed className="h-4 w-4 text-blue-400"/> Minha Posição
                      </Button>
                  </div>
              </div>
          </TabsContent>

          {/* ABA CRM */}
         <TabsContent value="crm" className="w-full data-[state=inactive]:hidden">
             <div className="p-4 border-b border-slate-800 flex justify-between">
                <Input placeholder="Filtrar..." className="w-64 bg-slate-900 border-slate-700" value={filterText} onChange={e => setFilterText(e.target.value)}/>
                <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleExportCSV}><Download className="mr-2 h-4 w-4"/> Exportar</Button>
                    <Button variant="ghost" onClick={handleClearLeads} className="text-red-400"><Trash2 className="mr-2 h-4 w-4"/> Limpar</Button>
                </div>
             </div>
             <div className="flex-1 flex gap-4 overflow-x-auto p-4">
                <KanbanColumn title="Novos" count={getLeadsByStatus('new').length} color="bg-slate-700">
                    {getLeadsByStatus('new').map(l => (
                        <LeadCard 
                            key={l.id} 
                            lead={l} 
                            isSelected={selectedLeadIds.has(l.id)} 
                            onSelect={() => toggleSelectLead(l.id)}
                            onView={() => setSelectedLead(l)}
                            onEdit={() => setEditingLead(l)}
                        />
                    ))}
                </KanbanColumn>
                
                <KanbanColumn title="Em Contato" count={getLeadsByStatus('contact').length} color="bg-blue-600">
                    {getLeadsByStatus('contact').map(l => <LeadCard key={l.id} lead={l} isSelected={selectedLeadIds.has(l.id)} onSelect={() => toggleSelectLead(l.id)} onView={() => setSelectedLead(l)} onEdit={() => setEditingLead(l)}/>)}
                </KanbanColumn>

                <KanbanColumn title="Fechado" count={getLeadsByStatus('closed').length} color="bg-emerald-600">
                    {getLeadsByStatus('closed').map(l => <LeadCard key={l.id} lead={l} isSelected={selectedLeadIds.has(l.id)} onSelect={() => toggleSelectLead(l.id)} onView={() => setSelectedLead(l)} onEdit={() => setEditingLead(l)}/>)}
                </KanbanColumn>
             </div>
             
             {selectedLeadIds.size > 0 && (
                <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-slate-800 border border-slate-600 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 animate-in slide-in-from-bottom z-50">
                    <span className="font-bold">{selectedLeadIds.size} selecionados</span>
                    <div className="h-4 w-px bg-slate-600"></div>
                    <Button size="sm" variant="destructive" onClick={() => handleBulkAction('delete')}><Trash2 className="h-4 w-4 mr-2"/> Excluir</Button>
                    <Button size="sm" variant="secondary" onClick={() => setSelectedLeadIds(new Set())}><X className="h-4 w-4 mr-2"/> Cancelar</Button>
                </div>
            )}
          </TabsContent>

          {/* ABA WHATSAPP */}
          <TabsContent value="connections" className="h-[calc(100vh-112px)] flex flex-col overflow-hidden data-[state=inactive]:hidden">
                <div className="bg-slate-800 border-b border-slate-700 p-4 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-red-500'}`}></div>
                          <span className="text-sm text-slate-300">{isConnected ? 'Conectado' : 'Desconectado'}</span>
                      </div>
                  </div>
                  <div className="flex gap-2">
                        {!isConnected && qrCode && <div className="bg-white p-1 rounded"><QRCodeSVG value={qrCode} size={60} /></div>}
                        {isConnected && <Button onClick={handleStartSDR} className="bg-blue-600"><BrainCircuit className="mr-2 h-4 w-4"/> SDR Automático</Button>}
                  </div>
              </div>
              <div className="flex-1 flex">
                  {/* Lista de Chats */}
                  <div className="w-[300px] border-r border-slate-800 bg-slate-900 p-2">
                      <div className="text-slate-400 text-xs uppercase p-2">Conversas Recentes</div>
                      {chats.map(chat => (
                          <div key={chat.id} onClick={() => setActiveChat(chat)} className="p-3 hover:bg-slate-800 cursor-pointer rounded flex items-center gap-3">
                              <div className="h-10 w-10 bg-slate-700 rounded-full flex items-center justify-center font-bold">{chat.name[0]}</div>
                              <div>
                                  <div className="font-bold text-sm text-white">{chat.name}</div>
                                  <div className="text-xs text-slate-500 truncate w-32">{chat.lastMsg || "..."}</div>
                              </div>
                          </div>
                      ))}
                  </div>
                  {/* Área de Chat */}
                  <div className="flex-1 bg-[#0b141a] flex flex-col">
                      {activeChat ? (
                          <>
                            <div className="h-14 bg-slate-800 flex items-center px-4"><span className="font-bold">{activeChat.name}</span></div>
                            <div className="flex-1 p-4 overflow-y-auto">
                                {activeChat.messages?.map((m, i) => (
                                    <div key={i} className={`flex ${m.fromMe ? 'justify-end' : 'justify-start'} mb-2`}>
                                        <div className={`p-2 rounded ${m.fromMe ? 'bg-[#005c4b]' : 'bg-[#202c33]'}`}>{m.body}</div>
                                    </div>
                                ))}
                            </div>
                            <div className="p-2 bg-slate-900 flex gap-2">
                                <Input value={messageInput} onChange={e => setMessageInput(e.target.value)} className="bg-slate-800 border-none"/>
                                <Button onClick={handleSendMessage}><Send className="h-4 w-4"/></Button>
                            </div>
                          </>
                      ) : <div className="flex-1 flex items-center justify-center text-slate-500">Selecione um chat</div>}
                  </div>
              </div>
          </TabsContent>

        </Tabs>
      </main>

      {/* TOAST FLUTUANTE */}
      {notification && (
          <div className="fixed top-24 right-6 bg-slate-800 border-l-4 border-blue-500 text-white px-6 py-4 rounded shadow-2xl z-[1000]">
              <h4 className="font-bold text-sm">Sistema</h4>
              <p className="text-xs text-slate-300">{notification}</p>
          </div>
      )}

      {/* MODAL DETALHES */}
      <Dialog open={!!selectedLead} onOpenChange={() => setSelectedLead(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
            <DialogHeader>
                <DialogTitle>{selectedLead?.name}</DialogTitle>
                <DialogDescription>Detalhes do Lead</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-800 p-3 rounded">
                    <Label className="text-xs text-slate-500">Telefone</Label>
                    <div className="text-lg">{selectedLead?.phone}</div>
                </div>
                <div className="bg-slate-800 p-3 rounded">
                    <Label className="text-xs text-slate-500">Nicho</Label>
                    <div>{selectedLead?.niche}</div>
                </div>
            </div>
            <DialogFooter>
                <Button onClick={() => handleOpenChatFromLead(selectedLead)} className="bg-green-600"><MessageSquare className="mr-2 h-4 w-4"/> WhatsApp</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL EDITAR */}
 {/* MODAL DETALHES - EXIBIÇÃO DE DADOS COMPLETOS */}
{/* MODAL DETALHES - EXIBIÇÃO DE DADOS COMPLETOS (ATUALIZADO V11) */}
      <Dialog open={!!selectedLead} onOpenChange={() => setSelectedLead(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
                <DialogTitle className="text-blue-400 text-xl">{selectedLead?.name}</DialogTitle>
                {/* NOVA BADGE DE PORTE DA EMPRESA */}
                {selectedLead?.porte && (
                    <Badge variant="outline" className="border-blue-500 text-blue-400 text-[10px] h-5">
                        {selectedLead.porte}
                    </Badge>
                )}
            </div>
            {/* NOVA DESCRIÇÃO COM ATIVIDADE PRINCIPAL */}
            <DialogDescription className="text-slate-400">
                {selectedLead?.atividade_principal 
                    ? selectedLead.atividade_principal 
                    : "Dados detalhados do decisor e empresa"}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-4">
            {/* Contato e Sócio */}
            <div className="bg-slate-800 p-3 rounded border border-slate-700">
              <Label className="text-xs text-slate-500">Sócio Proprietário</Label>
              <div className="text-md font-bold text-yellow-500">{selectedLead?.dono || "Não identificado"}</div>
            </div>
            <div className="bg-slate-800 p-3 rounded border border-slate-700">
              <Label className="text-xs text-slate-500">Telefone</Label>
              <div className="text-md flex items-center gap-2">
                  {selectedLead?.celular_fiscal || selectedLead?.phone || selectedLead?.telefone}
                  {selectedLead?.celular_fiscal && <Badge className="bg-green-900 text-green-200 text-[9px] px-1">Fiscal</Badge>}
              </div>
            </div>

            {/* Localização INTELIGENTE */}
            <div className="col-span-2 bg-slate-800 p-3 rounded border border-slate-700">
              <div className="flex justify-between items-center mb-1">
                  <Label className="text-xs text-slate-500">📍 Endereço Completo</Label>
                  {/* Selo de verificação se veio da Receita Federal */}
                  {selectedLead?.endereco_fiscal && (
                      <span className="text-[10px] text-green-400 flex items-center gap-1">
                          <CheckSquare className="h-3 w-3"/> Validado na Receita
                      </span>
                  )}
              </div>
              
              {/* AQUI ESTÁ A CORREÇÃO PRINCIPAL: */}
              <div className="text-sm">
                  {selectedLead?.endereco_fiscal || selectedLead?.address || "Verificar no Maps"}
              </div>
              
              {/* Mostra Bairro e CEP se disponíveis */}
              {(selectedLead?.bairro || selectedLead?.cep) && (
                  <div className="text-xs text-slate-500 mt-1">
                      {selectedLead.bairro && `Bairro: ${selectedLead.bairro}`} 
                      {selectedLead.cep && ` • CEP: ${selectedLead.cep}`}
                  </div>
              )}
            </div>

            {/* Inteligência Fiscal */}
            <div className="bg-slate-800 p-3 rounded border border-slate-700">
              <Label className="text-xs text-slate-500">CNPJ</Label>
              <div className="text-sm font-mono">{selectedLead?.cnpj || "N/A"}</div>
            </div>
            <div className="bg-slate-800 p-3 rounded border border-slate-700">
              <Label className="text-xs text-slate-500">Capital Social</Label>
              <div className="text-sm text-green-400">
                  {selectedLead?.capital_social ? `R$ ${selectedLead.capital_social.toLocaleString('pt-BR')}` : "N/A"}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => handleOpenChatFromLead(selectedLead)} className="bg-green-600 w-full font-bold py-6 hover:bg-green-500">
              <MessageSquare className="mr-2 h-5 w-5"/> 
              {selectedLead?.dono ? `Chamar ${selectedLead.dono.split(' ')[0]}` : "Falar com Responsável"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}

// --- COMPONENTES AUXILIARES ---
function KanbanColumn({ title, count, color, children }) {
    return (
        <div className="min-w-[320px] bg-slate-800/30 border border-slate-700 rounded-xl flex flex-col h-[650px] mb-10 overflow-hidden">
            <div className="p-3 border-b border-slate-700 flex justify-between items-center bg-slate-900/95 rounded-t-xl shrink-0 sticky top-0 z-10">
                <span className="font-bold text-sm">{title}</span>
                <Badge variant="secondary">{count}</Badge>
            </div>
            <div className="p-3 space-y-3 flex-1 overflow-y-auto custom-scrollbar bg-slate-900/20">
                {children}
            </div>
        </div>
    )
}

function LeadCard({ lead, isSelected, onSelect, onView, onEdit }) {
    return (
        <div 
            className={`bg-slate-800 p-4 rounded-lg border shadow-sm cursor-pointer relative group transition-all ${isSelected ? 'border-blue-500 bg-slate-800/90' : 'border-slate-700 hover:border-slate-500'}`}
            onClick={onView}
        >
            <div className="flex justify-between items-start mb-2">
                <div onClick={(e) => { e.stopPropagation(); onSelect(); }}>
                    {isSelected ? <CheckSquare className="h-5 w-5 text-blue-500"/> : <Square className="h-5 w-5 text-slate-500"/>}
                </div>
                <div className="flex gap-2">
                    {/* Badge de Porte direto no Card */}
                    {lead.porte && (
                        <span className="text-[9px] bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded border border-blue-800">
                            {lead.porte}
                        </span>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); onEdit(); }} className="text-slate-600 hover:text-white">
                        <Edit2 className="h-3.5 w-3.5"/>
                    </button>
                </div>
            </div>

            <div className="font-bold text-white mb-1 truncate text-sm flex items-center gap-1">
                {lead.name}
                {lead.cnpj && <div className="w-1.5 h-1.5 rounded-full bg-green-500" title="CNPJ Identificado"></div>}
            </div>
            
            <div className="text-[11px] text-slate-400 flex items-center gap-1 mb-1">
                <Phone className="h-3 w-3 text-slate-500"/> {lead.phone || "Sem telefone"}
            </div>

            {/* Mostra o Bairro se o endereço fiscal existir */}
            {lead.bairro && (
                <div className="text-[10px] text-slate-500 flex items-center gap-1 italic">
                    <MapPin className="h-3 w-3"/> {lead.bairro}
                </div>
            )}

            <div className="mt-3 flex justify-between items-center">
                <div className="text-[9px] bg-slate-900 px-2 py-0.5 rounded text-slate-400 border border-slate-700 uppercase tracking-wider">
                    {lead.niche}
                </div>
                {lead.dono && (
                    <span className="text-[10px] text-yellow-500/80 font-medium">
                        👤 {lead.dono.split(' ')[0]}
                    </span>
                )}
            </div>
        </div>
    )
}
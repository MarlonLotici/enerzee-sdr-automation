import { useState, useEffect, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { NicheSelect } from "@/components/NicheSelect"
import { Rocket, MapPin, LayoutDashboard, MessageSquare, QrCode, Phone, DollarSign, Play, Pause, LocateFixed, Send, BrainCircuit, Search, Mic, Download, X, CheckCircle2, Trash2, Edit2, ExternalLink, Calendar, MoreVertical, Mail, Linkedin, Plus } from 'lucide-react'
import { io } from 'socket.io-client'
import { QRCodeSVG } from 'qrcode.react'
import { MapContainer, TileLayer, Circle, useMap, useMapEvents, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet';

// Fix Ícones Leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
let DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

// Conexão Socket
const socket = io('http://localhost:3001', { autoConnect: false });

// Som de notificação
const playNotificationSound = () => {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    audio.volume = 0.5;
    audio.play().catch(e => console.log("Audio play blocked", e));
}

// --- Componentes Mapa ---
function MapController({ center }) {
  const map = useMap();
  useEffect(() => { map.flyTo(center, 13, { animate: true, duration: 1.5 }); }, [center, map]);
  return null;
}
function MapClickHandler({ setCenter, setLocationName }) {
  useMapEvents({
    click(e) {
      setCenter([e.latlng.lat, e.latlng.lng]);
      setLocationName(`${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`);
    },
  });
  return null;
}

// Dados iniciais (Fallback)
const defaultLeads = [
  { 
    id: 1, 
    name: "Exemplo Supermercado", 
    phone: "48 99999-9999", 
    status: "new", 
    value: "R$ 25.000", 
    niche: "Supermercado", 
    aiScore: 92, 
    lastContact: "Nunca",
    link: "",
    email: "",
    linkedin: "",
    enriched: false,
    dataCaptura: new Date().toLocaleString('pt-BR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("search")
  
  // Estados Mapa & Leads
  const [locationName, setLocationName] = useState("")
  const [mapCenter, setMapCenter] = useState([-27.5969, -48.5480]) 
  const [searchRadius, setSearchRadius] = useState([5]) 
  const [selectedNiche, setSelectedNiche] = useState(null)
  
  const [leads, setLeads] = useState(() => {
      const saved = localStorage.getItem('sdr_leads');
      if (saved) {
        let parsed = null;
        try { parsed = JSON.parse(saved) } catch { parsed = null }
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      return defaultLeads;
  });
  const [selectedLead, setSelectedLead] = useState(null)
  const [editingLead, setEditingLead] = useState(null) 
  
  // Estados WPP & Bot
  const [isConnected, setIsConnected] = useState(false)
  const [isBotRunning, setIsBotRunning] = useState(false)
  const [isSdrRunning, setIsSdrRunning] = useState(false)
  const [qrCode, setQrCode] = useState("")
  const [chats, setChats] = useState(() => {
    const saved = localStorage.getItem('sdr_chats');
    return saved ? JSON.parse(saved) : [];
  }) 
  const [activeChat, setActiveChat] = useState(null) 
  const [messageInput, setMessageInput] = useState("")
  const [notification, setNotification] = useState(null)
  const chatEndRef = useRef(null)
  const chatContainerRef = useRef(null)
  const [isServerOnline, setIsServerOnline] = useState(false)
  const [isCleanupRunning, setIsCleanupRunning] = useState(false)
  const [isEnrichRunning, setIsEnrichRunning] = useState(false)
  const [isPipelineRunning, setIsPipelineRunning] = useState(false)
  const [pipelineAuto, setPipelineAuto] = useState(false)
  const [pipelineStart, setPipelineStart] = useState(0)
  const [pipelineElapsedMs, setPipelineElapsedMs] = useState(0)

  const formatDuration = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const hh = h.toString().padStart(2, '0');
    const mm = m.toString().padStart(2, '0');
    const ss = s.toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  
  // AQUI: Removida a duplicata se existisse, mantendo apenas esta declaração
  const showToast = (msg) => { setNotification(msg); setTimeout(() => setNotification(null), 4000); }

  // Persistência
  useEffect(() => { localStorage.setItem('sdr_leads', JSON.stringify(leads)); }, [leads]);
  useEffect(() => { localStorage.setItem('sdr_chats', JSON.stringify(chats)); }, [chats]);
  useEffect(() => {
    if (!activeChat) return;
    const container = chatContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [activeChat?.messages])
  useEffect(() => {
    if (!isPipelineRunning) return;
    const id = setInterval(() => { setPipelineElapsedMs(Date.now() - pipelineStart) }, 1000);
    return () => clearInterval(id);
  }, [isPipelineRunning, pipelineStart])

  // SOCKET HANDLERS
  useEffect(() => {
    socket.connect();
    socket.on('connect', () => setIsServerOnline(true));
    socket.on('disconnect', () => setIsServerOnline(false));
    
    socket.on('qr_code', (qr) => { 
        console.log("QR Recebido"); 
        setQrCode(qr); 
        setIsConnected(false); 
    });
    
    socket.on('whatsapp_status', (status) => { 
        console.log("Status WPP:", status);
        if (status === 'CONNECTED') { setIsConnected(true); setQrCode(""); }
        if (status === 'DISCONNECTED') { setIsConnected(false); }
    });

    socket.on('all_chats', (c) => {
        setChats(prev => {
            const ids = new Set(prev.map(p => p.id));
            const merged = [...prev, ...c.filter(x => !ids.has(x.id)).map(x => ({ ...x, messages: x.messages || [] }))];
            return merged;
        });
    }); 
    
    socket.on('message_received', (newMsg) => {
        if (activeChat && activeChat.id === newMsg.chatId) {
            setActiveChat(prev => ({...prev, messages: [...(prev.messages || []), newMsg]}));
        }
        setChats(prev => {
            const exists = prev.some(c => c.id === newMsg.chatId);
            if (!exists) {
                const created = { id: newMsg.chatId, name: newMsg.chatId, messages: [newMsg], lastTime: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) };
                return [created, ...prev];
            }
            return prev.map(c => c.id === newMsg.chatId ? {...c, lastMsg: newMsg.body, messages: [...(c.messages || []), newMsg]} : c);
        });
        playNotificationSound();
        showToast("Nova mensagem WhatsApp!");
    });

    socket.on('message_sent', (newMsg) => {
        if (activeChat && activeChat.id === newMsg.chatId) {
            setActiveChat(prev => ({...prev, messages: [...(prev.messages || []), newMsg]}));
        }
        setChats(prev => prev.map(c => c.id === newMsg.chatId ? {...c, lastMsg: newMsg.body, messages: [...(c.messages || []), newMsg]} : c));
    });
    
    socket.on('new_lead', (lead) => {
        setLeads(prev => {
            if (prev.some(l => l.link && lead.link && l.link === lead.link)) return prev;
            if (prev.some(l => l.name === lead.nome && !lead.link)) return prev;
            return [{
                id: Date.now(),
                name: lead.nome,
                phone: lead.telefone || "Não informado",
                link: lead.link || '',
                niche: selectedNiche?.label || lead.categoria || "Sem categoria",
                value: "R$ 25.000 (Est.)",
                status: "new",
                aiScore: Math.floor(Math.random() * 20) + 80,
                lastContact: "Nunca",
                email: '',
                linkedin: '',
                enriched: false,
                dataCaptura: new Date().toLocaleString('pt-BR', { 
                    day: '2-digit', 
                    month: '2-digit', 
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })
            }, ...prev]
        });
        playNotificationSound();
        showToast(`Novo Lead: ${lead.nome}`);
    });

    socket.on('bot_finished', () => {
        setIsBotRunning(false);
        showToast("Varredura concluída!");
        if (pipelineAuto) {
          setIsCleanupRunning(true);
          socket.emit('run_cleanup');
        }
    });

    socket.on('sdr_status', (status) => {
        if (status === 'running') setIsSdrRunning(true);
        if (status === 'stopped') setIsSdrRunning(false);
    });

    socket.on('sdr_message', (data) => {
        showToast(`SDR: ${data.message}`);
    });
    socket.on('notification', (msg) => { showToast(msg) });
    socket.on('lead_prebooked', (data) => {
      setLeads(prev => prev.map(l => {
        const matchByEmail = data.email && l.email && l.email.toLowerCase() === data.email.toLowerCase();
        const cleanPhone = (l.phone || '').replace(/\D/g,'');
        const webhookPhone = (data.phone || '').replace(/\D/g,'');
        const matchByPhone = data.phone && cleanPhone && cleanPhone === webhookPhone;
        const matchByName = data.name && l.name && l.name.toLowerCase() === data.name.toLowerCase();
        if (matchByEmail || matchByPhone || matchByName) {
          return { ...l, status: 'pre_agendado' };
        }
        return l;
      }));
      showToast("Lead marcado como Pré-Agendado");
    });
    socket.on('cleanup_finished', () => { 
      setIsCleanupRunning(false); 
      showToast("Limpeza concluída!"); 
      if (pipelineAuto) {
        setIsEnrichRunning(true);
        socket.emit('run_enrich');
      }
    });
    socket.on('enrich_finished', () => { 
      setIsEnrichRunning(false); 
      showToast("Enriquecimento concluído!"); 
      if (pipelineAuto) {
        setPipelineAuto(false);
        setIsPipelineRunning(false);
      }
    });

    return () => { socket.disconnect() };
  }, [selectedNiche, activeChat, pipelineAuto]);

  // --- FUNÇÕES FUNCIONAIS ---

  const handleStartScraping = () => {
      if (!selectedNiche) return alert("Selecione um nicho primeiro!");
      setIsBotRunning(true);
      setPipelineAuto(true);
      setIsPipelineRunning(true);
      setPipelineStart(Date.now());
      setPipelineElapsedMs(0);
      showToast("Robô iniciado! Varrendo satélite...");
      socket.emit('start_scraping', { 
          niche: selectedNiche.keywords, 
          city: locationName || "Local Selecionado" 
      });
  }

  const handleExportCSV = () => {
      const headers = "Nome,Telefone,Nicho,Valor,Status,Score\n";
      const rows = leads.map(l => `${l.name},${l.phone},${l.niche},${l.value},${l.status},${l.aiScore}`).join("\n");
      const csvContent = "data:text/csv;charset=utf-8," + headers + rows;
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", "leads_enerzee_solar.csv");
      document.body.appendChild(link);
      link.click();
      showToast("Download iniciado!");
  }

  const handleClearLeads = () => {
      if(confirm("Tem certeza? Isso apagará o histórico local.")) { 
          setLeads([]); 
          localStorage.removeItem('sdr_leads'); 
      }
  }

  const handleMyLocation = () => {
    if (navigator.geolocation) {
        showToast("Buscando sua localização...");
        navigator.geolocation.getCurrentPosition(
            (p) => {
                setMapCenter([p.coords.latitude, p.coords.longitude]);
                setLocationName("Minha Localização");
                showToast("Localização atualizada!");
            },
            (err) => {
                showToast("Erro ao obter localização. Verifique as permissões.");
                console.error("GPS error:", err);
            }
        );
    } else {
        showToast("GPS não disponível no seu navegador.");
    }
  }

  const handleStartSDR = () => {
    if (!isConnected) {
        showToast("Conecte o WhatsApp primeiro!");
        return;
    }
    setIsSdrRunning(true);
    showToast("Iniciando IA SDR...");
    socket.emit('start_sdr');
  }
  const handleRunCleanup = () => {
    setIsCleanupRunning(true);
    showToast("Iniciando limpeza...");
    socket.emit('run_cleanup');
  }
  const handleRunEnrich = () => {
    setIsEnrichRunning(true);
    showToast("Iniciando enriquecimento...");
    socket.emit('run_enrich');
  }

  const handleOpenChatFromLead = (lead) => {
      setActiveTab("connections");
      const cleanPhone = lead.phone ? lead.phone.replace(/\D/g,'') : '';
      const existingChat = chats.find(c => c.name === lead.name || (c.id && cleanPhone && c.id.includes(cleanPhone)));

      if (existingChat) {
          setActiveChat(existingChat);
      } else {
          const fakeId = lead.phone ? lead.phone : `temp_${lead.id}`;
          const newChat = { 
              id: fakeId, 
              name: lead.name, 
              messages: [], 
              lastTime: "Agora",
              isTemp: true
          };
          setChats(prev => [newChat, ...prev]);
          setActiveChat(newChat);
      }
  }

  const handleSendMessage = (text = messageInput) => {
      if (!text.trim() || !activeChat) return;
      socket.emit('send_message', { chatId: activeChat.id, text: text });
      
      const newMsg = { fromMe: true, body: text, timestamp: "Agora" };
      setActiveChat(prev => ({...prev, messages: [...(prev.messages || []), newMsg]}));
      setChats(prev => prev.map(c => c.id === activeChat.id ? {...c, lastMsg: text, messages: [...(c.messages || []), newMsg]} : c));
      setMessageInput("");
  }

  const getLeadsByStatus = (status) => leads.filter(lead => lead.status === status)

  const handleChangeStatus = (leadId, newStatus) => {
    setLeads(prev => prev.map(lead => lead.id === leadId ? { ...lead, status: newStatus } : lead));
  }

  const handleStartConversation = (lead) => {
    handleChangeStatus(lead.id, "contact");
    handleOpenChatFromLead(lead);
    showToast(`Lead ${lead.name} movido para Em Contato`);
  }

  const handleDeleteLead = (leadId) => {
    if (confirm("Tem certeza que deseja excluir este lead?")) {
      setLeads(prev => prev.filter(lead => lead.id !== leadId));
      showToast("Lead excluído");
    }
  }

  const handleEditLead = (lead) => { setEditingLead(lead); }

  const handleSaveEdit = (updatedLead) => {
    setLeads(prev => {
      const exists = prev.some(l => l.id === updatedLead.id);
      const base = {
        email: updatedLead.email || '',
        linkedin: updatedLead.linkedin || '',
        enriched: !!updatedLead.enriched,
      };
      if (!exists) {
        const newLead = {
          id: Date.now(),
          name: updatedLead.name || '',
          phone: updatedLead.phone || '',
          link: updatedLead.link || '',
          niche: updatedLead.niche || selectedNiche?.label || '',
          value: updatedLead.value || 'R$ 0',
          status: updatedLead.status || 'new',
          aiScore: typeof updatedLead.aiScore === 'number' ? updatedLead.aiScore : 0,
          lastContact: updatedLead.lastContact || 'Nunca',
          dataCaptura: updatedLead.dataCaptura || new Date().toLocaleString('pt-BR', { 
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
          }),
          ...base
        };
        return [newLead, ...prev];
      }
      return prev.map(lead => lead.id === updatedLead.id ? { ...lead, ...updatedLead, ...base } : lead);
    });
    setEditingLead(null);
    showToast("Lead atualizado");
  }
  const handleAddLead = () => {
    setEditingLead({
      name: '',
      phone: '',
      link: '',
      niche: '',
      value: 'R$ 0',
      status: 'new',
      aiScore: 0,
      lastContact: 'Nunca',
      email: '',
      linkedin: '',
      enriched: false,
      dataCaptura: new Date().toLocaleString('pt-BR', { 
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      })
    });
  }

  return (
    <div className="bg-[#020617] text-slate-100 font-sans relative flex flex-col min-h-screen">
      <header className="border-b border-slate-800 bg-slate-900/95 px-6 py-4 sticky top-0 z-50 shadow-md">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg"><Rocket className="h-5 w-5 text-white" /></div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">Enerzee SDR <span className="text-blue-500">Solar</span></h1>
              <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="text-[10px] text-slate-400 font-medium">SYSTEM ONLINE (v3.2)</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2 items-center">
               <Badge variant="outline" className={isServerOnline ? "bg-emerald-600/20 border-emerald-500 text-emerald-400" : "bg-slate-800 border-slate-700 text-slate-300"}>
                  {isServerOnline ? "Servidor Online" : "Modo Local"}
               </Badge>
               <Badge variant="outline" className="bg-slate-800 border-slate-700 text-slate-300">
                  Leads: {leads.length}
               </Badge>
               {isPipelineRunning && (
                 <Badge variant="outline" className="bg-blue-600/20 border-blue-500 text-blue-400">
                   Tempo: {formatDuration(pipelineElapsedMs)}
                 </Badge>
               )}
               <Button variant={isBotRunning ? "destructive" : "default"} onClick={() => setIsBotRunning(!isBotRunning)} disabled={isBotRunning}>
                  {isBotRunning ? <><BrainCircuit className="mr-2 h-4 w-4 animate-spin"/> RODANDO...</> : <><Play className="mr-2 h-4 w-4"/> ATIVAR SCRAPER</>}
               </Button>
               <Button variant="outline" onClick={handleRunCleanup} disabled={isCleanupRunning} className="border-slate-700 hover:bg-slate-800 text-slate-300">
                 {isCleanupRunning ? <><BrainCircuit className="mr-2 h-4 w-4 animate-spin"/> Limpando...</> : "LIMPEZA"}
               </Button>
               <Button variant="outline" onClick={handleRunEnrich} disabled={isEnrichRunning} className="border-slate-700 hover:bg-slate-800 text-slate-300">
                 {isEnrichRunning ? <><BrainCircuit className="mr-2 h-4 w-4 animate-spin"/> Enriquecendo...</> : "ENRIQUECER"}
               </Button>
          </div>
        </div>
      </header>

      {notification && (
          <div className="fixed top-24 right-6 z-[1000] bg-slate-800 border-l-4 border-emerald-500 text-white px-6 py-4 rounded shadow-2xl animate-in slide-in-from-right flex items-center gap-3">
              <div className="bg-emerald-500/20 p-2 rounded-full"><CheckCircle2 className="h-6 w-6 text-emerald-500" /></div>
              <div><h4 className="font-bold text-sm">Notificação</h4><p className="text-xs text-slate-300">{notification}</p></div>
          </div>
      )}

      {/* AQUI ESTAVA O ERRO DE LAYOUT/TAGS: MANTIDO flex-1 PARA CONTEUDO NO TOPO */}
      <main className="flex-1 w-full flex flex-col overflow-hidden relative">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
          <TabsList className="bg-slate-800 border-b border-slate-700 p-0 w-full h-10 shrink-0 rounded-none justify-start px-4">
            <TabsTrigger value="search" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white h-full rounded-none border-b-2 border-transparent data-[state=active]:border-white px-6"><MapPin className="mr-2 h-4 w-4"/> Mapa</TabsTrigger>
            <TabsTrigger value="crm" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white h-full rounded-none border-b-2 border-transparent data-[state=active]:border-white px-6"><LayoutDashboard className="mr-2 h-4 w-4"/> CRM</TabsTrigger>
            <TabsTrigger value="connections" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white h-full rounded-none border-b-2 border-transparent data-[state=active]:border-white px-6"><MessageSquare className="mr-2 h-4 w-4"/> WhatsApp</TabsTrigger>
          </TabsList>

          {/* ABA 1: MAPA */}
          <TabsContent value="search" className="mt-0 flex-1 flex flex-col lg:flex-row gap-6 h-full min-h-[70vh]">
              <div className="w-full lg:w-[350px] space-y-4 shrink-0">
                 <Card className="bg-slate-800 border-slate-700 shadow-xl">
                   <CardHeader><CardTitle className="text-white text-base flex items-center gap-2"><Search className="h-4 w-4 text-blue-400"/> Filtros de Busca</CardTitle></CardHeader>
                   <CardContent className="space-y-4">
                     <div className="space-y-2">
                       <Label className="text-slate-300">Nicho</Label>
                       <NicheSelect onNicheSelect={setSelectedNiche} />
                     </div>
                     <div className="space-y-2">
                        <Label className="text-slate-300">Localização</Label>
                        <div className="flex gap-2">
                          <Input placeholder="Clique no mapa..." className="bg-slate-900 border-slate-600 text-white" value={locationName} onChange={(e) => setLocationName(e.target.value)} />
                          <Button size="icon" className="bg-slate-700 hover:bg-slate-600" onClick={handleMyLocation}><LocateFixed className="h-4 w-4"/></Button>
                        </div>
                     </div>
                     <div className="space-y-4 pt-2">
                         <div className="flex justify-between"><Label className="text-slate-300">Raio Busca</Label><span className="text-blue-400 font-bold">{searchRadius} km</span></div>
                         <Slider defaultValue={[5]} max={50} step={1} value={searchRadius} onValueChange={setSearchRadius} />
                     </div>
                     <Button onClick={handleStartScraping} disabled={isBotRunning} className="w-full bg-blue-600 hover:bg-blue-500 font-bold h-12 uppercase tracking-wide">
                       {isBotRunning ? <span className="flex items-center gap-2"><BrainCircuit className="h-5 w-5 animate-spin"/> Varrendo...</span> : "INICIAR VARREDURA"}
                     </Button>
                   </CardContent>
                 </Card>
              </div>

              <div className="flex-1 rounded-xl overflow-hidden border border-slate-700 shadow-2xl relative bg-slate-900 h-full">
                  <MapContainer center={mapCenter} zoom={13} scrollWheelZoom={true} style={{ height: "100%", width: "100%" }}>
                     <MapController center={mapCenter} />
                     <MapClickHandler setCenter={setMapCenter} setLocationName={setLocationName} />
                     <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='&copy; OpenStreetMap' />
                     <Circle center={mapCenter} pathOptions={{ fillColor: '#3b82f6', color: '#2563eb', weight: 1, fillOpacity: 0.2 }} radius={searchRadius * 1000} />
                     <Marker position={mapCenter}><Popup>Alvo</Popup></Marker>
                  </MapContainer>
                  <div className="absolute top-4 right-4 z-[1000]">
                      <Button onClick={handleMyLocation} className="bg-blue-600 hover:bg-blue-500 text-white shadow-lg flex items-center gap-2" size="sm">
                          <LocateFixed className="h-4 w-4"/> Minha Localização
                      </Button>
                  </div>
              </div>
          </TabsContent>

          {/* ABA 2: CRM */}
          <TabsContent value="crm" className="mt-0 flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex justify-between mb-4 items-center px-4 pt-4 shrink-0">
                <Badge variant="outline" className="text-slate-300 px-3 py-1 text-sm">{leads.length} Leads Detectados</Badge>
                <div className="flex gap-2">
                   <Button size="sm" onClick={handleAddLead} className="bg-green-600 hover:bg-green-500"><Plus className="h-4 w-4 mr-2"/> Adicionar Lead</Button>
                   <Button variant="outline" size="sm" onClick={handleExportCSV} className="border-slate-700 hover:bg-slate-800 text-slate-300"><Download className="h-4 w-4 mr-2"/> Exportar CSV</Button>
                   <Button variant="destructive" size="sm" onClick={handleClearLeads}><Trash2 className="h-4 w-4 mr-2"/> Limpar</Button>
                </div>
            </div>

            <div className="flex-1 flex gap-4 overflow-x-auto px-4 pb-4 custom-scrollbar">
               <KanbanColumn title="Novo Lead" count={getLeadsByStatus('new').length} color="bg-slate-700">
                   {getLeadsByStatus('new').length === 0 ? (
                       <div className="text-center text-slate-500 text-sm mt-10">Nenhum lead novo</div>
                   ) : (
                       getLeadsByStatus('new').map(l => (
                           <LeadCard key={l.id} lead={l} onStartConversation={() => handleStartConversation(l)} onEdit={() => handleEditLead(l)} onDelete={() => handleDeleteLead(l.id)} onChangeStatus={(newStatus) => handleChangeStatus(l.id, newStatus)} color="border-l-4 border-l-slate-500" />
                       ))
                   )}
               </KanbanColumn>
               
               <KanbanColumn title="Em Contato" count={getLeadsByStatus('contact').length} color="bg-blue-600">
                   {getLeadsByStatus('contact').map(l => (
                        <LeadCard key={l.id} lead={l} onStartConversation={() => handleStartConversation(l)} onEdit={() => handleEditLead(l)} onDelete={() => handleDeleteLead(l.id)} onChangeStatus={(newStatus) => handleChangeStatus(l.id, newStatus)} color="border-l-4 border-l-blue-500" />
                   ))}
               </KanbanColumn>
               
               <KanbanColumn title="Aguardando" count={getLeadsByStatus('waiting').length} color="bg-yellow-600">
                   {getLeadsByStatus('waiting').map(l => (
                        <LeadCard key={l.id} lead={l} onStartConversation={() => handleStartConversation(l)} onEdit={() => handleEditLead(l)} onDelete={() => handleDeleteLead(l.id)} onChangeStatus={(newStatus) => handleChangeStatus(l.id, newStatus)} color="border-l-4 border-l-yellow-500" />
                   ))}
               </KanbanColumn>

               <KanbanColumn title="Fechado" count={getLeadsByStatus('closed').length} color="bg-emerald-600">
                   {getLeadsByStatus('closed').map(l => (
                        <LeadCard key={l.id} lead={l} onStartConversation={() => handleStartConversation(l)} onEdit={() => handleEditLead(l)} onDelete={() => handleDeleteLead(l.id)} onChangeStatus={(newStatus) => handleChangeStatus(l.id, newStatus)} color="border-l-4 border-l-emerald-500" />
                   ))}
               </KanbanColumn>
            </div>
          </TabsContent>

          {/* ABA 3: WHATSAPP */}
          <TabsContent value="connections" className="mt-0 flex-1 min-h-0 border border-slate-700 rounded-xl bg-slate-950 flex overflow-hidden flex-col">
              {/* CONTROLE SDR */}
              <div className="bg-slate-800 border-b border-slate-700 p-4 flex items-center justify-between shrink-0">
                 <div className="flex items-center gap-4">
                     <div className="flex items-center gap-2">
                         <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-red-500'}`}></div>
                         <span className="text-sm text-slate-300">{isConnected ? 'WhatsApp Conectado' : 'WhatsApp Desconectado'}</span>
                     </div>
                     {isSdrRunning && (
                         <Badge variant="outline" className="bg-blue-600/20 border-blue-500 text-blue-400">
                             <BrainCircuit className="h-3 w-3 mr-1 animate-spin"/> IA SDR Ativa
                         </Badge>
                     )}
                 </div>
                 <div className="flex gap-2">
                     {!isConnected && qrCode && (
                         <div className="flex items-center gap-3 bg-slate-900 p-3 rounded-lg border border-slate-700">
                             <div className="bg-white p-1 rounded"><QRCodeSVG value={qrCode} size={80} /></div>
                             <div><p className="text-xs text-slate-400 mb-1">Escaneie o QR Code</p></div>
                         </div>
                     )}
                     {isConnected && (
                         <Button onClick={handleStartSDR} disabled={isSdrRunning} className={isSdrRunning ? "bg-emerald-600 hover:bg-emerald-600" : "bg-blue-600 hover:bg-blue-500"}>
                             {isSdrRunning ? <><BrainCircuit className="mr-2 h-4 w-4 animate-spin"/> IA SDR Rodando...</> : <><BrainCircuit className="mr-2 h-4 w-4"/> Iniciar IA SDR</>}
                         </Button>
                     )}
                 </div>
              </div>

              {/* CONTAINER CHAT */}
              <div className="flex flex-1 overflow-hidden">
                 {/* SIDEBAR */}
                 <div className="w-[320px] border-r border-slate-800 flex flex-col bg-slate-900 shrink-0">
                    <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800">
                       <h2 className="font-bold text-slate-200">Conversas</h2>
                       <Badge variant="outline" className="text-xs">{chats.length}</Badge>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                       {chats.length === 0 ? (
                           <div className="flex flex-col items-center justify-center mt-10 space-y-2">
                               <MessageSquare className="h-12 w-12 text-slate-600"/>
                               <p className="text-center text-slate-500 text-sm px-4">Nenhum chat iniciado.</p>
                               {!isConnected && <p className="text-xs text-slate-600 text-center px-4">Conecte o WhatsApp para ver conversas</p>}
                           </div>
                       ) : (
                           <div className="space-y-1">
                               {chats.map(chat => (
                                   <div key={chat.id} onClick={() => setActiveChat(chat)} className={`p-3 rounded-lg cursor-pointer flex items-center gap-3 hover:bg-slate-800 transition-colors ${activeChat?.id === chat.id ? 'bg-slate-800 border-l-2 border-blue-500' : ''}`}>
                                       <div className="h-10 w-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-white">{chat.name.charAt(0)}</div>
                                       <div className="overflow-hidden flex-1">
                                           <div className="flex justify-between"><h4 className="font-bold text-sm text-slate-200 truncate">{chat.name}</h4><span className="text-[10px] text-slate-500">{chat.lastTime}</span></div>
                                           <p className="text-xs text-slate-500 truncate">{chat.lastMessage || "Novo chat"}</p>
                                       </div>
                                   </div>
                               ))}
                           </div>
                       )}
                    </div>
                 </div>

                 {/* CHAT AREA */}
                 <div className="flex-1 flex flex-col bg-[#0b141a] relative">
                     {activeChat ? (
                         <>
                            <div className="h-16 bg-slate-800 flex items-center justify-between px-6 border-b border-slate-700 z-10">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-full bg-slate-600 flex items-center justify-center text-white font-bold">{activeChat.name.charAt(0)}</div>
                                    <div>
                                        <h3 className="font-bold text-white">{activeChat.name}</h3>
                                        <p className="text-[10px] text-green-400">Online</p>
                                    </div>
                                </div>
                                <Button variant="ghost" size="icon" onClick={() => setActiveChat(null)}><X className="text-slate-400"/></Button>
                            </div>
                            
                            <div className="bg-slate-900 border-b border-slate-800 p-2 flex gap-2 overflow-x-auto custom-scrollbar">
                                <Badge variant="outline" className="cursor-pointer hover:bg-blue-600 hover:text-white border-slate-700 whitespace-nowrap transition-colors" onClick={() => handleSendMessage(`Olá ${activeChat.name}, tudo bem? Sou da Enerzee Solar.`)}>👋 Saudação</Badge>
                                <Badge variant="outline" className="cursor-pointer hover:bg-blue-600 hover:text-white border-slate-700 whitespace-nowrap transition-colors" onClick={() => handleSendMessage("Gostaria de apresentar uma proposta de redução de energia.")}>⚡ Proposta Solar</Badge>
                                <Badge variant="outline" className="cursor-pointer hover:bg-blue-600 hover:text-white border-slate-700 whitespace-nowrap transition-colors" onClick={() => handleSendMessage("Podemos agendar uma visita técnica?")}>📅 Agendar Visita</Badge>
                            </div>

                            <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-opacity-5">
                                {activeChat.messages?.map((msg, i) => (
                                    <div key={i} className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`p-2 px-4 rounded-lg text-sm max-w-[70%] shadow relative ${msg.fromMe ? 'bg-[#005c4b] text-white' : 'bg-[#202c33] text-slate-200'}`}>
                                            <p>{msg.body}</p>
                                            <span className="text-[10px] block text-right mt-1 opacity-70">{msg.timestamp}</span>
                                        </div>
                                    </div>
                                ))}
                                <div ref={chatEndRef} />
                            </div>
                            
                            <div className="p-3 bg-slate-900 flex gap-2">
                                <Input value={messageInput} onChange={e => setMessageInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder="Digite..." className="bg-slate-800 border-none text-white"/>
                                <Button onClick={() => handleSendMessage()} size="icon" className="bg-[#005c4b] hover:bg-emerald-600"><Send className="h-4 w-4"/></Button>
                                <Button variant="ghost" size="icon" className="text-slate-400"><Mic className="h-5 w-5"/></Button>
                            </div>
                         </>
                     ) : (
                         <div className="flex-1 flex items-center justify-center flex-col text-slate-600 opacity-50">
                             <MessageSquare className="h-16 w-16 mb-2"/>
                             <p className="text-slate-400">Selecione uma conversa</p>
                             {chats.length === 0 && !isConnected && (
                                 <p className="text-xs text-slate-600 mt-2">Conecte o WhatsApp para começar</p>
                             )}
                         </div>
                     )}
                 </div>
              </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* LEAD DETAILS MODAL */}
      <Dialog open={!!selectedLead} onOpenChange={() => setSelectedLead(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
            <DialogHeader>
                <DialogTitle>{selectedLead?.name}</DialogTitle>
                <DialogDescription className="text-slate-400">Dados enriquecidos via IA</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
                 <div className="bg-slate-800 p-3 rounded border border-slate-700">
                    <span className="text-xs text-slate-500 uppercase">Potencial</span>
                    <div className="text-xl font-bold text-emerald-400">{selectedLead?.value}</div>
                 </div>
                 <div className="bg-slate-800 p-3 rounded border border-slate-700">
                    <span className="text-xs text-slate-500 uppercase">Score</span>
                    <div className="text-xl font-bold text-blue-400">{selectedLead?.aiScore}</div>
                 </div>
            </div>
            <DialogFooter>
                <Button className="w-full bg-green-600 hover:bg-green-500" onClick={() => { handleOpenChatFromLead(selectedLead); setSelectedLead(null); }}>
                    <MessageSquare className="mr-2 h-4 w-4"/> Iniciar WhatsApp
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* EDIT LEAD MODAL */}
      <Dialog open={!!editingLead} onOpenChange={() => setEditingLead(null)}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
            <DialogHeader>
                <DialogTitle>Editar Lead</DialogTitle>
                <DialogDescription className="text-slate-400">Atualize as informações do lead</DialogDescription>
            </DialogHeader>
            {editingLead && (
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label className="text-slate-300">Nome</Label>
                        <Input 
                            value={editingLead.name}
                            onChange={(e) => setEditingLead({...editingLead, name: e.target.value})}
                            className="bg-slate-800 border-slate-600 text-white"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-slate-300">Telefone</Label>
                        <Input 
                            value={editingLead.phone}
                            onChange={(e) => setEditingLead({...editingLead, phone: e.target.value})}
                            className="bg-slate-800 border-slate-600 text-white"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-slate-300">Link da Origem</Label>
                        <Input 
                            value={editingLead.link || ''}
                            onChange={(e) => setEditingLead({...editingLead, link: e.target.value})}
                            className="bg-slate-800 border-slate-600 text-white"
                            placeholder="https://..."
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-slate-300">E-mail</Label>
                        <Input 
                            value={editingLead.email || ''}
                            onChange={(e) => setEditingLead({...editingLead, email: e.target.value})}
                            className="bg-slate-800 border-slate-600 text-white"
                            placeholder="email@exemplo.com"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-slate-300">LinkedIn</Label>
                        <Input 
                            value={editingLead.linkedin || ''}
                            onChange={(e) => setEditingLead({...editingLead, linkedin: e.target.value})}
                            className="bg-slate-800 border-slate-600 text-white"
                            placeholder="https://linkedin.com/in/usuario"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-slate-300">Status</Label>
                        <select 
                            value={editingLead.status}
                            onChange={(e) => setEditingLead({...editingLead, status: e.target.value})}
                            className="w-full bg-slate-800 border border-slate-600 text-white rounded-md px-3 py-2"
                        >
                            <option value="new">Novo Lead</option>
                            <option value="contact">Em Contato</option>
                            <option value="waiting">Aguardando Retorno</option>
                            <option value="pre_agendado">Pré-Agendado</option>
                            <option value="closed">Fechado</option>
                        </select>
                    </div>
                </div>
            )}
            <DialogFooter>
                <Button variant="outline" onClick={() => setEditingLead(null)} className="border-slate-700 hover:bg-slate-800">Cancelar</Button>
                <Button onClick={() => handleSaveEdit(editingLead)} className="bg-blue-600 hover:bg-blue-500">Salvar</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function KanbanColumn({ title, count, color, children }) {
    return (
        <div className="min-w-[320px] bg-slate-800/50 border border-slate-700 rounded-xl flex flex-col h-full shadow-lg">
            <div className="p-3 border-b border-slate-700 flex justify-between items-center bg-slate-900/95 backdrop-blur rounded-t-xl sticky top-0 z-10">
                <div className="flex items-center gap-2"><div className={`w-3 h-3 rounded-full shadow-[0_0_10px] ${color.replace('bg-', 'shadow-')} ${color}`}></div><span className="font-bold text-sm text-slate-200">{title}</span></div>
                <Badge variant="secondary" className="bg-slate-700 text-xs">{count}</Badge>
            </div>
            <div className="p-3 space-y-3 overflow-y-auto flex-1 custom-scrollbar">{children}</div>
        </div>
    )
}

// ESTE É O SEU LEAD CARD EXATO, COM TODAS AS FUNÇÕES (MENU, EDITAR, STATUS, EMAIL, LINKEDIN)
function LeadCard({ lead, onStartConversation, onEdit, onDelete, onChangeStatus, color }) {
    const [showMenu, setShowMenu] = useState(false);

    const handleStatusClick = (e) => {
        e.stopPropagation();
        const statuses = ['new', 'contact', 'waiting', 'closed'];
        const currentIndex = statuses.indexOf(lead.status);
        const nextStatus = statuses[(currentIndex + 1) % statuses.length];
        onChangeStatus(nextStatus);
    }

    return (
        <div className={`bg-slate-800 p-4 rounded-lg border border-slate-700 shadow-sm hover:shadow-lg hover:border-blue-500 transition-all group ${color} relative`}>
            <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-slate-900 border-slate-600 text-slate-400 text-[10px] uppercase tracking-wider font-semibold">{lead.niche || "Sem categoria"}</Badge>
                    <Badge variant="outline" className="bg-blue-600/20 border-blue-500 text-blue-400 text-[10px]">Score {typeof lead.aiScore === 'number' ? lead.aiScore : 'N/A'}</Badge>
                </div>
                <div className="flex gap-1">
                    <div className="relative">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
                            className="p-1 rounded-full hover:bg-slate-700 text-slate-400 transition-colors z-10"
                            title="Mais opções"
                        >
                            <MoreVertical className="h-4 w-4"/>
                        </button>
                        {showMenu && (
                            <div className="absolute right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-lg z-20 min-w-[120px]">
                                <button
                                    onClick={(e) => { e.stopPropagation(); onEdit(); setShowMenu(false); }}
                                    className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 flex items-center gap-2"
                                >
                                    <Edit2 className="h-3 w-3"/> Editar
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onDelete(); setShowMenu(false); }}
                                    className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-slate-800 flex items-center gap-2"
                                >
                                    <Trash2 className="h-3 w-3"/> Excluir
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleStatusClick(e); setShowMenu(false); }}
                                    className="w-full text-left px-3 py-2 text-sm text-blue-400 hover:bg-slate-800 flex items-center gap-2"
                                >
                                    <CheckCircle2 className="h-3 w-3"/> Trocar Status
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            
            <h4 className="font-bold text-white text-base group-hover:text-blue-400 transition-colors mb-2">{lead.name}</h4>
            
            <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-slate-400 text-xs">
                    <Phone className="h-3 w-3 flex-shrink-0" /> 
                    <span className="truncate">{lead.phone || "Não informado"}</span>
                </div>
                {lead.link && (
                    <div className="flex items-center gap-2 text-slate-400 text-xs">
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        <a 
                            href={lead.link} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-400 hover:text-blue-300 truncate underline"
                        >
                            Link da Origem
                        </a>
                    </div>
                )}
                {lead.email && (
                    <div className="flex items-center gap-2 text-slate-400 text-xs">
                        <Mail className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{lead.email}</span>
                    </div>
                )}
                {lead.linkedin && (
                    <div className="flex items-center gap-2 text-slate-400 text-xs">
                        <Linkedin className="h-3 w-3 flex-shrink-0" />
                        <a 
                            href={lead.linkedin} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-400 hover:text-blue-300 truncate underline"
                        >
                            LinkedIn
                        </a>
                    </div>
                )}
                {lead.dataCaptura && (
                    <div className="flex items-center gap-2 text-slate-400 text-xs">
                        <Calendar className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{lead.dataCaptura}</span>
                    </div>
                )}
            </div>
            
            <div className="pt-3 border-t border-slate-700/50">
                <Button 
                    onClick={(e) => { e.stopPropagation(); onStartConversation(); }}
                    className="w-full bg-green-600 hover:bg-green-500 text-white text-sm"
                    size="sm"
                >
                    <MessageSquare className="h-3 w-3 mr-2"/> Iniciar Conversa
                </Button>
            </div>
            
            {showMenu && (
                <div 
                    className="fixed inset-0 z-10" 
                    onClick={(e) => { e.stopPropagation(); setShowMenu(false); }}
                />
            )}
        </div>
    )
}
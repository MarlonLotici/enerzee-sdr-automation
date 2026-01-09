import { useState } from 'react'
import './App.css'

function App() {
  const [cidade, setCidade] = useState('')
  const [nicho, setNicho] = useState('')
  const [modoVisual, setModoVisual] = useState(true) // Toggle state
  
  const [leads, setLeads] = useState([])
  const [carregando, setCarregando] = useState(false)
  const [statusMsg, setStatusMsg] = useState('Sistema pronto. Aguardando coordenadas.')

  const iniciarMineracao = async () => {
    if (!cidade || !nicho) return alert('Por favor, informe a Cidade e o Nicho.')
    
    setCarregando(true)
    setLeads([]) 
    setStatusMsg(`📡 Inicializando satélite em ${cidade}...`)
    
    try {
      const params = new URLSearchParams({ cidade, nicho, visual: modoVisual })
      const res = await fetch(`http://localhost:3000/api/buscar?${params}`)
      const data = await res.json()
      
      if (data.sucesso) {
        setLeads(data.dados)
        setStatusMsg(`✅ Operação completa! ${data.quantidade} leads novos no sistema.`)
      } else {
        setStatusMsg('❌ Erro no motor: ' + data.erro)
      }
    } catch (error) {
      console.error(error)
      setStatusMsg('❌ Falha de conexão com o servidor (Porta 3000).')
    } finally {
      setCarregando(false)
    }
  }

  const baixarCSV = () => {
    if (leads.length === 0) return
    const header = "Empresa,Telefone,Bairro,Link\n"
    const rows = leads.map(l => `"${l.empresa_maps}","${l.telefone_maps}","${l.bairro_detectado}","${l.link_maps}"`).join("\n")
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Leads_${cidade}.csv`
    a.click()
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f0f2f5', fontFamily: '"Segoe UI", Roboto, sans-serif', padding: '40px' }}>
      
      {/* PAINEL CENTRAL CARD */}
      <div style={{ maxWidth: '1100px', margin: '0 auto', backgroundColor: 'white', borderRadius: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        
        {/* HEADER */}
        <header style={{ backgroundColor: '#2c3e50', padding: '30px', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.8rem' }}>⚡ Ezee Connect <span style={{ color: '#f39c12' }}>Solar</span></h1>
            <p style={{ margin: '5px 0 0', opacity: 0.7, fontSize: '0.9rem' }}>Sistema de Inteligência Comercial e Geolocalização</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>TOTAL DE LEADS</div>
            <div style={{ fontSize: '3rem', fontWeight: 'bold', lineHeight: 1 }}>{leads.length}</div>
          </div>
        </header>

        {/* CONTROLES */}
        <div style={{ padding: '30px', display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr', gap: '20px', alignItems: 'end' }}>
          
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#555' }}>Cidade Alvo</label>
            <input 
              type="text" 
              placeholder="Ex: Florianópolis"
              value={cidade}
              onChange={e => setCidade(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '16px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', color: '#555' }}>Nicho / Segmento</label>
            <input 
              type="text" 
              placeholder="Ex: Padaria (Busca automática por sinônimos)"
              value={nicho}
              onChange={e => setNicho(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '16px' }}
            />
          </div>

          {/* TOGGLE SWITCH - Botão Deslizante */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
             <label style={{ marginBottom: '8px', fontWeight: '600', color: '#555', fontSize: '0.9rem' }}>Modo Visual</label>
             <div 
                onClick={() => setModoVisual(!modoVisual)}
                style={{ 
                  width: '60px', height: '30px', backgroundColor: modoVisual ? '#27ae60' : '#ccc', 
                  borderRadius: '30px', position: 'relative', cursor: 'pointer', transition: '0.3s'
                }}
             >
               <div style={{ 
                 width: '24px', height: '24px', backgroundColor: 'white', borderRadius: '50%', 
                 position: 'absolute', top: '3px', left: modoVisual ? '33px' : '3px', transition: '0.3s', boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
               }} />
             </div>
          </div>

          <button 
            onClick={iniciarMineracao}
            disabled={carregando}
            style={{ 
              height: '46px', backgroundColor: carregando ? '#95a5a6' : '#f39c12', color: 'white', 
              border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '16px', cursor: carregando ? 'wait' : 'pointer',
              boxShadow: '0 4px 10px rgba(243, 156, 18, 0.3)'
            }}
          >
            {carregando ? 'MINERANDO...' : 'INICIAR'}
          </button>
        </div>

        {/* STATUS BAR */}
        <div style={{ padding: '0 30px 20px 30px' }}>
          <div style={{ backgroundColor: '#ecf0f1', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #3498db', color: '#34495e' }}>
            <strong>Status:</strong> {statusMsg}
          </div>
        </div>

        {/* MAPA VISUAL (Placeholder para futura API) */}
        {carregando && (
          <div style={{ height: '150px', background: 'linear-gradient(45deg, #2c3e50, #34495e)', margin: '0 30px 20px 30px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexDirection: 'column' }}>
             <div className="radar-animation" style={{ width: '40px', height: '40px', border: '3px solid rgba(255,255,255,0.3)', borderRadius: '50%', borderTopColor: '#f39c12', animation: 'spin 1s linear infinite' }}></div>
             <p style={{ marginTop: '15px', fontSize: '0.9rem' }}>Varrendo perímetro geográfico...</p>
          </div>
        )}

        {/* TABELA DE DADOS */}
        {leads.length > 0 && (
          <div style={{ padding: '0 30px 40px 30px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
               <h3 style={{ margin: 0, color: '#2c3e50' }}>Resultados da Mineração</h3>
               <button onClick={baixarCSV} style={{ padding: '8px 15px', backgroundColor: '#27ae60', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>Download CSV</button>
            </div>
            
            <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #eee', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f8f9fa' }}>
                  <tr style={{ textAlign: 'left', color: '#7f8c8d', fontSize: '0.9rem' }}>
                    <th style={{ padding: '15px' }}>EMPRESA</th>
                    <th style={{ padding: '15px' }}>BAIRRO</th>
                    <th style={{ padding: '15px' }}>TELEFONE</th>
                    <th style={{ padding: '15px' }}>AÇÃO</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '15px', fontWeight: '600', color: '#2c3e50' }}>{lead.empresa_maps}</td>
                      <td style={{ padding: '15px', color: '#e67e22' }}>{lead.bairro_detectado}</td>
                      <td style={{ padding: '15px', color: '#555' }}>{lead.telefone_maps}</td>
                      <td style={{ padding: '15px' }}>
                        <a href={lead.link_maps} target="_blank" rel="noreferrer" style={{ color: '#3498db', textDecoration: 'none', fontWeight: 'bold', fontSize: '0.9rem' }}>Ver no Maps</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* CSS INLINE PARA ANIMAÇÃO (Geralmente iria no App.css) */}
      <style>{`
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

export default App
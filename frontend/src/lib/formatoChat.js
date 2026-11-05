// Formatação "estilo WhatsApp" para o painel (sem dependências → testável em Node).

const DIA_MS = 86400000
const inicioDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const valida = (d) => !Number.isNaN(d.getTime())
// new Date(null) vira 1970 e passaria como "válida": valores vazios nunca chegam ao Date.
const paraData = (v) => (v === null || v === undefined || v === '' ? new Date(NaN) : new Date(v))

/** "14:32" */
export function horaCurta(iso) {
    const d = paraData(iso)
    return valida(d) ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''
}

/** Rótulo do separador de dia no chat: Hoje / Ontem / segunda-feira / 05/11/2026 */
export function rotuloDia(iso, agora = new Date()) {
    const d = paraData(iso)
    if (!valida(d)) return ''
    const dif = Math.round((inicioDoDia(agora) - inicioDoDia(d)) / DIA_MS)
    if (dif === 0) return 'Hoje'
    if (dif === 1) return 'Ontem'
    if (dif > 1 && dif < 7) return d.toLocaleDateString('pt-BR', { weekday: 'long' })
    return d.toLocaleDateString('pt-BR')
}

/** Hora/dia no canto da linha da lista: 14:32 · Ontem · seg. · 05/11/26 */
export function horaLista(iso, agora = new Date()) {
    const d = paraData(iso)
    if (!valida(d)) return ''
    const dif = Math.round((inicioDoDia(agora) - inicioDoDia(d)) / DIA_MS)
    if (dif <= 0) return horaCurta(iso)
    if (dif === 1) return 'Ontem'
    if (dif < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/** Agrupa mensagens (em ordem cronológica) por dia local: [{ chave, rotulo, itens }] */
export function agruparPorDia(msgs = [], agora = new Date()) {
    const grupos = []
    for (const m of msgs) {
        const d = paraData(m.created_at)
        const chave = valida(d) ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : 'sem-data'
        const ultimo = grupos[grupos.length - 1]
        if (ultimo && ultimo.chave === chave) ultimo.itens.push(m)
        else grupos.push({ chave, rotulo: rotuloDia(m.created_at, agora), itens: [m] })
    }
    return grupos
}

/** Quem falou: 'lead' | 'ia' | 'humano' (role human_operator = alguém da equipe) */
export function autorDaMensagem(msg) {
    if (msg?.role === 'user') return 'lead'
    if (msg?.role === 'human_operator') return 'humano'
    return 'ia'
}

/**
 * Telefone do lead pra exibir e abrir no WhatsApp pessoal.
 * A Meta costuma entregar o celular BR SEM o 9 extra (12 dígitos); se for celular, devolve com o 9.
 */
export function telefoneDoLead(lead) {
    const bruto = String(lead?.phone || '').replace(/\D/g, '') || String(lead?.whatsapp_id || '').replace(/@.*/, '').replace(/\D/g, '')
    if (!bruto) return null
    let d = bruto
    if (d.length === 10 || d.length === 11) d = '55' + d
    if (d.length === 12 && d.startsWith('55') && /[6-9]/.test(d[4])) d = d.slice(0, 4) + '9' + d.slice(4)
    let exibicao = `+${d}`
    if (d.startsWith('55') && d.length === 13) exibicao = `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`
    else if (d.startsWith('55') && d.length === 12) exibicao = `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`
    return { digitos: d, exibicao, wa: `https://wa.me/${d}` }
}

/** Divide um texto em partes de texto e de link (pra tornar URLs clicáveis). */
export function partirLinks(texto = '') {
    const partes = []
    const re = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)])/g
    let ultimo = 0
    let m
    const s = String(texto)
    while ((m = re.exec(s)) !== null) {
        if (m.index > ultimo) partes.push({ tipo: 'texto', valor: s.slice(ultimo, m.index) })
        partes.push({ tipo: 'link', valor: m[0] })
        ultimo = m.index + m[0].length
    }
    if (ultimo < s.length) partes.push({ tipo: 'texto', valor: s.slice(ultimo) })
    return partes
}

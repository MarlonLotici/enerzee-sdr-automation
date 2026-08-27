// frontend/src/lib/temperatura.js
// Rótulo e estilo da temperatura do lead em PT-BR: Frio / Médio / Quente / Morto.
// O backend grava lead_temperature em inglês (cold/warm/hot/dead) via tags [CLIMA];
// aqui é SÓ display — não altera o valor armazenado.

const MAPA = {
    hot:  { label: 'Quente', emoji: '🔥', cor: '#ef4444', tw: 'text-red-400',   bg: 'bg-red-500/10 border-red-500/20' },
    warm: { label: 'Médio',  emoji: '🟡', cor: '#f59e0b', tw: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
    cold: { label: 'Frio',   emoji: '❄️', cor: '#60a5fa', tw: 'text-blue-400',  bg: 'bg-blue-500/10 border-blue-500/20' },
    dead: { label: 'Morto',  emoji: '💀', cor: '#64748b', tw: 'text-slate-500', bg: 'bg-slate-500/10 border-slate-500/20' },
};

// Retorna { label, emoji, cor, tw, bg }. Desconhecido cai em Frio.
export function rotuloTemperatura(t) {
    return MAPA[t] || MAPA.cold;
}

// "🔥 Quente" pronto pra exibição.
export function textoTemperatura(t) {
    const m = rotuloTemperatura(t);
    return `${m.emoji} ${m.label}`;
}

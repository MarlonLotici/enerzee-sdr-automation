'use strict';
// lib/semTravessao.js — Remove travessão (em dash — e en dash –) do texto final que vai
// pro lead. Pedido do usuário: nem o site nem a Sofia (WhatsApp/web) devem usar travessão.
// Função PURA, sem I/O — chamada no choke-point de cada canal, depois de tudo pronto
// (cobre tanto texto fixo do código quanto o que a LLM gera sozinha).

function semTravessao(texto) {
    if (!texto || typeof texto !== 'string') return texto;
    return texto
        // " — " / " – " (cercado de espaço) → vírgula: é o uso mais comum (aposto/pausa).
        .replace(/\s+[—–]\s+/g, ', ')
        // travessão colado sem espaço dos dois lados (raro, mas acontece em texto gerado)
        .replace(/[—–]/g, ', ')
        // limpa sujeira que a troca pode deixar: vírgula dupla, ", ." antes de ponto, etc.
        .replace(/,\s*,/g, ',')
        .replace(/,\s*([.!?…])/g, '$1')
        .replace(/\s+,/g, ',')
        .trim();
}

module.exports = { semTravessao };

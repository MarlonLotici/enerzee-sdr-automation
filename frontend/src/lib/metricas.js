// Regra ÚNICA do que conta como reunião em todas as telas (Pipeline, Operação, Resultados,
// Relatório). Só vale reunião de verdade: o lead reservou o horário (calendly_booked) ou o
// status virou booked/closed. current_stage 4 NÃO é reunião: é a IA propondo horário — contar
// isso inflava "reuniões" (ex.: 55 na tela contra 4 reais) e gerava conversão acima de 100%.
export const ehReuniao = (l) =>
    l.status === 'booked' || l.status === 'closed' || l.calendly_booked === true

// Mesmo critério para a query no Supabase (PostgREST .or()).
export const FILTRO_REUNIAO = 'status.eq.booked,status.eq.closed,calendly_booked.eq.true'

// Nomes dos estágios 0-5 gravados pela IA. 4 = horário proposto, 5 = reunião marcada.
export const ESTAGIOS = ['Qualificação', 'Situação', 'Dor', 'Solução', 'Horário proposto', 'Reunião marcada']

// Recebe minutos SEM arredondar. Resposta em segundos vira "<1 min" (antes arredondava para 0
// e a tela Operação mostrava "--", como se não houvesse dado).
export const formatarMinutos = (min) => (min == null ? null : min < 1 ? '<1 min' : `${Math.round(min)} min`)

/**
 * CALL CONVERSATION ENGINE — loop de conversa de UMA ligação (estado por callId).
 *
 * Não reaproveita o 4_sdr.js como motor: gaveta, jitter e polling por chip
 * existem para simular comportamento humano assíncrono no WhatsApp — numa
 * ligação síncrona o turno acontece em segundos. O que É reaproveitado é o
 * cérebro de decisão do funil: routerAgent (intenção) + closerAgent (resposta,
 * em modo 'voz'), para texto e voz nunca divergirem nas regras de venda.
 *
 * Decisão sobre o routerAgent: os regex de bot ("pressione 1", "horário de
 * atendimento"...) são mantidos de propósito — ao telefone, um match de ROBO
 * significa caixa postal/URA, e a reação certa é desligar com outcome
 * 'voicemail' em vez de gastar minutos falando com uma gravação.
 */

const { classificarMensagem } = require('../agents/routerAgent');
const { gerarRespostaCloser } = require('../agents/closerAgent');
const { criarSttStream } = require('./sttDeepgram');
const { sintetizarStream } = require('./ttsElevenLabs');

const MAX_DURACAO_MS = 10 * 60 * 1000;   // teto duro de 10min por ligação (guarda de custo)
const SILENCIO_REPROMPT_MS = 15000;      // 15s sem fala → "está me ouvindo?"
const SILENCIO_DESISTIR_MS = 30000;      // +30s → desliga como no_answer

// Pedido explícito de não receber mais ligações → do_not_call obrigatório (LGPD)
const REGEX_NAO_LIGAR = /\b(n[aã]o\s+(me\s+)?lig(a|ue)|n[aã]o\s+quero\s+(mais\s+)?(receber|falar|papo)|tira\s+meu\s+n[uú]mero|me\s+tira\s+(da|dessa)\s+lista|para\s+de\s+(me\s+)?ligar)\b/i;

function _extrairTags(respostaBruta) {
    const estagioMatch = respostaBruta.match(/\[ESTAGIO:(\d+|ENCERRADO)\]/i);
    const texto = respostaBruta
        .replace(/\[ESTAGIO:[^\]]*\]/gi, '')
        .replace(/\[CLIMA:[^\]]*\]/gi, '')
        .replace(/\[QUEBRA\]/gi, ' ')
        .replace(/https?:\/\/\S+/g, '')   // nunca ler URL em voz alta
        .replace(/\s{2,}/g, ' ')
        .trim();
    return { texto, estagio: estagioMatch ? estagioMatch[1].toUpperCase() : null };
}

class CallSession {
    /**
     * @param {object} ctx  contexto montado pelo voiceEngine na hora do disparo:
     *   { callId, callSid, lead, rules, userId, io, aoFinalizar(resumo) }
     * @param {object} twilioWs  WebSocket do Media Stream (lado Twilio)
     */
    constructor(ctx, twilioWs) {
        this.ctx = ctx;
        this.twilioWs = twilioWs;
        this.streamSid = null;
        this.historico = [];        // formato closerAgent: [{role, content}]
        this.transcript = [];       // [{speaker, text, at}] → calls.transcript
        this.ultimoEstagio = ctx.lead?.current_stage ?? 0;
        this.iniciadaEm = Date.now();
        this.processandoTurno = false;
        this.pendencia = [];        // falas que chegaram durante um turno em processamento
        this.ttsAtivo = null;       // { abortar } da síntese em andamento
        this.marcouInteresse = false;
        this.pediuNaoLigar = false;
        this.encerrada = false;
        this.outcomeForcado = null;
        this.leadFalou = false;
        this.contadorMarks = 0;
        this.marksPendentes = new Set(); // áudio da IA ainda tocando no Twilio

        this._timerMaxDuracao = setTimeout(() => this.desligar('inconclusive'), MAX_DURACAO_MS);
        this._armarTimerSilencio();

        this.stt = criarSttStream({
            onFalaDetectada: () => this._bargeIn(),
            onTranscricaoParcial: (t) => this._emitir('call_transcript_chunk', { speaker: 'lead', text: t, parcial: true }),
            onTranscricaoFinal: (t) => this._aoLeadFalar(t),
            onErro: () => { /* STT caiu: a ligação segue muda; o timer de silêncio encerra */ },
        });
    }

    // ── Entradas vindas do mediaStreamServer ────────────────────────────────

    aoStreamIniciar(streamSid) {
        this.streamSid = streamSid;
        this._emitir('call_status', { status: 'in-progress' });
        // A IA abre a ligação com um cumprimento raso e instantâneo (template,
        // não LLM): latência zero no momento mais sensível da chamada.
        const nomeLead = this.ctx.lead?.dono || null;
        const abertura = nomeLead
            ? `Oi, ${nomeLead}? Aqui é ${this.ctx.rules?.agent_name || 'a assistente'} da ${this.ctx.rules?.company_name || 'nossa empresa'}, tudo bem?`
            : `Olá, tudo bem? Aqui é ${this.ctx.rules?.agent_name || 'a assistente'} da ${this.ctx.rules?.company_name || 'nossa empresa'}. Falo com quem cuida da empresa?`;
        this._falar(abertura);
    }

    aoAudioLead(bufferMulaw) {
        this.stt.enviarAudio(bufferMulaw);
    }

    aoMarkConfirmado(nome) {
        this.marksPendentes.delete(nome);
    }

    aoStreamEncerrar() {
        this._finalizar();
    }

    /** Encerra ativamente: fecha o WS — sem próximo verbo TwiML, o Twilio derruba a chamada. */
    desligar(outcome = null) {
        if (outcome) this.outcomeForcado = outcome;
        try { this.twilioWs.close(); } catch { /* já fechado */ }
        // o 'close' do WS dispara aoStreamEncerrar → _finalizar
    }

    // ── Pipeline de turno ───────────────────────────────────────────────────

    async _aoLeadFalar(texto) {
        this.leadFalou = true;
        this._armarTimerSilencio();
        this.transcript.push({ speaker: 'lead', text: texto, at: new Date().toISOString() });
        this._emitir('call_transcript_chunk', { speaker: 'lead', text: texto });

        if (REGEX_NAO_LIGAR.test(texto)) {
            this.pediuNaoLigar = true;
            await this._falar('Entendido, sem problema. Removo seu número aqui e não ligamos mais. Uma ótima semana!');
            setTimeout(() => this.desligar('not_interested'), 4000);
            return;
        }

        if (this.processandoTurno) {
            this.pendencia.push(texto);
            return;
        }
        this.processandoTurno = true;

        try {
            const intencao = await classificarMensagem(texto);

            // Ao telefone, ROBO = caixa postal/URA → desligar sem gastar minutos
            if (intencao === 'ROBO') {
                this.desligar('voicemail');
                return;
            }
            if (intencao === 'ENGANO') {
                await this._falar('Ah, perdão pelo engano então! Obrigada, uma boa semana!');
                setTimeout(() => this.desligar('wrong_number'), 4000);
                return;
            }

            this.historico.push({ role: 'user', content: texto });

            const intencaoCloser = ['COMPRA', 'DUVIDA', 'REPASSE'].includes(intencao) ? intencao : 'DUVIDA';
            if (intencao === 'COMPRA') this.marcouInteresse = true;

            const respostaBruta = await gerarRespostaCloser(
                this.historico,
                this.ctx.lead,
                this.ctx.rules?.system_prompt || '',
                intencaoCloser,
                {
                    calendlyLink: this.ctx.rules?.calendly_link || '',
                    instanceType: this.ctx.rules?.product_type || 'generico',
                    modo: 'voz',
                }
            );

            const { texto: fala, estagio } = _extrairTags(respostaBruta);
            if (estagio === 'ENCERRADO') this.ultimoEstagio = 5;
            else if (estagio !== null) this.ultimoEstagio = parseInt(estagio, 10) || this.ultimoEstagio;
            if (this.ultimoEstagio >= 4) this.marcouInteresse = true;

            this.historico.push({ role: 'assistant', content: respostaBruta });

            if (fala) await this._falar(fala);
        } catch (err) {
            console.error(`❌ [CALL ${this.ctx.callId?.slice(0, 8)}] Erro no turno:`, err.message);
        } finally {
            this.processandoTurno = false;
            if (this.pendencia.length > 0 && !this.encerrada) {
                const proxima = this.pendencia.join(' ');
                this.pendencia = [];
                this._aoLeadFalar(proxima);
            }
        }
    }

    // ── Saída de áudio (TTS → Twilio) ───────────────────────────────────────

    async _falar(texto) {
        this.transcript.push({ speaker: 'ai', text: texto, at: new Date().toISOString() });
        this._emitir('call_transcript_chunk', { speaker: 'ai', text: texto });

        // Interrompe qualquer fala anterior ainda em síntese
        this.ttsAtivo?.abortar();

        try {
            const sintese = sintetizarStream(texto, (chunk) => {
                if (this.twilioWs.readyState === 1 && this.streamSid) {
                    this.twilioWs.send(JSON.stringify({
                        event: 'media',
                        streamSid: this.streamSid,
                        media: { payload: chunk.toString('base64') },
                    }));
                }
            });
            this.ttsAtivo = sintese;
            await sintese.pronta;

            // mark: o Twilio confirma quando TODO o áudio bufferizado tocou —
            // enquanto houver mark pendente, sabemos que "a IA está falando"
            const nomeMark = `fala-${++this.contadorMarks}`;
            this.marksPendentes.add(nomeMark);
            if (this.twilioWs.readyState === 1 && this.streamSid) {
                this.twilioWs.send(JSON.stringify({
                    event: 'mark',
                    streamSid: this.streamSid,
                    mark: { name: nomeMark },
                }));
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error(`❌ [CALL ${this.ctx.callId?.slice(0, 8)}] Falha no TTS:`, err.message);
            }
        } finally {
            this.ttsAtivo = null;
        }
    }

    /** Lead começou a falar em cima da fala da IA → corta a fala imediatamente. */
    _bargeIn() {
        this._armarTimerSilencio();
        const iaFalando = this.ttsAtivo !== null || this.marksPendentes.size > 0;
        if (!iaFalando) return;

        this.ttsAtivo?.abortar();
        this.marksPendentes.clear();
        if (this.twilioWs.readyState === 1 && this.streamSid) {
            // 'clear' descarta instantaneamente o áudio bufferizado no lado Twilio
            this.twilioWs.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
        }
    }

    // ── Silêncio / encerramento ─────────────────────────────────────────────

    _armarTimerSilencio() {
        clearTimeout(this._timerSilencio);
        clearTimeout(this._timerDesistir);
        if (this.encerrada) return;
        this._timerSilencio = setTimeout(() => {
            if (this.encerrada) return;
            this._falar(this.leadFalou ? 'Você ainda está aí?' : 'Alô, está me ouvindo?');
            this._timerDesistir = setTimeout(() => this.desligar(this.leadFalou ? 'inconclusive' : 'no_answer'), SILENCIO_DESISTIR_MS);
        }, SILENCIO_REPROMPT_MS);
    }

    _finalizar() {
        if (this.encerrada) return;
        this.encerrada = true;
        clearTimeout(this._timerMaxDuracao);
        clearTimeout(this._timerSilencio);
        clearTimeout(this._timerDesistir);
        this.ttsAtivo?.abortar();
        this.stt.fechar();

        const duracaoSeg = Math.round((Date.now() - this.iniciadaEm) / 1000);
        let outcome = this.outcomeForcado;
        if (!outcome) {
            if (!this.leadFalou) outcome = 'no_answer';
            else if (this.marcouInteresse) outcome = 'callback_requested';
            else outcome = 'inconclusive';
        }

        this.ctx.aoFinalizar({
            callId: this.ctx.callId,
            outcome,
            duracaoSeg,
            transcript: this.transcript,
            ultimoEstagio: this.ultimoEstagio,
            marcouInteresse: this.marcouInteresse,
            pediuNaoLigar: this.pediuNaoLigar,
        }).catch(err => console.error('❌ [CALL] Erro ao finalizar:', err.message));
    }

    _emitir(evento, dados) {
        this.ctx.io?.to(`user:${this.ctx.userId}`).emit(evento, {
            callId: this.ctx.callId,
            leadId: this.ctx.lead?.id,
            leadName: this.ctx.lead?.name,
            ...dados,
        });
    }
}

module.exports = { CallSession };

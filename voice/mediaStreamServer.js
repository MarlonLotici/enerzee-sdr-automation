/**
 * MEDIA STREAM SERVER — WebSocket puro para o Twilio Media Streams.
 *
 * O protocolo do Twilio (<Connect><Stream>) é WebSocket cru com mensagens JSON
 * (connected/start/media/stop/mark) — incompatível com o protocolo do Socket.io.
 * Por isso este servidor usa o pacote `ws` em modo noServer, pendurado no mesmo
 * http.Server do server.js via evento 'upgrade', respondendo só ao path
 * /media-stream/:callId (o Socket.io continua dono do /socket.io/).
 *
 * O callId na URL amarra a conexão ao contexto criado pelo voiceEngine na hora
 * do disparo (lead, regras do chip, callbacks) — conexões sem contexto válido
 * são derrubadas na hora (a URL wss é pública via túnel/Railway).
 */

const { WebSocketServer } = require('ws');
const { CallSession } = require('./callConversationEngine');

const PATH_PREFIX = '/media-stream/';

function initMediaStreamServer(httpServer, obterContextoCall) {
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req, socket, head) => {
        let pathname = '';
        try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { /* url inválida */ }

        if (!pathname.startsWith(PATH_PREFIX)) return; // Socket.io e afins seguem o fluxo normal

        wss.handleUpgrade(req, socket, head, (ws) => {
            const callId = pathname.slice(PATH_PREFIX.length).split('/')[0];
            const ctx = obterContextoCall(callId);

            if (!ctx) {
                console.warn(`⛔ [MEDIA] Conexão recusada: callId desconhecido (${String(callId).slice(0, 8)})`);
                ws.close();
                return;
            }

            console.log(`🎙️ [MEDIA] Stream conectado para call ${callId.slice(0, 8)}`);
            const session = new CallSession(ctx, ws);

            ws.on('message', (raw) => {
                let msg;
                try { msg = JSON.parse(raw.toString()); } catch { return; }

                switch (msg.event) {
                    case 'start':
                        session.aoStreamIniciar(msg.start?.streamSid || msg.streamSid);
                        break;
                    case 'media':
                        if (msg.media?.payload) {
                            session.aoAudioLead(Buffer.from(msg.media.payload, 'base64'));
                        }
                        break;
                    case 'mark':
                        session.aoMarkConfirmado(msg.mark?.name);
                        break;
                    case 'stop':
                        session.aoStreamEncerrar();
                        break;
                    // 'connected' é só o handshake — nada a fazer
                }
            });

            ws.on('close', () => session.aoStreamEncerrar());
            ws.on('error', (err) => {
                console.error(`❌ [MEDIA] Erro no WS da call ${callId.slice(0, 8)}:`, err.message);
                session.aoStreamEncerrar();
            });
        });
    });

    console.log('🎙️ [MEDIA] Servidor Media Streams pronto em /media-stream/:callId');
    return wss;
}

module.exports = { initMediaStreamServer };

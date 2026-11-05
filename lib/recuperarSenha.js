'use strict';
/**
 * RECUPERAÇÃO DE SENHA própria (bug 2026-11-05: "enviamos um link" mas o e-mail nunca chegava).
 *
 * O e-mail de redefinição do Supabase sai pelo SMTP padrão dele (limite baixíssimo, e só entrega p/ membros
 * da equipe do projeto): falha em silêncio. Aqui geramos o link de recuperação com a service key
 * (auth.admin.generateLink — NÃO envia nada) e mandamos o e-mail nós mesmos, pelo Resend, num domínio
 * já verificado. O link é nosso (`/?recuperar=<token_hash>`): o painel troca o token por sessão
 * (verifyOtp) e mostra "Definir nova senha". Não depende da lista de Redirect URLs do Supabase.
 *
 * Segurança: a resposta é SEMPRE a mesma (não revela se o e-mail existe); o chamador aplica rate limit.
 * Puro nas partes de formato (validar e-mail, montar link/e-mail) → testável sem rede.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normaliza e valida. Devolve o e-mail em minúsculas ou null. */
function normalizarEmail(valor) {
    const e = String(valor || '').trim().toLowerCase();
    return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

/** Link que o e-mail leva: abre o painel já com o token de recuperação. */
function montarLinkRecuperacao(baseUrl, tokenHash) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    return `${base}/?recuperar=${encodeURIComponent(tokenHash)}`;
}

/** Assunto + HTML + texto do e-mail de redefinição (pt-BR, sem imagens externas). */
function montarEmailRecuperacao({ link }) {
    const assunto = 'Redefinir sua senha — Antix';
    const texto = `Você pediu para redefinir a senha do painel da Antix.\n\nAbra este link (vale por 1 hora e só funciona uma vez):\n${link}\n\nSe não foi você, ignore este e-mail: sua senha continua a mesma.`;
    const html = `<!doctype html><html lang="pt-br"><body style="margin:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#111;border:1px solid #2a2a2a;border-radius:16px;padding:28px">
<tr><td style="color:#f59e0b;font-weight:800;letter-spacing:2px;font-size:13px">ANTIX</td></tr>
<tr><td style="color:#fff;font-size:20px;font-weight:700;padding:14px 0 8px">Redefinir sua senha</td></tr>
<tr><td style="color:#b5b5b5;font-size:14px;line-height:1.5;padding-bottom:22px">Você pediu para redefinir a senha do painel. O link vale por 1 hora e só funciona uma vez.</td></tr>
<tr><td><a href="${link}" style="display:inline-block;background:#f59e0b;color:#000;text-decoration:none;font-weight:700;font-size:14px;padding:13px 22px;border-radius:10px">Definir nova senha</a></td></tr>
<tr><td style="color:#7a7a7a;font-size:12px;line-height:1.5;padding-top:22px">Se o botão não abrir, copie e cole este endereço no navegador:<br><span style="word-break:break-all;color:#9a9a9a">${link}</span></td></tr>
<tr><td style="color:#7a7a7a;font-size:12px;padding-top:16px">Se não foi você, ignore este e-mail: sua senha continua a mesma.</td></tr>
</table></td></tr></table></body></html>`;
    return { assunto, html, texto };
}

/**
 * Fluxo completo. Dependências injetadas (supabase admin + função de envio) → testável.
 * @returns {Promise<{ok:true, enviado:boolean, motivo?:string}>} nunca lança; `enviado` é só pra log interno.
 */
async function solicitarRecuperacao({ email, baseUrl, supabase, enviarEmail, log = console }) {
    const alvo = normalizarEmail(email);
    if (!alvo) return { ok: true, enviado: false, motivo: 'email_invalido' };
    try {
        const { data, error } = await supabase.auth.admin.generateLink({ type: 'recovery', email: alvo });
        const tokenHash = data?.properties?.hashed_token;
        if (error || !tokenHash) {
            // e-mail sem conta (ou erro): resposta idêntica pro cliente; só o log interno sabe.
            return { ok: true, enviado: false, motivo: error ? 'sem_conta_ou_erro' : 'sem_token' };
        }
        const { assunto, html, texto } = montarEmailRecuperacao({ link: montarLinkRecuperacao(baseUrl, tokenHash) });
        await enviarEmail({ to: alvo, subject: assunto, html, text: texto });
        return { ok: true, enviado: true };
    } catch (e) {
        log.error?.(`❌ [RECUPERAR-SENHA] Falha ao enviar: ${e.message}`);
        return { ok: true, enviado: false, motivo: 'falha_envio' };
    }
}

module.exports = { normalizarEmail, montarLinkRecuperacao, montarEmailRecuperacao, solicitarRecuperacao };

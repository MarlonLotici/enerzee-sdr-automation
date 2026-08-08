'use strict';
// lib/validadores.js — Validadores PUROS dos campos PATCH de instância (sem I/O). Testáveis.
// Usados por server.js na rota PATCH /api/instance/:id. Cada validador recebe a string já
// trimada e devolve truthy (aceita) / falsy (rejeita).

const REGEX_EMAIL_SIMPLES = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CAMPOS_INSTANCE_PATCHAVEIS_TEXTO = {
    // Persona por chip. Vazio no PATCH vira null (reverte pro default do profile).
    // O disparo usa este nome; sem trava de conteúdo além do tamanho (nome/empresa livre).
    agent_name: (v) => v.length >= 1 && v.length <= 60,
    company_name: (v) => v.length >= 1 && v.length <= 80,
    email_prompt: (v) => v.length <= 4000,
    email_from_address: (v) => v.length <= 254 && REGEX_EMAIL_SIMPLES.test(v),
    email_website_url: (v) => v.length <= 500,
    // Só dígitos, 10-13 (DDD+número, com ou sem 55/9). O link wa.me depende disso — número
    // errado/vazio quebra o CTA de todo email. Validação de formato só; o usuário confere o real.
    owner_phone: (v) => /^\d{10,13}$/.test(v.replace(/\D/g, '')) && v.replace(/\D/g, ''),
};

// email_brief: objeto plano (respostas do formulário guiado), com trava de tamanho.
function emailBriefValido(brief) {
    return !!brief && typeof brief === 'object' && !Array.isArray(brief) && JSON.stringify(brief).length <= 6000;
}

module.exports = { CAMPOS_INSTANCE_PATCHAVEIS_TEXTO, emailBriefValido, REGEX_EMAIL_SIMPLES };

'use strict';
// Como a IA chama quem atende a reunião: "consultor" quando o prompt do chip fala assim (ex.: Enerzee); senão "especialista"
// (padrão antigo, usado pela Antix). Função PURA.
function termoEspecialista(instanceData) {
    return /\bconsultor/i.test(String(instanceData?.system_prompt || '')) ? 'consultor' : 'especialista';
}

module.exports = { termoEspecialista };

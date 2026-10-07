// Atualiza foto + perfil comercial do número da Sofia via Cloud API.
// Uso (PowerShell, na pasta do repo):
//   $env:WA_TOKEN="<token do System User>"; node scripts/atualizar_perfil_sofia.js C:\caminho\sofia_perfil.jpg
// Node 18+ (fetch nativo). O token só é lido do ambiente, nunca é impresso.
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.WA_TOKEN;
const APP_ID = process.env.WA_APP_ID || '1255597746733405';
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || '1366136896578904';
const GRAPH = 'https://graph.facebook.com/v25.0';
const img = process.argv[2];

const PERFIL = {
  about: 'Sofia, IA da Antix. Atendo 24h pelo WhatsApp 🤖', // máx. 139 caracteres
  description:
    'Sofia, assistente de IA da Antix. Atendo, qualifico e agendo reuniões pelo WhatsApp 24h por dia — sua empresa nunca mais perde um lead por demora.',
  email: 'atx@antix-colony.com',
  address: 'Florianópolis - SC, Brasil',
  // A Cloud API aceita ATÉ 2 sites. Instagram entra como 2º link (URL limpa, sem tracking).
  websites: ['https://antix-ia.com', 'https://www.instagram.com/antix_ia'],
  vertical: 'PROF_SERVICES',
};

(async () => {
  if (!TOKEN) throw new Error('Defina $env:WA_TOKEN');
  const auth = { Authorization: `Bearer ${TOKEN}` };
  const body = { messaging_product: 'whatsapp', ...PERFIL };

  if (img) {
    const buf = fs.readFileSync(img);
    const type = /\.png$/i.test(img) ? 'image/png' : 'image/jpeg';
    // 1) abre sessão de upload
    let r = await fetch(
      `${GRAPH}/${APP_ID}/uploads?file_length=${buf.length}&file_type=${encodeURIComponent(type)}&file_name=${encodeURIComponent(path.basename(img))}`,
      { method: 'POST', headers: auth }
    );
    let j = await r.json();
    if (!j.id) throw new Error('upload session: ' + JSON.stringify(j));
    // 2) envia os bytes
    r = await fetch(`${GRAPH}/${j.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${TOKEN}`, file_offset: '0' },
      body: buf,
    });
    j = await r.json();
    if (!j.h) throw new Error('upload: ' + JSON.stringify(j));
    body.profile_picture_handle = j.h;
    console.log('✅ foto enviada');
  }

  const r = await fetch(`${GRAPH}/${PHONE_NUMBER_ID}/whatsapp_business_profile`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.log('perfil →', r.status, JSON.stringify(await r.json()));

  const g = await fetch(
    `${GRAPH}/${PHONE_NUMBER_ID}/whatsapp_business_profile?fields=about,description,websites,vertical,profile_picture_url`,
    { headers: auth }
  );
  console.log('estado atual →', JSON.stringify(await g.json(), null, 2));
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});

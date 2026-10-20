# Integrações

## Arquitetura

```
 Cliente ──► app Next.js (Vercel, agenda.seudominio.com) ──► Postgres próprio (Neon/VPS)
                │   ▲
   REST X-API-Key│   │ webhook (HMAC)
                ▼   │
        WA-AKG (VPS/Docker, Baileys + MySQL/Postgres)  ──► WhatsApp
                │
```

`vendor/` guarda a cópia local do WA-AKG usada nos testes (ignorada pelo git).

## WhatsApp — WA-AKG

Cliente: [lib/server/whatsapp.ts](../lib/server/whatsapp.ts). Usa `X-API-Key`. Contrato **verificado contra uma instância real** (v1.6.4):

- `POST /api/sessions {name}` cria a sessão em `STOPPED`; o identificador das demais rotas é o `sessionId` curto (ex.: `ed8dsu`), não o `id` cuid. O app cria **e inicia** (`POST /api/sessions/{sessionId}/start`).
- `GET /api/sessions/{sessionId}/qr` → `{success, qr, base64}` (404 até a sessão chegar em `SCAN_QR`). Status: `STOPPED`, `SCAN_QR`, `CONNECTED`…
- `POST /api/messages/{sessionId}/{jid}/send {message:{text}}` envia texto.
- Webhook de saída: header `X-Webhook-Signature: sha256=<HMAC-SHA256 do corpo>` (lib/webhook.ts do WA-AKG). Em mensagens recebidas o `from` pode ser um LID; o telefone vem em `key.remoteJid`.

> **Não testado:** envio e recebimento com um número realmente pareado (exige escanear o QR com um celular). Testado: criar/listar/iniciar
> sessão, obter o QR real, falha controlada de envio sem pareamento (registrada como `FAILED`) e o webhook de entrada com HMAC.

Dev local usado nos testes: MySQL em Docker (`docker run -d --name wa-akg-mysql -e MYSQL_ROOT_PASSWORD=… -e MYSQL_DATABASE=wa_akg -p 127.0.0.1:3307:3306 mysql:8.0`),
`vendor/wa-akg/.env` com `PORT=3001`, `npx prisma db push`, `node scripts/setup-admin.js <email> <senha>`, `npm run dev`.
A API key é a coluna `User.apiKey` (formato `wag_…`); o painel do WA-AKG gera esse valor em *Settings → API Keys*.

Subir o WA-AKG em uma VPS:

```bash
git clone https://github.com/mrifqidaffaaditya/WA-AKG.git && cd WA-AKG
cp .env.example .env     # defina MYSQL_ROOT_PASSWORD, AUTH_SECRET, BASE_URL=https://wa.seudominio.com, ADMIN_EMAIL/ADMIN_PASSWORD
docker compose up -d     # app em :3000 (coloque Nginx/Caddy com TLS na frente)
```

1. Entre no painel do WA-AKG → *Settings → API Keys* e gere uma chave `wag_…` → `WA_AKG_API_KEY`; `WA_AKG_URL=https://wa.seudominio.com`.
2. No app: `/admin/whatsapp` → criar sessão → *QR Code* → escanear no celular → *Usar esta* → *Enviar teste*.
3. Webhook de entrada (opcional, registra respostas das clientes): no WA-AKG crie um webhook para
   `https://agenda.seudominio.com/api/webhooks/whatsapp`, evento `message.received`, secret = `WA_WEBHOOK_SECRET`.
   O app valida `HMAC-SHA256(corpo)` no header `X-Webhook-Signature`.

Mensagens: confirmação (ao aprovar o sinal), lembrete (cron) e aviso de cancelamento. Falhas ficam no histórico e nunca derrubam a reserva.
Use um número dedicado ao estúdio: automação via Baileys não é oficial e há risco de bloqueio pelo WhatsApp.

## Pagamentos

### Pix (único meio de pagamento)
`lib/pix.ts` gera o BR Code estático (copia-e-cola/QR) direto para a chave do estúdio — sem intermediário e sem taxa.
Como não há API bancária, a confirmação é **manual**: a cliente envia o comprovante e a administradora aprova em
`/admin/pagamentos` após conferir o extrato (a aprovação exige marcar essa conferência). Para confirmação automática de Pix,
será preciso um PSP com API/webhook (Efí, Mercado Pago, Asaas…) — o ponto de extensão é `createDepositPayment` em
`lib/server/payments.ts` + um novo webhook.

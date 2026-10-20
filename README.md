# Sistema Unha — agenda com WhatsApp e pagamento do sinal

Aplicação única (não é SaaS multi-tenant) para um estúdio de beleza: página pública de
agendamento, painel administrativo, confirmação/lembretes por **WhatsApp ([WA-AKG](https://github.com/mrifqidaffaaditya/WA-AKG))**
e cobrança de sinal por **Pix** (QR/copia e cola + comprovante conferido manualmente). Detalhes em
[docs/INTEGRACOES.md](docs/INTEGRACOES.md).

Stack: Next.js 15 (App Router) · TypeScript · Tailwind 4 · Prisma · PostgreSQL. Visual baseado no protótipo `beauty-saas`.

## Rotas

| Rota | O que é |
| --- | --- |
| `/` | Reserva pública: serviços → dia/horário → dados → sinal |
| `/reserva/[token]` | Pix copia-e-cola/QR, envio de comprovante, acompanhamento |
| `/login` | Acesso do administrador |
| `/admin` | Visão geral |
| `/admin/agenda` | Agendamentos (concluir, faltou, cancelar) |
| `/admin/pagamentos` | Análise de comprovantes (aprovar exige conferência no banco) |
| `/admin/servicos` · `/clientes` | CRUD de serviços · lista de clientes |
| `/admin/whatsapp` | Conversas com as clientes e conexão do WhatsApp (QR, sessões, envio e recebimento) |
| `/admin/configuracoes` | Horários, Pix, % do sinal, provedor, mensagens |

## Rodando localmente

```bash
npm install
docker compose up -d db            # Postgres local em 127.0.0.1:54330
cp .env.example .env               # defina SEED_ADMIN_PASSWORD (12+ caracteres)
npm run db:migrate                 # aplica prisma/migrations
SEED_DEMO=1 npm run db:seed        # admin + serviços de exemplo (SEED_DEMO é opcional)
npm run dev                        # http://localhost:3000
```

Sem WA-AKG configurado o app funciona normalmente; as mensagens ficam registradas como `SKIPPED`
em `/admin/whatsapp`. Sem chave Pix configurada, a reserva falha com erro claro (não cria cobrança falsa).

## Testes

```bash
npm run test:db:setup   # uma vez: cria/migra o banco SEPARADO unha_test (Postgres do docker compose precisa estar no ar)
npm test                # Playwright em http://localhost:3100, contra o build de produção (.next-test)
```

Os testes **apagam e recriam dados**, por isso rodam num banco próprio (`unha_test`), em outra porta (3100) e com build próprio:
não tocam no seu banco de desenvolvimento nem no `npm run dev`. Eles se recusam a rodar se o nome do banco não terminar em `_test`.

Cobrem: login, fluxo completo (Pix → comprovante → aprovação → confirmação), regras de horário (atendimentos encaixados sem "buracos",
serviço de 120 min, pausa entre atendimentos, duração que não cabe no expediente, dia fechado, reserva fora do expediente),
agenda em calendário (cancelar, concluído automático), serviços/clientes/pagamentos em cards, personalização, WhatsApp
(integração real com o WA-AKG local, webhook com HMAC) e cron protegido.

## Deploy (subdomínio + banco próprio)

1. **Banco**: crie um Postgres (Neon, Supabase ou VPS). No Neon use a URL *pooled* em `DATABASE_URL` e a direta em `DIRECT_URL`.
   Rode `npm run db:migrate` e `npm run db:seed` apontando para ele (uma vez, da sua máquina).
2. **Vercel**: importe o repositório. Variáveis: `DATABASE_URL`, `DIRECT_URL`, `APP_ORIGIN` (`https://agenda.seudominio.com`),
   `CRON_SECRET`, `WA_AKG_URL`, `WA_AKG_API_KEY`, `WA_WEBHOOK_SECRET`. O build já roda `prisma generate`.
3. **Subdomínio**: em *Settings → Domains* adicione `agenda.seudominio.com` e crie no DNS o `CNAME agenda → cname.vercel-dns.com`.
4. **Lembretes**: [vercel.json](vercel.json) agenda `/api/cron/reminders` de hora em hora (a Vercel envia `Authorization: Bearer $CRON_SECRET`).
   No plano Hobby o mínimo é diário; use um cron externo (cron-job.org, GitHub Actions) com o mesmo header se quiser mais frequência.
5. **O WhatsApp (WA-AKG) não roda na Vercel** (precisa de processo persistente). Hospede-o em uma VPS — veja docs/INTEGRACOES.md.

## Segurança (resumo)

Senhas com scrypt; sessão por token aleatório (hash no banco, cookie HttpOnly, 7 dias); CSRF por Origin; rate limit em login,
reserva e comprovante; comprovantes validados por assinatura de arquivo (PNG/JPG/PDF ≤ 2 MB) e servidos só ao admin;
reserva transacional *Serializable* contra horário duplicado; webhooks com HMAC em tempo constante e idempotência.
O rate limit é em memória (por instância serverless) — para proteção forte coloque também o WAF/Cloudflare na frente.

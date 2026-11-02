# Deploy no Coolify (sem domínio próprio)

Usa `compose.coolify.yaml`: app + Postgres + cron + WA-AKG + MySQL, igual ao ambiente local.
Sem domínio comprado, o Coolify gera endereços `*.sslip.io` que apontam para o IP público do servidor.

> Pré-requisito: o servidor do Coolify precisa ter **IP público** (VPS). Se ele estiver numa rede de casa/escritório,
> os endereços sslip.io apontam para um IP interno, a cliente não acessa de fora e o WA-AKG recusa o webhook.
> Nesse caso use o túnel da Cloudflare (ver docs/REDE-LOCAL.md).

## 1. Criar o recurso

1. Projeto **Saas-unha** → ambiente **production** → apague (ou pare) o recurso antigo `sistema-unha:main`.
2. **New Resource** → **Public Repository** → `https://github.com/GabrielCiloe/sistema-unha`, branch `main`.
3. **Build Pack**: `Docker Compose`. **Docker Compose Location**: `/compose.coolify.yaml`. Continue.

## 2. Domínios (aba General, um campo por serviço)

- Serviço **app**: clique em *Generate Domain* e troque `http://` por `https://` (ex.: `https://agenda.203-0-113-10.sslip.io`).
  Se o campo pedir porta, use `:3000` no final.
- Serviço **waakg**: idem (ex.: `https://wa.203-0-113-10.sslip.io`).
- Os demais serviços (db, cron, waakgdb) ficam sem domínio.

O `https` é necessário: o cookie de login exige HTTPS e o WA-AKG só aceita webhook HTTPS. O Coolify emite o certificado
(Let's Encrypt) sozinho no primeiro acesso.

## 3. Variáveis (aba Environment Variables)

| Variável | Valor |
| --- | --- |
| `APP_ORIGIN` | o domínio do serviço app, exatamente igual, sem barra no final |
| `WA_AKG_PUBLIC_URL` | o domínio do serviço waakg |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | login do painel do estúdio (senha com 12+ caracteres) |
| `WA_AKG_ADMIN_EMAIL` / `WA_AKG_ADMIN_PASSWORD` | login do painel do WA-AKG |
| `WA_AKG_API_KEY` | deixe vazio agora; preenchido no passo 5 |

As senhas dos bancos e os segredos (`SERVICE_PASSWORD_*`, `SERVICE_BASE64_*`) o Coolify gera e guarda sozinho.

## 4. Primeiro deploy

**Deploy**. O primeiro build demora (o WA-AKG é construído do zero). Quando tudo estiver *Running*:

- Terminal do Coolify → container **app** → `node prisma/seed.mjs` (com `SEED_DEMO=1` antes cria 3 serviços de exemplo).
- Abra `APP_ORIGIN/login` e entre com o `SEED_ADMIN_*`.

## 5. Ligar o WhatsApp

1. Abra `WA_AKG_PUBLIC_URL`, entre com `WA_AKG_ADMIN_*` → **Settings → API Keys** → gere a chave (`wag_...`).
2. Cole em `WA_AKG_API_KEY` no Coolify e faça **Redeploy**.
3. No app: **Admin → WhatsApp → Conectar WhatsApp** → escaneie o QR com o celular do estúdio.
4. Ligue **Receber mensagens das clientes** (registra o webhook; comprovantes enviados pelo WhatsApp passam a entrar sozinhos).
5. Em **Configurações**: telefone do estúdio, chave Pix, horários. Em **Personalização**: logo e cores.

## Levar os dados do computador local (opcional)

```bash
# no computador local
docker compose -f compose.local.yaml exec -T db pg_dump -U unha -d unha --clean --if-exists > unha.sql
# no servidor (Terminal do Coolify, container db), depois de copiar o arquivo para lá
psql -U unha -d unha < unha.sql
```

A sessão do WhatsApp não é copiada: no servidor o QR é escaneado de novo.

## Quando comprar um domínio

Aponte um registro `A` (ex.: `agenda.seudominio.com.br`) para o IP do servidor, troque o domínio do serviço app no Coolify,
atualize `APP_ORIGIN`, faça Redeploy e religue "Receber mensagens das clientes" (o webhook passa a usar o novo endereço).

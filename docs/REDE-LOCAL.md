# Rodando na rede local (Docker Desktop)

Sobe tudo de uma vez: app (Next.js), Postgres, cron de lembretes, WA-AKG (WhatsApp) e MySQL.

```bash
docker compose -f compose.local.yaml up -d --build
```

Variáveis ficam no `.env` da raiz (não versionado). As que importam para a rede local:

| Variável | Para quê |
| --- | --- |
| `LAN_IP` / `APP_ORIGIN` | IP desta máquina na rede (ex.: `192.168.3.82`). O app só aceita POST vindos dessa origem (CSRF) e usa o valor para registrar o webhook no WA-AKG. Se o IP mudar (DHCP), atualize e rode `docker compose -f compose.local.yaml up -d app`. |
| `WA_AKG_PUBLIC_URL` | Endereço do painel do WA-AKG na rede (`http://<LAN_IP>:3001`). |
| `WA_AKG_API_KEY` | Chave `wag_…` gravada na coluna `User.apiKey` do MySQL do WA-AKG. O app a envia como `X-API-Key`. |
| `SEED_ADMIN_*` | Primeiro administrador do app (criado por `node prisma/seed.mjs` dentro do container). |
| `WA_AKG_ADMIN_*` | Login do painel do WA-AKG. |

## Endereços

| Serviço | Na rede local | Só nesta máquina |
| --- | --- | --- |
| Agenda (clientes) | `http://<LAN_IP>:3000` | mesmo endereço (use o IP, não `localhost`, por causa do CSRF) |
| Painel admin | `http://<LAN_IP>:3000/admin` | |
| Painel WA-AKG | `http://<LAN_IP>:3001` | |
| Postgres | | `127.0.0.1:54330` (unha / local-development-only) |
| MySQL do WA-AKG | | `127.0.0.1:3307` (root / `WA_AKG_MYSQL_ROOT_PASSWORD`) |

## Primeira vez

1. `docker compose -f compose.local.yaml up -d --build`
2. Criar o admin do app: `docker compose -f compose.local.yaml exec app node prisma/seed.mjs` (com `SEED_DEMO=1` cria 3 serviços de exemplo).
3. Gravar a chave de API no WA-AKG (uma vez, depois que o container `wa-akg` criou o admin):
   `docker compose -f compose.local.yaml exec wa-akg-db mysql -uroot -p$WA_AKG_MYSQL_ROOT_PASSWORD wa_akg -e "UPDATE User SET apiKey='$WA_AKG_API_KEY' WHERE email='$WA_AKG_ADMIN_EMAIL'"`
4. Entrar em `/admin` → Configurações → preencher a chave Pix (sem ela a reserva recusa) → WhatsApp → **Conectar WhatsApp** → escanear o QR com o celular do estúdio.

## Comandos úteis

```bash
docker compose -f compose.local.yaml ps                  # estado dos 5 containers
docker compose -f compose.local.yaml logs -f app         # logs do app
docker compose -f compose.local.yaml logs -f wa-akg      # logs do WhatsApp
docker compose -f compose.local.yaml restart app         # após mudar o .env
docker compose -f compose.local.yaml down                # para tudo (dados ficam nos volumes)
docker compose -f compose.local.yaml down -v             # para tudo e APAGA os dados
```

## Acesso pela internet (túnel rápido da Cloudflare)

`.\scripts	unel-rapido.ps1` (PowerShell, na raiz) sobe um túnel `https://<aleatório>.trycloudflare.com` → `localhost:3000`,
grava esse endereço em `APP_ORIGIN` e reinicia o app. Não precisa de conta nem domínio. O endereço muda a cada execução
(reinício do PC, fechar o processo): rode o script de novo e mande o link novo. Com HTTPS público o webhook do WhatsApp
("Receber mensagens das clientes") funciona. Para endereço fixo, coloque um domínio na Cloudflare e use o túnel nomeado `saas-unha`
já criado (serviço `cloudflared` do Windows) com um Public Hostname apontando para `http://localhost:3000`.

## Limitações conhecidas em HTTP na rede local

- **Receber mensagens das clientes (webhook) não funciona.** O WA-AKG recusa webhooks `http://` e para IPs privados
  (proteção anti-SSRF em `src/lib/security.ts`, `allowHttp: false` fixo). O envio (confirmação, lembrete, cancelamento,
  conversas iniciadas pelo painel) funciona normalmente. Para receber respostas, exponha o app por HTTPS com nome público
  (túnel como Cloudflare Tunnel/ngrok, ou um proxy com TLS) e aponte `APP_ORIGIN` para ele.
- O cookie de sessão do admin só leva a flag `Secure` quando `APP_ORIGIN` começa com `https://` (ajuste em
  `lib/server/auth.ts`); sem isso o navegador descartaria o cookie em `http://<IP>` e o login não funcionaria.

Firewall: a regra "Docker Desktop Backend" (entrada, perfil Público) já libera as portas publicadas. Se outro
aparelho não alcançar a porta 3000, confira se a rede Wi-Fi não isola clientes (AP isolation) e se essa regra está ativa.

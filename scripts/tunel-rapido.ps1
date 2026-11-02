# Expõe o app na internet com um túnel rápido da Cloudflare (sem conta nem domínio).
# O endereço https://xxxx.trycloudflare.com muda a cada execução: o script atualiza APP_ORIGIN no .env
# e reinicia o container do app para o CSRF e o webhook do WhatsApp usarem o novo endereço.
#
# Uso (PowerShell, na raiz do projeto):  .\scripts\tunel-rapido.ps1
# Deixe a janela aberta: fechar encerra o túnel.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cf = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $cf)) { $cf = (Get-Command cloudflared -ErrorAction Stop).Source }
$log = Join-Path $env:TEMP "cloudflared-quick.log"
if (Test-Path $log) { Remove-Item $log -Force }

$p = Start-Process -FilePath $cf -ArgumentList @("tunnel", "--no-autoupdate", "--url", "http://localhost:3000", "--logfile", $log) -PassThru -WindowStyle Hidden
Write-Host "cloudflared iniciado (PID $($p.Id)); aguardando o endereço..."

$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
}
if (-not $url) { Stop-Process -Id $p.Id -Force; throw "O túnel não devolveu um endereço em 60 s. Veja $log" }

$envFile = Join-Path $root ".env"
$content = Get-Content $envFile -Raw
$content = [regex]::Replace($content, "(?m)^APP_ORIGIN=.*$", "APP_ORIGIN=$url")
[System.IO.File]::WriteAllText($envFile, $content, (New-Object System.Text.UTF8Encoding($false)))  # UTF-8 sem BOM
Write-Host "APP_ORIGIN=$url gravado no .env; reiniciando o app..."

Push-Location $root
docker compose -f compose.local.yaml up -d app | Out-Null
Pop-Location

Write-Host ""
Write-Host "Link público: $url"
Write-Host "Painel:       $url/admin"
Write-Host "Para encerrar: Stop-Process -Id $($p.Id)"

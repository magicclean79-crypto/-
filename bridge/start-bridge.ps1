# CTO Bridge 실행 — PC 재부팅·세션 종료 후 복구용
#
#   powershell -ExecutionPolicy Bypass -File bridge\start-bridge.ps1
#
# 하는 일:
#   1. 4200 포트에 남은 옛 서버를 정리한다 (옛 프로세스가 살아 있으면
#      인증 없는 예전 코드가 요청을 가로챈다 — 실측 사고, 2026-08-09)
#   2. 인증 토큰이 없으면 만든다
#   3. Bridge 서버를 띄운다
#   4. cloudflared 터널을 띄우고 공개 주소를 bridge\tunnel-url.txt 에 적는다
#
# 주의: cloudflared 임시 터널은 **띄울 때마다 주소가 바뀐다.**
#       바뀐 주소를 bridge\openapi.yaml 과 ChatGPT Actions 설정에 넣어야 한다.

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$bridge = Join-Path $repo "bridge"
$secrets = Join-Path $bridge ".secrets"
$tokenFile = Join-Path $secrets "bridge-token.txt"
$urlFile = Join-Path $bridge "tunnel-url.txt"
$cloudflared = "$env:LOCALAPPDATA\cloudflared\cloudflared.exe"
$port = 4200
$boardPort = 4201

Write-Host "== CTO Bridge 시작 ==" -ForegroundColor Cyan

# 1. 옛 서버 정리
foreach ($p in @($port, $boardPort)) {
  $existing = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  foreach ($conn in $existing) {
    Write-Host "  기존 $p 점유 프로세스 종료 (PID $($conn.OwningProcess))"
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
  ForEach-Object {
    Write-Host "  기존 터널 종료 (PID $($_.ProcessId))"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Seconds 2

# 2. 토큰 준비
if (-not (Test-Path $secrets)) { New-Item -ItemType Directory -Force $secrets | Out-Null }
if (-not (Test-Path $tokenFile)) {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  ($bytes | ForEach-Object { $_.ToString("x2") }) -join "" | Set-Content $tokenFile -Encoding utf8 -NoNewline
  Write-Host "  토큰 새로 만듦"
} else {
  Write-Host "  기존 토큰 사용"
}

# 3. Bridge 서버
Start-Process -FilePath "node" -ArgumentList "bridge/bridge-server.mjs" -WorkingDirectory $repo -WindowStyle Hidden
Write-Host "  Bridge 서버 시작 (포트 $port)"

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}
if (-not $ready) { Write-Error "Bridge 서버가 뜨지 않았습니다."; exit 1 }
Write-Host "  Bridge 서버 정상" -ForegroundColor Green

# 3-1. 현황판 (사람이 브라우저에서 보는 화면 — 이 PC에서만, 터널에 연결 안 함)
Start-Process -FilePath "node" -ArgumentList "bridge/bridge-board.mjs" -WorkingDirectory $repo -WindowStyle Hidden
Write-Host "  현황판 시작 (http://localhost:$boardPort)"

# 4. 터널
if (-not (Test-Path $cloudflared)) {
  Write-Error "cloudflared가 없습니다: $cloudflared"
  Write-Host "  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe 에서 받아 위 경로에 두십시오."
  exit 1
}
$log = Join-Path $env:TEMP "cloudflared-bridge.log"
if (Test-Path $log) { Remove-Item $log -Force }
Start-Process -FilePath $cloudflared `
  -ArgumentList "tunnel","--url","http://127.0.0.1:$port","--no-autoupdate","--logfile",$log `
  -WindowStyle Hidden
Write-Host "  터널 시작 — 주소 생성 대기"

$url = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue |
         Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value; break }
  }
}
if (-not $url) { Write-Error "터널 주소를 얻지 못했습니다. 로그: $log"; exit 1 }

$url | Set-Content $urlFile -Encoding utf8 -NoNewline
$token = (Get-Content $tokenFile -Raw).Trim()

# 5. ChatGPT에 붙여넣을 명세를 만든다.
#
# 저장소에 커밋되는 bridge\openapi.yaml 에는 **자리표시자**가 들어 있다 —
# 임시 터널 주소는 띄울 때마다 바뀌는 환경 종속 값이라 Git에 남기지 않는다
# (사장님 결정, 2026-08-09). 실제 주소는 여기서 채워 별도 파일로 만든다.
$specSrc = Join-Path $bridge "openapi.yaml"
$specOut = Join-Path $bridge "openapi.live.yaml"
if (Test-Path $specSrc) {
  (Get-Content $specSrc -Raw) -replace 'https://CHANGE-ME\.trycloudflare\.com', $url |
    Set-Content $specOut -Encoding utf8 -NoNewline
  Write-Host "  ChatGPT에 붙여넣을 명세: $specOut"
}

Write-Host ""
Write-Host "공개 주소: $url" -ForegroundColor Green
Write-Host "인증 토큰: $token"
Write-Host ""
Write-Host "현황판: http://localhost:$boardPort" -ForegroundColor Green
Write-Host ""
Write-Host "다음을 하십시오:"
Write-Host "  1. ChatGPT 커스텀 GPT의 Actions 에 bridge\openapi.live.yaml 을 붙여넣는다"
Write-Host "     (openapi.yaml 이 아니라 .live.yaml 입니다 — 주소가 채워진 쪽)"
Write-Host "  2. 인증을 API Key / Bearer 로 두고 위 토큰을 넣는다"

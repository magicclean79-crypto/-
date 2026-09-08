# Image Studio 고정 사람검증 환경 (T1-63) — 항상 같은 코드 + 같은 데이터
#
#   pnpm run studio:start   (= pnpm run studio:verify, 같은 스크립트)
#   powershell -ExecutionPolicy Bypass -File scripts\start-verify-studio.ps1
#
# 이 스크립트는 3100(Web)·4100(API)을 띄우는 **공식 단일 진입점**이다
# (T1-201). 동기식이다 — 끝까지 실행되면 API/Web이 실제로 응답 가능한
# 상태라는 뜻이다. **background로 실행하고 응답을 기다리지 않은 채 다음
# 단계로 넘어가지 않는다** — T1-198·T1-199가 이 스크립트를 백그라운드로
# 띄운 뒤 폴링하지 않고 "기다리겠다"고만 말한 채 결과 기록 없이 끝난
# 사고가 반복됐다(bridge/results/T1-198.json·T1-199.json). 이미 같은
# 커밋으로 떠 있으면 재빌드 없이 즉시 반환하므로(아래 0-2) background로
# 돌릴 이유 자체가 없다.
#
# 역할 구분 (T1-204, docs/DEVELOPMENT_ENVIRONMENT.md §26) — 이 스크립트
# (studio:start)와 `pnpm run verify:all`을 혼동하지 않는다:
#   - studio:start = **사람이 브라우저로 접속할 서버를 계속 띄워 둔다.**
#     스크립트 자신은 기동 확인 후 끝나지만, 자식 프로세스(API·Web)는
#     `Start-Process`로 완전히 분리(detached)되어 부모(이 스크립트·이를
#     호출한 셸)가 끝나도 계속 산다. 사람이 다시 쓸 것이므로
#     `pnpm run studio:stop`으로 명시적으로 내리기 전까지 유지한다.
#   - verify:all = **자동 검증 1회용.** studio:start를 내부에서 호출해
#     서버를 띄운 뒤 build/typecheck/lint/test까지 한 번에 돌리고
#     끝난다 — 검증이 끝났다고 서버를 내리지도 않지만, "사람이 계속
#     쓸 서버를 보장한다"는 것이 이 명령의 책임은 아니다. 사람이 볼
#     서버가 필요하면 항상 studio:start를 기준으로 삼는다.
#   - **재부팅하면 이 스크립트가 띄운 프로세스도 함께 죽는다** — 일반
#     사용자 프로세스이지 Windows 서비스가 아니기 때문이다(PostgreSQL과
#     다름). 재부팅 후 자동 복구는 `ACOS-Recovery-Manager` 스케줄러가
#     맡지만, 2026-08-31 실제 재부팅에서 그 스케줄러 자신이 로컬
#     API/Web 단계에 이르기 전에 Windows Task Scheduler에 의해
#     종료된 사례가 실측됐다(§26) — 자동 복구가 실패했을 수 있으니
#     재부팅 후에는 `pnpm run studio:start`를 사람이 직접 한 번
#     실행해 확인하는 것이 안전하다.
#
# 목적:
#   사람이 http://localhost:3100/image-studio 를 열 때마다 항상
#   ① 지금 이 워크트리(현재 커밋)의 코드 ② 로컬 PostgreSQL/MinIO의
#   같은 데이터 ③ 같은 API 포트(4100)·같은 Studio 포트(3100)를 보게
#   고정한다.
#
# 왜 production build(next build + next start)를 쓰는가:
#   기존에는 `next dev`(포트 3100)를 띄워 두고 검증했다. 그런데 이
#   워크트리는 여러 Bridge 세션이 동시에 코드를 계속 고치는 곳이다
#   (docs/PROJECT_MEMORY.md M-28). `next dev`는 파일이 바뀌면 그 자리에서
#   즉시 재컴파일해 사람이 보는 화면이 검증 도중에도 바뀔 수 있다 —
#   이것이 "Image Studio가 매번 다른 상태로 바뀐다"는 증상의 유력한
#   원인이다(T1-62가 조사 중인 것과 별개로, 이 스크립트는 재발 자체를
#   구조적으로 막는다). production build는 스크립트를 실행한 시점의
#   코드를 스냅샷으로 고정하므로, 다른 세션이 그 이후 파일을 고쳐도
#   이미 뜬 화면은 바뀌지 않는다. 최신 코드를 보려면 이 스크립트를
#   다시 실행해야 한다 — 그것이 의도한 동작이다.
#
# 하는 일:
#   1. 3100·4100 포트만 정리한다 (3000·4000 SSH 터널, 5432 PostgreSQL,
#      9000 MinIO, 4200·4201 Bridge는 절대 건드리지 않는다)
#   2. 로컬 PostgreSQL(5432)·MinIO(9000)가 떠 있는지 확인만 한다 —
#      떠 있지 않으면 이 스크립트가 대신 띄우지 않고 즉시 멈춘다
#      (이 프로젝트가 관리하는 서비스가 아니다)
#   3. API를 빌드하고(prisma generate + nest build) PORT=4100으로 띄운다
#   4. Web을 NEXT_PUBLIC_API_URL=http://localhost:4100 으로 빌드하고
#      PORT=3100으로 띄운다(next start — 고정 스냅샷)
#   5. /health(API)·/login(Web) 응답을 확인한다
#   6. 무엇을 띄웠는지(커밋·시각·포트·Benchmark ID)를
#      scripts\.verify-studio-status.json 에 기록한다(git 추적 대상 아님)
#
# 사람 검증용 고정 데이터:
#   apps/web/app/benchmark/constants.ts 의 BENCHMARK_IMAGE_IDS(로컬 DB,
#   사람 승인됨) — 이 스크립트가 만들거나 바꾸지 않는다. 이 파일은
#   사람 승인 없이 수정 금지 대상이다.

param(
  # 이미 같은 커밋으로 정상 응답 중이어도 강제로 죽이고 다시 빌드·기동한다.
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$apiPort = 4100
$webPort = 3100
$logDir = if (Test-Path "D:\dev-data") { "D:\dev-data\logs\verify-studio" } else { Join-Path $PSScriptRoot ".verify-studio-logs" }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$apiOutLog = Join-Path $logDir "api.out.log"
$apiErrLog = Join-Path $logDir "api.err.log"
$webOutLog = Join-Path $logDir "web.out.log"
$webErrLog = Join-Path $logDir "web.err.log"

Write-Host "== Image Studio 고정 검증 환경 시작 (T1-63, idempotent 기동 T1-201) ==" -ForegroundColor Cyan

# 0. 전제 서비스 확인 — 이 스크립트가 대신 띄우지 않는다
function Test-Port($port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-Port 5432)) {
  Write-Error "로컬 PostgreSQL(5432)이 떠 있지 않습니다. 먼저 PostgreSQL 서비스를 확인하십시오."
  exit 1
}
if (-not (Test-Port 9000)) {
  Write-Error "로컬 MinIO(9000)가 떠 있지 않습니다. 먼저 MinIO를 확인하십시오."
  exit 1
}
Write-Host "  전제 서비스 확인됨 — PostgreSQL(5432)·MinIO(9000)" -ForegroundColor Green

# 0-1. SSH 터널·Bridge는 절대 건드리지 않는다는 것을 명시적으로 남긴다
foreach ($p in @(3000, 4000, 4200, 4201)) {
  if (Test-Port $p) {
    Write-Host "  포트 $p 는 건드리지 않는다 (SSH 터널 또는 Bridge)"
  }
}

# 0-2. Idempotent 단축 경로(T1-201) — 이미 이 커밋으로 3100/4100이 정상
# 응답 중이면 재빌드·재기동을 건너뛴다. apps/api build(prisma generate +
# nest build)·apps/web build(next build)가 매번 수 분 걸려, 이전 세션들이
# "빌드가 끝날 때까지 background로 기다리겠다"며 결과 기록 없이 멈추는
# 사고로 이어졌다(bridge/results/T1-198.json·T1-199.json). 코드가 그대로면
# 다시 빌드할 이유가 없다 — -Force로 이 단축 경로를 끌 수 있다.
$statusFile = Join-Path $PSScriptRoot ".verify-studio-status.json"
$currentCommit = (git -C $repo rev-parse HEAD).Trim()
if (-not $Force -and (Test-Path $statusFile) -and (Test-Port $apiPort) -and (Test-Port $webPort)) {
  try {
    $prev = Get-Content $statusFile -Raw | ConvertFrom-Json
    if ($prev.commit -eq $currentCommit) {
      $apiOk = $false; $webOk = $false
      try { $r = Invoke-WebRequest "http://127.0.0.1:$apiPort/health" -UseBasicParsing -TimeoutSec 3; $apiOk = ($r.StatusCode -eq 200) } catch { }
      try { $r = Invoke-WebRequest "http://127.0.0.1:$webPort/login" -UseBasicParsing -TimeoutSec 3; $webOk = ($r.StatusCode -eq 200) } catch { }
      if ($apiOk -and $webOk) {
        Write-Host "  이미 같은 커밋($currentCommit)으로 API(4100)·Web(3100)이 정상 응답 중 — 재빌드 생략" -ForegroundColor Green
        Write-Host ""
        Write-Host "고정 검증 주소: http://localhost:$webPort/image-studio" -ForegroundColor Green
        Write-Host "커밋: $currentCommit ($($prev.branch))"
        Write-Host "재빌드하려면 -Force 를 붙여 다시 실행하십시오."
        exit 0
      }
    }
  } catch {
    Write-Host "  이전 상태 파일을 읽지 못해 idempotent 단축 경로를 건너뜁니다 — 처음부터 다시 기동합니다." -ForegroundColor Yellow
  }
}

# 1. 3100·4100만 정리한다
foreach ($p in @($webPort, $apiPort)) {
  $existing = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  foreach ($conn in $existing) {
    $procInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue
    Write-Host "  기존 포트 $p 점유 프로세스 종료 (PID $($conn.OwningProcess): $($procInfo.CommandLine))"
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 2

# 2. API 빌드 + 기동
Write-Host "  API 빌드 중 (prisma generate + nest build)..."
Push-Location (Join-Path $repo "apps\api")
try {
  pnpm run build
  if ($LASTEXITCODE -ne 0) { throw "apps/api build 실패" }
} finally {
  Pop-Location
}

$env:PORT = "$apiPort"
# WEB_URL이 없으면 apps/api/.env 기본값(http://localhost:3000)으로 CORS가
# 고정돼, 이 스크립트가 띄우는 Web(포트 $webPort)에서 오는 모든 요청이
# 데이터가 있어도 브라우저에서 막힌다(PROJECT_MEMORY.md M-39, T1-62 실측).
$env:WEB_URL = "http://localhost:$webPort"
Remove-Item $apiOutLog, $apiErrLog -ErrorAction SilentlyContinue
$apiProc = Start-Process -FilePath "node" -ArgumentList "dist/main.js" `
  -WorkingDirectory (Join-Path $repo "apps\api") -WindowStyle Hidden `
  -RedirectStandardOutput $apiOutLog -RedirectStandardError $apiErrLog -PassThru
Remove-Item Env:\PORT -ErrorAction SilentlyContinue
Remove-Item Env:\WEB_URL -ErrorAction SilentlyContinue
Write-Host "  API 시작 (PID $($apiProc.Id), 포트 $apiPort, 로그: $apiOutLog)"

$apiReady = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:$apiPort/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $apiReady = $true; break }
  } catch { }
}
if (-not $apiReady) {
  Write-Error "API(4100)가 뜨지 않았습니다. 최근 로그:"
  Write-Host "----- $apiErrLog (마지막 40줄) -----" -ForegroundColor Yellow
  Get-Content $apiErrLog -Tail 40 -ErrorAction SilentlyContinue | Write-Host
  Write-Host "----- $apiOutLog (마지막 40줄) -----" -ForegroundColor Yellow
  Get-Content $apiOutLog -Tail 40 -ErrorAction SilentlyContinue | Write-Host
  exit 1
}
Write-Host "  API 정상 (http://localhost:$apiPort/health)" -ForegroundColor Green

# 3. Web 빌드(고정 스냅샷) + 기동
Write-Host "  Web 빌드 중 (NEXT_PUBLIC_API_URL=http://localhost:$apiPort)..."
Push-Location (Join-Path $repo "apps\web")
try {
  $env:NEXT_PUBLIC_API_URL = "http://localhost:$apiPort"
  pnpm run build
  if ($LASTEXITCODE -ne 0) { throw "apps/web build 실패" }
} finally {
  Remove-Item Env:\NEXT_PUBLIC_API_URL -ErrorAction SilentlyContinue
  Pop-Location
}

$env:PORT = "$webPort"
# node_modules/.bin/next 는 POSIX sh 쉼(shebang #!/bin/sh)이라
# node.exe로 직접 실행할 수 없다 — next 패키지의 실제 JS 진입점을 쓴다.
Remove-Item $webOutLog, $webErrLog -ErrorAction SilentlyContinue
$webProc = Start-Process -FilePath "node" `
  -ArgumentList "node_modules/next/dist/bin/next", "start", "-p", "$webPort" `
  -WorkingDirectory (Join-Path $repo "apps\web") -WindowStyle Hidden `
  -RedirectStandardOutput $webOutLog -RedirectStandardError $webErrLog -PassThru
Remove-Item Env:\PORT -ErrorAction SilentlyContinue
Write-Host "  Web 시작 (PID $($webProc.Id), 포트 $webPort, 로그: $webOutLog)"

$webReady = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:$webPort/login" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $webReady = $true; break }
  } catch { }
}
if (-not $webReady) {
  Write-Error "Web(3100)이 뜨지 않았습니다. 최근 로그:"
  Write-Host "----- $webErrLog (마지막 40줄) -----" -ForegroundColor Yellow
  Get-Content $webErrLog -Tail 40 -ErrorAction SilentlyContinue | Write-Host
  Write-Host "----- $webOutLog (마지막 40줄) -----" -ForegroundColor Yellow
  Get-Content $webOutLog -Tail 40 -ErrorAction SilentlyContinue | Write-Host
  exit 1
}
Write-Host "  Web 정상 (http://localhost:$webPort)" -ForegroundColor Green

# 4. 상태 기록 (git 추적 대상 아님 — 이 PC·이 실행 시점에만 뜻이 있는 값)
$commit = (git -C $repo rev-parse HEAD).Trim()
$branch = (git -C $repo rev-parse --abbrev-ref HEAD).Trim()
$status = [ordered]@{
  startedAt      = (Get-Date).ToString("o")
  commit         = $commit
  branch         = $branch
  apiPort        = $apiPort
  webPort        = $webPort
  apiPid         = $apiProc.Id
  webPid         = $webProc.Id
  apiUrl         = "http://localhost:$apiPort"
  webUrl         = "http://localhost:$webPort"
  imageStudioUrl = "http://localhost:$webPort/image-studio"
  buildMode      = "production (next build + next start / nest build + node dist/main.js)"
  benchmarkConstantsFile = "apps/web/app/benchmark/constants.ts"
  note           = "이 파일이 가리키는 코드는 startedAt 시점의 스냅샷이다. 이후 워크트리 코드가 바뀌어도 이 서버는 재실행 전까지 그대로 유지된다. apiPid/webPid는 이 스크립트가 직접 시작한 프로세스만 가리킨다 — 다음 실행이 3100/4100을 정리할 때도 이 두 포트만 건드린다(T1-202)."
}
$statusFile = Join-Path $PSScriptRoot ".verify-studio-status.json"
$status | ConvertTo-Json | Set-Content $statusFile -Encoding utf8

Write-Host ""
Write-Host "고정 검증 주소: http://localhost:$webPort/image-studio" -ForegroundColor Green
Write-Host "커밋: $commit ($branch)"
Write-Host "상태 기록: $statusFile"
Write-Host ""
Write-Host "최신 코드로 갱신하려면 이 스크립트를 다시 실행하십시오."

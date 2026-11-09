# Image Studio 사람검증 환경 종료 (T1-204) — studio:start의 짝
#
#   powershell -ExecutionPolicy Bypass -File scripts\studio-stop.ps1
#
# scripts\start-verify-studio.ps1(studio:start)이 띄운 API(4100)·
# Web(3100) 프로세스만 정리한다. 3000·4000(SSH 터널)·5432(PostgreSQL)·
# 9000(MinIO)·4200·4201(Bridge)은 절대 건드리지 않는다.
#
# 정지 대상을 고르는 순서:
#   1. scripts\.verify-studio-status.json 에 기록된 apiPid/webPid가
#      살아 있고 실제로 그 포트를 점유 중이면 그 PID를 정지한다
#      (엉뚱한 프로세스를 죽이지 않기 위한 이중 확인).
#   2. 상태 파일이 없거나 PID가 이미 죽었으면, 지금 3100/4100을 점유한
#      프로세스를 그대로 정지한다(포트 기준 폴백).
#
# Node.js 프로세스는 콘솔이 없는 백그라운드 프로세스라 Windows에는
# 진짜 SIGTERM 등가물이 없다 — Stop-Process가 사실상 유일한 방법이다.
# 먼저 일반 Stop-Process를 시도하고, 포트가 여전히 열려 있으면
# -Force로 한 번 더 시도한다.

param(
  [switch]$Quiet
)

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
$apiPort = 4100
$webPort = 3100
$statusFile = Join-Path $PSScriptRoot ".verify-studio-status.json"

function Test-Port($port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Get-PidsOnPort($port) {
  return (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
}

Write-Host "== Image Studio 검증 환경 종료 (T1-204) ==" -ForegroundColor Cyan

$targetPids = New-Object System.Collections.Generic.HashSet[int]

$fromStatusFile = $false
if (Test-Path $statusFile) {
  try {
    $status = Get-Content $statusFile -Raw | ConvertFrom-Json
    foreach ($candidate in @($status.apiPid, $status.webPid)) {
      if ($candidate -and (Get-Process -Id $candidate -ErrorAction SilentlyContinue)) {
        [void]$targetPids.Add([int]$candidate)
        $fromStatusFile = $true
      }
    }
  } catch {
    Write-Host "  상태 파일을 읽지 못했습니다 — 포트 기준으로 폴백합니다: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

foreach ($port in @($apiPort, $webPort)) {
  foreach ($p in (Get-PidsOnPort $port)) {
    if ($p) { [void]$targetPids.Add([int]$p) }
  }
}

if ($targetPids.Count -eq 0) {
  Write-Host "  3100/4100 모두 이미 내려가 있습니다 — 할 일이 없습니다." -ForegroundColor Green
  exit 0
}

Write-Host ("  정지 대상 PID: {0} (상태 파일 근거: {1})" -f (($targetPids | Sort-Object) -join ", "), $fromStatusFile)

foreach ($p in $targetPids) {
  try {
    Stop-Process -Id $p -ErrorAction Stop
  } catch {
    Write-Host "    PID $p 일반 종료 실패, 강제 종료 시도: $($_.Exception.Message)" -ForegroundColor Yellow
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
  }
}

Start-Sleep -Seconds 2

$stillUp = @()
foreach ($port in @($apiPort, $webPort)) {
  if (Test-Port $port) { $stillUp += $port }
}

if ($stillUp.Count -gt 0) {
  Write-Host ("  아직 응답 중인 포트: {0} — 다시 확인하십시오." -f ($stillUp -join ", ")) -ForegroundColor Red
  exit 1
}

Write-Host "  API(4100)·Web(3100) 모두 정지 확인됨." -ForegroundColor Green
exit 0

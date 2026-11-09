# ACOS Recovery Manager (T1-109) — 재부팅 후 단일 복구 진입점
# T1-205(2026-09-01) 갱신 — 재부팅 실측(2026-08-31 09:09)에서 Task
# Scheduler가 이 작업을 PostgreSQL 확인 직후 SCHED_S_TASK_TERMINATED
# (267014)로 강제 종료한 사실이 드러나(§ 아래), 그 상태에서도 살아남도록
# 구조를 바꿨다. 상세 근거는 docs/DEVELOPMENT_ENVIRONMENT.md §26-B(T1-205).
#
#   powershell -ExecutionPolicy Bypass -File scripts\acos-recovery-manager.ps1
#
# 이 스크립트는 새 서비스를 새로 만들지 않는다. 이미 있는 부품을
# 의존성 순서대로 "확인하고, 죽어 있을 때만" 기동한다.
#
#   PostgreSQL(서비스, 이미 자동)
#     -> MinIO           (scripts\start-minio.ps1, 이미 있음, T1-74)
#     -> Bridge+현황판+터널 (bridge\start-bridge.ps1, 이미 있음, T1-105가 근본원인 수정)
#     -> CTO Worker        (ACOS-CTO-Worker 스케줄러 / bridge\start-cto-worker.ps1, 이미 있음)
#     -> 로컬 API(4100)/Web(3100) (scripts\start-verify-studio.ps1, 이미 있음, T1-63)
#     -> 최종 종합 Health Check
#
# bridge\ 아래 두 스크립트(start-bridge.ps1 · start-cto-worker.ps1)는
# **호출만 하고 내용을 고치지 않는다** — bridge/ 전부가 사람 승인 없이
# 수정 금지 대상이다(AGENTS.md, 이 작업 지시).
#
# 안전 원칙 — "이미 정상이면 절대 건드리지 않는다":
#   Bridge(4200/4201)를 재시작하는 것은 위험하다 — 지금 이 스크립트를
#   부른 프로세스 자신이 그 Bridge의 자식일 수 있다(docs/
#   DEVELOPMENT_ENVIRONMENT.md §3-3-1, 실측 확정). 그래서 이 스크립트는
#   **health check가 실패했을 때만** bridge\start-bridge.ps1을 부른다.
#   이미 정상이면 절대 재시작을 시도하지 않는다 — 실패했다는 것 자체가
#   "이 프로세스를 살려주는 부모가 이미 없다"는 뜻이므로 재시작이
#   안전하다.
#
# T1-205 — 자식 프로세스 생존 원칙:
#   이전 버전은 scripts\start-minio.ps1 · bridge\start-bridge.ps1 ·
#   scripts\start-verify-studio.ps1을 `&` 연산자로 **동기 호출**했다 —
#   이 프로세스가 최대 수십 초~수 분 동안 그 자식의 완료를 기다리며
#   블로킹된다는 뜻이다. 2026-08-31 실측 재부팅에서 이 스크립트 자신이
#   PostgreSQL 확인 직후(=MinIO 단계에 진입한 직후로 추정, 아래 근거)
#   Windows Task Scheduler에 의해 강제 종료됐다 — 블로킹 구간이 길수록
#   "이 스크립트가 죽는 순간"에 아직 시도조차 못 한 단계가 남을 위험이
#   커진다. 이번 버전은 각 하위 스크립트를 **`Start-Process`로 분리
#   기동(detached, PID 기록)한 뒤 이 스크립트가 직접 포트/health를
#   유한 시간 동안 polling**하는 방식으로 바꿨다 — 하위 스크립트
#   자체(내용은 고치지 않음)도 이미 실제 서버 프로세스(minio.exe·
#   node dist/main.js·node next start·cloudflared)를 Start-Process로
#   분리 기동하므로(각 스크립트 자체 실측 확인), 이 스크립트가 중간에
#   죽어도 이미 시작된 하위 프로세스가 함께 죽을 위험을 최소화한다.
#   또한 매 단계 직후 상태 파일(latest.json)을 즉시 갱신해(요청 7),
#   이 스크립트가 중간에 죽어도 "어디까지 갔는지"가 IN_PROGRESS/빈
#   배열로 뭉개지지 않고 마지막으로 완료된 단계까지 정확히 남는다
#   (2026-08-31 사고 재현: run-20260831-090908.json이 시작 시점 값
#   그대로 멈춰 있던 것이 바로 이 결함이었다).
#
# 멱등성: 몇 번을 다시 실행해도 이미 살아있는 것은 그대로 두고, 죽은
# 것만 살린다. 매 실행마다 D:\dev-data\logs\recovery-manager\ 에
# latest.json(가장 최근 결과) · history.log(누적 기록) · run-<타임스탬프>.json
# 을 남긴다.

param(
  [switch]$Quiet
)

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
$startedAt = Get-Date
$runId = $startedAt.ToString("yyyyMMdd-HHmmss")

# ---- 로그 위치 — C→D 저장정책(요청 4번). D:가 없으면(비정상 상황) C:에
#      최소한으로 남기되 그 사실 자체를 첫 단계 결과로 기록한다.
$dRoot = "D:\dev-data\logs\recovery-manager"
$usingFallbackLog = $false
if (-not (Test-Path "D:\")) {
  $dRoot = Join-Path $repo ".tmp\recovery-manager-logs"
  $usingFallbackLog = $true
}
New-Item -ItemType Directory -Force -Path $dRoot | Out-Null

# ---- 로그 rotation(T1-120) — history.log는 Add-Content로 매 단계마다
#      계속 자라고, run-<타임스탬프>.json은 실행마다 새로 쌓여 청소하지
#      않으면 무한히 늘어난다. history.log는 크기(5MB) 기준으로,
#      run-*.json은 보관 기간(30일) 기준으로 정리한다 — 최근 이력·오류
#      추적에 필요한 범위는 남긴다.
try {
  $historyLog = Join-Path $dRoot "history.log"
  if (Test-Path $historyLog) {
    $historyItem = Get-Item -LiteralPath $historyLog -ErrorAction SilentlyContinue
    if ($historyItem -and $historyItem.Length -ge 5MB) {
      $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
      Rename-Item -LiteralPath $historyLog -NewName "history.log.$stamp.bak" -Force -ErrorAction SilentlyContinue
      Get-ChildItem -Path $dRoot -Filter "history.log.*.bak" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 3 |
        Remove-Item -Force -ErrorAction SilentlyContinue
    }
  }
  $runCutoff = (Get-Date).AddDays(-30)
  Get-ChildItem -Path $dRoot -Filter "run-*.json" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $runCutoff } |
    Remove-Item -Force -ErrorAction SilentlyContinue
  # T1-205 — launcher 프로세스의 stdout/stderr 리다이렉션 로그(아래 3·4·6단계)도
  # run-*.json과 같은 30일 보관 정책을 따른다.
  Get-ChildItem -Path $dRoot -Filter "*-launch-*.log" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $runCutoff } |
    Remove-Item -Force -ErrorAction SilentlyContinue
} catch {
  # 로그 정리 실패는 복구 자체를 막지 않는다.
}

$steps = New-Object System.Collections.Generic.List[object]

function Write-Status {
  param($Verdict)
  $finishedAt = Get-Date
  $status = [ordered]@{
    runId           = $runId
    startedAt       = $startedAt.ToString("o")
    finishedAt      = $finishedAt.ToString("o")
    durationSeconds = [math]::Round((New-TimeSpan -Start $startedAt -End $finishedAt).TotalSeconds, 1)
    verdict         = $Verdict
    usingFallbackLog = $usingFallbackLog
    steps           = $steps
  }
  # BOM 없는 UTF-8로 쓴다 — JSON.parse(Node)는 BOM을 자동으로 벗기지
  # 않아, VS Code 작업·bootstrap-context.mjs 등 다른 도구가 이 파일을
  # 읽을 때 파싱이 깨진다(실측). Set-Content -Encoding utf8은 PowerShell
  # 5.1에서 항상 BOM을 붙이므로 쓰지 않는다.
  $json = $status | ConvertTo-Json -Depth 6
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $dRoot "latest.json"), $json, $utf8NoBom)
  [System.IO.File]::WriteAllText((Join-Path $dRoot "run-$runId.json"), $json, $utf8NoBom)

  $lines = @()
  $lines += "ACOS 자동복구 결과 — $Verdict"
  $durSec = [math]::Round((New-TimeSpan -Start $startedAt -End $finishedAt).TotalSeconds, 1)
  $lines += "실행: $($startedAt.ToString('yyyy-MM-dd HH:mm:ss')) ~ $($finishedAt.ToString('HH:mm:ss')) (${durSec}초 경과, 마지막 갱신)"
  $lines += ""
  foreach ($s in $steps) {
    $lines += ("  [{0,-8}] {1} — {2}" -f $s.status, $s.name, $s.detail)
  }
  $lines += ""
  if ($Verdict -eq "FAILED") {
    $lines += "실패한 단계가 있습니다. 위 [FAIL] 항목을 확인하십시오."
  } elseif ($Verdict -eq "PARTIAL") {
    $lines += "핵심 서비스는 떴지만 경고가 있습니다. 위 [WARN] 항목을 확인하십시오."
  } elseif ($Verdict -eq "IN_PROGRESS") {
    $lines += "아직 실행 중입니다 — 이 파일은 매 단계 직후 갱신되므로, 실행이 중간에 끊겨도 여기까지는 실제로 완료된 상태입니다."
  } else {
    $lines += "핵심 서비스가 모두 정상입니다. http://localhost:4201 (현황판) 또는 http://localhost:3100/image-studio 에서 확인하십시오."
  }
  [System.IO.File]::WriteAllText((Join-Path $dRoot "latest.txt"), ($lines -join "`r`n"), $utf8NoBom)
}

function Add-Step {
  param($Name, $Status, $Detail, [double]$DurationMs = 0)
  $obj = [ordered]@{
    name       = $Name
    status     = $Status   # OK | SKIP | STARTED | WARN | FAIL
    detail     = $Detail
    durationMs = [math]::Round($DurationMs, 0)
  }
  $steps.Add($obj)
  $line = "[$Name] $Status — $Detail"
  if (-not $Quiet) {
    $color = switch ($Status) {
      "OK"    { "Green" }
      "SKIP"  { "DarkGray" }
      "WARN"  { "Yellow" }
      "FAIL"  { "Red" }
      default { "Cyan" }
    }
    Write-Host $line -ForegroundColor $color
  }
  # Add-Content 기본 인코딩은 시스템 코드페이지(CP949)라 한글이 깨진다
  # (실측) — 로그 전체가 UTF-8이어야 하는 이 저장소 관례에 맞춰 명시한다.
  Add-Content -Path (Join-Path $dRoot "history.log") -Value ("{0} [{1}] {2}: {3}" -f (Get-Date -Format o), $runId, $Name, "$Status — $Detail") -Encoding utf8
  # T1-205 — 매 단계 직후 상태 파일을 즉시 갱신한다(요청 7). Task
  # Scheduler가 이 프로세스를 중간에 강제 종료해도(SCHED_S_TASK_TERMINATED,
  # 2026-08-31 실측) latest.json이 "마지막으로 실제 완료된 단계"까지
  # 정확히 남는다 — 이전 버전은 시작/종료 시점 2회만 기록해 중간에
  # 죽으면 IN_PROGRESS·steps:[]로 영구히 멈춘 채 남았다.
  Write-Status -Verdict "IN_PROGRESS"
}

function Test-Port($port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Test-Http($url, [int]$timeoutSec = 5) {
  try {
    $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec $timeoutSec
    return @{ ok = ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400); code = $r.StatusCode }
  } catch {
    return @{ ok = $false; code = $null; error = $_.Exception.Message }
  }
}

# T1-205 — 유한 시간 polling/backoff 헬퍼(요청 6). 재부팅 직후에는
# 네트워크·DB가 아직 준비되지 않아 첫 확인이 실패할 수 있으므로, 무한
# 대기 대신 정해진 시간 동안만 일정 간격으로 재확인한다. 대기 도중에도
# 상태 파일을 계속 갱신해(요청 7) 중간에 죽어도 "몇 초째 대기 중이었는지"가
# 남는다.
function Wait-Port($port, [int]$timeoutSec = 30, [int]$intervalSec = 2) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($true) {
    if (Test-Port $port) { return $true }
    if ($sw.Elapsed.TotalSeconds -ge $timeoutSec) { return $false }
    Start-Sleep -Seconds $intervalSec
    Write-Status -Verdict "IN_PROGRESS"
  }
}

function Wait-Http($url, [int]$timeoutSec = 30, [int]$intervalSec = 2, [int]$reqTimeoutSec = 5) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $last = @{ ok = $false; code = $null; error = "시도 전" }
  while ($true) {
    $last = Test-Http $url $reqTimeoutSec
    if ($last.ok) { return $last }
    if ($sw.Elapsed.TotalSeconds -ge $timeoutSec) { return $last }
    Start-Sleep -Seconds $intervalSec
    Write-Status -Verdict "IN_PROGRESS"
  }
}

# T1-205 — 하위 기동 스크립트를 분리 프로세스로 띄운다(요청 3·4). 이
# 스크립트(recovery-manager) 자신이 죽어도 이미 시작된 launcher가 계속
# 진행할 수 있도록 `&`(동기 대기) 대신 Start-Process(비동기, PID 기록,
# 로그 리다이렉션)를 쓴다. 실제 서버 프로세스(minio.exe·node dist/main.js
# 등)를 분리 기동하는 책임은 각 하위 스크립트 자신에게 이미 있다(내용은
# 고치지 않음) — 이 함수는 "그 하위 스크립트를 실행하는 launcher" 한 겹만
# 추가로 분리한다.
function Start-DetachedScript($scriptPath, $label) {
  $log = Join-Path $dRoot ("{0}-launch-{1}" -f $label, $runId)
  $p = Start-Process -FilePath "powershell" -ArgumentList @(
    "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", $scriptPath
  ) -WorkingDirectory $repo -WindowStyle Hidden `
    -RedirectStandardOutput "$log.out.log" -RedirectStandardError "$log.err.log" -PassThru
  return @{ Process = $p; OutLog = "$log.out.log"; ErrLog = "$log.err.log" }
}

# ---- 시작을 즉시 기록한다(요청 6: "복구 시작"도 알 수 있어야 한다) ----
Write-Status -Verdict "IN_PROGRESS"

Write-Host "== ACOS Recovery Manager (T1-109/T1-205) — $runId ==" -ForegroundColor Cyan

# T1-205 — 전체를 try/catch로 감싼다(요청 7). 어떤 단계에서 예상치
# 못한 예외가 터져도(이전 버전은 최상위 예외 처리가 없어 스크립트가
# 그 자리에서 죽으면 최종 판정 자체를 못 남길 위험이 있었다) 반드시
# FAIL 단계를 남기고 아래 "최종 판정"까지 도달해 Write-Status를 호출한다
# — Task Scheduler가 이 프로세스의 종료 상태를 정상적인 exit code(0/1)로
# 인식할 수 있게 한다.
try {

if ($usingFallbackLog) {
  Add-Step "D: 드라이브" "WARN" "D:\ 를 찾을 수 없어 로그를 저장소 임시 폴더에 남깁니다 — C/D 저장정책 위반 상태입니다."
} else {
  Add-Step "D: 드라이브" "OK" "로그 위치: $dRoot"
}

# ---- 0. C:/D: 저장공간 ----
try {
  $c = Get-PSDrive C -ErrorAction Stop
  $cFreeGb = [math]::Round($c.Free / 1GB, 2)
  if ($cFreeGb -lt 3) {
    Add-Step "C: 여유공간" "FAIL" "$cFreeGb GB — 위험 수준(3GB 미만). MinIO 저장 거부·빌드 실패가 재발할 수 있습니다."
  } elseif ($cFreeGb -lt 5) {
    Add-Step "C: 여유공간" "WARN" "$cFreeGb GB — 5GB 미만, 재부팅 후 재발 이력 있음(docs/DEVELOPMENT_ENVIRONMENT.md 16장)."
  } else {
    Add-Step "C: 여유공간" "OK" "$cFreeGb GB"
  }
} catch {
  Add-Step "C: 여유공간" "WARN" "확인 실패: $($_.Exception.Message)"
}
try {
  $d = Get-PSDrive D -ErrorAction Stop
  $dFreeGb = [math]::Round($d.Free / 1GB, 2)
  Add-Step "D: 여유공간" "OK" "$dFreeGb GB"
} catch {
  Add-Step "D: 여유공간" "WARN" "D: 드라이브를 찾을 수 없습니다 — C/D 저장정책이 이 PC에 적용되지 않은 상태일 수 있습니다."
}

# ---- 1. PostgreSQL(5432) — Windows 서비스, 원래 자동. 죽어 있으면만 시작한다 ----
# T1-205: Start-Service 직후 고정 2초 대기 1회 대신, 재부팅 직후 서비스가
# 늦게 응답할 수 있는 경우를 감안해 유한 시간(20초) 동안 polling한다(요청 6).
$sw = [Diagnostics.Stopwatch]::StartNew()
try {
  $svc = Get-Service -Name "postgresql-x64-16" -ErrorAction Stop
  if ($svc.Status -eq "Running") {
    Add-Step "PostgreSQL(5432)" "SKIP" "이미 실행 중(Windows 서비스) — 건드리지 않음" $sw.Elapsed.TotalMilliseconds
  } else {
    Write-Host "  PostgreSQL 서비스가 꺼져 있어 시작합니다..."
    Start-Service -Name "postgresql-x64-16" -ErrorAction Stop
    if (Wait-Port 5432 -timeoutSec 20 -intervalSec 2) {
      Add-Step "PostgreSQL(5432)" "OK" "서비스 시작함" $sw.Elapsed.TotalMilliseconds
    } else {
      Add-Step "PostgreSQL(5432)" "FAIL" "서비스는 시작 명령을 받았으나 20초 동안 5432가 응답하지 않습니다" $sw.Elapsed.TotalMilliseconds
    }
  }
} catch {
  if (Test-Port 5432) {
    Add-Step "PostgreSQL(5432)" "OK" "서비스 이름은 다르지만 5432 포트는 이미 응답 중" $sw.Elapsed.TotalMilliseconds
  } else {
    Add-Step "PostgreSQL(5432)" "FAIL" "서비스 확인 실패 및 5432 미응답: $($_.Exception.Message)" $sw.Elapsed.TotalMilliseconds
  }
}

# ---- 2. MinIO(9000) — scripts\start-minio.ps1 재사용, 분리 기동 + polling(T1-205) ----
$sw = [Diagnostics.Stopwatch]::StartNew()
if (Test-Port 9000) {
  Add-Step "MinIO(9000)" "SKIP" "이미 실행 중 — 건드리지 않음" $sw.Elapsed.TotalMilliseconds
} else {
  Write-Host "  MinIO가 꺼져 있어 scripts\start-minio.ps1 을 분리 기동합니다..."
  try {
    $launch = Start-DetachedScript (Join-Path $repo "scripts\start-minio.ps1") "minio"
    Add-Step "MinIO(9000) 기동 시작" "STARTED" "launcher PID $($launch.Process.Id), 로그: $($launch.OutLog)" $sw.Elapsed.TotalMilliseconds
    if (Wait-Port 9000 -timeoutSec 40 -intervalSec 2) {
      Add-Step "MinIO(9000)" "OK" "launcher PID $($launch.Process.Id)로 기동 확인" $sw.Elapsed.TotalMilliseconds
    } else {
      Add-Step "MinIO(9000)" "FAIL" "40초 대기 후에도 9000이 응답하지 않습니다 — $($launch.ErrLog) 확인 (launcher PID $($launch.Process.Id))" $sw.Elapsed.TotalMilliseconds
    }
  } catch {
    Add-Step "MinIO(9000)" "FAIL" "start-minio.ps1 분리 기동 오류: $($_.Exception.Message)" $sw.Elapsed.TotalMilliseconds
  }
}

# ---- 3. Bridge(4200) + 현황판(4201) + Managed Tunnel ----
# T1-205: 재부팅 직후 순간적인 미응답으로 오판해 불필요하게 재시작하지
# 않도록, 최초 판정 전에 짧게(8초) 한 번 더 확인한다(요청 5·6).
$sw = [Diagnostics.Stopwatch]::StartNew()
$bridgeHealth = Wait-Http "http://127.0.0.1:4200/health" 8 2
$boardHealth  = Wait-Http "http://127.0.0.1:4201" 8 2
if ($bridgeHealth.ok -and $boardHealth.ok) {
  Add-Step "Bridge(4200)+현황판(4201)" "SKIP" "이미 정상 — 재시작하면 이 스크립트를 부른 세션 자신이 죽을 수 있어 절대 건드리지 않음" $sw.Elapsed.TotalMilliseconds
} else {
  Write-Host "  Bridge/현황판이 정상이 아니어서 bridge\start-bridge.ps1 을 분리 기동합니다..."
  Write-Host "  (health 실패 = 이 프로세스를 살려주는 Bridge 부모가 이미 없다는 뜻이라 재시작이 안전함)"
  try {
    $launch = Start-DetachedScript (Join-Path $repo "bridge\start-bridge.ps1") "bridge"
    Add-Step "Bridge(4200)+현황판(4201) 기동 시작" "STARTED" "launcher PID $($launch.Process.Id), 로그: $($launch.OutLog)" $sw.Elapsed.TotalMilliseconds
    $bridgeHealth2 = Wait-Http "http://127.0.0.1:4200/health" 60 3
    $boardHealth2  = Wait-Http "http://127.0.0.1:4201" 60 3
    if ($bridgeHealth2.ok -and $boardHealth2.ok) {
      Add-Step "Bridge(4200)+현황판(4201)" "OK" "start-bridge.ps1로 기동함(launcher PID $($launch.Process.Id))" $sw.Elapsed.TotalMilliseconds
    } else {
      Add-Step "Bridge(4200)+현황판(4201)" "FAIL" "start-bridge.ps1 실행(launcher PID $($launch.Process.Id)) 후에도 정상이 아님 — D:\dev-data\logs\start-bridge-run.log, cloudflared-bridge.err.log, $($launch.ErrLog) 확인" $sw.Elapsed.TotalMilliseconds
    }
  } catch {
    Add-Step "Bridge(4200)+현황판(4201)" "FAIL" "start-bridge.ps1 분리 기동 오류: $($_.Exception.Message)" $sw.Elapsed.TotalMilliseconds
  }
}

# ---- 4. CTO Worker ----
$sw = [Diagnostics.Stopwatch]::StartNew()
function Test-CtoWorkerAlive {
  $lockFile = Join-Path $repo "bridge\cto-worker.lock"
  if (-not (Test-Path $lockFile)) { return $false }
  try {
    $lock = Get-Content $lockFile -Raw | ConvertFrom-Json
    $p = Get-Process -Id $lock.pid -ErrorAction SilentlyContinue
    return [bool]$p
  } catch {
    return $false
  }
}
if (Test-CtoWorkerAlive) {
  Add-Step "CTO Worker" "SKIP" "잠금 파일 기준으로 이미 살아있음 — 건드리지 않음" $sw.Elapsed.TotalMilliseconds
} else {
  Write-Host "  CTO Worker가 죽어 있어 복구를 시도합니다..."
  $recovered = $false
  try {
    $task = Get-ScheduledTask -TaskName "ACOS-CTO-Worker" -ErrorAction Stop
    Start-ScheduledTask -TaskName "ACOS-CTO-Worker" -ErrorAction Stop
  } catch {
    Write-Host "    Start-ScheduledTask 실패: $($_.Exception.Message)"
  }
  # 위 Start-ScheduledTask 시도 뒤 최대 10초 동안 잠금 파일 기준으로 확인한다.
  if (-not $recovered) {
    $sw2 = [Diagnostics.Stopwatch]::StartNew()
    while ($sw2.Elapsed.TotalSeconds -lt 10) {
      if (Test-CtoWorkerAlive) { $recovered = $true; break }
      Start-Sleep -Seconds 1
    }
  }
  if (-not $recovered) {
    # 예약 작업(Boot 트리거) 경로가 실패했을 가능성 — 이 스크립트는 보통
    # Logon 트리거로, 사용자 프로필(PATH 등)이 이미 로드된 뒤 돈다. 같은
    # 스크립트를 여기서 직접 한 번 더 시도한다(fallback). bridge/ 파일
    # 내용은 고치지 않는다 — 그대로 호출만 한다.
    try {
      Start-Process -FilePath "powershell" -ArgumentList @(
        "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
        "-File", (Join-Path $repo "bridge\start-cto-worker.ps1")
      ) -WorkingDirectory $repo
      $sw3 = [Diagnostics.Stopwatch]::StartNew()
      while ($sw3.Elapsed.TotalSeconds -lt 15) {
        if (Test-CtoWorkerAlive) { $recovered = $true; break }
        Start-Sleep -Seconds 1
      }
    } catch {
      Write-Host "    fallback 직접 실행 실패: $($_.Exception.Message)"
    }
  }
  if ($recovered) {
    Add-Step "CTO Worker" "OK" "재시작으로 복구됨" $sw.Elapsed.TotalMilliseconds
  } else {
    Add-Step "CTO Worker" "FAIL" "ACOS-CTO-Worker 스케줄러·직접 실행 모두 시도했지만 살아나지 않음 — bridge\.worker-logs 확인 필요" $sw.Elapsed.TotalMilliseconds
  }
}

# ---- 5. 로컬 API(4100)/Web(3100) — scripts\start-verify-studio.ps1 재사용, 분리 기동(T1-205) ----
# 요청 5: studio:start(사람용)와 이 단계가 3100/4100을 중복 기동하지
# 않도록, start-verify-studio.ps1 자신의 idempotent 단축 경로(같은 커밋 +
# 이미 응답 중이면 재빌드 없이 즉시 종료, T1-201/T1-203)에 그대로 의존한다
# — 이 스크립트는 그 앞에서 한 번 더 health를 확인해 이미 정상이면 아예
# 호출조차 하지 않는다(중복 실행 이중 방지).
$sw = [Diagnostics.Stopwatch]::StartNew()
$apiHealth = Wait-Http "http://127.0.0.1:4100/health" 5 2
$webHealth = Wait-Http "http://127.0.0.1:3100/login" 5 2
if ($apiHealth.ok -and $webHealth.ok) {
  Add-Step "로컬 API(4100)/Web(3100)" "SKIP" "이미 정상 — 건드리지 않음" $sw.Elapsed.TotalMilliseconds
} else {
  Write-Host "  로컬 API/Web이 정상이 아니어서 scripts\start-verify-studio.ps1 을 분리 기동합니다..."
  try {
    $launch = Start-DetachedScript (Join-Path $repo "scripts\start-verify-studio.ps1") "studio"
    Add-Step "로컬 API(4100)/Web(3100) 기동 시작" "STARTED" "launcher PID $($launch.Process.Id), 로그: $($launch.OutLog) — build 포함이라 수 분 걸릴 수 있음" $sw.Elapsed.TotalMilliseconds
    # build(apps/api + apps/web)가 포함될 수 있어 최대 10분까지 기다린다.
    $apiHealth2 = Wait-Http "http://127.0.0.1:4100/health" 600 5
    $webHealth2 = if ($apiHealth2.ok) { Wait-Http "http://127.0.0.1:3100/login" 120 5 } else { @{ ok = $false; error = "API가 뜨지 않아 Web 확인을 생략함" } }
    if ($apiHealth2.ok -and $webHealth2.ok) {
      Add-Step "로컬 API(4100)/Web(3100)" "OK" "start-verify-studio.ps1로 기동함(launcher PID $($launch.Process.Id))" $sw.Elapsed.TotalMilliseconds
    } else {
      Add-Step "로컬 API(4100)/Web(3100)" "FAIL" "start-verify-studio.ps1 실행(launcher PID $($launch.Process.Id)) 후에도 정상이 아님 — $($launch.ErrLog), $($launch.OutLog) 확인" $sw.Elapsed.TotalMilliseconds
    }
  } catch {
    Add-Step "로컬 API(4100)/Web(3100)" "FAIL" "start-verify-studio.ps1 분리 기동 오류: $($_.Exception.Message)" $sw.Elapsed.TotalMilliseconds
  }
}

# ---- 6. Git Task Sync 큐 재시도 (T1-130) ----
# scripts\git-task-sync.mjs --retry-queue-only는 이미 만들어진 로컬 커밋의
# push만 재시도한다 — 작업 트리를 reset/pull/checkout하지 않고, 새 커밋도
# 만들지 않는다(그건 Task 완료 시점에만 별도로 실행됨). 재부팅 후 인증이
# 되돌아왔을 때 밀린 push를 자동으로 흘려보내기 위한 안전한 상태 확인 +
# 재시도 단계다.
$sw = [Diagnostics.Stopwatch]::StartNew()
try {
  $syncOutput = & node (Join-Path $repo "scripts\git-task-sync.mjs") --retry-queue-only 2>&1
  $syncExit = $LASTEXITCODE
  $syncOutput | ForEach-Object { Write-Host "    $_" }
  if ($syncExit -eq 0) {
    Add-Step "Git Task Sync 큐 재시도" "OK" "scripts\git-task-sync.mjs --retry-queue-only 실행 완료(exit $syncExit) — 상세는 D:\dev-data\logs\git-sync\git-sync.log" $sw.Elapsed.TotalMilliseconds
  } else {
    Add-Step "Git Task Sync 큐 재시도" "WARN" "exit $syncExit — 인증 미비이거나 대기 중인 push가 없을 수 있음, D:\dev-data\logs\git-sync\git-sync.log 확인" $sw.Elapsed.TotalMilliseconds
  }
} catch {
  Add-Step "Git Task Sync 큐 재시도" "WARN" "실행 오류: $($_.Exception.Message)" $sw.Elapsed.TotalMilliseconds
}

# ---- 7. 최종 종합 Health Check (요청 10) ----
Write-Host ""
Write-Host "== 최종 종합 Health Check ==" -ForegroundColor Cyan

foreach ($portInfo in @(
  @{ Port = 4200; Name = "Bridge 서버" },
  @{ Port = 4201; Name = "Bridge 현황판" },
  @{ Port = 4100; Name = "로컬 API" },
  @{ Port = 3100; Name = "로컬 Web" },
  @{ Port = 9000; Name = "MinIO" },
  @{ Port = 5432; Name = "PostgreSQL" }
)) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  if (Test-Port $portInfo.Port) {
    Add-Step ("포트 {0}({1})" -f $portInfo.Port, $portInfo.Name) "OK" "LISTEN" $sw.Elapsed.TotalMilliseconds
  } else {
    Add-Step ("포트 {0}({1})" -f $portInfo.Port, $portInfo.Name) "FAIL" "닫혀 있음" $sw.Elapsed.TotalMilliseconds
  }
}

$sw = [Diagnostics.Stopwatch]::StartNew()
$extHealth = Test-Http "https://bridge.magicclean79.com/health" 10
if ($extHealth.ok) {
  Add-Step "외부 터널(bridge.magicclean79.com/health)" "OK" "HTTP $($extHealth.code)" $sw.Elapsed.TotalMilliseconds
} else {
  Add-Step "외부 터널(bridge.magicclean79.com/health)" "WARN" "응답 없음(Cloudflare 엣지 전파 지연이거나 인터넷 문제일 수 있음): $($extHealth.error)" $sw.Elapsed.TotalMilliseconds
}

$sw = [Diagnostics.Stopwatch]::StartNew()
$tokenPath = Join-Path $repo "bridge\.secrets\bridge-token.txt"
$taskApiOk = $false
$taskApiDetail = ""
if (Test-Path $tokenPath) {
  try {
    $tok = (Get-Content $tokenPath -Raw).Trim()
    $r = Invoke-WebRequest "http://127.0.0.1:4200/tasks" -Headers @{ Authorization = "Bearer $tok" } -UseBasicParsing -TimeoutSec 5
    $taskApiOk = ($r.StatusCode -eq 200)
    $taskApiDetail = "HTTP $($r.StatusCode)"
  } catch {
    $taskApiDetail = $_.Exception.Message
  }
} else {
  $taskApiDetail = "토큰 파일 없음: $tokenPath"
}
Add-Step "Bridge Task API(/tasks)" $(if ($taskApiOk) { "OK" } else { "WARN" }) $taskApiDetail $sw.Elapsed.TotalMilliseconds

$sw = [Diagnostics.Stopwatch]::StartNew()
if (Test-CtoWorkerAlive) {
  Add-Step "CTO Worker heartbeat" "OK" "잠금 파일의 pid가 살아있는 프로세스와 일치" $sw.Elapsed.TotalMilliseconds
} else {
  Add-Step "CTO Worker heartbeat" "FAIL" "잠금 파일 기준으로 살아있지 않음" $sw.Elapsed.TotalMilliseconds
}

$sw = [Diagnostics.Stopwatch]::StartNew()
try {
  $constantsPath = Join-Path $repo "apps\web\app\benchmark\constants.ts"
  $constants = Get-Content $constantsPath -Raw
  $firstIdMatch = [regex]::Match($constants, '"(cm[0-9a-z]+)"')
  if ($firstIdMatch.Success) {
    $imgId = $firstIdMatch.Groups[1].Value
    $r = Invoke-WebRequest "http://127.0.0.1:4100/uploads/images/$imgId/file" -UseBasicParsing -TimeoutSec 10
    if ($r.StatusCode -eq 200 -and $r.RawContentLength -gt 0) {
      Add-Step "Image Studio Benchmark 사진 API" "OK" "GET /uploads/images/$imgId/file -> HTTP 200 ($($r.RawContentLength) bytes)" $sw.Elapsed.TotalMilliseconds
    } else {
      Add-Step "Image Studio Benchmark 사진 API" "FAIL" "HTTP $($r.StatusCode), $($r.RawContentLength) bytes" $sw.Elapsed.TotalMilliseconds
    }
  } else {
    Add-Step "Image Studio Benchmark 사진 API" "WARN" "constants.ts에서 BENCHMARK_IMAGE_IDS를 찾지 못함"
  }
} catch {
  Add-Step "Image Studio Benchmark 사진 API" "FAIL" $_.Exception.Message $sw.Elapsed.TotalMilliseconds
}

} catch {
  # T1-205 — 예상 못 한 최상위 예외. 원인을 FAIL 단계로 남기고 아래
  # 최종 판정으로 계속 진행한다(요청 7) — 여기서 그냥 죽으면 Write-Status가
  # 마지막 verdict를 못 남긴다.
  Add-Step "예상치 못한 오류" "FAIL" "$($_.Exception.Message) — $($_.ScriptStackTrace)"
}

# ---- 최종 판정 ----
$failCount = @($steps | Where-Object { $_.status -eq "FAIL" }).Count
$warnCount = @($steps | Where-Object { $_.status -eq "WARN" }).Count
$verdict = if ($failCount -gt 0) { "FAILED" } elseif ($warnCount -gt 0) { "PARTIAL" } else { "SUCCESS" }

Write-Status -Verdict $verdict

Write-Host ""
$color = switch ($verdict) { "SUCCESS" { "Green" } "PARTIAL" { "Yellow" } default { "Red" } }
Write-Host ("== 최종 판정: {0} (FAIL {1}건, WARN {2}건) ==" -f $verdict, $failCount, $warnCount) -ForegroundColor $color
Write-Host ("상태 파일: {0}\latest.json / latest.txt" -f $dRoot)

if ($verdict -eq "FAILED") { exit 1 } else { exit 0 }

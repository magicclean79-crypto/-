# ACOS 운영 환경 진단 (T1-103) — 읽기 전용, 아무것도 바꾸지 않는다
#
#   powershell -ExecutionPolicy Bypass -File scripts\check-acos-environment.ps1
#
# 목적:
#   AGENTS.md 0 . DEVELOPMENT_ENVIRONMENT.md 0 이 말하는 상태(Bridge
#   health . 주요 포트 . D: 저장환경 . 재부팅 자동복구 스케줄러)가
#   지금 이 PC의 실제 상태와 같은지 한 번에 실측한다. bridge/ 안의
#   어떤 파일도 쓰거나 지우거나 재시작하지 않는다 - 순수 조회만 한다.
#
# 하는 일:
#   1. Bridge 서버(4200)/health, 현황판(4201) 응답 확인
#   2. Bridge Task API(/tasks) 응답 확인 (토큰 파일이 있으면 사용)
#   3. 주요 포트(3000/4000/4100/3100/5432/9000/4200/4201) LISTEN 여부
#   4. D:\dev-data\* 저장환경 폴더 존재 여부
#   5. C:/D: 드라이브 여유공간(C: 5GB 미만이면 WARN)
#   6. ACOS-Bridge / ACOS-CTO-Worker 스케줄러 등록·마지막 실행 결과
#   7. 이 프로세스가 D: 환경변수(TURBO_CACHE_DIR 등)를 실제로 상속했는지
#
# 결과는 화면에 표로만 출력한다 - 파일을 새로 만들지 않는다.

$ErrorActionPreference = "Continue"
$results = New-Object System.Collections.Generic.List[object]

function Add-Result {
  param($Check, $Status, $Detail)
  $results.Add([pscustomobject]@{ Check = $Check; Status = $Status; Detail = $Detail })
}

Write-Host "== ACOS 운영 환경 진단 (T1-103) ==" -ForegroundColor Cyan
Write-Host ("실행 시각: {0}" -f (Get-Date -Format o))
Write-Host "읽기 전용 - 아무것도 바꾸지 않습니다."
Write-Host ""

# 1. Bridge 서버 / 현황판
try {
  $r = Invoke-WebRequest "http://127.0.0.1:4200/health" -UseBasicParsing -TimeoutSec 5
  Add-Result "Bridge 서버 (4200) /health" "PASS" ("HTTP {0}" -f $r.StatusCode)
} catch {
  Add-Result "Bridge 서버 (4200) /health" "FAIL" $_.Exception.Message
}

try {
  $r = Invoke-WebRequest "http://127.0.0.1:4201" -UseBasicParsing -TimeoutSec 5
  Add-Result "Bridge 현황판 (4201)" "PASS" ("HTTP {0}" -f $r.StatusCode)
} catch {
  Add-Result "Bridge 현황판 (4201)" "FAIL" $_.Exception.Message
}

# 2. Task API - 토큰 파일이 있으면 쓰고, 없으면 무인증으로 시도한다
$tokenPath = Join-Path $PSScriptRoot "..\bridge\.secrets\bridge-token.txt"
$authHeader = @{}
if (Test-Path $tokenPath) {
  $tok = (Get-Content $tokenPath -Raw -ErrorAction SilentlyContinue)
  if ($tok) { $authHeader = @{ Authorization = ("Bearer {0}" -f $tok.Trim()) } }
}
try {
  $r = Invoke-WebRequest "http://127.0.0.1:4200/tasks" -Headers $authHeader -UseBasicParsing -TimeoutSec 5
  $tasks = $r.Content | ConvertFrom-Json
  Add-Result "Bridge Task API (/tasks)" "PASS" ("HTTP {0}, 작업 수 {1}" -f $r.StatusCode, @($tasks).Count)
} catch {
  Add-Result "Bridge Task API (/tasks)" "FAIL" $_.Exception.Message
}

# 3. 주요 포트
# 주의(실측): [ordered]@{ 3000 = "..." } 처럼 정수를 키로 쓰면
# System.Collections.Specialized.OrderedDictionary의 인덱서가
# this[int index](위치 접근)로 오버로드 해석되어 $ports[3000]이
# "범위를 벗어남" 오류나 빈 값을 돌려준다 - 반드시 문자열 키를 쓴다.
$ports = [ordered]@{
  "3000" = "SSH 터널 -> EC2 Web (원격, 종료 금지)"
  "4000" = "SSH 터널 -> EC2 API (원격, 종료 금지)"
  "4100" = "로컬 API (검증용, 자동 시작 아님)"
  "3100" = "로컬 Web (검증용, 자동 시작 아님)"
  "5432" = "PostgreSQL (자동 시작 서비스)"
  "9000" = "MinIO (자동 시작 아님)"
  "4200" = "Bridge 서버"
  "4201" = "Bridge 현황판"
}
foreach ($p in $ports.Keys) {
  $listening = [bool](Get-NetTCPConnection -LocalPort ([int]$p) -State Listen -ErrorAction SilentlyContinue)
  $status = if ($listening) { "LISTENING" } else { "닫힘" }
  Add-Result ("포트 {0} ({1})" -f $p, $ports[$p]) $status ""
}

# 4. D: 저장환경 폴더
$dPaths = @(
  "D:\dev-data\minio-data",
  "D:\dev-data\pnpm-store",
  "D:\dev-data\npm-cache",
  "D:\dev-data\ms-playwright",
  "D:\dev-data\turbo-cache",
  "D:\dev-data\temp"
)
foreach ($p in $dPaths) {
  $exists = Test-Path $p
  Add-Result ("D: 경로 {0}" -f $p) $(if ($exists) { "PASS" } else { "없음" }) ""
}

# 5. C:/D: 여유공간
$cDrive = Get-PSDrive C -ErrorAction SilentlyContinue
$dDrive = Get-PSDrive D -ErrorAction SilentlyContinue
if ($cDrive) {
  $freeGb = [math]::Round($cDrive.Free / 1GB, 2)
  $status = if ($freeGb -lt 5) { "WARN(<5GB)" } else { "PASS" }
  Add-Result "C: 여유공간" $status ("{0} GB" -f $freeGb)
}
if ($dDrive) {
  $freeGb = [math]::Round($dDrive.Free / 1GB, 2)
  Add-Result "D: 여유공간" "PASS" ("{0} GB" -f $freeGb)
} else {
  Add-Result "D: 드라이브" "없음" "D: 드라이브가 없는 PC일 수 있습니다"
}

# 6. 재부팅 자동복구 스케줄러
foreach ($taskName in @("ACOS-Bridge", "ACOS-CTO-Worker")) {
  try {
    $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
    if ($info.LastTaskResult -eq 0) {
      $st = "PASS(마지막 성공)"
    } elseif ($info.LastTaskResult -eq 267011) {
      $st = "미실행"
    } else {
      $st = ("FAIL(코드 {0})" -f $info.LastTaskResult)
    }
    Add-Result ("스케줄러 {0}" -f $taskName) $st ("LastRunTime {0}" -f $info.LastRunTime)
  } catch {
    Add-Result ("스케줄러 {0}" -f $taskName) "없음" "등록되지 않음"
  }
}

# 7. 이 프로세스가 D: 환경변수를 실제로 상속했는지 (T1-100/102 실측 문제)
foreach ($ev in @("TURBO_CACHE_DIR", "PLAYWRIGHT_BROWSERS_PATH", "TEMP", "TMP")) {
  $procVal = [Environment]::GetEnvironmentVariable($ev, "Process")
  $isD = $procVal -like "D:*"
  $status = if ($isD) { "D: 적용됨" } else { "미적용" }
  Add-Result ("현재 프로세스 env {0}" -f $ev) $status ("값: {0}" -f $procVal)

  $userVal = [Environment]::GetEnvironmentVariable($ev, "User")
  $isDUser = $userVal -like "D:*"
  Add-Result ("레지스트리(User) {0}" -f $ev) $(if ($isDUser) { "D: 설정됨" } else { "미설정" }) ("값: {0}" -f $userVal)
}

# 결과 출력
$results | Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host

$failCount = @($results | Where-Object { $_.Status -like "FAIL*" }).Count
$warnCount = @($results | Where-Object { $_.Status -like "WARN*" }).Count

Write-Host ""
$summaryColor = if ($failCount -gt 0) { "Red" } elseif ($warnCount -gt 0) { "Yellow" } else { "Green" }
Write-Host ("요약: FAIL {0}건, WARN {1}건" -f $failCount, $warnCount) -ForegroundColor $summaryColor
Write-Host "문서와 다른 결과가 있으면 문서를 갱신하십시오 (AGENTS.md 0 Source of Truth)."

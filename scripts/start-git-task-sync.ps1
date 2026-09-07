# ACOS Git Task Sync — 실행 래퍼 (T1-130)
#
#   powershell -ExecutionPolicy Bypass -File scripts\start-git-task-sync.ps1
#
# scripts\git-task-sync.mjs(전체 사이클: 이미 만든 로컬 커밋의 push 재시도
# → 새로 검증 통과한 Task를 찾아 Task 단위로 commit/push)를 그대로 호출만
# 한다. 이 래퍼는 로직을 갖지 않는다 — Task Scheduler(`ACOS-Git-Task-Sync`)
# 등록 지점을 다른 start-*.ps1과 같은 패턴으로 맞추기 위한 얇은 진입점이다.
#
# 안전 원칙(git-task-sync.mjs 자체에 이미 있음, 여기서 다시 어기지 않는다):
#   - git reset/checkout/clean/pull/stash를 쓰지 않는다.
#   - 인증이 안 되면 push만 실패하고 로컬 커밋은 유지된다 — 재시도는 큐로.
#   - 비대화형 인증 프롬프트는 GIT_TERMINAL_PROMPT=0으로 즉시 실패시킨다
#     (실측: 이 값이 없으면 Git Credential Manager가 무한 대기한다).

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot

$dLogRoot = "D:\dev-data\logs\git-sync"
if (-not (Test-Path "D:\")) {
  $dLogRoot = Join-Path $repo ".tmp\git-sync-logs"
}
New-Item -ItemType Directory -Force -Path $dLogRoot -ErrorAction SilentlyContinue | Out-Null
$runLog = Join-Path $dLogRoot "start-git-task-sync-run.log"

$startedAt = Get-Date
"[$($startedAt.ToString('o'))] start-git-task-sync 실행 시작" | Add-Content -Path $runLog -Encoding utf8

Push-Location $repo
try {
  $output = & node (Join-Path $repo "scripts\git-task-sync.mjs") 2>&1
  $exitCode = $LASTEXITCODE
  $output | ForEach-Object { Write-Host $_ }
  $output | Add-Content -Path $runLog -Encoding utf8
  "[$((Get-Date).ToString('o'))] 종료 코드 $exitCode" | Add-Content -Path $runLog -Encoding utf8
  exit $exitCode
} catch {
  "[$((Get-Date).ToString('o'))] 실행 오류: $($_.Exception.Message)" | Add-Content -Path $runLog -Encoding utf8
  exit 1
} finally {
  Pop-Location
}

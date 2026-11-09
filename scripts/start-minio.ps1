# 로컬 MinIO 시작 — D: 드라이브 데이터 위치 고정 (T1-74, 2026-08-10)
#
#   powershell -ExecutionPolicy Bypass -File scripts\start-minio.ps1
#
# 왜 이 스크립트가 필요한가:
#   기존에는 MinIO를 사람이 매번 손으로 실행했다(이 프로젝트가 관리하는
#   서비스가 아님, docs/DEVELOPMENT_ENVIRONMENT.md 참고). 그때 데이터
#   경로를 상대경로("minio-data")로 주면 실행한 위치(cwd) 기준으로
#   새 폴더가 만들어진다 — 지금까지는 그 결과로 데이터가 C:
#   (`...\-\.tmp\minio-data`)에 쌓였다.
#
#   T1-74(추가 SSD D드라이브 저장공간 이전)에서 기존 데이터
#   858,026,375바이트(752개 오브젝트)를 `D:\dev-data\minio-data`로
#   옮기고(robocopy /MOVE, 이동 전후 바이트 수 일치 확인 + API로 실제
#   이미지 1장을 다시 받아 무결성 확인) 로컬 API(4100)를 통해 실제
#   이미지가 정상적으로 조회됨을 확인했다. 이 스크립트는 **그 이후
#   누구든 MinIO를 다시 시작할 때 실수로 C:에 새 데이터 폴더를 만들지
#   않도록** 경로를 고정한 공식 진입점이다.
#
# 하는 일:
#   1. 9000(MinIO API)·9001(MinIO 콘솔) 포트가 이미 떠 있으면 그대로
#      두고 끝낸다(중복 실행 방지) — 다른 세션이 이미 띄운 것을 죽이지
#      않는다.
#   2. D:\dev-data\minio-data 가 없으면(첫 실행 등) 새로 만든다.
#   3. `<repo>\.tmp\minio.exe server D:\dev-data\minio-data
#      --console-address :9001` 을 백그라운드로 띄운다.
#   4. /minio/health/live 로 기동을 확인한다.
#
# 건드리지 않는 것: PostgreSQL(5432)·SSH 터널(3000/4000)·Bridge(4200/4201).
#
# 실행 파일 위치가 이 스크립트가 있는 워크트리 기준이 아닌 이유:
#   MinIO는 이 워크트리 전용이 아니라 이 PC의 로컬 개발 인프라 전체가
#   공유하는 서비스다(PostgreSQL과 같은 성격). 실행 파일
#   (`minio.exe`, 113MB)은 원래 사람이 내려받아 둔 메인 체크아웃
#   (`C:\Users\82104\Documents\GitHub\-\.tmp\minio.exe`)에만 있고, 이
#   워크트리(`...\-.worktrees\claude-chatbot-integration`)에는 없다
#   (T1-74에서 실측 확인). 그래서 실행 파일 경로는 $PSScriptRoot가
#   아니라 고정 경로를 쓴다 — 어느 워크트리에서 이 스크립트를 실행해도
#   같은 실행 파일·같은 데이터를 가리켜야 하기 때문이다.

$ErrorActionPreference = "Stop"
$dataDir = "D:\dev-data\minio-data"
$minioExe = "C:\Users\82104\Documents\GitHub\-\.tmp\minio.exe"

function Test-Port($port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

Write-Host "== MinIO 시작 (데이터: $dataDir) ==" -ForegroundColor Cyan

if (Test-Port 9000) {
  Write-Host "  9000번이 이미 떠 있습니다 — 중복 실행하지 않습니다." -ForegroundColor Yellow
  exit 0
}

if (-not (Test-Path $minioExe)) {
  Write-Error "MinIO 실행 파일을 찾을 수 없습니다: $minioExe"
  exit 1
}

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path "D:\dev-data\logs" | Out-Null

Start-Process -FilePath $minioExe `
  -ArgumentList "server", $dataDir, "--console-address", ":9001" `
  -WorkingDirectory (Split-Path -Parent $minioExe) `
  -WindowStyle Hidden `
  -RedirectStandardOutput "D:\dev-data\logs\minio.out.log" `
  -RedirectStandardError "D:\dev-data\logs\minio.err.log"

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest "http://127.0.0.1:9000/minio/health/live" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}

if (-not $ready) {
  Write-Error "MinIO(9000)가 뜨지 않았습니다. D:\dev-data\logs\minio.err.log 를 확인하십시오."
  exit 1
}

Write-Host "  MinIO 정상 (http://localhost:9000, 콘솔 http://localhost:9001)" -ForegroundColor Green
Write-Host "  데이터 위치: $dataDir"

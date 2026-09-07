# V1 정식 Production 배포 대상 현황 (T1-208, 2026-09-04)

> **2026-09-04 갱신(T1-210)**: 이 문서가 §2에서 "스스로 정하지 않고
> 남긴" 세 가지 결정이 사용자에 의해 확정되어(기존 EC2 재활용·
> `magicclean79.com`·S3 지금 생성) T1-210이 실제로 배포를 완료했다.
> **다만 실제로 접속해 보니 §1의 "S3 없음" 전제가 틀렸다** — 이미
> 2026-08-06(`TASK-5501`, 이 Bridge 체계 밖의 과거 작업)에 만든 실
> S3 버킷 2개가 있었다(버전 관리·암호화·퍼블릭 차단 전부 켜짐). 이
> 문서의 §1·§2는 **그 시점(SSH 미접속 상태)의 정확한 기록으로 그대로
> 둔다** — 아래 내용을 지우지 않고, 실제 배포 결과와 남은 마지막
> 수동 작업(AWS 보안그룹·Cloudflare DNS)은
> `docs/PROJECT_STATE.md`의 "T1-210" 절과
> `docs/DEVELOPMENT_ENVIRONMENT.md` §1.2를 참고한다.

> **이 문서는 "지금 실제로 배포할 곳이 있는가"에 답합니다.**
>
> `deployment-checklist.md`·`production-runbook.md`·`production-cutover.md`·
> `production-activation-runbook.md`·`validation-environment.md`는 이미
> **"어떻게 배포하는가"** 를 상세히 문서화하고 있습니다(Sprint 12~44,
> 코드로 자동 판정됨). 이 문서가 새로 답하는 것은 그것들이 전제로 깔고
> 있는 질문 하나 — **"그 대상이 지금 실제로 존재하는가"** — 뿐입니다.
> 추측하지 않고 이 저장소의 실제 파일·설정만 근거로 확인했습니다.

## 1. 실제로 확인한 것 — 지금 이 제품의 Production 대상은 없다

| 확인 항목 | 실측 결과 | 근거 |
| --- | --- | --- |
| 앱(API·Web) 전용 도메인 | **없음** | 저장소 전체에서 `magicclean79.com`을 참조하는 곳은 `bridge.magicclean79.com` 하나뿐이고, 이것은 ChatGPT↔Claude Code 개발 도구(Bridge, 4200/4201) 터널 주소다 — 제품 화면(API/Web)과 무관하다(`docs/DEVELOPMENT_ENVIRONMENT.md` §3-1, `bridge/openapi.yaml`) |
| 리버스 프록시 설정 | **없음** | 저장소에 `nginx`·`caddy`·`traefik` 설정 파일이 없다(전수 검색 확인) |
| 프로세스 관리자 설정 | **없음** | `Dockerfile`·PM2 `ecosystem.config.*`·systemd unit 파일이 저장소에 없다. `docker-compose.yml`은 Postgres·Redis·MinIO(로컬 인프라)만 정의하고 API/Web 앱 자체는 포함하지 않는다 |
| TLS/인증서 설정 | **없음** | Let's Encrypt·certbot·인증서 관련 설정 없음 |
| CI의 실제 배포(deploy) 단계 | **없음** | `.github/workflows/ci.yml`은 품질 게이트(build·typecheck·lint·test·live-checks)만 돌리고, 빌드 산출물을 어디로도 배포하지 않는다 |
| EC2 인스턴스 | **있다, 그러나 이 V1의 배포 대상이 아니다** | `ec2-3-39-9-111.ap-northeast-2.compute.amazonaws.com`에 SSH 터널(포트 3000/4000)로 접속 가능한 서버가 존재한다. 다만: ① 그 위에서 도는 코드가 어느 커밋인지 **미확인**(`docs/DEVELOPMENT_ENVIRONMENT.md` §4 "EC2에서 도는 코드의 커밋" — 미확인 항목), ② EC2의 DB는 로컬과 **다른 데이터**를 본다(로컬에 있는 Benchmark Project가 EC2에는 없음, 같은 문서 §1.3), ③ EC2의 배포 방법 자체가 "확인하지 않았다"로 남아 있다(같은 문서 §4), ④ 여러 공식 문서가 이 서버를 "**절대 건드리지 않는다**"고 명시한 보호 대상으로 취급한다(`docs/MASTER_GUIDE.md` §5, `AGENTS.md`) |

**결론**: T1-207이 고정한 "V1 상용화 기준선"(LEVEL2 다중 페이지 상세페이지
생성 파이프라인, 커밋 `775675e` + 워크트리 미커밋 변경)을 실제로 올릴
**호스트·도메인·리버스 프록시·프로세스 관리자가 아직 하나도 정해지지
않았다.** 이것은 코드 문제가 아니라 **아직 내려지지 않은 인프라 결정**이다.

## 2. 무엇을 스스로 정하지 않았는가 (BLOCKED — 사람 판단 필요)

아래는 이번 작업이 **추측해서 실행하지 않고** 그대로 남긴 항목이다.
실제 비용이 나가거나(신규 클라우드 리소스·도메인) 되돌리기 어려운
선택(기존 EC2를 이 V1의 정식 운영 서버로 재활용할지 여부)이라, 문서
확인만으로는 대신 정할 수 없다.

1. **어디에 배포하는가** — 기존 EC2(`ec2-3-39-9-111`)를 이 V1의 정식
   운영 서버로 재활용할지, 새 서버/인스턴스를 만들지.
2. **도메인** — 실제 서비스 도메인(예: `magicclean79.com`의 하위 도메인을
   쓸지, 새 도메인을 쓸지)과 그 도메인의 DNS 설정.
3. **비용이 발생하는 리소스** — Amazon S3 버킷(현재 MinIO는 개발 전용,
   `docs/operations/s3-migration.md`), TLS 인증서 발급, 새 인스턴스 등.

## 3. 실제로 준비되어 있는 것 (코드 레벨 — 이미 완료, 이번에 실측 재확인)

이 저장소는 "정식 상용화"를 위한 애플리케이션 레벨 안전장치를 이미
상당히 갖추고 있다. 이번 작업에서 로컬(포트 4300)에 `NODE_ENV=production`으로
직접 기동해 실측으로 재확인했다(아래 §4).

- **운영 필수 환경변수 검증 후 기동** — 필수값이 비면 기동 자체를
  거부한다(`packages/core/src/ops/env-spec.ts`, `ReadinessService`).
- **운영 자동 보안 강화** — `NODE_ENV=production`이면 세션 쿠키에
  `Secure` 속성이 자동으로 붙고(`AUTH_COOKIE_SECURE` 미지정 시 자동 on),
  로그인 응답 본문에서 토큰이 빠지는 쿠키 전용 모드가 자동으로 켜진다
  (`apps/api/src/auth/session-config.ts`).
- **배포 준비 자동 판정** — `GET /health/ready`(ADMIN)가 환경변수·DB·
  마이그레이션·저장소·관리자 계정·Provider 연결·버킷 버전관리·백업
  분리·재해복구 가능 여부를 자동으로 판정한다.
- **배포 게이트 스크립트** — `node scripts/deployment-gate.mjs`(운영
  기본값으로 엄격 판정), `pnpm cutover`(LLM·Vision·S3·CI 네 항목이
  실제 공식 주소로 전환됐는지), `pnpm validation:preflight`(실
  Provider 검증을 시작해도 되는가) — 전부 "확인하지 못한 것은 통과로
  세지 않는다"는 동일 원칙으로 설계돼 있다.
- **리버스 프록시 뒤에서 동작하도록 설계됨** — `PRODUCTION_HOSTS`(허용
  도메인 목록)·`TRUSTED_PROXY_IPS`(신뢰하는 프록시의 `X-Forwarded-Host`만
  신뢰)가 이미 구현돼 있다(`docs/operations/validation-environment.md`
  §4·§5). 즉 **리버스 프록시를 앞에 두는 구성 자체는 이미 지원된다** —
  실제 프록시 설정 파일(nginx 등)만 없을 뿐이다.
- **백업 디렉터리 필수화** — `BACKUP_DIR` 미설정 시 운영에서 기동을
  막는다(CTO 결정 1601-①). **이번 작업에서 발견한 작은 문제**: 이 값이
  운영 필수임에도 루트 `.env.example`에 예시 항목이 없었다 — 실제로
  기동 시도 시 즉시 실패로 드러나는 값이라 배포 자체를 막지는 않지만,
  운영자가 준비 단계에서 미리 알기 어려웠다. 이번에 `.env.example`에
  추가했다(§6).

## 4. 이번 작업이 로컬에서 재현한 Production 기동 결과 (실측, 비용 없음)

로컬 PostgreSQL(5432)·MinIO(9000, 개발용 S3 호환 저장소)를 그대로 둔 채,
API를 `NODE_ENV=production`·포트 4300(기존 3100/4100/4200/4201/3000/4000과
겹치지 않는 임시 포트)으로 직접 기동해 실제 운영 코드 경로를 확인했다.
**실 Provider 호출은 하지 않았다** — 아래 결과는 이미 DB에 남아 있는
과거 실행 기록을 판독한 것이다. 확인 후 프로세스는 종료했고 생성한
임시 백업 디렉터리도 정리했다.

### 4.1 필수값 없이 기동 시도 → 정상적으로 거부됨

`BACKUP_DIR`을 뺀 채 기동하면:

```
[ReadinessService] 환경 오류 [BACKUP_DIR] 필수 환경변수가 없습니다 — …
[Bootstrap] 환경 검증에 실패해 기동을 중단합니다 — 위 오류를 해결한 뒤 다시 시작하세요.
```

로 즉시 종료했다(exit 1). **의도한 설계대로 동작**한다.

### 4.2 필수값을 전부 채우고 기동 → 기동됨, `/health/ready` 판정

| 판정 | 항목 | 상태 | 비고 |
| --- | --- | --- | --- |
| 통과 | 데이터베이스 연결 · 이미지 저장소 접근 · 관리자 계정 · 실제 Provider 연결 · 이미지 버킷 준비 | pass | Provider 연결은 이 로컬 DB에 이미 남아 있는 과거 실 호출 기록(OpenAI·Google Vision) 기준 |
| 경고 | 환경변수(S3가 MinIO) · 비용 예산 미설정 · Failover 미설정 · IAM 조회 불가 | warn | 실제 S3·예산·Failover 설정 시 해소됨 |
| **차단** | **이미지 버킷 버전 관리** | fail | MinIO는 버전 관리 조회를 지원하지 않음 — Amazon S3 전환 후에만 해소 가능 |
| **차단** | **백업 버킷 준비·분리** | fail | 백업 전용 버킷이 없음 — 운영 담당자가 만들어야 함 |
| **차단** | **재해 복구 판정** | fail | 최근 성공한 백업이 없어 "지금 무너지면 되살릴 수 없음"으로 판정됨 |
| 직접 확인 | 마이그레이션 적용 · 실 Provider 스모크 · DB 백업/복구 확인 | manual | 실제 배포 시 사람이 1회 확인 |

`node scripts/deployment-gate.mjs`(`GATE_ENV=production`, 운영 기본값)를
같은 인스턴스에 돌리면 위 3개 차단 항목에 더해 **활성 critical 경보
12건**(전부 "Redis 분산 잠금을 쓸 수 없어 예약 점검이 멈춰 있다" —
이 로컬 환경에 Redis가 떠 있지 않기 때문, 실제 운영에서 Redis를 붙이면
해소됨)으로 최종 `exit 1`(배포 불가)을 돌려줬다. **이것은 버그가 아니라
게이트가 설계대로 "확인되지 않은 상태를 통과시키지 않은 것"**이다.

### 4.3 `pnpm cutover` 판정

| 항목 | 판정 | 근거 |
| --- | --- | --- |
| LLM(OpenAI) | ✅ `verified` | 공식 주소(`api.openai.com`)로 최근 성공한 실 호출 50건 기록 있음 |
| Google Cloud Vision(OCR) | ✅ `verified` | 공식 주소(`vision.googleapis.com`)로 최근 성공한 OCR 7건 기록 있음 |
| Amazon S3 | ❌ `not-production` | 지금 저장소는 MinIO(localhost) — Amazon S3로 전환 필요 |
| GitHub Actions | ❌ `unverified` | `GITHUB_REPOSITORY` 미설정 — CI 실행 이력을 읽을 대상이 지정 안 됨 |

**즉 LLM·OCR 실 연결은 이미 검증된 사실로 기록돼 있다** — 남은 것은
저장소를 Amazon S3로 옮기는 것과 CI 이력 조회 대상을 지정하는 것,
그리고 §2의 인프라 결정(호스트·도메인)이다.

> 참고: 이 명령은 정상 판정을 전부 출력한 뒤 Windows Node 런타임의
> libuv 비동기 핸들 정리 과정에서 어서션 오류로 종료 코드가 비정상값이
> 됐다(`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) …`,
> `src/win/async.c`). 판정 결과 자체는 오류 전에 전부 정상 출력됐고,
> 재현 시점은 Redis 연결 재시도 종료 이후였다 — 이번 작업 범위(Redis가
> 없는 로컬 환경에서의 1회성 스크립트 실행)에서는 판정 결과에 영향이
> 없어 별도로 고치지 않았다. 실 운영(Redis 연결됨, Linux 호스트)에서
> 재발하는지는 미확인이다.

## 5. 실제 배포에 필요한 나머지 단계 — 순서대로

이미 있는 절차 문서를 그대로 따르되, 이 V1에 맞춰 순서를 요약한다.

```
1. (사람) §2의 인프라 결정 — 호스트·도메인 확정
2. (사람) Amazon S3 버킷 2개(이미지·백업) 생성 + Versioning 켜기
   → docs/operations/s3-migration.md, deployment-checklist.md §1
3. (사람) 선택한 호스트에 리버스 프록시 + TLS 구성 → 아래 §6 예시 참고
4. (사람) 선택한 호스트에서 pnpm --filter api build && pnpm --filter api start,
   pnpm --filter web build && pnpm --filter web start 를 상시 구동하는
   프로세스 관리자(systemd 등) 구성 → 아래 §6 예시 참고
5. (사람) 운영 환경변수 설정 — WEB_URL(실 도메인) · PRODUCTION_HOSTS ·
   S3_* (Amazon S3) · BACKUP_DIR · AUTH_ADMIN_* · REDIS_URL 등
   → docs/operations/production-runbook.md §1.1, config/validation.env.example
6. (사람) DB 마이그레이션 배포 (`prisma migrate deploy`)
7. (기계) GET /health/ready — 배포 차단 항목이 0인지 확인
8. (기계) node scripts/deployment-gate.mjs — exit 0 확인
9. (사람) node scripts/real-provider-smoke.mjs — 배포 직후 1회, 과금됨
10. (기계) pnpm cutover — 4항목 전부 verified 확인
11. 문서 갱신 — docs/PROJECT_STATE.md에 실제 Production URL과 배포일 기록
```

## 6. 참고 예시 — 리버스 프록시 / 프로세스 관리자 (호스트 미정이므로 표본일 뿐)

**주의**: 아래는 실제로 적용된 설정이 아니다. §2의 인프라 결정이 내려진
뒤, 실제 호스트 OS·도메인에 맞춰 사람이 채워 써야 하는 **예시**다.
이 저장소 어디에도 실행되는 설정으로 등록돼 있지 않다.

### 6.1 nginx 리버스 프록시 예시 (Web 3000 · API 4000, 도메인 미정)

```nginx
server {
    listen 443 ssl;
    server_name <실제-도메인>;

    ssl_certificate     /etc/letsencrypt/live/<실제-도메인>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<실제-도메인>/privkey.pem;

    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # TRUSTED_PROXY_IPS에 이 프록시의 실제 주소를 등록해야
        # 애플리케이션이 X-Forwarded-Host를 신뢰한다.
    }

    location / {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name <실제-도메인>;
    return 301 https://$host$request_uri;
}
```

경로 기반(`/api/`) 대신 API 전용 서브도메인(예: `api.<도메인>`)을 쓸
수도 있다 — 그 경우 `NEXT_PUBLIC_API_URL`을 그 서브도메인으로, `WEB_URL`을
Web 도메인으로 맞춘다. **어느 쪽을 쓸지는 §2의 도메인 결정에 달려 있다.**

### 6.2 systemd 서비스 예시 (Linux 호스트 가정 — EC2가 Amazon Linux/RHEL 계열일 때 전형적인 구성)

```ini
# /etc/systemd/system/acos-api.service
[Unit]
Description=AI Product Content OS - API
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/acos/apps/api
EnvironmentFile=/opt/acos/apps/api/.env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5
User=acos

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/acos-web.service
[Unit]
Description=AI Product Content OS - Web
After=network.target acos-api.service

[Service]
WorkingDirectory=/opt/acos/apps/web
Environment=NODE_ENV=production
ExecStart=/usr/bin/node_modules/.bin/next start --port 3000
Restart=on-failure
RestartSec=5
User=acos

[Install]
WantedBy=multi-user.target
```

**Next.js는 `NEXT_PUBLIC_*` 환경변수를 빌드 시점에 고정한다** — 배포
파이프라인은 실제 API 도메인을 가리키는 `NEXT_PUBLIC_API_URL`을 설정한
채로 `pnpm --filter web build`를 실행해야 한다(기동 시점에 값을 바꿔도
이미 빌드된 결과물에는 반영되지 않는다).

## 7. 이번 작업이 바꾼 것 (최소 범위)

- `.env.example`(루트)에 운영 필수값인 `BACKUP_DIR` 예시 항목 추가
  (§3의 발견 사항 — 코드 동작은 바꾸지 않았다, 예시 파일에 누락된
  안내만 보강).
- 이 문서(신규) — 실제 배포 대상 조사 결과와 남은 단계.
- 애플리케이션 코드·V1 파이프라인·기존 운영 문서는 변경하지 않았다.

## 8. 관련 문서

| 문서 | 무엇 |
| --- | --- |
| [deployment-checklist.md](deployment-checklist.md) | 배포 전/후 체크리스트 (기계 판정) |
| [production-runbook.md](production-runbook.md) | 배포 실행 절차 |
| [production-cutover.md](production-cutover.md) | LLM·Vision·S3·CI 전환 판정 상세 |
| [production-activation-runbook.md](production-activation-runbook.md) | 활성화 8단계, 되돌리는 법 |
| [validation-environment.md](validation-environment.md) | 사람이 줘야 하는 4가지 (자격 증명·네트워크·검증 환경·호스트 목록) |
| [s3-migration.md](s3-migration.md) | MinIO → Amazon S3 전환 절차 |
| [disaster-recovery.md](disaster-recovery.md) | 백업·복원·재해 복구 판정 |

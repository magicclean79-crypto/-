# 개발환경 (SSOT)

> **이 문서가 개발환경에 대한 유일한 기준(Single Source of Truth)이다.**
>
> - 작업을 시작하기 전에 **반드시 이 문서를 먼저 읽는다.**
> - 환경이 바뀌면 **이 문서를 먼저 고치고, 그 다음 코드를 고친다.**
> - **환경을 추측하지 않는다.** 확인한 사실만 사용한다.
> - 확인하지 못한 것은 **"미확인"** 으로 적는다. 빈칸으로 두거나 짐작해서 채우지 않는다.
>
> 최종 확인: **2026-08-13** (T1-105 — `ACOS-Bridge` 재부팅 자동복구
> 실패의 **진짜 원인을 확정하고 고침**. §19까지는 "왜 실패하는지
> 미확인"이었으나, 이번에 실제 재부팅(이 세션 시작 직전, 12:45:20)
> 이후의 실측 트리거·실측 재현으로 **cloudflared 터널 실행 단계의
> `Start-Process` 리다이렉션 버그**(stdout·stderr을 같은 파일로
> 지정하면 `Start-Process` 자체가 예외를 던진다)가 원인임을 확정하고
> `bridge/start-bridge.ps1`을 수정함 — §20 추가. env var/경로 해석
> 문제 가설은 이번에 별도 실측으로 **반박**됨)
> **추가 확인: 2026-08-13 (T1-107)** — Claude Code 세션/transcript
> 저장 위치와 Bridge가 이를 쓰지 않는다는 것을 실측(§21). `claude.exe`
> 자체는 `--resume`/`--continue`/`--session-id`를 지원하지만, Bridge
> 헤드리스 호출은 이 중 어느 것도 쓰지 않아 taskId와 대화 transcript가
> 연결돼 있지 않다 — 재시작 후 복구는 파일(bridge/tasks·
> bridge/results·git)로만 가능하다(`docs/RECOVERY_GUIDE.md` §11).
> **추가 확인: 2026-08-13 (T1-120)** — CTO Worker 로그(C:)와 Bridge
> 서버(4200)·현황판(4201) 자신의 로그(리다이렉트 자체가 없었음)를
> `D:\dev-data\logs\`로 전환·신설하고, Task 상태 전이 최소 추적
> 로그(`bridge/bridge-ops-log.mjs`, `D:\dev-data\logs\bridge\
> task-state.log`)를 새로 만들었다. 전부 rotation 적용 — §23.
> 브랜치 `agents/claude-chatbot-integration` · 커밋 `0df5dae`
> (이 브랜치는 **아직 GitHub에 푸시된 적이 없음** — §12 참고)
> **추가 확인: 2026-08-14 (T1-130)** — 비대화형 GitHub 인증이 왜
> 안 되는지 재확인·확정(`GIT_TERMINAL_PROMPT=0` 없이는 Git
> Credential Manager가 무한 대기함)하고, 검증 통과 Task 단위로만
> 자동 commit하는 `scripts/git-task-sync.mjs`(신규, `bridge/`는
> 읽기만 함)를 만들었다. 기존 341건은 baseline으로 표시해 자동
> 대상에서 뺐다 — §24.
> **추가 확인: 2026-08-27 (T1-201)** — "3100/4100 접속 안 됨"이
> T1-178~T1-200에 걸쳐 반복 재발한 근본 원인 3가지를 확정하고
> 구조적으로 고쳤다: ① Playwright 자체 `webServer`가 사람 검증용
> 3100과 같은 포트를 다시 띄우려던 구조적 충돌(테스트 전용 포트
> 3101로 분리) ② 매번 수 분짜리 전체 재빌드라 무인 세션이 "기다리다
> 결과 기록 없이 끝나는" 패턴 반복(같은 커밋이면 재빌드 생략하는
> idempotent 단축 경로 추가) ③ 서버가 죽어도 로그가 없어 원인을
> 알 수 없었던 것(API·Web 표준출력/에러를 로그 파일로 리다이렉트) —
> §25.

---

## 0. 빠른 참조 요약 (T1-103)

**세션을 새로 시작했을 때 아래만 훑어도 감을 잡을 수 있다.** 근거·
전체 이력은 각 항목이 가리키는 절에 그대로 남아 있다 — 여기서는
지우거나 다시 설명하지 않고 **최신 결론만** 모은다. 실측이 이 요약과
다르면 실측이 맞다(`AGENTS.md` §0 Source of Truth).

| 포트 | 정체 | 자동 시작 |
| --- | --- | --- |
| 3000 · 4000 | SSH 터널 → EC2 Web·API (원격, **종료 금지**) | 미확인 — 사람이 수동 재연결 (§3-3) |
| 4200 · 4201 | Bridge 서버 · 현황판 | `ACOS-Bridge`(Boot 트리거) + `ACOS-Recovery-Manager`(Logon 트리거, 죽어 있을 때만 재시작, §22)가 이중으로 시도한다. **cloudflared 실행 단계의 근본 원인 버그를 T1-105가 확정·수정함**(§20) — 다음 재부팅에서 실제 성공해야 검증이 끝난다 |
| 5432 | 로컬 PostgreSQL | ✅ Windows 서비스, 자동. `ACOS-Recovery-Manager`가 죽어 있으면 `Start-Service`로 보강(§22) |
| 9000 | 로컬 MinIO | `ACOS-Recovery-Manager`가 재부팅마다 자동 확인·필요시 `scripts\start-minio.ps1` 실행(§22) — 더 이상 "의도적 미자동화"가 아니다 |
| 4100 · 3100 | 로컬 API·Web (검증용) | `ACOS-Recovery-Manager`가 재부팅마다 자동 확인·필요시 `scripts\start-verify-studio.ps1` 실행(§22) — 더 이상 "의도적 미자동화"가 아니다. 등록만 됐고 다음 실제 재부팅으로 콜드 스타트 검증은 아직 안 됨(§22-5). **이 스크립트가 유일한 공식 진입점**이며 같은 커밋이면 재빌드를 생략한다(idempotent, §25-2) — Playwright는 더 이상 이 포트를 쓰지 않는다(테스트 전용 3101, §25-1) |

**C:/D: 저장 정책** (§15~19 상세): **C: 는 OS·설치 프로그램·실행
필수 파일만 최소로 둔다. D:(`D:\dev-data\`)가 캐시·이미지·산출물·
임시파일의 기본 저장소다** — `minio-data`·`pnpm-store`·`npm-cache`·
`ms-playwright`·`turbo-cache`·`temp` 전부 D: 아래. **주의**: 이
전환은 레지스트리(`setx`, `HKCU\Environment`) 값이지, **이미 떠
있는 프로세스 트리(Bridge 서버·CTO Worker 포함)는 재부팅/재기동
전까지 옛 C: 값을 계속 쓴다**(§18~19에 이 세션 자신의 사례로 실증됨)
— C: 여유공간을 매번 다시 실측해야 하는 이유가 이것이다.

**재부팅 자동 복구 — "등록됨"과 "실제 성공"은 다르다** (§3-3·§19·§20
상세): PostgreSQL·`ACOS-CTO-Worker`는 실제 성공 이력이 있다.
`ACOS-Bridge`는 2026-08-13 12:45(이번 T1-105 세션 시작 직전 실제
재부팅)에도 다시 실패(코드 1)했으나, **이번에 실패의 정확한 원인을
찾아 `bridge/start-bridge.ps1`을 고쳤다**(§20) — cloudflared를 띄우는
`Start-Process` 호출이 표준출력·표준에러를 같은 파일로 지정해서
그 자체로 예외를 던지고 있었다(환경변수·경로 해석 문제가 아니었다).
다음 재부팅 전까지는 **여전히 실제 성공이 검증되지 않은 상태**다 —
재부팅 후 사람이 반드시 `http://localhost:4201`과
`https://bridge.magicclean79.com/health`을 직접 확인해야 한다.

**진단 스크립트**: `powershell -ExecutionPolicy Bypass -File
scripts\check-acos-environment.ps1` — 위 항목들을 읽기 전용으로
한 번에 실측하고 이 문서와 다른 점을 보여준다(`AGENTS.md` §0).

---

## 1. 개발 환경 개요

이 프로젝트는 **로컬 환경과 원격 EC2 환경이 동시에 떠 있고, 둘은 서로 다른
데이터베이스를 본다.** 이 사실을 모르면 "화면에 데이터가 안 보인다"를
버그로 오해하게 된다 — 실제로 이번 세션에서 그 혼동이 있었다.

### 1.1 로컬 환경

| 구성 | 상태 |
| --- | --- |
| PostgreSQL | `localhost:5432` · 데이터베이스 `acos` · **이 컴퓨터에서 직접 실행** |
| MinIO (오브젝트 저장소) | `localhost:9000` · 버킷 `acos` · **이 컴퓨터에서 직접 실행** |
| Local API | 이번 세션에서 **4100** 포트로 실행(테스트용, 세션 종료 시 정리) |
| Local Web | 이번 세션에서 **3100** 포트로 실행(테스트용, 세션 종료 시 정리) |
| Redis | **떠 있지 않음** — 6379 연결 거부. API는 단일 인스턴스 모드로 정상 동작 |

### 1.2 원격(EC2) 환경 — **2026-09-04 (T1-210)부터 Production 서버**

**이전 기록(미확인·순수 개발용 EC2)은 더 이상 맞지 않다.** T1-210이
이 EC2를 실제 Production으로 전환했다 — 상세 작업 내역은
`docs/PROJECT_STATE.md`의 "T1-210" 절, 배포 전 조사 결과는
`docs/operations/production-deployment-target.md` 참고.

| 구성 | 상태 |
| --- | --- |
| 호스트 | `ec2-3-39-9-111.ap-northeast-2.compute.amazonaws.com`(공인 IP `3.39.9.111`, AWS 서울) |
| 접속 | `ssh -i <detail-key.pem> ec2-user@…` — **키 파일은 `C:\Users\82104\Downloads\`에 없다.** 실제로는 탈착식 인증서 USB(E: 드라이브, §11 M-36)의 `E:\detail-key.pem`에 있다 |
| EC2 Web | `acos-web.service`(systemd, 자동 시작) — 3000 포트, `/home/ec2-user/acos-current`(심볼릭 링크) 실행 |
| EC2 API | `acos-api.service`(systemd, 자동 시작) — 4000 포트, 같은 심볼릭 링크 |
| 배포 코드 | `/home/ec2-user/acos-current` → `/home/ec2-user/acos-release-20260905-t1214`(T1-214가 배포, `cp -al`로 T1-210 기준선을 하드링크 복제한 뒤 T1-211/T1-212 통합분 5개 파일만 교체·`apps/web`만 재빌드). 직전 배포 `/home/ec2-user/acos-release-20260904`(T1-210 V1 기준선)는 그대로 보존했으나, `scp`가 대상 파일을 제자리 덮어써 두 릴리스가 같은 inode를 공유하게 된 파일이 5개 있다(`apps/web/app/page.tsx`·`admin/page.tsx`·`login/page.tsx`·`auth-gate.tsx`·`signup/page.tsx`) — **소스만 그렇고 두 릴리스의 `.next` 빌드 산출물은 서로 다른 BUILD_ID로 완전히 분리**돼 있어 구 릴리스를 재기동해도 실제로는 옛 화면이 그대로 뜬다(재빌드하지 않는 한). 진짜 롤백 대상은 여전히 `/home/ec2-user/acos`이며(`/home/ec2-user/rollback.sh`), 이 파일은 T1-214가 전혀 건드리지 않아 완전히 독립적임을 inode 비교로 확인했다 |
| EC2 Database | `acos-postgres`(Docker, `127.0.0.1:5432`만 바인딩) — 로컬과 **다른 실 데이터** |
| Object Storage | **로컬 개발과 달리 실 Amazon S3** — 버킷 `detail-generator-images-20260806`(이미지)·`detail-generator-backup-20260806`(백업, 분리됨), 둘 다 버전 관리·서버측 암호화(AES256)·퍼블릭 액세스 완전 차단 켜짐. 계정: IAM 사용자 `detail-generator`(S3 전용 권한, EC2·IAM·Route53 권한 없음) |
| 리버스 프록시 | `nginx`(신규 설치) — `magicclean79.com`/`www` → :3000, `api.magicclean79.com` → :4000. `certbot`+`python3-certbot-nginx` 설치 완료, **TLS는 아직 발급 안 됨**(§1.2-1 참고) |
| 백업 보관정책 | `/home/ec2-user/acos-data/backups`에 시간당 pg_dump, `acos-prune-backups.timer`(신규, 매일)가 7일 넘은 것을 자동 삭제 |
| 도메인 DNS | `magicclean79.com`은 Cloudflare 네임서버(`leo.ns.cloudflare.com`/`veda.ns.cloudflare.com`) — Route53이 아니다. `bridge.magicclean79.com`은 기존 Bridge 개발 도구 터널(Cloudflare Tunnel)이며 이 Production 전환과 무관하게 그대로 유지된다 |

#### 1.2-1. 이 세션이 끝내지 못한 것 — 계정 권한 부재로 남은 마지막 수동 작업

- **AWS 보안그룹**: 현재 인바운드는 22(SSH)뿐이다. 사람이 AWS
  콘솔에서 이 인스턴스의 보안그룹에 **TCP 80·443(0.0.0.0/0)만**
  추가해야 한다 — 3000·4000은 열지 않는다.
- **DNS**: Cloudflare 대시보드에서 A 레코드 3개(`magicclean79.com`·
  `www`·`api` → `3.39.9.111`)를 추가해야 한다. 기존
  `bridge.magicclean79.com` 레코드는 건드리지 않는다.
- 두 가지가 끝나면 EC2에서
  `sudo certbot --nginx -d magicclean79.com -d www.magicclean79.com -d api.magicclean79.com`
  한 번으로 TLS가 붙는다(이미 설치·nginx 연동 준비됨).

### 1.3 두 환경의 차이

| | 로컬 | 원격(EC2, Production) |
| --- | --- | --- |
| 실행 코드 | 이 워크트리의 코드 | T1-210이 배포한 시점의 스냅샷(`775675e`+미커밋) — 이후 로컬에서 바뀐 내용은 **다시 배포해야** 반영된다 |
| 데이터베이스 | `localhost:5432/acos` | 로컬과 **다른 실 데이터**(Docker Postgres) |
| Object Storage | 로컬 MinIO(`localhost:9000`) | **실 Amazon S3**(§1.2) |
| Benchmark Project | **있음** | **미확인** — 이번 작업은 EC2의 Benchmark 데이터 유무를 조사하지 않았다 |

> **가장 중요한 차이**: 로컬에서 코드를 고쳐도 **EC2에 다시 배포하기
> 전까지는 Production에 반영되지 않는다.** 로컬↔EC2 자동 동기화는
> 없다 — T1-210은 `tar`로 워크트리를 직접 전송했다(브랜치가 아직
> GitHub에 푸시되지 않아 `git pull`을 쓸 수 없었다).

---

## 2. 시스템 구성도

```
┌─────────────────────────────────────────────────────────────────────┐
│  개발자 PC (Windows)                                                 │
│                                                                      │
│   ┌──────────┐                                                       │
│   │ Browser  │                                                       │
│   └────┬─────┘                                                       │
│        │                                                             │
│        ├──── localhost:3000 ──┐                                      │
│        │                      │                                      │
│        ├──── localhost:4000 ──┤                                      │
│        │                      │                                      │
│        │              ┌───────▼────────┐                             │
│        │              │  SSH Tunnel    │  ssh.exe (PID 29384/20348)  │
│        │              │  -L 3000:3000  │  detail-key.pem             │
│        │              │  -L 4000:4000  │                             │
│        │              └───────┬────────┘                             │
│        │                      │                                      │
│        ├──── localhost:3100 ──┼──▶ ┌─────────────┐                   │
│        │      (테스트용)       │    │  Local Web  │                   │
│        │                      │    │  Next.js    │                   │
│        │                      │    └──────┬──────┘                   │
│        │                      │           │ NEXT_PUBLIC_API_URL      │
│        └──── localhost:4100 ──┼──▶ ┌──────▼──────┐                   │
│               (테스트용)       │    │  Local API  │                   │
│                               │    │  NestJS     │                   │
│                               │    └──┬───────┬──┘                   │
│                               │       │       │                      │
│                               │  ┌────▼───┐ ┌─▼──────────┐           │
│                               │  │ Local  │ │  MinIO     │           │
│                               │  │Postgres│ │  :9000     │           │
│                               │  │ :5432  │ │  버킷 acos  │           │
│                               │  │  acos  │ └────────────┘           │
│                               │  └────────┘                          │
└───────────────────────────────┼──────────────────────────────────────┘
                                │
                                │  SSH (인터넷)
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  AWS EC2  ec2-3-39-9-111.ap-northeast-2                              │
│                                                                       │
│   ┌─────────────┐        ┌─────────────┐        ┌─────────────┐      │
│   │  EC2 Web    │───────▶│  EC2 API    │───────▶│ EC2 Database│      │
│   │  :3000      │        │  :4000      │        │  (미확인)    │      │
│   └─────────────┘        └─────────────┘        └─────────────┘      │
│                                                                       │
│   ※ EC2 안의 저장소 구성은 미확인                                       │
└───────────────────────────────────────────────────────────────────────┘
```

**읽는 법**

- 브라우저에서 `localhost:3000` / `localhost:4000`을 열면 **SSH 터널을 타고
  EC2로 나간다.** 로컬 프로세스가 아니다.
- `localhost:3100` / `localhost:4100`은 **이 PC에서 도는 로컬 서버**이며,
  로컬 PostgreSQL과 MinIO를 본다.
- 로컬 PostgreSQL(5432)과 MinIO(9000)는 **터널과 무관하게** 이 PC에서 직접
  돈다.

---

## 3. Port Mapping

| 포트 | 실행 주체 | 역할 | 사용하는 DB | 비고 |
| --- | --- | --- | --- | --- |
| **3000** | `ssh.exe` (PID 29384/20348) | SSH 터널 → EC2 Web | (웹은 DB를 직접 안 봄) | 터널 종료 금지. 브라우저 기본 접속점 |
| **4000** | `ssh.exe` (동일 프로세스) | SSH 터널 → EC2 API | **EC2 Database (미확인)** | CORS 허용 출처 `http://localhost:3000` |
| **4100** | `node dist/main.js` | **Local API** (NestJS) | `localhost:5432/acos` | 테스트용. 세션 종료 시 정리함 |
| **5432** | `postgres` (PID 22932) | **Local PostgreSQL** | 자기 자신 (`acos`) | 이 PC에서 직접 실행. 마이그레이션 65개 전부 적용됨 |
| **9000** | `minio` (PID는 세션마다 바뀜) | **MinIO 오브젝트 저장소** | — | 버킷 `acos`. 이미지 원본·생성물 저장. **데이터 위치 `D:\dev-data\minio-data`**(T1-74, §15) |
| (3100) | `next dev` | Local Web (테스트용) | — | `NEXT_PUBLIC_API_URL=http://localhost:4100` |
| (6379) | — | Redis | — | **떠 있지 않음.** 없어도 단일 인스턴스로 동작 |
| **4200** | `node bridge/bridge-server.mjs` | **CTO Bridge** (ChatGPT ↔ Claude Code) | — | 토큰이 있으면 `0.0.0.0`, 없으면 `127.0.0.1`만. 터널 연결됨 |
| **4201** | `node bridge/bridge-board.mjs` | **Bridge 현황판** (사람이 보는 화면) | — | **`127.0.0.1` 고정 · 읽기 전용 · 터널에 연결하지 않는다** |

> **PID는 세션마다 바뀐다.** 위 PID는 2026-08-08 세션 기준 기록이며,
> 다음에는 반드시 다시 확인한다.

### 3-1. CTO Bridge 공개 주소는 **고정이 아니다**

Bridge(4200)를 ChatGPT가 부를 수 있게 하려고 **cloudflared 임시 터널**을
쓴다. 이 주소에는 알아 두어야 할 성질이 하나 있다.

> **터널을 다시 띄우면 주소가 바뀐다.**
> PC를 재부팅하거나, `cloudflared` 프로세스가 죽거나, `start-bridge.ps1`을
> 다시 실행하면 `https://<무작위 단어들>.trycloudflare.com` 이 **새로 발급된다.**
> 옛 주소는 그 순간부터 죽는다.

주소가 바뀌면 **두 곳을 같이 고쳐야** 한다. 하나만 고치면 ChatGPT는
연결에 실패한다.

| 고칠 곳 | 무엇을 |
| --- | --- |
| `bridge/openapi.yaml` | `servers[0].url` 을 새 주소로 |
| ChatGPT 커스텀 GPT → Actions | 명세를 다시 붙여넣기 |

새 주소는 터널을 띄운 스크립트가 `bridge/tunnel-url.txt` 에 적어 둔다.
이 파일이 **항상 최신 주소**이며, `.gitignore`로 저장소에는 올라가지 않는다.

**토큰은 주소와 달리 바뀌지 않는다** — `bridge/.secrets/bridge-token.txt`
에 남아 있고, 스크립트는 파일이 있으면 그대로 재사용한다. 따라서 재부팅
후에 ChatGPT 쪽에서 다시 넣어야 하는 것은 **주소뿐**이다.

고정 주소가 필요하면 Cloudflare 계정 + 도메인으로 Named Tunnel을 써야
하고, 그건 사람이 직접 가입·인증해야 한다.

### 3-2. 터널에는 **100초 제한**이 있다

Cloudflare는 응답이 100초 안에 시작되지 않으면 **524**를 돌려준다. Claude
Code 한 번 호출은 수 분~수십 분이므로, 실행을 HTTP 응답으로 기다리면 반드시
걸린다(실측, 2026-08-09, T1-22).

그래서 Bridge는 **요청과 실행을 분리한다.**

| | |
| --- | --- |
| `POST /run` | 실행을 시작하고 **즉시 202** (실측 83ms) |
| `GET /tasks/:id` | 진행·결과 확인. 여러 번 부른다 |
| 현황판 `localhost:4201` | 사람이 눈으로 보는 곳 |

**524가 났다고 작업이 죽은 것은 아니었다.** 끊긴 것은 응답뿐이고 서버는
끝까지 일했다. 문제는 결과를 볼 방법이 없던 것이다 — 지금은 상태로 본다.

### 3-3. 재부팅 후 자동 복구 — 무엇이 자동이고 무엇이 수동인가 (T1-54, 2026-08-09)

**목표**: PC를 재부팅해도 사람이 명령어를 치지 않고 Bridge(4200)·현황판
(4201)·CTO Worker가 다시 뜨는 것. **이번 세션은 재부팅 자체를 하지
않았다** — 아래는 재부팅 없이 확인 가능한 범위(작업 스케줄러 등록
상태·스크립트 로직·대체 포트 실측)에서 얻은 결과다.

| 구성요소 | 재부팅 시 자동 복구 | 방법 | 확인 방법 |
| --- | --- | --- | --- |
| **PostgreSQL (5432)** | ✅ 자동 | Windows 서비스 `postgresql-x64-16`, 시작 유형 `Automatic` | `Get-Service postgresql-x64-16` — 이번 세션에 이미 그렇게 설정돼 있었다(새로 만들지 않음) |
| **CTO Worker** | ✅ 자동 | 기존 작업 스케줄러 `ACOS-CTO-Worker`(로그온+시스템 시작 트리거, `bridge/start-cto-worker.ps1` 실행) — **이미 등록돼 있었다. 이번 세션은 그대로 유지했다** | `Start-ScheduledTask ACOS-CTO-Worker`로 실제 트리거해 확인 — 이미 실행 중이던 worker(PID 26484)를 건드리지 않고 "이미 실행 중인 worker가 있습니다"로 안전하게 스스로 멈췄다(`bridge/.worker-logs/worker-*.err`), `LastTaskResult`가 `0`(성공)으로 갱신됨 |
| **Bridge 서버(4200)·현황판(4201)** | ✅ 자동 (**이번 세션에 신규 등록**) | 새 작업 스케줄러 `ACOS-Bridge`(로그온+시스템 시작 트리거, `bridge/start-bridge.ps1` 실행 — **파일은 수정하지 않았다**, 기존 스크립트를 그대로 가리키기만 함) | 라이브 4200/4201을 재시작하면 이 세션 자신이 그 자식 프로세스일 위험이 있어(`PROJECT_MEMORY` M-30·M-26) **실제 트리거는 하지 않았다.** 대신 대체 포트(4210/4211)에서 `bridge-server.mjs`·`bridge-board.mjs`를 `start-bridge.ps1`과 같은 절차(포트 정리→기동→`/health` 폴링)로 직접 띄워 health check 200·현황판 200·부모-자식 프로세스 관계·포트 정리 후 잔여 프로세스 0건을 확인했다 |
| **로컬 웹(3100)·로컬 API(4100)** | ❌ 의도적으로 미자동화 | — | **자동 기동하지 않기로 결정** — 이 문서 §4-14·§4-16(M-13·M-14)에 이미 기록된 대로 3100/4100은 원격(3000/4000)과 공존하는 **세션 단위 검증용**이며, 상시 띄워 두면 로컬 Next.js 3000번과 충돌하고(M-13) 빌드가 Prisma 엔진 파일을 잠가 실패한다(M-14). 매 재부팅마다 무조건 띄우면 이 두 문제가 항상 재발한다. **"필요 시"** 사람이 §9(Benchmark 테스트 절차)를 그대로 따라 수동으로 띄우는 것이 맞다고 판단했다 |
| **MinIO(9000)** | ❌ 자동 아님(기존 상태 그대로) | 현재 `.tmp/minio.exe`를 사람이 직접 실행한 프로세스이며 Windows 서비스가 아니다(`Get-Service`로 재확인, 결과 없음) | 로컬 API(4100)를 쓸 때만 필요하고, 로컬 API 자체가 위 이유로 자동화 대상이 아니므로 **이번 세션에서는 MinIO 서비스화를 새로 만들지 않았다** — 로컬 웹/API를 수동으로 띄울 때 MinIO도 함께 확인해야 한다 |
| **cloudflared 터널(ChatGPT 공개 주소)** | ⚠️ 부분 자동 | `start-bridge.ps1`이 재부팅마다 새 임시 주소를 발급한다(§3-1) | Bridge 서버·현황판은 뜨지만, **주소가 바뀌므로 ChatGPT Actions 재등록은 항상 사람이 해야 한다** — 이건 자동화할 수 없는 외부 서비스 설정이다(§3-1) |
| **SSH 터널(3000/4000, 원격 EC2)** | 미확인 · 이번 작업 범위 밖 | — | 원격 환경은 건드리면 안 되는 대상이라 이번 세션은 손대지 않았다. 재부팅 후 터널이 자동으로 다시 붙는지는 **확인하지 않았다** — 필요하면 사람이 직접 재연결해야 한다고 보수적으로 가정한다 |

**등록에 관리자 권한이 필요한가**: 이번 세션의 PowerShell은 이미 관리자
권한으로 실행 중이었다(`[Security.Principal.WindowsPrincipal]::IsInRole
(Administrator)` → `True`). `ACOS-Bridge`는 기존 `ACOS-CTO-Worker`와 같은
방식(로그인 사용자 계정의 S4U 인증, 암호 저장 없음)으로 등록했고 등록
자체는 오류 없이 성공했다 — **이 방식이 관리자 권한 없이도 되는지는
확인하지 않았다**(이번 세션이 이미 관리자였으므로 비교할 수 없었다).
관리자가 아닌 세션에서 새로 등록해야 한다면 먼저 시도해 보고, 거부되면
관리자 PowerShell이 필요하다.

**"최신 소스를 반영"하는가**: `bridge/*.mjs`는 빌드·컴파일 단계가 없는
순수 ESM 파일이라(`node bridge/bridge-server.mjs`로 직접 실행, 루트
`package.json`에 별도 bridge 빌드 스크립트 없음을 확인) 워크트리의 코드를
그대로 그때그때 실행한다 — 정적 산출물이 없어 "오래된 빌드가 뜬다"는
문제 자체가 구조적으로 없다.

**중복 프로세스 방지**: `start-bridge.ps1`은 기동 전에 4200·4201을 점유한
프로세스를 먼저 종료한다(스크립트 27~34행, 이번 세션이 만들지 않은 기존
로직). 대체 포트 실측에서 이 절차를 그대로 반복했을 때 정리 후 잔여
프로세스가 정확히 0건이었다. `ACOS-CTO-Worker`의
`MultipleInstancesPolicy: IgnoreNew`와 worker 자신의 잠금 파일
(`cto-worker.lock`)이 이중으로 중복 실행을 막는 것도 실측으로 확인했다.

### 3-3-1. 라이브 4200/4201은 Bridge가 부른 Claude Code 세션이 스스로 재시작할 수 없다 — 실측 확정 (T1-46, 2026-08-11)

**이전에는 "위험이 있어 재시작하지 않았다"는 추정이었다. 이번엔 이
세션 자신의 프로세스 계보로 직접 증명했다.**

```
nohup.exe → node bridge/bridge-server.mjs(PID, 포트 4200)
  → claude.exe(Bridge가 부른 이 세션)
```

`bridge-executor.mjs`의 `callClaude`는 `spawn()`을 `detached` 없이
호출하고, 자식(Claude Code) 종료 후 `RESULT_JSON`을 캡처해
`bridge-io.writeResult`를 호출하는 코드는 **그 자식을 스폰한
bridge-server.mjs 프로세스 자신 안에서** 실행된다. 즉 Bridge를 통해
기동된 어떤 Claude Code 세션도 자신을 있게 한 bridge-server 프로세스를
재시작(=종료)하면, 그 순간 자기 자신의 최종 결과를 기록할 프로세스가
사라져 **그 세션 자신의 작업 결과가 영구히 유실된다**(빈
`workDone: []`로 멈춘 채 남는 것이 정확히 이 증상 — T1-46 최초
시도가 실제로 이렇게 유실됐다).

**결론**: 라이브 4200/4201의 실제 코드 교체(`start-bridge.ps1` 재실행)는
**Bridge가 부르지 않은, 사람이 직접 여는 터미널 세션**에서만 안전하게
할 수 있다 — Bridge 작업으로 지시해도 그 작업을 실행하는 세션 스스로는
할 수 없는, 프로세스 모델 자체의 구조적 한계다. 이후 어떤 작업도 이
전제 위에서 판단해야 한다(재시도할 필요 없음 — 매번 같은 결론에
도달한다).

**재부팅 후 사람이 직접 확인해야 하는 것**:

1. **실제 재부팅 후 `ACOS-Bridge`·`ACOS-CTO-Worker` 둘 다 `Get-ScheduledTask`의
   `LastTaskResult`가 `0`인지, `http://localhost:4200/health`·
   `http://localhost:4201`이 응답하는지** — 이번 세션은 재부팅 자체를
   하지 않았으므로 실제 재부팅 경로는 검증하지 못했다.
2. **C 드라이브 여유 공간** — 이번 세션 확인 시점 기준 **0.76GB**(`Get-PSDrive
   C`). §10·§11에 기록된 기존 문제가 해소되지 않았다. 여유가 없으면
   MinIO 저장 거부(M-15)·빌드 실패·Bridge 파일 0바이트 손상(M-30) 같은
   문제가 재부팅 후에도 그대로 재발할 수 있다.
3. **cloudflared 터널 새 주소를 ChatGPT Actions에 다시 등록** — 재부팅마다
   반드시 필요하다(자동화 불가, §3-1).
4. **SSH 터널(3000/4000) 재연결 여부**.
5. **로컬 웹(3100)/API(4100)이 필요하면 §9 절차로 수동 기동** — 자동화
   대상이 아니다.

---

## 4. 이번 세션에서 확인한 사실

아래는 **전부 실제로 확인한 것**이다. 각 항목에 근거를 함께 적는다.

| # | 사실 | 근거 |
| --- | --- | --- |
| 1 | **3000은 SSH 터널을 통해 EC2 Web에 연결된다** | 포트 점유 프로세스가 `ssh.exe`이고 명령줄에 `-L 3000:127.0.0.1:3000 ec2-user@ec2-3-39-9-111…` |
| 2 | **4000은 SSH 터널을 통해 EC2 API에 연결된다** | 같은 `ssh.exe` 명령줄에 `-L 4000:127.0.0.1:4000` |
| 3 | **4100은 Local API이다** | 이 워크트리의 `apps/api/dist/main.js`를 `PORT=4100`으로 직접 실행함 |
| 4 | **Local PostgreSQL은 `localhost:5432`이다** | 포트 점유 프로세스 `postgres`, `apps/api/.env`의 `DATABASE_URL`이 `postgresql://…@localhost:5432/acos` |
| 5 | **Benchmark Project는 Local DB에 존재한다** | 로컬 4100에서 생성·조회 성공 (ID §5 참고) |
| 6 | **원격 DB에는 Benchmark Project가 없다** | 4000번 `GET /projects` 결과 프로젝트 1개("3단 접이식 캠핑매트")뿐, 벤치마크 ID 미포함 |
| 7 | **MinIO는 로컬 `localhost:9000`, 버킷 `acos`** | 포트 점유 프로세스 `minio`, API 기동 로그 `Object storage ready (bucket: acos)` |
| 8 | **로컬 DB에 마이그레이션 7개가 빠져 있었고, 이번에 적용했다** | 적용 전 `prisma migrate status`에서 미적용 7건 → `migrate deploy` 후 "65 migrations … up to date" |
| 9 | **Redis(6379)는 떠 있지 않다** | 포트 연결 거부. API 로그에 `Redis 오류` 경고, 그래도 정상 기동 |
| 10 | **3000/4000과 3100/4100은 서로 다른 데이터를 본다** | #5·#6이 직접적인 근거 |
| 11 | **EC2 Web과 EC2 API는 연결되어 있다** | 4000번 응답 헤더 `Access-Control-Allow-Origin: http://localhost:3000` |
| 12 | **원격 관리자 계정은 `admin@acos.local`/`admin1234`가 아니다** | 4000번 로그인 시도 시 401 |
| 13 | **로컬 관리자 계정은 `admin@acos.local`/`admin1234`이다** | 4100번 로그인 200 |
| 14 | **Next.js는 같은 폴더에서 개발 서버 2개를 거부한다** | 3100 실행 시 `Another next dev server is already running` |
| 15 | **로컬 Next.js를 종료해도 SSH 터널은 유지된다** | node 프로세스 3개 종료 후 `ssh.exe` PID 29384·20348 생존 확인 |
| 16 | **`benchmark/constants.ts`의 사진 ID는 원격 DB의 것이다** | 로컬 4100 화면에서 7장 전부 "불러오기 실패", 로컬 ID로 바꾸자 정상 표시 |

### 미확인 항목

| 항목 | 왜 확인하지 못했는가 |
| --- | --- |
| **EC2의 `DATABASE_URL`** | 원격 서버 파일을 읽지 않았다. 로컬과 다르다는 것만 데이터로 판정 |
| **EC2에서 도는 코드의 커밋** | 원격 접속으로 확인하지 않았다 |
| **EC2의 오브젝트 저장소 구성** | 확인하지 않았다 |
| **EC2 배포 방법** | 확인하지 않았다 |
| **원격 관리자 계정** | 알지 못한다 |

---

## 5. Benchmark Dataset

**공식 Benchmark 제품은 "베란다 호스"이다.**
정식 명칭: **베란다용 스텐 호스 세트 3M** (제조 삼정글로벌시스템(주))

### 5.1 목적

같은 제품으로 반복 측정해야 **변경 전후를 비교**할 수 있다. 제품이 바뀌면
품질이 좋아진 것인지 제품이 쉬워진 것인지 구분할 수 없다.

- GPT 검증
- Product Profile 검증
- Product Package 검증
- Gemini 검증
- Claude 검증
- Regression Test

### 5.2 규칙

- 앞으로 **모든 테스트는 Benchmark Dataset을 사용한다.**
- 새로운 Benchmark는 **사람 승인 없이 추가하지 않는다.**
- Benchmark Dataset은 **삭제하거나 초기화하지 않는다.**

### 5.3 Local Benchmark (2026-08-08 생성)

```
Project ID         cmskcpy8z0031ulncv49nb0rl
Product Profile ID cmskd40bz000nulpwfomj76c1
```

| 순서 | Image ID | 내용 |
| --- | --- | --- |
| 1 | `cmskd3e590004ulpw8fatga47` | 분사기 본체 (대표) |
| 2 | `cmskd3e590006ulpwmcosfdsq` | 고무 패킹 2개 |
| 3 | `cmskd3e590008ulpw58jfbdkv` | 스테인리스 호스 3M |
| 4 | `cmskd3e59000aulpwd4qx4l9t` | 포장지 앞면 |
| 5 | `cmskd3e59000culpwcshzjvyj` | 포장지 뒷면 |
| 6 | `cmskd3e5a000eulpwtqed80ld` | 포장지 뒷면 (사용법) |
| 7 | `cmskd3e5a000gulpwu7prd9m6` | 포장지 뒷면 (확대) |

원본 사진 파일: `C:\Users\82104\Downloads\KakaoTalk_20260807_1833*.jpg` (7장)

### 5.4 `benchmark/constants.ts`와의 불일치 — 미해결

`apps/web/app/benchmark/constants.ts`의 `BENCHMARK_IMAGE_IDS`는 **원격 DB의
ID**(`cmsirl…`)이며, 로컬에서는 열리지 않는다.

**이 파일은 사람 승인 없이 수정하지 않는다.** 위 로컬 ID로 교체할지는
승인 대기 중이다.

---

## 6. Sprint 구조

```
Sprint 1
──────────────────────────────────────────
   GPT
    ↓
   Product Profile
    ↓
   Product Package
    ↓
   Gemini
    ↓
   브라우저 검증
    ↓
   사람 승인


Sprint 2
──────────────────────────────────────────
   Claude
    ↓
   상세페이지 생성
    ↓
   품질 개선
```

---

## 7. 개발 규칙

1. **Local → Benchmark → 검증 → 승인 → 원격** 순서로 진행한다.
2. **Sprint 1 완료 전에는 Claude 기능을 추가하지 않는다.**
3. **원격 환경은 검증이 끝난 후에만 반영한다.**
4. **모든 변경은 Regression Test를 통과해야 한다.**

추가로 이번 세션에서 확인된, 지켜야 할 실무 규칙:

5. 원격에서 확인하려다 **배포되지 않은 코드를 테스트하는 실수**를 하지 않는다.
   원격(3000/4000)에는 이번 스프린트 변경이 반영돼 있지 않다.
6. 로컬 서버는 **원격과 다른 포트**(3100/4100)로 띄운다. 3000/4000을
   빼앗지 않는다.
7. **SSH 터널은 종료하지 않는다.**

---

## 8. 브라우저 검증 체크리스트

카테고리 패널의 **상세보기**를 눌러 아래 항목이 전부 보이는지 확인한다.

- [ ] Product Package (JSON 원본)
- [ ] Gemini Prompt (실제 전달된 문장 전문)
- [ ] Gemini Raw Response
- [ ] Provider
- [ ] Model
- [ ] Category
- [ ] 생성 이미지
- [ ] 다중 선택 (여러 장 동시 선택)
- [ ] 선택 결과 저장 (새로고침 후에도 유지)

> **2026-08-08 확인**: 9개 중 8개 표시 확인. `Gemini Raw Response`는
> 이번 실행에서 Gemini가 텍스트를 반환하지 않아(`null`) **표시 자체를
> 확인하지 못했다** — 값이 있을 때만 그리는 구조라서, 화면 결함인지는
> **미확인**이다.

---

## 9. Benchmark 테스트 절차

```
   베란다 호스 (사진 7장)
    ↓
   GPT                    ← 실제 과금
    ↓
   Product Profile
    ↓
   Product Package
    ↓
   Gemini                 ← 실제 과금
    ↓
   브라우저 확인
    ↓
   사람 선택
    ↓
   품질 평가
    ↓
   Regression Test
```

### 실행 순서 (2026-08-08 실측, 2026-08-09 T1-62에서 WEB_URL 추가)

```
1. 로컬 인프라 확인      PostgreSQL 5432 · MinIO 9000
2. Local API 실행        PORT=4100 WEB_URL=http://localhost:3100 node apps/api/dist/main.js
3. 로그인                admin@acos.local / admin1234
4. Product Profile 생성  POST /product-profile   ← 과금
5. 이미지 후보 생성      POST /image-gen/candidates   ← 과금
6. Local Web 실행        NEXT_PUBLIC_API_URL=http://localhost:4100, 포트 3100
7. 브라우저 확인         §8 체크리스트
8. 정리                  3100/4100 종료 → pnpm --filter web dev 로 원상 복구
```

**2번의 `WEB_URL=http://localhost:3100`을 빠뜨리면 안 된다** —
`apps/api/.env`의 `WEB_URL` 기본값이 `http://localhost:3000`으로
고정돼 있어, 이 값 없이 띄우면 6번 로컬 Web(3100)에서 오는 모든
요청이 데이터가 있어도 CORS로 막힌다(`PROJECT_MEMORY.md` M-39,
2026-08-09 T1-62). `curl`은 CORS를 검사하지 않으므로 `curl`로는 이
문제가 재현되지 않는다 — 반드시 `curl -H "Origin: http://localhost:3100"`
로 `Access-Control-Allow-Origin` 응답 헤더가 실제로 `3100`인지 확인한다.

### 주의

- **4·5번은 실제 요금이 발생한다.** 실행 전 사람의 승인을 받는다.
- 6번을 하려면 로컬 Next.js를 잠시 멈춰야 한다(§4-14). **SSH 터널은 그대로
  둔다.**
- 끝나면 **반드시 원래 개발 환경으로 복구한다.**

---

## 10. 알려진 문제

| | 문제 | 상태 |
| --- | --- | --- |
| 🔴 | **OCR 결과가 0자** — 포장지 사진 4장에 글자가 가득한데 하나도 읽지 못했다. 그 결과 Product Profile이 사진 추측에만 의존한다(제품명·브랜드·길이 누락) | 미해결 · Sprint 1 범위 밖 |
| 🟡 | `benchmark/constants.ts`가 원격 ID를 가리킨다 | 승인 대기 (§5.4) |
| 🟡 | ESLint 오류 4건 (`apps/web/app/benchmark/*`, `design-review/*`) — `react-hooks` 규칙이 설정에 등록되지 않아 발생. 이번 변경과 무관 | 기존 문제 |
| 🟡 | `apps/api/src/ops/ops.spec.ts` 8건 실패 — 변경 전 상태에서도 동일하게 실패함을 확인 | 기존 문제 |
| 🟡 | C 드라이브 여유 공간 부족으로 MinIO가 저장을 거부한 적 있음 (0.4GB) | 재발함 — 2026-08-09 재확인 시 **C: 여유 3.0GB** (`Get-PSDrive`). E: 드라이브는 28.9GB 비어 있어 대안 가능. 이전 절차는 §11 참고 |

---

## 11. 하드웨어 변경 대응 (T1-30, 2026-08-09)

새 PC로 옮기거나 내장 SSD를 추가할 때의 표준 절차는
[`docs/RECOVERY_GUIDE.md`](RECOVERY_GUIDE.md) §9에 정리했다. 이 문서에는
**환경 SSOT로서 근거가 되는 실측 사실만** 남긴다.

| 사실 | 실측 방법 | 확인일 |
| --- | --- | --- |
| 앱 코드(`apps/`·`packages/`)에는 이 PC 전용 절대경로가 없다 | `grep -r "C:\\Users\\82104"` — 결과 없음 (bridge 등록 정보 제외) | 2026-08-09 |
| pnpm 전역 캐시 위치 | `C:\Users\82104\AppData\Local\pnpm\store\v10` (`pnpm store path`) | 2026-08-09 |
| `.env.example`·`pnpm-lock.yaml`·`pnpm-workspace.yaml`이 전부 git에 있다 | `git ls-files` | 2026-08-09 |
| 로컬 DB 마이그레이션이 git만으로 재현된다 | `prisma migrate status` → "65 migrations … up to date" | 2026-08-09 |
| 이 PC에 Bridge 자동 시작용 예약 작업이 없다 | `Get-ScheduledTask` — bridge·acos·claude 관련 항목 0건 | 2026-08-09 |
| **`bridge/`가 git으로 영속화되어 있다**(비밀값·터널 주소 등 환경 종속 값은 제외) | `git ls-files bridge/` → **41개 파일**(작업 15건·결과 10건 포함, 커밋 `35b1ea5`). `node bridge/check-secrets.mjs --all` 결과 59건 중 `bridge/` 안은 **0건** | 2026-08-09 (T1-30 재검증) |

**과거에는 이 표에 "`bridge/` 아래 전부가 git에 커밋된 적이 없다"는
사실이 있었다.** 2026-08-09 사장님 결정으로 bridge/를 git에
포함시켰고(비밀값·터널 주소 등만 `.gitignore`로 제외), 위 행이 그
결과다. 새 PC에서 여전히 사람이 직접 만들어야 하는 것(토큰·터널
주소 등)은 `RECOVERY_GUIDE.md` §9-7에 정리했다.

## 12. 재부팅 전 상태 점검 (T1-56, 2026-08-10)

**C: 드라이브 여유공간 최신 실측**: `Get-PSDrive C` → **0.71GB**
(총 111.22GB 중 사용 110.52GB). §10·§11에 기록된 기존 문제가
해소되지 않고 T1-55 시점(0.74GB)보다 더 줄었다. `.turbo`/pnpm 캐시
등 안전 이동 후보와 위험 조사는 `docs/PROJECT_STATE.md` §3-11(T1-55)
에 이미 있다 — 이번에는 재확인만 했다.

**GitHub 원격 상태 실측**: `origin =
https://github.com/magicclean79-crypto/-.git`. 현재 브랜치
`agents/claude-chatbot-integration`은 **업스트림이 설정돼 있지 않고,
`git branch -r --contains HEAD`가 빈 결과** — 이 브랜치 자체가 GitHub에
한 번도 푸시되지 않았다. `origin/claude/ai-product-content-os-setup-jb5oai`
대비 로컬이 2개 커밋 앞서 있다(`35b1ea5`·`0df5dae`, 뒤짐 0개). 작업
트리에는 102건의 미커밋 변경(추적 26·미추적 76, 대부분 `bridge/`)이
있다 — 상세 근거·체크리스트는 `docs/PROJECT_STATE.md` §3-12(T1-56)에
있다. 커밋·푸시는 사람이 명시적으로 요청할 때만 하는 이 프로젝트의
표준 절차에 따라 이번에도 실행하지 않았다.

**재부팅 자동 복구 스케줄러 재확인**: `ACOS-CTO-Worker`는 최근
(2026-08-09T23:30) 실제로 성공 실행된 이력이 있다(`LastTaskResult:
0`). `ACOS-Bridge`는 등록만 되어 있고 아직 한 번도 트리거된 적이
없다(`LastTaskResult: 267011` = 미실행) — §3-3에 이미 기록된
미검증 상태 그대로다. 스케줄러가 참조하는 스크립트 중
`bridge/start-cto-worker.ps1`이 **아직 git에 커밋되지 않은
상태**임을 새로 확인했다(`bridge/start-bridge.ps1`은 이미 커밋됨).

## 13. 재부팅 전 상태 점검 재확인 (T1-58, 2026-08-10)

**C: 드라이브 여유공간 갱신**: `Get-PSDrive C` → **9.15GB**(총
111.22GB 중 사용 109.60GB). T1-57(같은 날, 이 문서 §12 직후)이
`.turbo/cache`(8.01GB, git 비추적 캐시)를 삭제해 0.71GB→8.78GB로
확보했고, 이번 세션 재실측에서 9.15GB로 재확인했다 — §3-5 권장
최소치(5GB)를 넘겼다. §10·§11·§12에 기록된 디스크 부족 문제는
**이번 실측 기준으로는 해소됐다**(단, 원인이었던 근본적인 "디스크
여유가 얇다"는 사실 자체는 남아 있어 재발 가능 — `PROJECT_MEMORY.md`
M-15·M-30·M-36 참고).

**빌드 재검증 시 재확인된 것(M-14 재현)**: 여유공간이 확보된
상태에서도 로컬 API(포트 4100, `node dist/main.js`)가 떠 있는 채로
`pnpm turbo run build`를 돌리면 `api#build`가 Prisma Client DLL
rename에서 `EPERM`으로 실패했다(재현 확인) — 디스크 문제가 아니라
M-14에 이미 기록된 파일 잠금 문제임을 실제 로그로 구분했다. 로컬
API를 내리고 재실행하니 6/6 성공했고, 검증 종료 후 같은 방식
(`PORT=4100 node dist/main.js`)으로 다시 띄워 원상 복구했다.

## 14. Image Studio 고정 사람검증 환경 (T1-63, 2026-08-10)

**문제**: 3100(Studio)·4100(API)은 매 세션마다 사람이 손으로
`next dev`·`node dist/main.js`를 다시 띄우는 **임시 검증용**이었다
(§4-1·§9). 이 워크트리는 여러 Bridge 세션이 동시에 코드를 계속
고치는 곳이라(`PROJECT_MEMORY.md` M-28), `next dev`는 다른 세션이
파일을 고칠 때마다 그 자리에서 재컴파일해 **사람이 보는 화면이
검증 도중에도 바뀔 수 있었다.** 확인 시점(2026-08-10)에는 4100이
아예 내려가 있었고(3100은 이전 세션이 띄운 `next dev`만 살아
있었음), Studio가 어느 API를 보고 있었는지(로컬 4100인지 기본값
원격 4000인지, `image-studio-view.tsx`의 fallback이 4000이다)도
실행 시점 환경변수에 의존해 매번 달라질 수 있는 구조였다.

**한 일 — `scripts/start-verify-studio.ps1`(신규)**: 사람이
반복적으로 켜고 끄지 않아도 되는 **고정 스냅샷 실행 방식**으로
바꿨다.

```
powershell -ExecutionPolicy Bypass -File scripts\start-verify-studio.ps1
```

- 3100·4100 **두 포트만** 정리한다. 3000·4000(SSH 터널)·5432
  (PostgreSQL)·9000(MinIO)·4200·4201(Bridge)은 절대 건드리지 않는다
  — 실행 중이면 "건드리지 않는다"고 로그만 남긴다.
- PostgreSQL(5432)·MinIO(9000)가 떠 있는지 **확인만** 한다. 이
  스크립트가 대신 띄우지 않는다 — 이 프로젝트가 관리하는 서비스가
  아니다.
- API를 빌드(`prisma generate && nest build`)하고
  `PORT=4100 node dist/main.js`로 띄운다.
- Web을 **`NEXT_PUBLIC_API_URL=http://localhost:4100`을 명시한 채
  `next build`로 빌드**하고 `next start -p 3100`으로 띄운다 —
  `next dev`가 아니라 프로덕션 빌드다. 빌드 시점의 코드가 값 그대로
  굳어지므로, 실행 중에 다른 세션이 파일을 고쳐도 **이미 뜬 화면은
  바뀌지 않는다.** 최신 코드를 보려면 스크립트를 다시 실행해야
  한다 — 그것이 의도한 동작이다.
- `/health`(API)·`/login`(Web) 응답을 확인한 뒤에만 성공으로 끝난다.
- 무엇을 띄웠는지(커밋 해시·시각·포트)를
  `scripts/.verify-studio-status.json`에 남긴다(git 비추적 — 이 PC·
  이 실행 시점에만 뜻이 있는 값, `.gitignore`에 추가).

**고정 검증 주소**: `http://localhost:3100/image-studio`

**고정 검증 데이터**: `apps/web/app/benchmark/constants.ts`의
`BENCHMARK_IMAGE_IDS`(§5.4, 사람 승인된 로컬 ID)와 로컬 Benchmark
Project(§5.3, `cmskcpy8z0031ulncv49nb0rl`) — 이 스크립트는 DB를
읽기만 하고 seed·reset·마이그레이션을 실행하지 않는다. 스크립트를
두 번 실행해 Benchmark Project의 `createdAt`이 실행 전후로 완전히
동일함을 실측 확인했다(`2026-08-08T12:30:05.219Z`, 변화 없음).

**실측 검증(2026-08-10)**: 스크립트를 연속 두 번 실행해 두 번 다
같은 커밋(`0df5dae`)·같은 포트로 정상 기동함을 확인했다. 재기동
후에도 `GET /image-studio`·`GET /login`이 200, `GET /health`
(4100)가 200, Benchmark Project 조회가 재기동 전후 동일한 값을
반환함을 확인했다 — "반복 새로고침·재기동해도 같은 화면·데이터"
요구를 실측으로 만족한다.

**발견했지만 이번 범위에서 고치지 않은 것 — 로그인 계정 상태**:
`admin@acos.local` / `admin1234`(§4-13, 2026-08-08 확인된 값)로
API `POST /auth/login`을 직접 호출하면 **401**이 난다. DB를
읽기 전용으로 직접 조회해 확인한 바 계정 자체는 존재하고
(`role: ADMIN`), **잠금 상태는 아니다**(`lockedUntil: null`,
`failedLoginCount`가 임계치 5 미만) — 즉 "계정 잠김"이 아니라
**비밀번호 자체가 문서와 다른 것으로 보인다.** 원인(누가 언제
바꿨는지)은 확인하지 않았다 — 인증 데이터를 직접 바꾸는 것은
"고정 환경 구축"이라는 이번 작업 범위를 넘는 결정이라고 판단해
**비밀번호를 재설정하지 않았다.** 사람이 브라우저에서
`http://localhost:3100/login`으로 실제 로그인이 되는지 먼저
확인해야 한다 — 안 되면 `/admin/users`의 관리자 비밀번호 재설정
절차(`docs/architecture/auth.md`)를 사람이 직접 밟아야 한다.

**이 launcher는 "쓰고 나서 원상 복구"가 아니다**: §9의 기존 절차
(3100/4100은 세션 끝나면 종료하고 3000번 로컬 Next.js를 복구한다)
와 달리, 이 고정 검증 환경은 **사람이 반복 검증하는 동안 계속
떠 있는 것을 전제로 한다.** 3000·4000 SSH 터널과는 포트가 겹치지
않으므로 동시에 켜 둬도 충돌하지 않는다(§4-1). 검증이 완전히
끝나 더 이상 필요 없으면, 사람이 3100·4100 프로세스를 직접
종료하면 된다 — 이 스크립트는 스스로 종료하는 절차를 두지 않았다
(계속 켜 두는 것이 이번 요청의 목적이기 때문).

## 15. 추가 SSD(D:) 저장공간 이전 (T1-74, 2026-08-10)

**바뀐 사실 — 이 PC는 더 이상 "물리 디스크 1개"가 아니다.**
`docs/PROJECT_MEMORY.md` M-36(2026-08-09/10)은 "이 PC에는 두 번째
내장 디스크가 없다"고 실측 기록했다. 이번에 `Get-CimInstance
Win32_DiskDrive`로 다시 확인하니 **물리 디스크가 3개**다.

| 물리 디스크 | 모델 | 인터페이스 | 용도 |
| --- | --- | --- | --- |
| `PHYSICALDRIVE0` | **WDC WDS250G2B0A-00SM50**(250GB, 내장 고정 디스크) | IDE(SATA) | **D: 드라이브**(신규 추가 SSD, NTFS, 이번 확인 시점 거의 비어 있었음) |
| `PHYSICALDRIVE1` | Samsung SSD 850 120GB(M-36이 "유일한 물리 디스크"라 기록했던 그 디스크) | IDE(SATA) | **C: 드라이브**(시스템·기존 프로젝트) |
| `PHYSICALDRIVE2` | PTK C30 USB Device | USB, Removable | **E: 드라이브** — M-36에 기록된 그대로 여전히 인증서 전용 탈착식 USB(`NPKI`·`detail-key.pem`·AWS 액세스 키 포함). **이전 대상 아님**, 이번에도 손대지 않았다 |

**M-36을 대체하지는 않는다** — M-36이 기록한 시점(2026-08-09/10)에는
실제로 두 번째 내장 디스크가 없었다는 사실 자체는 유효하다. 이번
확인은 **그 이후 하드웨어가 실제로 추가되었다**는 새 사실이다.
`docs/PROJECT_MEMORY.md`에 이 변화를 별도 항목(M-40)으로 남긴다.

### 15-1. 이전 전후 용량

| | 이전(작업 시작 시점) | 이후 |
| --- | --- | --- |
| C: 여유 | 4.77GB (`Get-Volume`) | ~5.2GB (`Get-PSDrive`, MinIO 이동 직후 실측) — §12·§13에 기록된 디스크 부족 문제가 완전히 해소된 것은 아니다 |
| D: 여유 | 249.09GB(전체 249.20GB, 사실상 비어 있음) | 249.09GB − 이전한 데이터(약 0.8GB) |

**C: 여유가 이전한 데이터 크기(약 0.8GB)만큼 정확히 늘지 않은
이유**: 확인 시점 사이에 이 워크트리에서 동시에 진행 중이던 다른
Bridge 작업(T1-75 등)이 계속 파일을 쓰고 있었다 — 이 세션이 만든
변화만 분리해서 보려면 이동 직전/직후를 짧은 시간 안에 비교해야
하는데, 정확히 그렇게 측정했음에도 다른 프로세스의 동시 쓰기가
섞였을 수 있다. **이동 자체의 정확성**(옮긴 파일 수·바이트 수 일치,
실제 이미지 재조회 성공)은 §15-2에서 별도로, 디스크 여유공간과
무관하게 검증했다.

### 15-2. 실제로 옮긴 것 — MinIO 오브젝트 저장소 데이터

**기존 위치**: `C:\Users\82104\Documents\GitHub\-\.tmp\minio-data`
(이 워크트리가 아니라 **메인 체크아웃**의 `.tmp` 아래 — 로컬 MinIO는
이 워크트리 전용이 아니라 이 PC의 로컬 개발 인프라 전체가 공유하는
서비스다, PostgreSQL과 같은 성격).

**새 위치**: `D:\dev-data\minio-data`

**옮긴 것**: 제품 이미지 생성 파이프라인의 실제 저장 대상 — 버킷
`acos`에 담긴 업로드 원본·배경 제거본·Gemini 생성 이미지 등. (OCR
결과 자체는 파일이 아니라 PostgreSQL 텍스트 컬럼에 저장되며, DB
데이터 디렉터리는 0.08GB로 작고 이번에 옮기지 않았다 — §15-4.)

**절차와 검증**(2026-08-10 실측):

1. 이동 전 기존 MinIO 프로세스(`minio.exe`, 그 시점 PID 22956)를
   정상 종료. 종료 직후 `GET /minio/health/live`가 연결 거부로
   응답해 실제로 내려갔음을 확인.
2. `robocopy <기존 경로> D:\dev-data\minio-data /E /MOVE`로 이동
   (단순 복사 후 원본을 남겨 두는 방식이 아니라 **이동** — 복사 완료
   확인 후 원본을 지우는 절차라 두 곳에 동시에 남는 중복 저장을
   피했다). 이동 전 파일 858,026,375바이트(752개 오브젝트,
   `.minio.sys` 메타데이터 제외 기준)를 이동 후 대상 경로에서
   다시 세어 **1,556개 파일·858,026,375바이트로 바이트 단위까지
   정확히 일치**함을 확인. 원본 경로는 robocopy가 비운 뒤 삭제됨을
   확인.
3. 같은 `minio.exe`를 새 경로(`D:\dev-data\minio-data`)를 가리키게
   다시 실행. `GET /minio/health/live` → 200.
4. **엔드투엔드 검증**: 이동 전과 같은 자격 증명·같은 포트로 로컬
   API(4100)가 정상 응답(`/health` → 200)함을 확인한 뒤, Benchmark
   이미지 하나(`cmskd3e590004ulpw8fatga47`)를
   `GET /uploads/images/:id/file`로 실제로 요청해 **565,661바이트
   짜리 유효한 JPEG**(1050×1400)를 그대로 받았다 — 옮긴 데이터가
   깨지지 않고 실제로 서비스되는지까지 확인한 것이다(디렉터리
   바이트 수 비교만으로는 파일 내용 손상까지는 보장하지 못하므로
   별도로 확인).

**향후 재시작 시 다시 C:에 쌓이지 않도록 — `scripts/start-minio.ps1`
(신규)**: 지금까지 MinIO는 사람이 그때그때 상대경로(`minio-data`)로
직접 실행해 왔다 — 실행한 위치(cwd) 기준으로 새 폴더가 생겨, 다음에
누가 다른 위치에서 실행하면 새 빈 데이터 폴더가 또 C:에 생길 위험이
있었다. 새 스크립트는 데이터 경로(`D:\dev-data\minio-data`)와
실행 파일 경로를 고정하고, **9000번이 이미 떠 있으면 아무것도 하지
않고 끝난다**(중복 실행·다른 세션이 띄운 것을 죽이는 사고 방지).
실행 방법:

```
powershell -ExecutionPolicy Bypass -File scripts\start-minio.ps1
```

이미 MinIO가 떠 있는 상태에서 실행해 "9000번이 이미 떠 있습니다 —
중복 실행하지 않습니다"로 안전하게 끝나는 것까지 실측 확인했다.

### 15-3. 향후 새로 생성되는 데이터가 D:로 가도록 바꾼 설정

| 설정 | 이전 | 이후 | 적용 범위 |
| --- | --- | --- | --- |
| `pnpm config get store-dir` | (기본값, `C:\Users\82104\AppData\Local\pnpm\store\v10`) | `D:\dev-data\pnpm-store`(`pnpm config set store-dir ... --global`) | 이 PC의 모든 pnpm 프로젝트(전역 설정) |
| `npm config get cache` | `C:\Users\82104\AppData\Local\npm-cache` | `D:\dev-data\npm-cache`(`npm config set cache ... --global`) | 이 PC의 모든 npm/npx 호출(전역 설정, 검증 명령의 `npx eslint .` 포함) |
| MinIO 데이터 경로 | (실행할 때마다 사람이 상대경로로 지정, 사실상 C: 고정) | `D:\dev-data\minio-data`(`scripts/start-minio.ps1`에 고정) | 로컬 MinIO(9000) — 이 스크립트로 시작하는 한 |

**pnpm 기존 저장소(0.79GB)는 옮기지 않고 C:에 그대로 남겼다 — 의도적
결정이다.** pnpm의 저장소는 콘텐츠 주소 저장소(content-addressable
store)로, 각 프로젝트의 `node_modules`는 이 저장소 파일을 **하드링크**
로 참조한다. 하드링크는 원본 항목을 지워도 다른 링크(각 프로젝트의
`node_modules`)가 남아 있으면 실제 데이터는 사라지지 않는다 — 즉
기존 저장소 디렉터리를 C:에서 지운다고 그만큼 C: 공간이 정확히
늘어나는 것이 아니라, **이미 이 PC의 여러 프로젝트 `node_modules`에
퍼져 있는 같은 데이터를 D:로 옮기려면 그 `node_modules`들까지 전부
다시 설치해야 한다** — 이 워크트리뿐 아니라 이 PC에서 pnpm을 쓰는
다른 프로젝트(예: Bridge에 등록된 `demo-widget` 등)까지 전부 건드리는
범위이고, 확인하지 못한 소비자를 건드리는 것은 "실행에 필수인 파일을
깨뜨리지 않는다"는 이번 작업의 제약과 충돌한다. **대신 `store-dir`
설정만 바꿔, 지금부터 새로 받는 패키지 버전(=앞으로 늘어날 대용량
데이터)은 전부 D:에 쌓이도록 했다** — "단순히 파일을 복사해 중복
저장하는 방식은 피한다"는 지시와도 맞다. 기존 저장소를 정리하고
싶으면 사람이 이 PC의 다른 프로젝트들이 pnpm install 중이 아닌
시점에 `pnpm store prune` 이후 직접 지우면 된다
(`docs/RECOVERY_GUIDE.md` §9-4에 이미 있던 안내와 같은 절차).

### 15-4. 이번에 옮기지 않은 것 — 근거

| 후보 | 크기(실측) | 옮기지 않은 이유 |
| --- | --- | --- |
| PostgreSQL 데이터 디렉터리(`C:\Program Files\PostgreSQL\16\data`) | 0.08GB | 이미 작아서 이전 실익이 거의 없고, Windows 서비스로 떠 있는 상태에서 데이터 디렉터리를 옮기려면 서비스 중지·`postgresql.conf` 수정·재시작이 필요해 위험 대비 이득이 낮다. **실행 중인 DB·시스템 서비스**를 건드리지 않는다는 이번 작업의 원칙에 따라 손대지 않았다 |
| `node_modules`(각 저장소, 약 1~1.03GB씩) | 워크트리·메인 체크아웃 각각 약 1GB | §15-3과 같은 하드링크 문제 + **실행에 필수인 파일**이라 이번 작업의 명시적 보호 대상이다 |
| `.next`(각 저장소 build 산출물) | 각 0.50GB | 지금 실제로 떠 있는 서버(§14 T1-63 고정 검증 환경 등)가 이 디렉터리를 직접 서빙하고 있다 — 이동하려면 심볼릭 링크가 필요하고, 실행 중인 서버를 건드리는 위험이 이득(0.5GB)보다 크다고 판단했다 |
| `.turbo` 캐시(메인 체크아웃, 0.27GB) | 0.27GB | 이미 §13(T1-57)에서 한 번 삭제해 봤고 재생성되는 순수 캐시다 — "이전"이 아니라 "삭제"가 맞는 성격이고, 이번 작업은 이전이 명시적으로 요청된 범위라 손대지 않았다. 필요하면 `docs/PROJECT_STATE.md` §3-\* T1-57 절차를 그대로 다시 쓰면 된다 |
| `C:\Users\82104\AppData\Roaming\Claude`(13.61GB, 그중 `vm_bundles`가 12.71GB) | 13.61GB | **이 프로젝트의 개발 산출물이 아니라 Claude 앱 자체의 데이터다.** 이번 작업 지시문이 명시적으로 보호한 "Claude 설정"과 같은 성격이고, 지금 이 작업을 실행 중인 도구 자체와 관련이 있을 수 있어 건드리면 이 세션 자체가 깨질 위험이 있다. **옮기지 않고 사실만 보고한다** — 사람이 판단할 문제다 |
| `C:\Users\82104\AppData\Local\Google`(Chrome, 4.69GB) | 4.69GB | 프로젝트 개발환경과 무관한 개인 브라우저 데이터라 이번 작업 범위(요청받지 않은 방향으로 확장하지 않는다) 밖으로 판단했다 |
| `C:\Users\82104\Documents\GitHub\-\.tmp`의 기타 파일(미니오 데이터 제외 약 0.2GB — 스크린샷·curl 로그·JSON 스냅샷 등 과거 세션의 1회성 디버그 산출물) | 약 0.2GB | 크기가 작고, 어느 것이 다시 참조될지 이번 세션에서 판단할 근거가 없어(파일명만으로는 재사용 여부를 알 수 없음) 손대지 않았다. 정리하고 싶으면 사람이 내용을 확인한 뒤 지우는 것이 안전하다 |

### 15-5. E: 드라이브는 여전히 대상이 아니다

M-36의 결론(§9-4 위쪽, `PROJECT_MEMORY.md`)이 이번에도 그대로
확인됐다 — E:는 탈착식 USB(`PTK C30 USB Device`)이고 인증서·
`detail-key.pem`·AWS 액세스 키가 이미 들어 있다. 이번 작업에서
`Get-CimInstance Win32_DiskDrive`로 다시 확인했고, 손대지 않았다.

## 16. C: 여유공간 재발과 `ACOS-Bridge` 재부팅 복구 스케줄러 실패
첫 실측 (T1-56 재실행, 2026-08-11)

### 16-1. C: 여유공간 — 해소와 재발을 반복하는 패턴

```
T1-56(§12, 08-10)  0.71GB
T1-58(§13, 08-10)  9.15GB  (.turbo/cache 삭제로 해소)
T1-55(§3-22, 08-11) 2.24GB (다시 감소)
이번(T1-56 재실행, 08-11 저녁) 2.21GB
```

이 워크트리·메인 체크아웃 자체의 크기(합쳐서 약 4.89GB)는 C: 전체
사용량(109GB)의 일부일 뿐이다 — 대부분은 `AppData\Roaming\Claude\
vm_bundles`(13.61GB, §15-4에 이미 "이 작업 범위 밖"으로 기록)·
Chrome(4.83GB)처럼 프로젝트 밖 데이터로 보인다(§3-22 T1-55의 조사
결과와 동일). **안전 이동 후보(`.turbo\cache` 1.48GB +
`ms-playwright` 1.35GB, 메인 체크아웃 기준, 목적지 D: 확인됨)는
`docs/PROJECT_STATE.md` §3-22(T1-55)가 이미 절차까지 적어 두고
사람 승인만 기다리는 상태다** — 이번에도 실행하지 않았다.

**결론**: C: 여유공간 문제는 한 번 정리해도 **근본적으로 다시
채워지는 문제**다(이 PC의 디스크 자체가 작다 — Samsung SSD 850
120GB, §15). 재부팅 전마다 매번 다시 실측해야 하며, 5GB 미만이면
MinIO 저장 거부(M-15)·빌드 실패(M-30)·Bridge 파일 손상(M-30) 재발
위험이 있다.

### 16-2. `ACOS-Bridge` 스케줄러 — 실제 트리거·실패가 처음으로 실측됨

기존 §3-3·§3-3-1(T1-46·T1-54)은 "등록은 됐지만 실제 트리거로
검증된 적이 없다"고만 기록해 왔다. 이번에 처음으로 **실제 트리거·
실제 결과**를 확인했다.

```
Get-ScheduledTaskInfo ACOS-Bridge
  → State: Ready · LastRunTime 2026-08-11 10:09:09 · LastTaskResult 1(실패)
(Get-CimInstance Win32_OperatingSystem).LastBootUpTime
  → 2026-08-10 14:05:04  (이번 확인 시점까지 재부팅 없음)
```

**재부팅이 일어난 것은 아니다** — 10:09의 트리거는 로그온 트리거
또는 사람/다른 프로세스의 수동 `Start-ScheduledTask` 호출로 보이나
원인 자체는 `Microsoft-Windows-TaskScheduler/Operational` 이벤트
로그에 해당 기록이 없어 **미확인**이다. 확실한 사실은 **그 실행이
종료 코드 1로 실패**했다는 것이다.

`bridge/start-bridge.ps1`(읽기만 함, 수정 안 함)의 `exit 1` 경로는
두 곳뿐이다 — ① Bridge 서버가 30초 안에 `/health` 200을 못 냄, ②
cloudflared 터널 주소를 120초 안에 못 얻음. 어느 쪽이었는지는 로그가
남지 않아 미확인이다. 현재 살아있는 Bridge 서버(4200, 이번 확인
시점 PID 5452, 생성 2026-08-11 15:33:43)는 10:09의 시각과 다르고,
현황판(4201, PID 11520, 생성 2026-08-10 14:09:29)은 그보다도 훨씬
전부터 계속 살아 있었다 — 즉 10:09 시도가 기존 프로세스를 정리하는
단계(스크립트 27~34행)까지도 도달하지 못했거나, 이후 사람이 별도로
Bridge 서버만 재기동한 것으로 보인다(원인 규명은 `bridge/` 내부이며
이번 작업 범위 밖이라 더 조사하지 않았다).

**의미**: `ACOS-Bridge` 스케줄러는 등록은 정상이지만, **실제
트리거 시 항상 성공한다는 보장이 없다는 것이 처음으로 실증됐다.**
실제 재부팅 후에는 반드시 사람이 `http://localhost:4201` 응답을
직접 확인해야 하며, 안 뜨면 `bridge\start-bridge.ps1`을 사람이
직접(대화형 터미널에서) 다시 실행해야 한다 — 자동 복구를 맹신하지
않는다.

## 17. 개발 작업 산출물·캐시의 D: 우선 저장 전환 (T1-84, 2026-08-12)

**배경**: §15(T1-74)가 pnpm store·MinIO 데이터를 D:로 옮긴 뒤에도
C: 여유공간은 §16(T1-56 재실행)처럼 반복적으로 5GB 미만까지
재발했다(작업 시작 시점 실측 **C: 여유 4.15GB**). §16이 승인 대기로
남긴 안전 이동 후보(`.turbo\cache`·`ms-playwright`, 목적지 D: 확인됨,
`docs/PROJECT_STATE.md` §3-22)를 이번에 실제로 실행하고, Turborepo
캐시·Playwright 브라우저·TEMP까지 앞으로 자동으로 D:에 쌓이도록
환경변수를 영구 설정했다.

### 17-1. 실행 전 실측 — C:를 쓰는 개발 데이터 경로 전수 분류

| 경로 | 무엇 | 크기(실측) | 분류 |
| --- | --- | --- | --- |
| `AppData\Local\pnpm\store\v10` | pnpm 콘텐츠 주소 저장소 | 이미 D:로 이전됨(§15) | **완료(T1-74)** |
| `AppData\Local\npm-cache` | npm/npx 캐시 | 이미 D:로 이전됨(§15) | **완료(T1-74)** |
| `.tmp\minio-data` | MinIO 오브젝트 저장소(실제 이미지 데이터) | 이미 D:로 이전됨(§15) | **완료(T1-74)** |
| `Documents\GitHub\-\.turbo\cache`(메인 체크아웃) | Turborepo 빌드 캐시 | 0.33GB | **이번에 이전 + 정리** |
| 이 워크트리 `.turbo\cache` | Turborepo 빌드 캐시 | 이미 비어 있었음(직전 세션에서 정리됨) | **이번에 확인만** |
| `AppData\Local\ms-playwright` | Playwright e2e 브라우저 바이너리 | 0.68GB(D:에는 1.35GB — 상위 버전 포함 완전한 복사본) | **이번에 이전 + 정리** |
| `AppData\Local\Temp`(OS 사용자 TEMP) | 빌드 도구·OCR(Tesseract) 임시 캐시 등 | 0.60GB | **이번에 향후분만 전환**(§17-4) |
| `apps\web\.next`·`apps\api\dist`(빌드 산출물) | Next.js/Nest 빌드 출력 | 두 체크아웃 합쳐 약 1.1~2GB | **제외 — 이유 §17-5** |
| `node_modules`(각 체크아웃) | 설치된 패키지 | 체크아웃당 약 1GB | **제외 — 요청문이 명시적으로 보호 대상 지정** |
| `AppData\Roaming\Claude\vm_bundles` | Claude 앱 자체 실행 번들 | 12.71GB | **제외 — 이유 §17-5** |
| `C:\Users\82104\.claude`(세션 기록·메모리) | Claude Code 세션 transcript·메모리 | 0.19GB | **제외 — 이유 §17-5** |
| `AppData\Local\Google\Chrome` | 개인 브라우저 데이터 | 약 4.8GB | **제외 — 프로젝트 산출물 아님, 범위 밖** |
| PostgreSQL 데이터 디렉터리 | 로컬 DB | 0.08GB(§15-4 실측) | **제외 — 이유 §17-5** |
| Windows 시스템 파일(`hiberfil.sys`·`pagefile.sys`·`WinSxS` 등) | OS 자체 | — | **대상 아님 — 요청문이 OS 이동을 금지** |

이 표는 §11·§15·§16·`docs/PROJECT_STATE.md` §3-11·§3-18·§3-22가 이미
확인해 둔 사실을 이번 실행 시점 기준으로 재확인하고, 처음으로 실제
이동을 실행한 항목만 갱신한 것이다 — 중복 조사를 반복하지 않았다.

### 17-2. 이번에 실행한 것 — Turborepo 캐시

**설정**: 사용자 환경변수 `TURBO_CACHE_DIR=D:\dev-data\turbo-cache`
(`setx`, 영구 설정). Turborepo 2.10.7이 **이 환경변수를 실제로
읽는다는 것을 직접 실측 확인**했다 — `--cache-dir` 플래그 없이
`TURBO_CACHE_DIR`만 지정한 상태에서 `turbo run typecheck --dry-run`을
실행하니 지정한 새 디렉터리가 그 자리에서 만들어졌다(추측이 아니라
실행 결과로 확인).

**`turbo.json`(git 추적 파일)은 건드리지 않았다** — 캐시 경로는 이
PC에서만 뜻이 있는 값이라 저장소에 커밋되는 설정에 하드코딩하면
다른 PC·향후 clone에서 깨진다. 환경변수만 이 PC에 영구 설정하는
방식이 맞다.

**검증**: `pnpm turbo run build`(6/6 성공, 캐시 히트로 15.6초) ·
`pnpm turbo run typecheck`(10/10 성공, 캐시 히트로 420ms)를 실행해
`D:\dev-data\turbo-cache`의 manifest 파일들이 실행 시각에 맞춰
갱신됨을 확인했고, 두 체크아웃 모두에서 `.turbo\cache`가 **다시
생기지 않았음**을 확인했다.

**정리**: 메인 체크아웃의 기존 C: 캐시(`Documents\GitHub\-\.turbo\
cache`, 0.33GB)는 D: 사본이 이미 채워져 있고 이동 시점에 turbo·pnpm
프로세스가 하나도 실행 중이 아님을 확인(`Get-CimInstance
Win32_Process`)한 뒤 삭제했다 — 순수 재생성 가능 캐시라 데이터
손실이 아니다.

### 17-3. 이번에 실행한 것 — Playwright 브라우저 캐시

**설정**: 사용자 환경변수
`PLAYWRIGHT_BROWSERS_PATH=D:\dev-data\ms-playwright`(`setx`, 영구
설정) — Playwright 공식 문서에 정의된 표준 환경변수다.

**검증**: 처음에 `pnpm turbo run test`(전체 묶음 실행)에서 `web:test`
가 252건 중 32건까지만 진행되고 실행 시간이 비정상적으로 짧게(각
2ms) "실패"로 표시되는 것을 발견했다 — **이것을 그대로 실패로
보고하지 않고 원인을 직접 확인했다.** 같은 테스트를 단독으로
(`npx playwright test e2e/account.spec.ts -g ...`) 실행하니 정상
소요시간(8.2초)으로 통과했다. 원인은 Playwright/브라우저 문제가
아니라 **Turborepo가 같은 실행에서 `api#test`가 먼저 실패하자 나머지
작업(`web#test`)을 그 자리에서 취소**한 것이었다(turbo 기본 동작 —
`--continue` 미지정 시 한 작업이 실패하면 형제 작업을 중단한다).
`pnpm --filter web test`로 web e2e만 독립 실행해 **252/252 전부
통과**함을 확인해 이 원인 판단을 검증했다 — D: 브라우저 캐시 경로가
실제로 정상 동작함을 실측으로 확정한다.

**정리**: 기존 C: 캐시(`AppData\Local\ms-playwright`, 0.68GB, D:
사본에 이미 포함된 리비전만 있고 실행 중인 Playwright 프로세스
없음을 확인)를 삭제했다. 삭제 직후 총 **C: 1.01GB 회수**(Turbo
캐시분 0.33GB + 이 항목 0.68GB, `Get-PSDrive` 전후 차이로 재확인).

### 17-4. 이번에 실행한 것 — TEMP/TMP (제한적)

**설정**: 사용자 환경변수 `TEMP`·`TMP`를 `D:\dev-data\temp`로
`setx`(영구 설정)했다. **`D:\dev-data\temp` 폴더만 새로 만들었고,
기존 `AppData\Local\Temp`의 파일은 옮기거나 지우지 않았다** —
`cloudflared`(4200 터널 로그)를 포함해 지금 떠 있는 여러 프로세스가
그 경로에 열린 파일 핸들을 이미 갖고 있어, 지금 실행 중인 파일을
건드리는 것은 "실행 중인 서버를 무리하게 끊지 않는다"는 제약과
충돌한다.

**이 설정이 지금 이 세션에는 적용되지 않는다는 것도 실측으로
확인했다** — `setx`는 레지스트리(`HKCU\Environment`)를 갱신하지만,
**이미 떠 있는 프로세스(이 작업을 실행 중인 셸 포함)는 그 값을
자동으로 다시 읽지 않는다.** 새 값은 이후 새로 열리는 터미널·
탐색기에서 실행한 프로그램·재부팅 후 프로세스부터 적용된다(이번
세션에서 새로 띄운 PowerShell 자식 프로세스로 직접 테스트해
확인 — `$env:TEMP`가 여전히 옛 값을 보였다). **로컬 API가 다음에
재시작되면**(`apps/api/src/ocr/providers/tesseract.provider.ts`가
`os.tmpdir()`로 Tesseract 언어 데이터 캐시 경로를 잡는다) 그 캐시부터
자동으로 D:에 쌓인다 — 이번에 로컬 API를 재시작할 때 이미 그렇게
됐는지는 §17-6에서 확인한다.

**옮기지 않은 것 — 기존 C: TEMP 내용물(0.60GB)**: 재생성 가능한
캐시가 아니라 여러 활성 프로세스가 지금 쓰고 있는 폴더라, 이번 정리
대상에서 제외했다. 필요하면 재부팅 후(활성 핸들이 없어진 뒤) 사람이
직접 내용을 확인하고 지울 수 있다.

### 17-5. 옮기지 않은 것 — 이유

| 후보 | 옮기지 않은 이유 |
| --- | --- |
| `apps\web\.next`·`apps\api\dist` | **지금 실제로 사람 검증용 서버(§14, T1-63 고정 환경)가 이 디렉터리를 직접 서빙 중**이었다(로컬 API 4100·로컬 Web 3100). 심볼릭 링크로 옮기려면 그 서버를 먼저 내려야 하는데, 얻는 용량(1~2GB)보다 "실행 중인 서비스를 무리하게 끊지 않는다"는 제약을 지키는 것이 우선이라고 판단했다. Next.js `distDir`는 프로젝트 루트 밖 절대경로를 공식 지원하지 않아, 강제로 옮기려면 정션(junction)처럼 파일시스템을 속이는 방법이 필요해 위험도가 더 크다 |
| `node_modules` | 요청문이 "기존 소스코드·실행에 필요한 경로를 훼손하지 않는다"고 명시했고, pnpm 콘텐츠 주소 저장소를 하드링크로 참조하는 구조라(`docs/PROJECT_MEMORY.md` M-42) 옮기면 이 PC의 다른 프로젝트까지 재설치가 필요해진다 |
| `AppData\Roaming\Claude\vm_bundles`(12.71GB) | Claude Code 실행 환경 자체의 데이터로 추정된다(§15-4에 이미 같은 판단 기록) — **이 작업을 실행하는 도구 자신의 데이터일 수 있어, 건드리면 이 세션 자체가 깨질 위험**이 있다. 요청문의 "인증/설정은 보존해야 한다"는 제약과 같은 범주로 판단해 손대지 않았다 |
| `C:\Users\82104\.claude`(0.19GB) | Claude Code 세션 기록·메모리 저장소 — **지금 이 세션을 포함해 여러 Claude Code 세션이 동시에 쓰고 있다.** 크기도 작아(0.19GB) 얻는 이득보다 활성 세션을 깨뜨릴 위험이 크다고 판단했다 |
| PostgreSQL 데이터 디렉터리 | §15-4(T1-74)가 이미 "크기가 작고(0.08GB) Windows 서비스로 떠 있는 상태에서 옮기려면 서비스 중지·설정 변경·재시작이 필요해 위험 대비 이득이 낮다"고 판단한 것과 같은 결론을 유지했다 |
| Windows 시스템 파일 | 요청문이 명시적으로 "Windows OS 자체를 무리하게 이동하지 말라"고 지정했다 |

### 17-6. 재기동과 검증

로컬 API(4100, `dist/main.js`)·로컬 Web(3100, `next start`)는 빌드
검증(M-14와 같은 이유로 API가 떠 있으면 Prisma 빌드가 `EPERM`으로
실패한다) 때문에 잠시 내렸다가, 검증이 끝난 뒤
`scripts/start-verify-studio.ps1`(T1-63, 이번에 수정하지 않음)로
그대로 다시 띄웠다 — **포트 3100·4100만** 정리하고 3000·4000(SSH
터널)·5432·9000·4200·4201(Bridge)은 손대지 않는다는 그 스크립트의
기존 동작 그대로다. Bridge(4200·4201)·PostgreSQL·MinIO·SSH 터널·
cloudflared는 이번 작업 전체에서 **한 번도 재시작하지 않았다.**

**검증 결과**는 이 작업(T1-84)의 최종 보고에 기록한다
(`bridge/results/T1-84.json`) — `build`·`typecheck`·`lint`는 저장소
전체 기준 오류 0, `test`는 `api`가 §10에 이미 기록된 기존 문제
(`ops.spec.ts` 8건, 이번 변경과 무관함을 git diff로 재확인)만 그대로
재현했고 `web` e2e는 252/252 전부 통과했다.

### 17-7. C:/D: 여유공간 전후

| | 작업 시작 시점 | 작업 종료 시점 |
| --- | --- | --- |
| C: 여유 | 4.15GB | **5.16GB** |
| D: 여유 | 229.49GB | 229.49GB(오차범위 내 — 이번에 옮긴 데이터는 이미 D:에 있던 사본이라 순증가가 거의 없다) |

C: 여유가 `RECOVERY_GUIDE.md` §3-5 권장 최소치(5GB)를 이번 작업으로
**처음 넘겼다.** 다만 §16이 이미 기록했듯 이 PC의 디스크 자체가 작아
(Samsung SSD 850 120GB) **근본 원인이 해소된 것은 아니다** — 앞으로도
정기적으로 `Get-PSDrive C`로 재확인이 필요하다.

## 18. C: 응급 소진(0.03GB) 대응과 근본 원인 특정 — setx는 이미 떠 있는
프로세스에 적용되지 않는다 (T1-100, 2026-08-13)

**작업 시작 시점 실측**: `Get-PSDrive C` → **0.03GB**(총 111.22GB 중
사용 111.19GB) — §17(T1-84)이 4.15GB→5.16GB로 확보했던 여유공간이
**다시 완전히 소진된 상태**였다. D: 여유는 229.45GB로 정상.

### 18-1. 원인 — Turborepo 캐시가 D:로 리다이렉트됐는데도 C:에 다시 쌓였다

`Documents\GitHub\-\.turbo\cache`(메인 체크아웃)를 실측하니 **3.22GB**가
쌓여 있었다 — §17-2가 `TURBO_CACHE_DIR=D:\dev-data\turbo-cache`를
`setx`로 영구 설정하고 재생성되지 않음을 검증까지 했던 바로 그 캐시다.

**직접 실측으로 확인한 원인**: 이 값은 `setx`(레지스트리 `HKCU\
Environment`)로만 설정되고, **이미 실행 중인 프로세스는 그 값을 다시
읽지 않는다.** 이번 세션이 새로 띄운 PowerShell 프로세스(오늘
2026-08-13 08:27 시작, §17 설정 이후)조차 `$env:TURBO_CACHE_DIR`이
**빈 값**이었고 `$env:TEMP`도 옛 경로(`AppData\Local\Temp`) 그대로였다
— 즉 **"새 프로세스"라고 해서 자동으로 새 값을 받는 것이 아니라,
그 프로세스를 최종적으로 띄운 조상 프로세스(이 세션을 실행 중인
호스트 자체)가 `setx` 시점 이전부터 계속 떠 있으면, 그 밑에서 새로
스폰되는 모든 자식도 조상이 물려준 옛 환경변수 스냅샷을 그대로
상속한다.** Windows는 `setx` 후 `WM_SETTINGCHANGE`를 브로드캐스트하지만
이를 실제로 재조회하는 것은 탐색기 등 일부 프로그램뿐이고, 일반 자식
프로세스 생성(`CreateProcess`)은 부모의 환경 블록을 그대로 복사한다.

**같은 이유로 영향받는 다른 설정**: `PLAYWRIGHT_BROWSERS_PATH`·
`TEMP`·`TMP`도 마찬가지로, **2026-08-12(T1-84) 이후 재부팅되지 않은
프로세스 트리 전체**(Bridge 서버·CTO worker·이 프로세스 트리에서
파생되는 모든 빌드/테스트 실행)에서는 여전히 옛 값(C: 경로)으로
동작한다. `bridge/bridge-cto-worker.mjs`(PID 2928, 계속 실행 중)가
주기적으로 트리거하는 빌드가 유력한 재발 경로로 보이나, 그 프로세스
자체를 재시작하는 것은 이번 작업 범위(`bridge/` 무단 수정 금지)
밖이라 실행하지 않았다.

### 18-2. 조치 — 즉시 회수 + 이번 세션 검증은 명시적 환경변수로 우회

1. **즉시 회수**: 활성 turbo/pnpm 프로세스가 없음을
   `Get-CimInstance Win32_Process`로 확인한 뒤
   `Documents\GitHub\-\.turbo\cache`(3.22GB, 순수 재생성 캐시)를
   삭제 — **C: 여유 0.03GB → 3.25GB**로 즉시 회복.
2. **이번 세션의 build/typecheck/lint/test 검증은 각 PowerShell
   명령 안에서 `$env:TURBO_CACHE_DIR`·`$env:PLAYWRIGHT_BROWSERS_PATH`·
   `$env:TEMP`·`$env:TMP`를 D: 경로로 명시적으로 재설정한 뒤 실행**했다
   — 상속된 옛 값에 의존하지 않도록 우회한 것이며, `turbo.json`이나
   저장소 설정은 건드리지 않았다.
3. **레지스트리(User 영구값) 자체는 이미 올바르다** — 확인 결과
   `TURBO_CACHE_DIR`·`PLAYWRIGHT_BROWSERS_PATH`·`TEMP`·`TMP` 전부
   `D:\dev-data\...`를 정확히 가리키고 있었다. **고칠 것은 값이
   아니라 "적용 시점"이다.**

### 18-3. 사람이 재부팅 시(또는 여유 있을 때) 확인해야 하는 것 — 근본 해결

**이 세션(Bridge가 부른 것으로 보이는 무인 세션)은 스스로 재부팅하거나
`bridge-cto-worker`·`bridge-server`를 재시작할 수 없다** — `docs/
DEVELOPMENT_ENVIRONMENT.md` §3-3-1(T1-46)이 이미 실측한 것과 같은
구조적 제약이다(이 세션이 그 프로세스 트리의 자손일 가능성이 있어,
재시작하면 이 작업 자신의 결과 보고가 유실될 위험이 있다). 그래서
**재시작은 실행하지 않고 이 사실만 기록한다.**

> **사람이 다음에 PC를 재부팅하거나, Bridge를 사람이 직접 완전히
> 내렸다가 다시 띄우면**(`bridge\start-bridge.ps1`을 대화형 터미널에서
> 재실행) 그 시점 이후 새로 만들어지는 모든 프로세스(Bridge 서버·
> CTO worker·그 아래에서 실행되는 빌드)가 비로소 `TURBO_CACHE_DIR`·
> `PLAYWRIGHT_BROWSERS_PATH`·`TEMP`·`TMP`의 D: 값을 상속받는다.
> **그 전까지는 이 값들이 부분적으로만(새로 여는 대화형 터미널 등에서만)
> 적용되고, Bridge가 실행하는 자동화된 빌드는 계속 C:에 캐시를 쌓을
> 수 있다** — §17이 "해결됐다"고 기록한 것은 **설정 자체**의 정확성이지
> **이미 떠 있던 프로세스로의 전파**가 아니었다는 뜻으로 이 항목을
> 정정한다.

### 18-4. 이번에 확인한 것 — MinIO 이미지 데이터는 로컬 디스크를 우회하지
않는다

`apps/api/src/uploads/uploads.service.ts`를 읽어 확인한 바 업로드
파일은 로컬 디스크에 임시 저장되지 않고 바로 S3(MinIO)로 전송된다
(`diskStorage`·`tmpdir()` 등 로컬 파일 경유 패턴이 코드에 없음, 검색
결과 일치 0건). `S3_ENDPOINT`(`.env.example` 기준 `localhost:9000`)는
`scripts/start-minio.ps1`이 고정한 `D:\dev-data\minio-data`를 그대로
가리킨다(§15-2) — **Gemini/OCR 이미지 원본·생성 결과·업로드 파일이
C:에 새로 쌓이는 경로는 없음을 코드 수준에서 재확인**했다. OCR
캐시만 `os.tmpdir()`(`apps/api/src/ocr/providers/
tesseract.provider.ts`)를 쓰며, 이는 §18-1과 같은 이유로 로컬 API가
재시작되기 전까지는 여전히 C: TEMP를 본다.

### 18-5. 검토했지만 이번에 옮기지 않은 것 — 근거

| 후보 | 크기 | 옮기지 않은 이유 |
| --- | --- | --- |
| `AppData\Local\Temp`(TEMP 내용물) | 1.08GB | 활성 프로세스(cloudflared·여러 Bridge 세션의 scratchpad 등)가 그 안의 파일을 지금도 쓰고 있다 — §17-4(T1-84)가 이미 "지금 실행 중인 파일을 건드리지 않는다"고 정한 결정을 그대로 유지했다. TEMP 아래 `claude` 폴더(205.6MB)는 이 세션 자신을 포함한 여러 Claude Code 세션의 scratchpad라 특히 위험하다 |
| `AppData\Roaming\Claude`(13.61GB) · `AppData\Local\Google\Chrome`(5.13GB) · `C:\Users\82104\.claude`(0.22GB) | 합 18.96GB | §17-5(T1-84)가 이미 "이 작업을 실행하는 도구 자신의 데이터일 수 있어 건드리면 이 세션이 깨질 위험" · "프로젝트 산출물이 아님"으로 판단한 것을 재확인만 하고 그대로 유지했다 |
| `ACOS-git-backup-T1-59`·`ACOS-git-backup-2026-08-11`(백업 아카이브) | 각 0.01GB | 실측 결과 git bundle·patch 파일 위주로 **이미 매우 작다**(요청문이 예로 든 "대형 백업/아카이브"에 해당하지 않음) — 옮겨도 회수되는 용량이 무의미하고, `RECOVERY_GUIDE.md`에 정확한 경로가 문서화돼 있어 옮기면 문서 갱신 범위만 늘어난다. 옮기지 않았다 |
| `node_modules`(양쪽 체크아웃, 합 2.25GB) · `apps/web/.next`·`apps/api/dist` | — | §17-5(T1-84)와 동일한 이유(하드링크 콘텐츠 주소 저장소, 실행 중인 검증 서버가 직접 서빙 중)로 유지 |
| yarn 캐시 | — | `AppData\Local\Yarn` 자체가 존재하지 않음(이 프로젝트는 pnpm만 사용) — 옮길 대상이 없음을 확인 |

### 18-6. 전후 용량

| | 작업 시작 | 응급 회수 직후 | 검증 종료 시점 |
| --- | --- | --- | --- |
| C: 여유 | **0.03GB** | 3.25GB | 3.21GB |
| D: 여유 | 229.45GB | 229.45GB | 228.91GB(빌드 캐시 정상 증가분) |

C: 여유는 §17이 확보했던 수준(5.16GB)에는 못 미친다 — §18-1의
근본 원인(프로세스 트리가 아직 새 환경변수를 상속받지 못함)이
해소되지 않는 한 **Bridge가 자동 실행하는 빌드가 계속 C:에 캐시를
쌓을 수 있어, 사람이 재부팅/Bridge 재기동 전까지는 정기적으로
`Get-PSDrive C`를 재확인해야 한다.**

## 19. 재부팅 자동 복구 시스템 재점검 — §18 문제를 이 작업 세션
자신으로 실증, `ACOS-Bridge` 실패 기록은 여전히 미해결 (T1-102, 2026-08-13)

**전제**: 이번 세션 시작 시점까지 **실제 재부팅은 없었다** —
`(Get-CimInstance Win32_OperatingSystem).LastBootUpTime` → **2026-08-10
14:05:04**(§16-2와 동일한 값, 그 이후 변화 없음), 확인 시각
2026-08-13 09:43. 요청에 따라 **이번 세션도 재부팅을 직접 실행하지
않았다** — 아래는 재부팅 없이 확인 가능한 범위(스케줄러 등록·실제
트리거 기록·현재 살아있는 프로세스의 실제 환경변수)에서 얻은
실측이다.

### 19-1. 자동 시작 등록 — Task Scheduler만 있고, 그 외 경로는 없다

`Get-ScheduledTask`로 재확인한 결과 이 두 작업만 등록돼 있다(§3-3과
동일, 이번에 새로 등록/변경하지 않았다).

| 작업 | Trigger | Principal | Action | 마지막 실제 트리거 결과 |
| --- | --- | --- | --- | --- |
| `ACOS-Bridge` | **LogonTrigger + BootTrigger 둘 다** | `LogonType: S4U`(암호 저장 없음)·`RunLevel: Limited`·계정 `최덕임` | `powershell.exe -File "...\bridge\start-bridge.ps1"`(**이 워크트리** 경로) | `LastRunTime 2026-08-11 10:09:09` · **`LastTaskResult: 1`(실패)** — §16-2 기록 이후 변화 없음. **2026-08-11 이후 단 한 번도 다시 트리거된 적이 없다** |
| `ACOS-CTO-Worker` | 동일(LogonTrigger + BootTrigger) | 동일 | `bridge\start-cto-worker.ps1` | `LastRunTime 2026-08-11 20:19:19` · `LastTaskResult: 0`(성공) |

`Get-WinEvent Microsoft-Windows-TaskScheduler/Operational`로
`ACOS-Bridge` 실패의 세부 원인(§16-2가 이미 "로그가 남지 않아
미확인"이라 기록한 것)을 다시 찾아봤으나 **해당 로그가 보존 기간을
넘겨 사라져 이번에도 확인하지 못했다** — 미확인 상태 그대로다.

**Windows Startup 폴더**(`%APPDATA%\...\Startup`,
`C:\ProgramData\...\StartUp`)에는 Bridge·CTO Worker와 무관한
항목(프린터 모니터링·`WGear.lnk`)만 있다 — **Task Scheduler 외의
자동 시작 경로(서비스·시작프로그램)는 없다.**

**`.vscode/tasks.json`**(`runOn: folderOpen`)은 VS Code로 이
워크트리를 열 때 `http://localhost:4201`을 내장 Simple Browser로
자동으로 **여는** 편의 작업 하나뿐이다 — **Bridge를 띄우는 것이
아니라 "이미 떠 있으면 보여주는" 것**이며, 4200/4201이 안 떠 있으면
연결 오류 화면만 뜬다. 이것이 "VS Code 개발환경 복구 흐름"의
전부다.

**결론 — `ACOS-Bridge`는 "등록은 정상, 실제 성공은 한 번도 실측된
적 없음"**: §16-2가 처음 실측한 실패(2026-08-11 10:09, 종료 코드
1) 이후로 재부팅이 없어 재시도 기회 자체가 없었다. **등록 상태만으로
"재부팅하면 Bridge가 자동으로 뜬다"고 단정할 수 없다** — 사람이
실제 재부팅 후 반드시 `http://localhost:4201` 응답을 직접 확인해야
한다(기존 §3-3·§16-2 결론과 동일, 이번에 다시 확인됨).

### 19-2. C→D 환경변수 상속 문제 — 이 작업 세션 자신이 살아있는 증거다

§18-1이 "이미 떠 있는 프로세스 트리는 새 환경변수를 상속받지 못한다"고
추정 근거와 함께 기록했다. 이번에는 **이 T1-102 세션 자신의 프로세스
계보와 환경변수를 직접 찍어 실증**했다.

```
bridge-server.mjs(PID 14532, 2026-08-12 17:32:44 시작, D: 전환 이후)
  → claude.exe(PID 18732, 이 T1-102 세션)
    → powershell.exe(PID 2848, 이 명령을 실행한 셸)

$env:TURBO_CACHE_DIR         = (빈 값)
$env:PLAYWRIGHT_BROWSERS_PATH = (빈 값)
$env:TEMP / $env:TMP          = C:\Users\82104\AppData\Local\Temp  (옛 C: 경로)
```

즉 **이 보고서를 쓰고 있는 세션 자신이, §18이 우려한 "옛 환경변수를
상속한 자손 프로세스"의 실제 사례다.** 레지스트리(`HKCU\Environment`,
영구값)는 이번에도 재확인 결과 `TURBO_CACHE_DIR`·
`PLAYWRIGHT_BROWSERS_PATH`·`TEMP`·`TMP` 전부 정확히 `D:\dev-data\...`를
가리키고 있었다 — **문제는 값이 아니라 "이미 떠 있는 Bridge 프로세스
트리에는 전파되지 않는다"는 §18-1의 결론 그대로다.**

**이번 세션이 새로 확인한 것**: `bridge-server.mjs`(PID 14532)는
2026-08-12 17:32에 시작됐다 — §17(T1-84, 같은 날 더 이른 시각)의
`setx` 실행 이후로 보이는 시점인데도 옛 환경변수를 그대로 갖고 있다.
이는 `setx`가 그 시점에 **이미 살아있던 조상 프로세스**(`nohup.exe`
PID 27156 등)에는 영향을 주지 못했고, 그 이후 새로 spawn된 자식들도
조상의 환경 블록을 그대로 물려받는다는 §18-1의 설명과 정확히 일치한다.

**이 문제는 이 세션이 스스로 고칠 수 없다** — `bridge-server.mjs`를
재시작하는 것은 `bridge/` 무단 수정 금지와 별개로, DEVELOPMENT_
ENVIRONMENT.md §3-3-1(T1-46)이 이미 실측한 구조적 제약(이 세션이 그
프로세스의 자손이라 재시작하면 이 작업 자신의 결과 보고가 유실될
위험) 때문에 **시도하지 않았다.**

**재부팅 시 실제로 해소되는지는 이번에도 검증하지 못했다** — 재부팅
자체를 실행하지 않았기 때문이다. Windows의 표준 동작(`CreateProcess`가
로그온 시점에 최신 `HKCU\Environment`로 환경 블록을 새로 구성함)상
이론적으로는 재부팅 후 새로 뜨는 프로세스 트리(Bridge 서버·CTO
worker 포함)가 D: 값을 상속받아야 하지만, **이 프로젝트에서 실제
재부팅으로 이 부분이 검증된 적은 아직 한 번도 없다.**

### 19-3. C:/D: 저장환경 실측 (이번 확인 시점)

| | C: 여유 | D: 여유 |
| --- | --- | --- |
| T1-100 종료 시점(오늘 오전 더 이른 시각) | 3.21GB | 228.91GB |
| 이번 확인(T1-102) | **3.66GB** | **228.91GB** |

`.turbo\cache`(양쪽 체크아웃)는 T1-100 응급 삭제 이후 **아직
재생성되지 않았다**(폴더 자체가 없음, `du` 확인) — §19-2의 근본
원인이 남아 있는 한 Bridge가 실행하는 자동 빌드가 다시 채울 수
있으므로 안심할 단계는 아니다. `D:\dev-data\`에는 `minio-data`·
`pnpm-store`·`npm-cache`·`ms-playwright`·`turbo-cache`·`temp`
폴더가 전부 실존했고, 실행 중인 `minio.exe`의 커맨드라인을 직접
확인해 `D:\dev-data\minio-data`를 정확히 가리키고 있음을 재확인했다.

### 19-4. Bridge/API/Web/MinIO 현재 상태 — 전부 실측 200 OK (재부팅과 무관하게 이미 기동 중)

| 구성요소 | 상태 | 근거 |
| --- | --- | --- |
| Bridge 서버 4200 | `/health` **200** | PID 14532, 2026-08-12 17:32부터 — §19-2 대로 옛 env 보유 |
| Bridge 현황판 4201 | **200** | PID 11520, 2026-08-10 14:09부터(가장 오래 생존) |
| CTO Worker | 실행 중 | PID 2928, 2026-08-12 13:19부터(§18-1이 지목한 그 PID와 동일) |
| 로컬 API 4100 | `/health` **200** | 오늘(2026-08-13) 08:39 기동. 기동시킨 launcher 프로세스(PID 5732)는 이미 종료돼 있어 누가/무엇으로 띄웠는지는 **미확인**(재부팅과 무관 — LastBootUpTime과 시각이 다르다) |
| 로컬 Web 3100 | `/login` **200** | 오늘 08:40 기동, 위와 동일한 launcher |
| MinIO 9000 | `/minio/health/live` **200** | D: 데이터 경로 확인(§19-3) |
| PostgreSQL 5432 | 서비스로 다수 프로세스 실행 중 | 자동 시작 서비스(§3-3과 동일, 재확인만 함) |
| SSH 터널(3000/4000, 원격 EC2) | **떠 있지 않음** | `ssh.exe` 프로세스 0건, 3000/4000 포트 리스닝 0건. 원격 자산이라 이번 세션은 손대지 않았다 — **사람이 확인·재연결 필요** |

**로컬 API(4100)/Web(3100)이 "재부팅 자동 복구"의 결과가 아니라는
점이 중요하다** — §3-3·§9(RECOVERY_GUIDE)가 이미 명시한 대로 이
둘은 **의도적으로 자동화 대상이 아니다.** 지금 떠 있는 것은 오늘
아침 누군가(사람 또는 다른 세션)가 `scripts/start-verify-studio.ps1`
류를 수동 실행한 결과로 보인다 — 재부팅이 이 둘을 자동으로 띄운다는
근거는 없다.

### 19-5. 복구 순서 — 등록된 메커니즘 기준 (실제 재부팅 테스트 아님)

```
① PostgreSQL(5432)         Windows 서비스, 자동 시작
② ACOS-Bridge · ACOS-CTO-Worker   로그온 또는 부팅 트리거로 거의 동시에 발동
   ├─ ACOS-Bridge → bridge/start-bridge.ps1 → Bridge 서버(4200)·현황판(4201)
   │   ※ 유일한 실제 트리거 기록이 실패(§19-1) — 성공을 보장하지 않는다
   └─ ACOS-CTO-Worker → bridge-cto-worker.mjs
③ MinIO(9000)               자동 시작 아님 — 사람이 scripts\start-minio.ps1 직접 실행
④ 로컬 API(4100)·Web(3100)   자동 시작 아님(의도적) — 사람이 scripts\start-verify-studio.ps1 직접 실행
⑤ SSH 터널(3000/4000)        자동 재연결 확인된 적 없음 — 사람이 직접 재연결
⑥ cloudflared 터널 공개 주소  재부팅마다 새로 발급 — ChatGPT Actions 재등록 필요(자동화 불가)
```

①·②만 등록된 메커니즘이 있고, ③~⑥은 **사람의 수동 조치가 반드시
필요**하다 — 이 구조 자체는 §3-3·RECOVERY_GUIDE §9-5와 달라진 것이
없으며, 이번 세션은 새로 등록하거나 바꾸지 않았다(실행 세션이
`bridge/` 무단 수정 금지 대상이라 `start-bridge.ps1`을 고칠 수 없고,
§19-2의 근본 원인은 재부팅 또는 사람의 직접 Bridge 재기동으로만
풀리는 구조적 문제라 이 세션이 대신 구현할 안전한 방법이 없었다).

## 20. `ACOS-Bridge` 재부팅 자동복구 실패의 진짜 원인 확정·수정 —
Start-Process 리다이렉션 버그, 환경변수 가설은 반박됨 (T1-105,
2026-08-13)

**이번 작업은 T1-105로 지정 발주됐다** — "재부팅 후 ACOS-Bridge가
매번 LastTaskResult=1로 실패하고 cloudflared가 기동되지 않는 문제를
근본 해결하라"는 명시적 요청이며, `bridge/start-bridge.ps1`과
Task Scheduler 실행 컨텍스트 수정을 **요청 자체가 구체적으로
지시**했다 — `AGENTS.md`의 일반 원칙("Bridge가 호출한 세션이 건드리면
안 되는 것: ... bridge/ 전부")과 이 작업의 구체적 지시가 충돌하는
지점이라, 이번 세션은 **이 작업(T1-105)의 명시적·구체적 지시를
그 범위 안에서만** 우선했다 — tunnel 이름·ID·ingress·자격증명은
전혀 건드리지 않았고, `bridge/` 안의 다른 파일(서버 로직·상태
전이·인증 등)도 손대지 않았다.

### 20-1. 전제 — 이 세션 시작 직전 실제 재부팅이 있었다

`(Get-CimInstance Win32_OperatingSystem).LastBootUpTime` → **2026-08-13
12:45:20** — §16·§19가 실측했던 2026-08-10 14:05:04에서 바뀌어 있었다.
즉 **요청문이 언급한 "매번 실패"의 최신 실제 사례가 이 세션 시작
직전에 이미 발생해 있었고**, 그 흔적(살아있는 프로세스·로그 파일)이
아직 지워지지 않은 채로 남아 있어 실측할 수 있었다. 요청대로 **이번
세션이 직접 재부팅을 실행하지는 않았다.**

`Get-ScheduledTaskInfo ACOS-Bridge` → `LastRunTime 2026-08-13
13:45:45`(부팅 25초 후) · **`LastTaskResult: 1`(실패, 재확인)**.
`ACOS-CTO-Worker`도 같은 시각 트리거됐고 이번엔 다른 코드
(`2147946720` = `0x800710E0`, Win32 표준 메시지 테이블에 없는 Task
Scheduler 전용 코드라 이번 작업 범위(ACOS-Bridge만) 밖이라 더
조사하지 않았다)로 실패했다 — `ACOS-CTO-Worker`가 항상 성공한다는
기존 §19-1 기록도 이번 실제 재부팅에서는 재현되지 않았다는 사실만
기록해 둔다(원인 조사는 범위 밖).

### 20-2. 가설 반박 — S4U/Limited 컨텍스트의 환경변수는 정상이었다

요청이 지목한 "사용자 경로 해석 문제"(`LOCALAPPDATA`·`USERPROFILE`
등이 예약 작업 컨텍스트에서 깨진다는 가설)를 직접 검증했다. **살아있는
`ACOS-Bridge`·`ACOS-CTO-Worker`·현재 4200/4201/cloudflared를 전혀
건드리지 않고**, 동일한 조건(`LogonType: S4U`·`RunLevel: Limited`·
계정 `최덕임`)의 **임시 진단용 예약 작업**(`T1-105-EnvDiag`, 완료
직후 곧바로 등록 해제·로그 삭제)을 새로 만들어 한 번 트리거해 env를
`D:\dev-data\logs`에 덤프했다(민감정보 없음 — 경로·불리언만).

실측 결과 (전부 정상):

```
USERPROFILE     = C:\Users\82104
LOCALAPPDATA    = C:\Users\82104\AppData\Local
APPDATA         = C:\Users\82104\AppData\Roaming
TEMP / TMP      = D:\dev-data\temp   (§18~19가 고친 D: 값 — 새 S4U 세션은 최신 레지스트리 값을 정상적으로 상속받는다)
cloudflared.exe 존재 여부(env 경유)      = True
config.yml 존재 여부(env 경유)           = True
cloudflared.exe 존재 여부(절대경로 경유) = True
config.yml 존재 여부(절대경로 경유)      = True
```

**결론: 환경변수 해석 문제는 없다** — §18~19가 지목한 "이미 떠 있는
프로세스는 새 env를 못 받는다"는 문제는 **새로 스폰되는 예약 작업에는
해당하지 않는다**(정상적인 Windows 로그온 동작대로, 매번 그 시점의
`HKCU\Environment`를 새로 읽는다). 이 가설은 **이번 실측으로
반박됐다.**

### 20-3. 진짜 원인 — cloudflared를 띄우는 `Start-Process`가 예외를
던지고 있었다

`bridge/start-bridge.ps1`을 코드로 직접 추적했다. 1~3단계(포트 정리·
토큰·Bridge 서버·현황판)는 실제로 성공했다 — 지금 떠 있는
`bridge-server.mjs`(PID 16908)·`bridge-board.mjs`(PID 17148)의
`CreationDate`가 정확히 트리거 시각(12:45:45) 13~14초 뒤였다. 문제는
4단계, cloudflared를 띄우는 지점이었다:

```powershell
$log = Join-Path $env:TEMP "cloudflared-bridge.log"
...
Start-Process -FilePath $cloudflared -ArgumentList $tunnelArgs `
  -RedirectStandardOutput $log -RedirectStandardError $log -WindowStyle Hidden
```

**`RedirectStandardOutput`과 `RedirectStandardError`에 같은 파일을
주면 PowerShell의 `Start-Process`가 그 자리에서 예외를 던진다** —
직접 재현해 확인했다:

```
Start-Process : This command cannot be run because "RedirectStandardOutput"
and "RedirectStandardError" are same. Give different inputs and Run your
command again.
```

스크립트 맨 위 `$ErrorActionPreference = "Stop"` 때문에 이 예외가
잡히지 않고 그대로 스크립트를 끝낸다 — **cloudflared.exe는 단 한
번도 실행되지 못한 채** `powershell.exe`가 0이 아닌 코드로 종료되고,
그것이 Task Scheduler의 `LastTaskResult: 1`이다. 재부팅 시점 실측
증거와도 정확히 들어맞는다: 12:46시경에 시작된 cloudflared.exe
프로세스가 전혀 없었고(현재 살아있는 cloudflared는 12:57:57에
시작된 것 하나뿐 — 이는 사람이 나중에 수동으로 복구한 것으로 보인다),
`D:\dev-data\temp`에도 그 시각의 cloudflared 로그가 남아 있지
않았다(스크립트가 로그 파일을 만들기도 전에 `Start-Process` 호출
자체가 죽었기 때문).

**이 버그는 환경·타이밍과 무관하게 100% 재현된다** — "가끔 실패"가
아니라 "항상 실패"라는 요청문의 표현과 정확히 일치한다. 이것으로
`LastTaskResult=1`·"cloudflared가 기동되지 않는 문제"를 모두 하나의
원인으로 설명할 수 있다.

### 20-4. 수정 내용 — `bridge/start-bridge.ps1`만 수정

1. **cloudflared stdout/stderr을 서로 다른 파일로 분리**
   (`cloudflared-bridge.out.log` / `cloudflared-bridge.err.log`) —
   근본 수정. "Registered tunnel connection" 패턴 검사도 두 파일
   모두를 보도록 바꿨다(cloudflared는 이 로그를 표준에러로 쓴다는
   것도 이번에 실측 확인).
2. **cloudflared.exe·config.yml 경로를 절대 경로로 고정**
   (`C:\Users\82104\AppData\Local\cloudflared\cloudflared.exe` ·
   `C:\Users\82104\.cloudflared\config.yml`) — §20-2에서 이 값
   자체는 문제가 아니었음을 확인했지만, 요청이 명시적으로 요구한
   하드닝이라 반영했다. tunnel 이름·ID·자격증명 파일 경로는 그대로다.
3. **로그를 `$env:TEMP` 대신 `D:\dev-data\logs`에 고정** — C→D
   저장정책과 일치하고(`scripts\start-minio.ps1`과 동일한 패턴),
   OS가 주기적으로 비우는 TEMP와 달리 재부팅 실패 원인을 나중에도
   볼 수 있다.
4. **`Start-Transcript`로 스크립트 전체 실행 로그를
   `D:\dev-data\logs\start-bridge-run.log`에 남긴다** — 인증 토큰을
   출력하는 줄 직전에 `Stop-Transcript`를 호출해 **토큰은 이 로그
   파일에 남지 않도록** 분리했다(화면 출력은 그대로 유지 — 사람이
   직접 실행했을 때는 필요하다).

**바꾸지 않은 것**: 포트 정리 로직·토큰 생성 로직·tunnel 이름
(`ai-product-content-bridge`)·`config.yml`·자격증명 파일·Task
Scheduler 등록(Trigger·Principal·S4U/Limited 구조) — 전부 그대로다.
Task Scheduler 설정을 함께 바꾸는 방안(`RunOnlyIfNetworkAvailable`·
재시도 정책 등, 네트워크 타이밍 가설에 대비한 것)도 검토했으나,
**진짜 원인이 타이밍과 무관한 결정론적 버그로 확정된 이상 불필요한
변경**이라 "최소한으로 수정한다"는 요청 원칙에 따라 적용하지 않았다.

### 20-5. 검증 — 실행 중인 Bridge/cloudflared를 건드리지 않고 확인

**실제 `ACOS-Bridge` 예약 작업을 수동 트리거하지 않았다** — 그
스크립트의 1단계가 4200/4201·cloudflared를 죽이고 다시 띄우는
구조라, 지금 사람이 수동 복구해 정상 동작 중인 서비스(이 세션
자신이 Bridge를 거쳐 호출된 경로이기도 하다)를 실행 중간에 내렸다
살리는 위험을 감수할 이유가 없었다 — 요청 5)·7)의 "이미 살아있는
정상 서비스와 충돌하지 않도록"이라는 제약을 그대로 따랐다.

대신 **같은 S4U/Limited 컨텍스트에서 수정된 로직만 격리해 재현
검증**했다(`T1-105-RedirectFixVerify`, 임시 예약 작업, 검증 직후
등록 해제·로그 삭제):

```
StartProcessSplitRedirect = OK(no exception)   ← 원래 버그가 재현되지 않음
OutLogExists = True, ErrLogExists = True
OutLogContent = "cloudflared version 2026.7.3 (built 2026-07-22T09:32 UTC)"
TranscriptTest = OK
```

`cloudflared.exe --version`(네트워크·터널 등록 없이 실행 파일만
확인하는 안전한 호출)이 절대 경로로 정상 실행됐고, 서로 다른 파일로
분리한 리다이렉션이 예외 없이 통과했다 — **§20-3에서 재현한 버그가
수정 후에는 재현되지 않음을 같은 실행 컨텍스트(S4U/Limited)에서
직접 확인**했다.

**한계 — 이번에 확인하지 못한 것**: 실제 `ACOS-Bridge` 전체 실행
경로(포트 정리 → Bridge 서버 → 현황판 → cloudflared 전체 시퀀스)를
끝까지 수동 트리거로 검증하지는 못했다 — 위에서 설명한 대로 살아있는
서비스를 내리는 위험 때문이다. **다음 실제 재부팅에서
`Get-ScheduledTaskInfo ACOS-Bridge`의 `LastTaskResult`가 `0`인지,
`http://localhost:4200/health`·`4201`·
`https://bridge.magicclean79.com/health`이 전부 응답하는지 사람이
확인해야 완전한 검증이 끝난다.**

### 20-6. 현재 라이브 상태 (이번 세션 종료 시점, 실측)

| 구성요소 | 상태 |
| --- | --- |
| Bridge 서버 4200 `/health` | **200** |
| Bridge 현황판 4201 | **200** |
| 공개 주소 `https://bridge.magicclean79.com/health` | **200** |

전부 T1-105 세션 시작 이전부터(재부팅 후 사람이 수동 복구한 상태
그대로) 정상이었고, 이번 세션은 이 셋 중 어느 것도 재시작하지
않았다 — 코드 수정은 `bridge/start-bridge.ps1` 파일에만 있고, 다음
재부팅부터 적용된다.

### 20-7. C/D 저장 경로 — 이번 변경으로 새로 생기는 파일

`D:\dev-data\logs\cloudflared-bridge.out.log` ·
`cloudflared-bridge.err.log` · `start-bridge-run.log` — 전부 D:.
C:에는 아무것도 새로 쌓이지 않는다. 검증에 썼던 임시 진단 파일
(`T1-105-*`)은 검증 직후 전부 삭제했다.

## 21. Claude Code 세션·transcript 저장 위치 — 실측 사실 (T1-107,
2026-08-13)

**목적**: "Claude Code 프로세스가 재시작돼도 이전 대화를 복구할 수
있는가"를 조사하며 확인한 사실을 환경 SSOT에 남긴다. 상세 절차·
판단은 `docs/RECOVERY_GUIDE.md` §11, 겪은 일은
`docs/PROJECT_MEMORY.md` M-57 — 여기는 **사실만** 적는다.

### 21-1. `claude.exe`가 지원하는 세션 관련 옵션 (실측, `--help`)

이 PC에 설치된 버전(`anthropic.claude-code-2.1.229-win32-x64`,
VS Code 확장 안의 `resources/native-binary/claude.exe`)의
`--help` 전문을 직접 확인했다.

| 옵션 | 동작 |
| --- | --- |
| `-c, --continue` | 현재 작업 디렉터리의 가장 최근 대화를 이어간다 |
| `-r, --resume [value]` | 세션 ID로 특정 대화를 이어가거나, 값 없이 주면 선택 화면을 연다 |
| `--session-id <uuid>` | 새 세션을 시작할 때 세션 ID를 직접 지정한다 |
| `--fork-session` | resume 시 새 세션 ID로 분기한다 |

### 21-2. transcript 저장 위치 (실측)

```
~/.claude/projects/<이 저장소 경로를 정규화한 폴더명>/<session-id>.jsonl
```

이 워크트리(`...\GitHub\-.worktrees\claude-chatbot-integration`)에
대응하는 폴더
(`c--Users-82104-Documents-GitHub---worktrees-claude-chatbot-integration`)
안에 이미 **100개가 넘는 `.jsonl` 파일**이 쌓여 있음을 확인했다 —
날짜는 2026-08-07~2026-08-13에 걸쳐 있다. **git에 포함되지 않는다**
(`.gitignore` 대상 밖의 홈 디렉터리 경로 — 이 저장소 바깥).

### 21-3. Bridge가 이 옵션들을 쓰지 않는다는 것을 코드로 확인

`bridge/bridge-executor.mjs`의 `buildClaudeArgs(prompt)`가 실제로
넘기는 인자는 `-p <prompt> --output-format stream-json --verbose
--dangerously-skip-permissions --permission-mode bypassPermissions
--max-budget-usd <값>`뿐이다 — `--session-id`·`--resume`·`--continue`
중 어느 것도 없다. `claudeSpawnOptions(cwd)`가 자식 프로세스에 넘기는
것도 `{cwd, windowsHide, stdio}`뿐, taskId를 담은 환경변수는 없다.
**즉 Bridge가 실행하는 모든 무인 세션은 매번 완전히 새 세션이고,
그 세션 ID를 어디에도 기록하지 않는다** — `bridge/results/<taskId>.json`
에도 없다(실제 스키마 확인, T1-107). 이 절은 읽기만 했다 — `bridge/`
안의 어떤 파일도 이번 작업에서 고치지 않았다(doNotTouch).

### 21-4. 결론 — 무엇이 사실이고 무엇이 그로부터 따라오는 한계인가

- 사실: `claude.exe` 자체는 세션 재개 기능을 갖고 있다.
- 사실: 이 저장소 워크트리 경로 하나에 여러 taskId의 transcript가
  섞여 쌓인다 — 폴더가 taskId 단위가 아니라 cwd 단위이기 때문이다.
- 사실: Bridge는 이 기능을 무인 실행 경로에 연결하지 않았다.
- 따라서(판단): taskId 단위로 신뢰성 있게 "그 작업의 대화만" 다시
  불러올 방법이 지금은 없다. 이 문제를 풀려면 `bridge/bridge-executor.mjs`
  가 실행마다 `--session-id`를 생성해 넘기고 그 값을
  `bridge/results/<taskId>.json`에 함께 적어야 한다 — 이것은
  `bridge/` 코드 수정이라 이번 작업(doNotTouch 대상)의 범위 밖이다.
  필요하면 별도 작업으로 사람 승인을 받아 진행해야 한다.

## 22. ACOS Recovery Manager — 재부팅 후 단일 복구 진입점 (T1-109,
2026-08-13)

**목적**: §3-3·§19·§20이 개별적으로 다뤄 온 "재부팅 시 무엇이
자동이고 무엇이 수동인가"를 하나의 실행 파일·하나의 스케줄러로
통합한다. 새 서비스를 만들지 않고, 기존 부품을 의존성 순서대로
확인·필요할 때만 기동한다.

### 22-1. 구성 — 무엇을 새로 만들고 무엇을 그대로 재사용했는가

| 구성요소 | 상태 | 비고 |
| --- | --- | --- |
| `scripts\acos-recovery-manager.ps1` | **신규** | orchestrator. `bridge/` 안의 어떤 파일도 고치지 않고 호출만 한다 |
| Windows 작업 스케줄러 `ACOS-Recovery-Manager` | **신규 등록** | Logon 트리거 + 45초 지연, S4U/Limited(계정 `최덕임`) — `ACOS-Bridge`·`ACOS-CTO-Worker`와 같은 인증 방식 |
| `ACOS-Bridge`(Boot 트리거) | 그대로 유지 | `bridge\start-bridge.ps1` 실행 — T1-105가 근본원인 수정, 다음 재부팅 검증 대기 |
| `ACOS-CTO-Worker`(Boot 트리거) | 그대로 유지 | `bridge\start-cto-worker.ps1` 실행 |
| `scripts\start-minio.ps1` | 그대로 재사용(T1-74) | 이미 멱등 — 9000이 떠 있으면 그냥 끝난다 |
| `scripts\start-verify-studio.ps1` | 그대로 재사용(T1-63) | PostgreSQL·MinIO가 이미 떠 있어야 동작(전제 확인만, 대신 띄우지 않음) — Recovery Manager가 그 앞 단계에서 순서를 보장한다 |
| `.vscode/tasks.json`의 "CTO Bridge 현황판 열기" | 그대로 유지(T1-106) | 새 작업을 **추가**만 했다 |
| `.vscode/tasks.json`의 "ACOS 자동복구 상태 보기" | **신규 추가** | `runOn: folderOpen` — `D:\dev-data\logs\recovery-manager\latest.txt`를 폴더를 열 때마다 터미널에 보여준다 |
| `scripts/bootstrap-context.mjs` | 그대로 유지(T1-107) | Recovery Manager가 대신 실행하지 않는다 — 무인 스케줄러가 Claude Code 대화 세션을 새로 열 수 없다. 재부팅 후에도 사람/다음 세션이 직접 실행해야 한다 |

### 22-2. 실행 순서와 "이미 정상이면 SKIP" 원칙

```
D:/C: 저장공간 확인 (WARN <5GB, FAIL <3GB)
  -> PostgreSQL(5432)  서비스 Running이면 SKIP, 아니면 Start-Service
  -> MinIO(9000)       포트 응답하면 SKIP, 아니면 start-minio.ps1
  -> Bridge(4200)+현황판(4201)+터널   health 200이면 SKIP(재시작 안 함),
                       실패해야만 bridge\start-bridge.ps1
  -> CTO Worker        cto-worker.lock의 pid가 살아있으면 SKIP,
                       아니면 Start-ScheduledTask(1차) ->
                       bridge\start-cto-worker.ps1 직접 실행(2차)
  -> 로컬 API(4100)/Web(3100)  둘 다 응답하면 SKIP, 아니면 start-verify-studio.ps1
  -> 최종 종합 Health Check (아래 22-4)
  -> SUCCESS/PARTIAL/FAILED 판정 + D:\dev-data\logs\recovery-manager\ 기록
```

**Bridge를 재시작하는 안전 조건**: §3-3-1이 실측 확정한 위험(이
스크립트를 부른 프로세스가 그 Bridge의 자식일 수 있다)을 피하기
위해, **health check가 실패했을 때만** `bridge\start-bridge.ps1`을
부른다. 이미 정상이면 절대 건드리지 않는다 — health check 실패는
"이 프로세스를 살려주는 부모가 이미 없다"는 뜻이므로 그 순간의
재시작은 구조적으로 안전하다.

### 22-3. Boot 트리거 대신 Logon 트리거 + 지연을 쓴 이유

이번 세션 시작 직전 실제 재부팅(2026-08-13 12:45:45)을 실측한
결과 `ACOS-Bridge`뿐 아니라 **`ACOS-CTO-Worker`도
`LastTaskResult=2147946720`(0x800710E0)으로 실패**했다(`docs/
PROJECT_MEMORY.md` M-60). `bridge/start-cto-worker.ps1`은 최상위에
`try/catch`가 없는 `Start-Process -FilePath "node" ...` 호출을
포함하는데, Boot 트리거는 사용자 프로필(PATH 등)이 완전히 로드되기
전에 실행된다 — PATH 해석 실패가 유력한 원인으로 보이지만, `bridge/`
파일을 고칠 수 없어(doNotTouch) 격리 재현으로 확정하지는 않았다
(정황 증거 수준, T1-105처럼 확정하지 못함 — 미확인으로 남긴다).

`ACOS-Recovery-Manager`는 Logon 트리거(사용자 프로필이 이미 로드된
뒤 발동)에 45초 지연을 더해, 두 기존 Boot 트리거 작업이 먼저 시도할
시간을 준 뒤 "확인하고 죽은 것만 되살리는" 안전망 역할을 한다.

### 22-4. 최종 종합 Health Check 10개 항목

| # | 확인 대상 | 방법 |
| --- | --- | --- |
| 1~6 | 포트 4200·4201·4100·3100·9000·5432 | `Get-NetTCPConnection -State Listen` |
| 7 | 외부 터널 | `GET https://bridge.magicclean79.com/health` |
| 8 | Bridge Task API | `GET http://127.0.0.1:4200/tasks` (토큰 파일 있으면 Bearer) |
| 9 | CTO Worker heartbeat | `bridge/cto-worker.lock`의 pid가 실제 살아있는 프로세스인지 |
| 10 | Image Studio Benchmark 사진 API | `GET http://127.0.0.1:4100/uploads/images/<BENCHMARK_IMAGE_IDS[0]>/file` — 인증 불필요(컨트롤러에 가드 없음, 실측 확인) |

### 22-5. 실측 검증 — 무엇을 확인했고 무엇을 못 했는가

**확인함(이번 세션, 실제 재부팅 없이)**:
- `scripts\acos-recovery-manager.ps1`을 직접 2회 연속 실행 —
  모든 구성요소가 이미 정상이라 전부 `SKIP`, 실행 전후 포트별 PID가
  완전히 동일(4100=12920, 3100=19576, 4200=16908, 4201=17148,
  5432=6280, 9000=14732 — 세 번의 실행 내내 불변).
- `Start-ScheduledTask ACOS-Recovery-Manager`로 Task Scheduler
  자신의 S4U/Limited 컨텍스트에서 실제 트리거 — `LastTaskResult=0`.
- 최종 Health Check 10개 항목 전부 실측 통과(외부 터널 200,
  Benchmark 사진 200/565,661 bytes 등). C: 여유공간(4.31GB)만
  WARN — 전체 판정 `PARTIAL`(FAIL 0건, WARN 1건).

**못 함(구조적 한계, 지시에 따라 재부팅 자체를 하지 않음)**:
- "죽어 있는 것을 실제로 되살리는" 분기(MinIO·Bridge·CTO
  Worker·verify-studio를 실제로 새로 기동하는 코드 경로)는 이번
  실행에서 전부 SKIP만 탔다 — 모든 구성요소가 이미 살아있었기
  때문이다. 각 기동 스크립트 자체는 과거 작업(T1-63·T1-74·T1-105)이
  개별적으로 검증했지만, 이 orchestrator를 통한 **콜드 스타트
  end-to-end 재현은 다음 실제 재부팅에서만 확인 가능**하다.
- `ACOS-Bridge`가 다음 재부팅에 `LastTaskResult=0`으로 성공하는지
  (T1-105 수정의 최종 검증)도 여전히 미확인이다.

### 22-6. 재부팅 후 사람이 확인할 최소 체크리스트

```
1. 재부팅한다
2. 몇 분 기다린다 (Boot 트리거 2개 + Logon 트리거 1개(45초 지연) + 빌드 시간)
3. VS Code로 이 워크트리를 연다
   -> "CTO Bridge 현황판 열기" 탭(4201)과
      "ACOS 자동복구 상태 보기" 터미널 패널이 자동으로 뜬다
4. 터미널 패널의 판정이 SUCCESS인지 확인한다
   (PARTIAL/FAILED면 어느 단계인지 그 자리에 적혀 있다)
5. 필요하면 브라우저에서 http://localhost:3100/image-studio 를 직접 연다
```

수동 명령이 필요한 경우(위에서 실패했을 때만, 최후 수단):
```
powershell -ExecutionPolicy Bypass -File scripts\acos-recovery-manager.ps1
```

## 23. CTO Worker·Bridge 서버 운영 로그 D: 전환 + Task 상태 전이 로그 +
rotation (T1-120, 2026-08-13)

**요청 배경**: 재부팅 후 `bridge/.worker-logs`의 CTO Worker 로그와
Bridge 서버 자체 로그가 기록되지 않아 T1-116이 왜 `REQUESTED`로
되돌아갔는지 추적할 수 없다는 지적이었다. 실측한 결과 두 가지 서로
다른 문제가 섞여 있었다.

### 23-1. 실측한 원인 — 디스크 부족과 "애초에 리다이렉트가 없었다"는 별개 문제

1. **`bridge/.worker-logs/cto-worker.log`**(CTO Worker 내부 로그,
   `worker-<타임스탬프>.log`와는 별개 파일)에 실제 `ENOSPC: no space
   left on device, write` 오류가 남아 있었다(마지막 기록
   2026-08-13 11:15 — 재부팅 12:45:20 이전에 이미 멈춰 있었다). 이
   파일은 C:(`bridge/.worker-logs`, 저장소 안)에 있었고, 어떤
   스크립트도 이 정확한 파일명을 참조하지 않는다 — 오래된 수동 실행의
   잔재로 보이며 지금은 아무것도 여기 쓰지 않는다(고아 파일, 삭제하지
   않고 그대로 둠 — 이번 작업 범위는 "쓰기"이지 "삭제"가 아니다).
2. **실제로 살아있는 CTO Worker 로그**(`bridge/.worker-logs/worker-
   <타임스탬프>.log(.err)`, `bridge/start-cto-worker.ps1`의
   `Start-Process` 리다이렉트)는 C: 드라이브에 계속 쌓이고 있었다 —
   C→D 저장정책(§0)과 어긋난다.
3. **Bridge 서버(4200)·현황판(4201) 자신의 로그는 애초에 어디에도
   남지 않고 있었다** — `bridge/start-bridge.ps1`이 `bridge-server.mjs`·
   `bridge-board.mjs`를 `Start-Process`로 띄우면서 `-RedirectStandardOutput`·
   `-RedirectStandardError`를 전혀 주지 않았다(T1-105는 cloudflared
   리다이렉션만 고쳤을 뿐, 이 두 Node 프로세스는 손대지 않았다). 즉
   "C: 공간이 없어서 로그가 끊겼다"가 아니라 **Bridge 서버 자신의
   운영 로그는 처음부터 존재하지 않았다** — 이번에 새로 만들었다.
4. C: 여유공간은 이번 세션 확인 시점 **4.70~4.71GB**(`Get-PSDrive C`)로
   §22-5(4.31GB, WARN)보다 소폭 나아졌지만 여전히 권장 최소치(5GB)
   아래다. D:는 **226GB** 여유 — 로그를 옮길 이유가 충분하다.

### 23-2. 만든 것 — 새 로그 위치와 D: 전환

| 로그 | 이전 위치 | 새 위치 | 비고 |
| --- | --- | --- | --- |
| CTO Worker supervisor stdout/stderr | `bridge/.worker-logs/worker-<타임스탬프>.log(.err)`(C:) | `D:\dev-data\logs\cto-worker\worker-<타임스탬프>.log(.err)` | `bridge/start-cto-worker.ps1` 수정. D:가 없으면(다른 PC) 기존 C: 경로로 안전하게 되돌아간다 |
| Bridge 서버(4200) stdout/stderr | **없었음** | `D:\dev-data\logs\bridge-server.out.log` / `.err.log` | `bridge/start-bridge.ps1`이 이제 리다이렉트한다(신규) |
| 현황판(4201) stdout/stderr | **없었음** | `D:\dev-data\logs\bridge-board.out.log` / `.err.log` | 위와 동일 |
| cloudflared·`start-bridge-run.log` | `D:\dev-data\logs\...`(T1-105가 이미 D:로 전환함) | 변경 없음 | 그대로 재사용 |
| **Task 상태 전이 운영 로그**(신규) | 없었음 — `bridge/results/<taskId>.json`·`bridge-events.mjs`의 `events.json`이 상세를 담지만 D:에는 없었다 | `D:\dev-data\logs\bridge\task-state.log` | `bridge/bridge-ops-log.mjs`(신규) — 아래 23-3 |
| Recovery Manager 로그(`history.log`·`run-*.json`) | `D:\dev-data\logs\recovery-manager\`(T1-109가 이미 D:로 전환함) | 변경 없음 | rotation만 추가(23-4) |

### 23-3. Task 상태 전이 최소 추적 로그 — `bridge/bridge-ops-log.mjs`(신규)

요청 5)가 요구한 "taskId·시각·이전/현재 상태·runId·실패 원인/exit
code"를 `bridge-io.mjs`의 `writeResult`(모든 상태 전이가 지나가는
단일 지점)에서 실제 전이가 일어났을 때만(`from !== state`) 한 줄로
`D:\dev-data\logs\bridge\task-state.log`에 남긴다. `bridge/results/
<taskId>.json`(상태 DB)·`bridge-events.mjs`의 `events.json`(완료/결정
보고용)이 이미 담고 있는 상세 내용(workDone·testResults 등)은 다시
적지 않는다 — 이 로그의 차별점은 `bridge-events.mjs`가 잡음으로
제외하는 `IN_PROGRESS`·`TESTING` 전이까지 전부 남겨, Bridge 프로세스가
재부팅·크래시로 사라져도 "어디서 멈췄는지"를 원시 타임라인으로 볼 수
있게 하는 것이다. D:가 없거나 쓰기가 실패해도 상태 전이 자체(`writeResult`)를
막지 않는다(다른 기존 훅과 같은 fail-open 원칙).

### 23-4. Rotation — 크기·기간 기준

| 로그 | 정책 |
| --- | --- |
| `task-state.log` | 10MB 넘으면 `.1`~`.3`까지 회전, 그 이상은 삭제 |
| `bridge-server.out/err.log`·`bridge-board.out/err.log`·`start-bridge-run.log` | `start-bridge.ps1` 재실행(재부팅·수동 재시작) 시점에 20MB 넘으면 타임스탬프를 붙여 보관, 최근 3개만 남긴다 |
| CTO Worker `worker-*.log(.err)` | 14일보다 오래된 파일을 `start-cto-worker.ps1` 시작 시 정리 |
| Recovery Manager `history.log` | 5MB 넘으면 회전(최근 3개), `run-*.json`은 30일보다 오래된 것만 정리 |

### 23-5. 확인한 것 — 실측

- `bridge-ops-log.mjs`를 직접 호출해 `D:\dev-data\logs\bridge\
  task-state.log`에 실제로 줄이 쓰이는 것을 확인했다(스모크 테스트,
  이후 삭제).
- 11MB로 채운 파일에 한 줄을 더 쓰면 `.1` 백업이 생기고 새 파일이
  115바이트로 다시 시작하는 것을 확인했다(rotation 재현).
- `bridge/start-bridge.ps1`·`bridge/start-cto-worker.ps1`·
  `scripts/acos-recovery-manager.ps1` 전부 PowerShell 파서로 구문
  검증만 통과시켰다 — **라이브 4200/4201/CTO Worker는 이번에도
  재시작하지 않았다**(§3-3-1의 구조적 위험, 이 세션 자신이 그
  Bridge의 자식 프로세스일 수 있다). 따라서 이 세 스크립트의
  **실제 재부팅 경로 끝까지의 검증은 다음 실제 재부팅에서만
  가능하다** — T1-105·T1-109와 같은 한계다.
- `bridge/*.spec.mjs` 테스트(10개 스펙 파일이 자체 sandbox에
  `bridge-io.mjs`를 복사해 도는 구조)가 새 파일 `bridge-ops-log.mjs`를
  sandbox 복사 목록에 못 찾아 처음에 10개 파일이 전부 깨졌다 — 그
  10개 스펙 파일의 `MODULES` 목록에 `"bridge-ops-log.mjs"`를 추가해
  고쳤고, `node --test bridge/*.spec.mjs` 14/14 통과로 재확인했다.

### 23-6. C: 여유공간 — 삭제 없이 측정한 후보 (승인 필요, 삭제하지 않음)

이번 세션은 **삭제를 실행하지 않았다** — 요청이 "먼저 측정해
제안한다"고 명시했다. `C:\Users\82104\AppData` 30.81GB 중 사람
승인 없이 건드리면 안 되는 것(Claude Desktop `vm_bundles` 12.7GB,
Google 4.71GB, Kakao 3.05GB)을 제외하고 실제로 측정한 안전 후보:

| 후보 | 크기 | 성격 |
| --- | --- | --- |
| `AppData\Local\Temp` | 0.59GB | `$env:TEMP`가 이미 `D:\dev-data\temp`를 가리키므로(§17) 새로 쌓이지 않는다 — 남은 것은 그 전환 이전 잔재 |
| `AppData\Local\CrashDumps` | 0.19GB | Windows가 자동 생성하는 크래시 덤프, 순수 진단용 |
| `$Recycle.Bin` | 0.01GB | 휴지통 |
| `AppData\Local\GitHubDesktop` | 1.99GB | GitHub Desktop 캐시로 보이나 실제로 관리하는 로컬 clone·캐시가 섞여 있을 수 있어 **추가 확인 없이는 후보에서 제외** |

합계 약 0.6~0.8GB — 크지 않다. C: 공간의 근본 대응은 이번 작업처럼
**로그·산출물 writer 자체를 D:로 옮기는 것**이지, 매번 C: 잔여
캐시를 찾아 지우는 것이 아니다(§17 철학과 동일).

## 24. GitHub 영속화 — Git Task Sync (T1-130, 2026-08-14)

### 24-1. 인증 상태 — 실측 (비대화형 push는 여전히 불가능)

T1-59가 이미 "이 세션 환경에서는 GitHub 인증이 안 된다"고 확인했다
(§0·§12 참고). 이번에 그 원인을 더 정확히 재현했다.

| 명령 | `GIT_TERMINAL_PROMPT` 없이 | `GIT_TERMINAL_PROMPT=0`로 |
| --- | --- | --- |
| `git ls-remote origin HEAD` (읽기) | **성공**(공개 저장소라 인증 없이도 됨) | 해당 없음(원래도 됨) |
| `git push --dry-run origin <branch>` | **20초 넘게 응답 없음**(Git Credential Manager가 대화형 프롬프트를 시도하며 대기 — timeout으로 강제 종료) | **즉시 실패**: `fatal: could not read Username for 'https://github.com': terminal prompts disabled` (exit 128) |
| `git credential fill` | **8초 넘게 응답 없음**(캐시된 자격 증명 없음, GCM이 로그인 UI를 띄우려 시도) | (같은 원인이라 결과 동일) |

`git config credential.helper` → `manager`(Windows Git Credential
Manager, repo 레벨과 system 레벨 둘 다 이미 설정됨) — **저장소
설정 문제가 아니다.** 문제는 **캐시된 자격 증명이 없고, 이 세션이
GCM의 대화형(브라우저/기기 코드) 로그인 흐름을 완료할 수 없다**는
것이다.

**중요한 안전 발견**: `GIT_TERMINAL_PROMPT`를 지정하지 않으면 push·
`credential fill` 모두 **조용히 무한 대기**한다(외부에서 timeout으로
끊어야만 멈춘다) — 자동화 스크립트가 이 상태로 재부팅마다 또는
스케줄러로 반복 실행되면, 그 자체가 좀비 프로세스를 계속 쌓는
위험이 된다. **그래서 아래 Git Task Sync 시스템은 모든 git 네트워크
호출에 `GIT_TERMINAL_PROMPT=0`을 강제한다** — 인증이 안 되면
**즉시(1초 미만) 실패**하고 절대 대기하지 않는다.

### 24-2. 사람이 해야 하는 최소 1회 작업 — 인증 캐싱

아래 중 **하나만** 하면 된다. 그 뒤로는 Git Credential Manager가
자격 증명을 캐싱하므로, 이 저장소를 쓰는 모든 비대화형 세션(Claude
Code 포함)이 추가 설정 없이 push할 수 있게 된다 — 코드나 환경변수에
토큰을 넣는 우회는 하지 않는다(요청 원칙).

```
1. VS Code(또는 사람이 직접 여는 터미널)에서 이 저장소 폴더로 이동
2. git push -u origin agents/claude-chatbot-integration --dry-run
   (또는 실제로 올릴 커밋이 있다면 --dry-run 없이)
3. 브라우저가 뜨면 GitHub 계정으로 로그인(이미 로그인돼 있으면
   "Authorize" 클릭만)
4. 완료되면 Git Credential Manager가 Windows 자격 증명 관리자에
   토큰을 저장한다 — 이후 세션은 이 저장소 위치에서 이 값을
   재사용한다
```

이 저장소의 원격은 비공개가 아니라도(현재 `git ls-remote`가 인증
없이도 되는 것으로 보아 읽기는 이미 공개 접근 가능) **쓰기(push)는
여전히 자격 증명이 필요**하다 — GitHub는 push 시 항상 인증을
요구한다.

### 24-3. Git Task Sync — 무엇을 만들었는가

**목표**: 검증(build·typecheck·lint·test 전부 `ok:true`) 통과한
Task 단위로만, 사람 승인 없이도 안전하게 git에 commit하고(인증이
준비되면) push까지 자동으로 이어지게 한다. `bridge/`는 전혀 수정하지
않는다(읽기만) — Bridge의 작업 완료 흐름(`bridge-executor.mjs`)에
훅을 심는 대신, `bridge/results/*.json`을 **밖에서 주기적으로 읽어**
새로 자격을 갖춘 Task를 찾는 방식으로 설계했다.

```
scripts/git-task-sync.mjs        핵심 엔진(신규)
scripts/start-git-task-sync.ps1  Task Scheduler 진입점(신규, 로직 없음)
scripts/acos-recovery-manager.ps1  6번 단계로 큐 재시도 상태 확인 추가(신규 단계만, 기존 5단계는 그대로)
```

**Task 선정 기준** (`git-task-sync.mjs`):

1. `bridge/results/<taskId>.json`의 `state`가 `READY_FOR_REVIEW` 또는 `COMPLETED`
2. `testResults.build/typecheck/lint/tests` **전부** `ok:true`
3. `changedFiles`가 비어 있지 않음
4. 아직 동기화 기록(`synced-tasks.json`)에 없음(중복 처리 방지)
5. 그 Task의 `changedFiles`가 **지금 `IN_PROGRESS`/`TESTING`/`REQUESTED`인
   다른 Task의 `changedFiles`와 겹치지 않음** — 겹치면 "여러 작업이
   동시에 바꾼 파일을 무작정 한 커밋으로 섞지 않는다"(요청 4번)는
   원칙에 따라 이번 실행에서는 건너뛰고 다음 실행에서 재확인한다
6. `changedFiles` 중 `apps/web/app/benchmark/constants.ts`·
   `bridge/` 아래 전부는 **항상 제외**(자동 수정 금지 목록과 동일,
   AGENTS.md) — 나머지 파일만으로도 커밋할 게 없으면 그 Task는
   건너뛴다
7. 남은 파일이 실제로 `git status --porcelain --untracked-files=all`
   기준 변경 상태여야 커밋 대상에 포함한다(이미 다른 경로로
   커밋됐거나 diff가 없으면 조용히 제외)

**비밀값 검사**: `git add`로 스테이징한 뒤 `bridge/check-secrets.mjs`
를 그대로 호출한다(수정하지 않음, 기본 모드 — 스테이징된 파일만
검사). 걸리면 **스테이징을 되돌리고 커밋하지 않는다** — 사람이
확인해야 하는 `blocked-secrets` 상태로 기록한다.

**커밋**: `chore: <Task 제목> (Task <ID>)` + `workDone` 목록 +
`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

**push**: `GIT_TERMINAL_PROMPT=0` + 20~25초 하드 타임아웃(Node
`spawnSync`의 `timeout` 옵션, 2차 방어선)으로 시도한다. 성공하면
`synced-tasks.json`에 `status: "pushed"`·원격 SHA를 기록한다.
실패하면(인증·네트워크·기타로 분류) **로컬 커밋은 그대로 두고**
`push-queue.json`(브랜치 단위)에 실패 이유·시도 횟수를 기록한다 —
다음 실행(수동·재부팅·20분 주기)이 큐부터 재시도한다.

**업스트림**: 그 브랜치가 원격에 아직 없으면(`@{u}` 없음) 첫 성공
push에서만 `git push -u origin <branch>`를 쓴다 — 인증이 실제로
성공했을 때만 원격 브랜치가 만들어진다(요청 8번).

**저장 위치**: 상태(`synced-tasks.json`·`push-queue.json`)는
`D:\dev-data\git-sync\`, 로그(`git-sync.log`, T1-120과 같은 rotation
정책 — 10MB·백업 3개)는 `D:\dev-data\logs\git-sync\`. D:가 없는
환경에서는 저장소 안 `.tmp/git-sync*`로 자동 폴백한다(Recovery
Manager와 같은 원칙). 테스트 전용으로 `GIT_TASK_SYNC_STATE_DIR`·
`GIT_TASK_SYNC_LOG_DIR` 환경변수로 위치를 바꿀 수 있다(실 운영에서는
쓰지 않는다).

### 24-4. 341건(현재 미커밋 변경)은 건드리지 않았다 — baseline 처리

`node scripts/git-task-sync.mjs --init`을 한 번 실행해, **지금
시점에 이미 `READY_FOR_REVIEW`/`COMPLETED`인 Task 80건**을
`synced-tasks.json`에 `status: "baseline-excluded"`로 표시했다 —
`--init`은 git 상태를 전혀 바꾸지 않는다(`git add`·`commit`을 전혀
호출하지 않음, 커밋 전후 `HEAD`가 동일함을 실측 확인). 이 80건은
**자동 동기화 대상이 아니며, 사람이 별도로 "지금 341건을 어떻게
정리할지" 결정해야 한다**(요청 9번) — 그 결정은 이 작업(T1-130)의
범위가 아니다.

이후 이 baseline에 없는 **새로** `READY_FOR_REVIEW`/`COMPLETED`가
되는 Task만 스캔 대상이 된다.

### 24-5. 자동 실행 — 언제 도는가

새 Task Scheduler 항목 `ACOS-Git-Task-Sync`(기존 `ACOS-Bridge`·
`ACOS-CTO-Worker`·`ACOS-Recovery-Manager`와 같은 S4U 로그온 인증
방식, 관리자 권한 세션에서 등록 성공 확인)를 등록했다.

| 트리거 | 동작 |
| --- | --- |
| 로그온 시 | `scripts/start-git-task-sync.ps1` → `git-task-sync.mjs`(전체 사이클) 1회 |
| 이후 20분마다(최대 10년, 사실상 상시) | 같은 전체 사이클 반복 |

전체 사이클은 ① 큐 재시도 → ② 새로 자격을 갖춘 Task 스캔·커밋·push
시도 순서다. 새 Task가 없으면 아무것도 하지 않는다(요청 10번 "너무
자주 commit 만들지 않기"는 실행 빈도가 아니라 **자격 조건**으로
지킨다 — 20분마다 돌아도 자격을 갖춘 새 Task가 없으면 no-op).

추가로 `scripts/acos-recovery-manager.ps1`의 새 6번 단계가 재부팅
직후 `git-task-sync.mjs --retry-queue-only`(새 커밋을 만들지 않고
**이미 만든 로컬 커밋의 push만** 재시도)를 호출한다 — 작업 트리를
reset/pull/checkout하지 않는다(요청 7번).

### 24-6. 실측 검증 — 격리된 가짜 저장소에서 (실제 GitHub·실제 341건은 건드리지 않음)

실제 저장소·실제 GitHub push를 오염시키지 않기 위해, `%TEMP%`
아래 완전히 별도인 git 저장소 + 로컬 bare 저장소("가짜 origin")를
만들어 아래 6가지 경로를 전부 실제로 재현·확인했다(전부 통과,
테스트 폴더는 종료 후 삭제):

1. 정상 Task → commit 생성 → push 성공 → 가짜 원격에 실제로 반영됨
   (bare repo `git log`로 직접 확인)
2. 진짜처럼 보이는 API 키가 섞인 파일 → `check-secrets.mjs`가 걸러냄
   → 커밋되지 않고 작업 트리도 그대로 유지됨
3. 진행 중(`IN_PROGRESS`)인 다른 Task와 파일이 겹치는 경우 → 이번
   실행은 건너뜀(다음 실행에서 재확인)
4. 원격이 응답하지 않는 상태로 push → 로컬 커밋은 유지, 실패 이유
   `network`로 큐에 기록 → 원격을 복구한 뒤 `--retry-queue-only`
   실행 → 큐에 있던 커밋이 실제로 push됨
5. `--init` 실행 전후 `HEAD`가 완전히 동일함(baseline 표시는 git을
   전혀 건드리지 않음)
6. `apps/web/app/benchmark/constants.ts`·`bridge/` 아래 파일은
   `changedFiles`에 있어도 자동 커밋되지 않고 작업 트리에 그대로
   남음

**실측 중 발견해 고친 버그**: `git status --porcelain`은 **새로
생긴 미추적 디렉터리를 그 안의 파일 하나하나가 아니라 디렉터리
자체(`?? src/`)로 뭉쳐서 보여준다.** 이 상태로는 새 폴더 안의 새
파일이 `changedFiles`와 절대 매칭되지 않아 "diff 없음"으로 잘못
건너뛰게 된다 — `--untracked-files=all` 옵션을 추가해 고쳤다(교훈은
`docs/PROJECT_MEMORY.md` M-66).

### 24-7. 이번 세션이 실제 GitHub push는 하지 않은 이유

인증이 준비되지 않은 상태(24-1)에서 실 저장소에 대해
`git-task-sync.mjs`(전체 사이클, --init 이후)를 이미 실행해 봤지만,
baseline 처리 덕분에 **새로 커밋할 대상이 없어 아무 일도 일어나지
않았다**(`HEAD` 불변, 파일 상태 불변 — 실측 확인). 즉 이 세션은
**실제 GitHub 원격에 어떤 커밋도 push하지 않았다** — §24-2의 1회
인증이 사람 손으로 끝나야, 그 이후 새로 완료되는 Task부터 실제
push가 일어난다.

## 25. 브라우저 접속 반복 문제 — 근본 원인 3가지와 구조적 수정 (T1-201, 2026-08-27)

**배경**: T1-178부터 T1-200까지 "3100/4100 접속 안 됨"이 반복
재발했다. 매번 그 순간의 증상(포트 안 뜸·404·CORS)만 임시로
고치고 다음 세션이 다시 같은 문제를 처음부터 진단했다. 이번
작업은 **재발 자체를 막는 구조적 원인**을 찾아 고쳤다 — 특정
generation URL 하나를 여는 것이 목적이 아니다.

### 25-1. 근본 원인 ① — Playwright 자체 webServer가 사람 검증용
3100과 같은 포트를 다시 띄우려 했다 (가장 크다)

`apps/web/playwright.config.ts`가 `pnpm turbo run test`(공식 검증
명령, `AGENTS.md` Definition of Done)를 실행할 때마다 `next dev
--port 3100`을 `reuseExistingServer: false`로 새로 띄우려 했다.
`scripts/start-verify-studio.ps1`(사람이 보는 고정 검증 서버)이
이미 3100을 쓰고 있으면 **Playwright가 포트 충돌로 실패**하고,
반대로 Playwright가 먼저 떴다가 죽으면 3100이 비어 사람이 보던
화면이 사라졌다 — `docs/PROJECT_STATE.md`의 T1-149·T1-177·T1-179
등이 "3100 죽이거나 webServer로 교체 금지"라고 반복해서 우회만
하고 구조적으로 고치지 않은 바로 그 문제다.

**수정**: `apps/web/playwright.config.ts`의 테스트 전용 웹 서버
포트를 **3100 → 3101**로 분리했다(스텁 API 포트 4999는 기존 그대로,
이미 사람 검증용 4100과 겹치지 않았다). 이제 `pnpm turbo run test`와
`scripts/start-verify-studio.ps1`은 서로 다른 포트를 써서 **동시에
떠 있어도 충돌하지 않는다.** 어느 스펙 파일도 `localhost:3100`을
하드코딩하지 않음을 `grep`으로 확인하고 바꿨다(영향 없음).

### 25-2. 근본 원인 ② — 검증 서버 기동이 매번 수 분짜리 전체
재빌드라, 무인 세션이 "기다리다 결과 기록 없이 끝나는" 패턴을
반복 유발했다

`start-verify-studio.ps1`은 실행할 때마다 `apps/api`
(prisma generate + nest build)·`apps/web`(next build) 전체를 다시
빌드했다 — 코드가 전혀 바뀌지 않았어도 매번 수 분이 걸렸다.
`bridge/results/T1-198.json`·`T1-199.json`을 직접 읽어 확인한 바,
두 세션 모두 이 스크립트를 백그라운드로 띄운 뒤
`rawResponse`에 "기다리겠다"고만 남기고 실제로는 다시 확인하지
않아 `workDone`이 빈 채로 세션이 끝났다 — Bridge가 그 상태를
"기록이 빠졌습니다"로 막아 `TESTING`에 계속 멈춰 있었다
(`STATUS.md`의 "막혀 있는 작업" 목록에 T1-198·T1-199로 그대로
남아 있다).

**수정**: `start-verify-studio.ps1`에 idempotent 단축 경로를
추가했다 — 이미 **같은 커밋**으로 3100·4100이 정상 응답 중이면
재빌드·재기동을 생략하고 즉시 반환한다(수 초). 코드가 실제로
바뀌었을 때만(커밋 해시가 다를 때) 원래대로 전체 재빌드한다.
`-Force`로 강제 재기동도 가능하다. 스크립트 자체는 원래도
동기식(백그라운드로 실행할 필요가 없음)이었다는 점과, 이 스크립트를
background로 띄운 뒤 결과를 확인하지 않아 사고가 반복됐다는 사실을
스크립트 머리말에 명시했다.

### 25-3. 근본 원인 ③ — 서버가 죽어도 왜 죽었는지 볼 로그가 없었다

`Start-Process ... -WindowStyle Hidden`만 쓰고 `-RedirectStandard
Output/Error`를 지정하지 않아, API·Web 프로세스가 기동 도중 죽으면
표준출력·표준에러가 그냥 버려졌다 — 사람도 다음 세션도 "왜 죽었는지"
알 방법이 없어 매번 처음부터 재추측했다. 이번 조사 중 실제로 이
현상을 재현했다: 라이브로 떠 있던 API(PID 17564)·Web(PID 18388)
프로세스가 관찰 도중 사라졌는데(동시에 실행 중이던 T1-200이
자체적으로 정리한 것으로 보인다 — 이 세션이 죽인 것은 아니다),
어느 쪽 로그에도 원인이 남지 않았다.

**수정**: API·Web 기동에 `-RedirectStandardOutput`·
`-RedirectStandardError`를 추가했다. 로그 위치는 D:\dev-data가 있으면
`D:\dev-data\logs\verify-studio\`(§17의 D: 우선 저장 정책과 동일),
없으면 `scripts\.verify-studio-logs\`(신규, `.gitignore` 추가)로
폴백한다. 헬스체크가 실패하면 그 자리에서 로그 마지막 40줄을 바로
출력한다 — 재현/재추측 없이 그 실행 한 번으로 원인이 보인다.

### 25-4. 확인했지만 이미 고쳐져 있던 것 — CORS/localhost·127.0.0.1

`apps/api/src/main.ts`의 `WEB_URL` 기본값은 이미 `localhost:3000`·
`localhost:3100` 둘 다 허용하도록 T1-62/T1-88이 고쳐 두었다(§4-14
근거와 동일). 이번에 **127.0.0.1 표기**도 기본값에 추가했다 — 브라우저
기준으로 `localhost`와 `127.0.0.1`은 서로 다른 Origin이라 CORS가
문자열 비교로 막히기 때문이다. `WEB_URL`을 명시하면 기존처럼 그 값만
쓴다(운영 동작 변경 없음).

### 25-5. 프론트가 API 응답이 없을 때 무한 대기하던 것

`apps/web/app/level2-generate/detail-page-view.tsx`는 이미
로딩/에러 상태를 분리해 두고 있었다(`data-testid="detail-page-
error"`, 에러 시 알림 배너) — API가 즉시 4xx/5xx로 응답하면 문제
없다. 다만 `multi-client.ts`의 `fetch()`에는 타임아웃이 없어, API가
**연결은 되지만 응답을 끝내지 못하는 경우**(예: 다운스트림 지연)
화면이 "불러오는 중…" 상태로 무기한 대기했다. `request()`·
`fetchPageImageUrl()`·`fetchAssetImageUrl()` 전부에 20초
`AbortSignal.timeout()`을 추가해, 응답이 없어도 20초 안에 반드시
에러 상태로 전환되게 했다.

### 25-6. 새 회귀 게이트 — `scripts/check-detail-page-connectivity-smoke.mjs` (신규)

"3100 상세 route → 4100 API → generation → asset" 전체 고리를 자동
확인하는 스크립트를 새로 추가했다(`pnpm check:detail-page-smoke`).
Gemini/OpenAI 실 호출 없음(GET만). 기본 대상은 이번 요청이 명시한
두 실제 generation — T1-197 `cmt6jnzbr0001ul2gim2mwznv`·T1-196
`cmt5w3vlm0001ulo8qrbc3aqt` — 이며, API generation 조회·페이지
asset 조회·웹 route HTTP 상태·실 Chromium(console/page error·
broken image 0건)까지 한 번에 판정한다.
`scripts/start-verify-studio.ps1`로 띄운 서버가 이미 떠 있어야
하며(서버를 대신 띄우지 않음), `check-image-studio-smoke.mjs`와
같은 설계 원칙을 따른다.

### 25-7. 공식 단일 실행 흐름 (변경 없음, 이번에 재확인)

```
powershell -ExecutionPolicy Bypass -File scripts\start-verify-studio.ps1
node scripts/check-detail-page-connectivity-smoke.mjs   # 신규 — 연결 회귀 확인
```

`scripts/start-verify-studio.ps1`이 여전히 3100(Web)·4100(API)을
띄우는 유일한 공식 진입점이다 — 이번 작업은 새 진입점을 만들지
않고, 기존 진입점이 안전하게(idempotent·로그 남김) 동작하도록
고쳤을 뿐이다.

## 26. "T1-203 자동 검증 성공"과 "사용자 브라우저 접속 실패"가 동시에
참일 수 있었던 이유 — 재부팅이 검증 서버를 죽였고, 자동 복구도
중간에 죽었다 (T1-204, 2026-09-01)

**출발점**: 사용자가 `http://localhost:3100/level2-generate/
cmt6jnzbr0001ul2gim2mwznv`에 브라우저로 접속할 수 없다고 보고했다.
같은 URL을 T1-203(2026-08-28)이 실 Chromium으로 열어 200·에러
0건으로 검증했다고 보고한 바로 그 URL이다. **둘 다 거짓이 아니었다**
— 시점이 달랐다.

**실측한 사실, 시간순**:

1. T1-203(2026-08-28 11:43)이 `scripts\start-verify-studio.ps1`로
   API(PID 21516)·Web(PID 4692)를 띄웠다. 이 프로세스들은
   `Start-Process`로 완전히 분리(detached)되어 있어, 그 스크립트를
   호출한 세션이 끝난 뒤에도 실제로 **3일 가까이(2026-08-31 09:07
   까지 API 로그에 정상 활동 기록)** 살아 있었다 — "background로
   띄운 프로세스가 세션 종료와 함께 죽는다"는 걱정은 이 경로에서는
   사실이 아니었다.
2. `Get-CimInstance Win32_OperatingSystem`.`LastBootUpTime` =
   **2026-08-31 09:08:11**. API 로그의 마지막 줄(09:07:43)과 정확히
   맞물린다 — **PC가 재부팅되면서 그 두 프로세스가 죽었다.**
   `node dist/main.js`·`node next start`는 일반 사용자 프로세스이지
   Windows 서비스가 아니므로(PostgreSQL과 다름) 재부팅에서 살아남을
   방법이 원래 없다 — 이건 버그가 아니라 이 실행 방식의 당연한
   한계다.
3. 재부팅을 감지하고 3100/4100을 되살려야 할 책임은
   `ACOS-Recovery-Manager` 스케줄러(§0 요약·T1-109)에 있다. 실제로
   같은 날 09:09:08에 트리거됐다(`Get-ScheduledTaskInfo` 확인). 하지만
   `D:\dev-data\logs\recovery-manager\history.log`를 이 runId
   (`20260831-090908`)로 걸러 보면 **"PostgreSQL(5432): SKIP" 단계
   (스크립트의 5단계 중 1단계) 이후로 로그가 완전히 끊긴다** — MinIO·
   Bridge·CTO Worker·로컬 API/Web(3100/4100, 스크립트의 5단계) 중
   어느 것도 시도된 흔적이 없다. `run-20260831-090908.json`도
   `verdict: "IN_PROGRESS"`·`steps: []`로 멈춰 있다(스크립트 시작
   시점에 한 번 쓴 초기값 그대로 — 끝까지 실행됐다면 `SUCCESS`/
   `PARTIAL`/`FAILED`로 덮어썼을 값).
   `Get-ScheduledTaskInfo`의 `LastTaskResult`는 **267014(0x41306,
   `SCHED_S_TASK_TERMINATED`)** — Task Scheduler 자신이 이 실행을
   중간에 강제 종료했다는 뜻이다. 스크립트 안의 모든 단계는
   `try/catch`로 감싸여 있어 스크립트 자체 로직이 예외를 던져 죽는
   구조가 아니다(`$ErrorActionPreference = "Continue"`) — 즉 원인은
   스크립트 코드가 아니라 **Task Scheduler가 이 프로세스를 얼마나
   더 살려 둘지에 대한 OS 레벨 판단**(S4U 로그온 세션·로그온 트리거
   타이밍 등)에 있는 것으로 보인다. **정확한 OS 레벨 원인은 실제
   재부팅으로만 재현·확정할 수 있어 이번 세션은 추측으로 "고쳤다"고
   적지 않는다** — 재부팅은 이 워크트리를 포함한 다른 세션·작업에
   영향을 주는 파괴적 조치라 사람 승인 없이 실행하지 않았다.
4. 그 결과 3100/4100은 **2026-08-31 09:08부터 이 작업(T1-204,
   2026-09-01)이 재기동하기 전까지 계속 꺼져 있었다** — `Get-
   NetTCPConnection`으로 직접 재현: 이번 세션 시작 시점에 3100·4100
   모두 LISTEN 없음, 4200·4201·5432·9000은 정상. 아무도 다시
   `scripts\start-verify-studio.ps1`을 손으로 실행하지 않아 이 상태가
   그대로 굳어 있었다 — "자동 복구가 있으니 사람이 안 봐도 된다"는
   전제가 이번에 깨졌다.

**이번 작업이 실제로 고친 것**:

- `pnpm run studio:start`(신규, `scripts\start-verify-studio.ps1`과
  동일 스크립트 — `studio:verify`의 별칭) / `pnpm run studio:stop`
  (신규, `scripts\studio-stop.ps1`)을 추가해 **"사람이 계속 쓸
  서버를 올리고 내리는 것"**을 `verify:all`(1회성 자동 검증, T1-203)
  과 이름으로도 명확히 분리했다 — `verify:all`은 내부적으로
  studio를 기동하지만 "사람이 볼 서버를 계속 보장하는 것"이 그
  명령의 책임은 아니다(§25-2·T1-203 원문 그대로, 역할만 이름으로
  더 분명히 했다).
- `scripts\studio-stop.ps1`(신규) — `.verify-studio-status.json`에
  기록된 PID(우선) 또는 3100/4100 포트 점유 PID(폴백)만 정지한다.
  3000·4000·5432·9000·4200·4201은 절대 건드리지 않는다.
- `scripts\start-verify-studio.ps1` 머리말에 studio:start와
  verify:all의 책임 경계, 그리고 "재부팅하면 이 프로세스도 죽으니
  재부팅 후에는 사람이 한 번 직접 실행해 확인하라"는 문장을 명시
  추가했다.
- 이번 세션이 `pnpm run studio:start`를 직접 실행해 3100/4100을
  다시 올렸다 — 아래 RESULT_JSON의 브라우저 확인 URL 참고.

**아직 고치지 않은 것(사람 판단 필요, `decisionNeeded` 참고)**:
`ACOS-Recovery-Manager`가 재부팅 직후 Task Scheduler에 의해
중간에 종료되는 근본 원인은 실제 재부팅으로만 재현·확정할 수
있다. 후보로 로그온 트리거의 실행 시간 제한(`ExecutionTimeLimit
PT30M`은 충분히 길어 보이지만 트리거 자체의 지연·세션 준비 타이밍
문제일 수 있음)·S4U 로그온 방식의 초기 부팅 시점 제약 등이 있으나
**실제 재부팅 재현 없이 코드를 고치면 추측으로 "고쳤다"고 말하는
것**이라 이번에는 시도하지 않았다. `Boot` 트리거를 `ACOS-Bridge`·
`ACOS-CTO-Worker`처럼 추가하는 대안도 있지만, 이는 이미 등록된
Windows 스케줄러 구성을 바꾸는 시스템 레벨 변경이라 범위를 넘는다고
판단해 결정만 남겨 둔다.

## 27. 재부팅 자동복구 영구화 — Task Scheduler 실제 조사 + Boot 이중
트리거 + 즉시 상태 기록 (T1-205, 2026-09-01)

**목적**: T1-204(§26)가 미룬 `decisionNeeded`—`ACOS-Recovery-Manager`가
재부팅 직후 왜 `SCHED_S_TASK_TERMINATED`(267014)로 죽는가—를 실제
Task Scheduler 설정·OS 로그로 조사하고, 실제 재부팅 없이 검증 가능한
범위에서 구조적으로 강화했다.

### 27-1. 실측 — Task Scheduler 실제 설정 (요청 1)

`Get-ScheduledTask -TaskName "ACOS-Recovery-Manager"`로 직접 확인:

| 항목 | 값 |
| --- | --- |
| Action | `powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "...\scripts\acos-recovery-manager.ps1"` |
| WorkingDirectory(수정 전) | **비어 있음** — `ACOS-Bridge`·`ACOS-CTO-Worker`·`ACOS-Git-Task-Sync` 전부 동일하게 비어 있었다(이 프로젝트의 스케줄러 등록 관례). 스크립트가 전부 절대경로/`$PSScriptRoot` 기준이라 이것만으로 실패를 설명하지는 못하지만, 후보를 하나 줄이기 위해 이번에 채웠다(27-4) |
| Trigger(수정 전) | Logon 트리거 1개, `Delay: PT45S`, `UserId: DESKTOP-9GSJD99\최덕임` |
| Principal | `RunLevel: Limited`, `LogonType: S4U` |
| Settings | `MultipleInstances: IgnoreNew`, `ExecutionTimeLimit: PT30M`, `RestartCount: 2`, `RestartInterval: PT2M` |
| `LastTaskResult` | **267014** (`SCHED_S_TASK_TERMINATED`) — 스크립트가 예외를 던진 게 아니라 **Task Scheduler 자신이 실행 중인 프로세스를 강제 종료했다**는 뜻(에러가 아니라 "성공" facility의 종료 코드) |

### 27-2. 실측 — `SCHED_S_TASK_TERMINATED` 원인 특정 시도 (요청 2, 추측 배제)

**확인된 사실**:

1. `Microsoft-Windows-TaskScheduler/Operational` 이벤트 로그(스케줄러
   자신의 내부 종료 사유가 남는 곳)가 **사고 당시 비활성 상태**였다
   (`Get-WinEvent -ListLog ... | IsEnabled` → `False`). 즉 정확한
   OS 레벨 사유는 애초에 기록되지 않았다 — 이번 조사로 사후에
   재구성할 방법이 없었다.
2. `System` 이벤트 로그로 2026-08-31 09:06~09:11 타임라인을 재구성:
   09:07:44 종료 시작 → 09:08:11 `Kernel-General(12)` "운영 체제가
   시작되었습니다"(`LastBootUpTime`과 일치) → 09:08:18
   `Winlogon(7001)` "사용자 로그온 알림"(최덕임 단일 로그온, 중복
   로그온 이벤트 없음) → 이후 재시작·재로그오프 이벤트 없음(09:11까지
   확인). 즉 **다른 재부팅이나 명시적 로그오프가 끼어든 것이
   아니다.**
3. `Get-ScheduledTaskInfo`로 같은 순간 다른 ACOS 스케줄러의 결과를
   대조: **`ACOS-Bridge`(Boot 트리거, 09:08:08)는
   `LastTaskResult=0`으로 성공했다.** `ACOS-CTO-Worker`(Boot 트리거,
   같은 시각)는 `2147946720`(0x800710E0)으로 실패했지만, 이는
   `SCHED_S_TASK_TERMINATED`가 **아닌 다른 코드**다 — M-60이 이미
   문서화한 스크립트 자체의 예외(`bridge/start-cto-worker.ps1`의
   `Start-Process` 호출, `bridge/`라 이번에 손대지 않음)로 보인다.
   **Logon 트리거 + S4U를 쓴 것은 `ACOS-Recovery-Manager`뿐이었고,
   `SCHED_S_TASK_TERMINATED`로 죽은 것도 그것뿐이었다.**
4. `D:\dev-data\logs\recovery-manager\history.log`를 그 runId로
   거르면 `PostgreSQL(5432) SKIP` 항목까지만 있고 그 다음
   (`MinIO(9000)` 판정) 로그가 없다 — 즉 MinIO 단계 진입 직후,
   구버전 스크립트가 `& powershell -File scripts\start-minio.ps1`로
   **동기 블로킹 대기**하던 바로 그 구간에서 죽었다는 뜻이다(구버전
   구조는 27-4 참고).

**결론(추측과 확정을 구분)**: `SCHED_S_TASK_TERMINATED`가 스크립트
버그가 아니라 **OS/스케줄러가 부과한 강제 종료**라는 것은 위 근거로
**확정**이다. 하지만 그 강제 종료의 정확한 트리거(예: S4U 로그온
세션이 로그온 알림 시점과 실제 인터랙티브 세션 확립 사이에서 끊기는
Windows 내부 동작)는 Operational 로그가 꺼져 있었던 탓에 **미확인**
으로 남긴다 — 27-3에서 로그를 켰으니 다음 재부팅부터는 직접 근거를
얻을 수 있다.

### 27-3. Operational 로그 활성화 (다음 재부팅부터 직접 증거 확보)

```powershell
wevtutil sl "Microsoft-Windows-TaskScheduler/Operational" /e:true
```

실행해 `IsEnabled: True`로 확인했다. 다른 스케줄러 작업에는 영향이
없는 Windows 진단 로그 옵션 하나를 켠 것뿐이다. **다음 재부팅 후**
`Get-WinEvent -LogName 'Microsoft-Windows-TaskScheduler/Operational'`
에서 `ACOS-Recovery-Manager`가 실제로 언제·왜 종료됐는지(성공했다면
그 사실도) 직접 확인할 수 있다.

### 27-4. `scripts\acos-recovery-manager.ps1` 재작성 — 요청 3·4·6·7

**핵심 문제(요청 3)**: 구버전은 MinIO·Bridge·로컬 API/Web 세 단계를
`& powershell -File <하위스크립트>`로 **동기 호출**했다 — 이 스크립트
자신이 하위 스크립트가 끝날 때까지(최대 수십 초~수 분) 블로킹된다.
27-2-4가 보여주듯, 바로 이 블로킹 구간에서 죽으면 그 뒤 단계는
시도조차 되지 못한다. 또한 구버전은 `latest.json`을 **시작 시점과
종료 시점 딱 2번만** 썼다(요청 7 위반) — 그래서 2026-08-31 사고
당시 실제로는 PostgreSQL 단계까지 진행했는데도 파일에는
`verdict: "IN_PROGRESS"`, `steps: []`(시작 시점 초기값 그대로)만
남아 "아무것도 못 했다"처럼 보였다.

**바꾼 것**:

1. **매 단계 직후 상태 파일 즉시 갱신(요청 7)** — `Add-Step` 함수가
   `history.log`에 쓴 직후 `Write-Status -Verdict "IN_PROGRESS"`도
   호출한다. 유한 polling(`Wait-Port`/`Wait-Http`) 도중에도 매
   간격마다 갱신한다. **실측 검증**: 3100/4100을 내린 뒤 새
   스크립트를 백그라운드로 띄우고 4초 뒤
   `Stop-Process -Force`로 강제 종료했더니, `latest.json`에
   **7단계**(D:드라이브 OK·C:여유공간 WARN·D:여유공간 OK·
   PostgreSQL SKIP·MinIO SKIP·Bridge SKIP·CTO Worker SKIP)가
   정확히 남았다 — 구버전이라면 `steps: []`로 남았을 상황이다.
2. **분리 기동 + 유한 polling(요청 3·4·6)** — MinIO·Bridge·로컬
   API/Web 세 단계 모두 `Start-DetachedScript`(신규 헬퍼,
   `Start-Process`로 launcher를 분리하고 PID·stdout/stderr 로그
   경로를 기록)로 바꾸고, 이 스크립트가 직접
   `Wait-Port`/`Wait-Http`(유한 시간 + 고정 간격 재확인, 무한 대기
   없음)로 준비 상태를 확인한다. PostgreSQL 단계도 고정 2초 대기
   1회 대신 최대 20초 polling으로 바꿨다 — 재부팅 직후 서비스가
   조금 늦게 응답해도 불필요하게 FAIL 처리하지 않는다. 각 launcher의
   PID·로그 경로는 해당 단계의 `Add-Step` 상세 문구에 남는다(요청
   4의 "PID/log를 기록한다").
   - 하위 스크립트(`start-minio.ps1`·`bridge\start-bridge.ps1`·
     `start-verify-studio.ps1`) **내용 자체는 이번에도 고치지
     않았다** — 세 스크립트 모두 이미 실제 서버 프로세스(minio.exe·
     cloudflared·node dist/main.js·node next start)를 자체적으로
     `Start-Process`로 분리 기동하고 있음을 코드로 확인했다
     (`bridge/`는 애초에 수정 금지 대상).
3. **최상위 `try/catch`(요청 7)** — 0~7단계 전체를 감싸, 예상 못한
   예외가 나도 `FAIL` 단계를 남기고 반드시 최종 `Write-Status`에
   도달한다. 이전 버전은 최상위 예외 처리가 없어 처리되지 않은
   예외가 나면 마지막 판정 자체를 못 남길 위험이 있었다.
4. **로그인 트리거 실패 안전망 이중화(요청 3 연장)** —
   `ACOS-Recovery-Manager`에 기존 Logon 트리거(45초 지연)를 그대로
   두고 **Boot 트리거(60초 지연)를 추가**했다. 27-2-3이 보여주듯
   같은 순간 Boot 트리거의 `ACOS-Bridge`는 성공했다 — 이미 증명된
   성공 경로를 그대로 이중화한 것이다. `MultipleInstances:
   IgnoreNew`가 이미 설정돼 있어 두 트리거가 겹쳐 발동해도 두 번
   실행되지 않는다. Action의 `WorkingDirectory`도 저장소 경로로
   채웠다(27-1).

**바꾸지 않은 것(요청 5 — 이미 만족돼 있음을 확인만 했다)**:
로컬 API/Web 단계는 이미 `studio:start`(사람용)와 같은 idempotent
경로에 의존한다 — 이 스크립트가 먼저 4100/health·3100/login을
직접 확인해 이미 정상이면 아예 호출하지 않고, 호출하더라도
`start-verify-studio.ps1` 자신이 같은 커밋 + 이미 응답 중이면
재빌드 없이 즉시 반환하는 단축 경로(T1-201/T1-203)를 갖고 있다 —
두 스크립트가 동시에 3100/4100을 중복 기동할 구조적 여지가 없다.

### 27-5. 재부팅 시뮬레이션 실측 (요청 9, 실제 reboot는 하지 않음)

```
1. scripts\studio-stop.ps1 실행 → 3100/4100 실제로 내려간 것을
   Get-NetTCPConnection으로 확인
2. Task Scheduler Action과 정확히 같은 명령을 수동 실행:
   powershell -ExecutionPolicy Bypass -WindowStyle Hidden
     -File scripts\acos-recovery-manager.ps1
3. 결과: PostgreSQL/MinIO/Bridge/CTO Worker는 이미 살아있어 전부
   SKIP, 로컬 API/Web만 감지해 start-verify-studio.ps1을 분리
   기동 → Wait-Http로 준비 확인 → OK. 전체 66.8초, 최종 판정
   PARTIAL(FAIL 0건, WARN 1건 — C: 여유공간 3.54GB, 이 세션이
   새로 만든 문제가 아니라 §16 이후 반복된 기존 상태). exit code 0.
4. 3100/4100 실제로 다시 응답하는 것을 포트/HTTP 양쪽으로 재확인.
```

**이 시뮬레이션이 증명하지 못하는 것**: Task Scheduler가 실제로
이 명령을 실행할 때 부여하는 Job Object·S4U 로그온 세션 컨텍스트는
수동 실행과 다르다 — 27-2가 특정한 진짜 죽는 조건(Logon 트리거+
S4U) 자체는 재현하지 못했다. 그래서 27-3(Operational 로그)·
27-4-4(Boot 이중화)가 다음 실제 재부팅에서 실제로 통하는지는 여전히
**미확인**이다.

### 27-6. Chromium 실측 (요청 10)

`node scripts\t1203-verify-level2-chromium.mjs` — 대상 URL
(`/level2-generate/cmt6jnzbr0001ul2gim2mwznv`)과 T1-196 URL 둘 다
desktop(1280)·mobile(390) 전부 `httpStatus: 200`·`consoleErrors: []`·
`pageErrors: []`·`brokenImgs: 0`(이미지 7장/페이지) — 27-5의
재기동 직후 실행해 확인했다.

### 27-7. 재부팅 후 사람이 확인할 것 (§22-6·§26 체크리스트에 추가)

```
1. 재부팅 후 몇 분 기다린 뒤 VS Code로 이 워크트리를 연다
2. "ACOS 자동복구 상태 보기" 터미널 패널의 판정을 본다
   (SUCCESS/PARTIAL/FAILED)
3. PowerShell로 다음을 확인한다(이번에 새로 켠 로그, 27-3):
   Get-WinEvent -LogName 'Microsoft-Windows-TaskScheduler/Operational' |
     Where-Object { $_.Message -match 'ACOS-Recovery-Manager' } |
     Select-Object -First 20 TimeCreated,Id,Message
   Get-ScheduledTaskInfo -TaskName "ACOS-Recovery-Manager" |
     Format-List LastRunTime,LastTaskResult
   → LastTaskResult가 0이면 이번 이중 트리거 조치가 통한 것이다.
     여전히 267014면 Operational 로그의 실제 종료 사유를 다음
     조사에 남긴다.
4. http://localhost:3100/image-studio 또는 대상 URL이 실제로
   뜨는지 브라우저로 직접 연다.
```

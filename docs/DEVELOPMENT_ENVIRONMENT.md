# 개발환경 (SSOT)

> **이 문서가 개발환경에 대한 유일한 기준(Single Source of Truth)이다.**
>
> - 작업을 시작하기 전에 **반드시 이 문서를 먼저 읽는다.**
> - 환경이 바뀌면 **이 문서를 먼저 고치고, 그 다음 코드를 고친다.**
> - **환경을 추측하지 않는다.** 확인한 사실만 사용한다.
> - 확인하지 못한 것은 **"미확인"** 으로 적는다. 빈칸으로 두거나 짐작해서 채우지 않는다.
>
> 최종 확인: **2026-08-08** (Sprint 1 세션)
> 브랜치 `agents/claude-chatbot-integration` · 커밋 `f13f230`

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

### 1.2 원격(EC2) 환경

| 구성 | 상태 |
| --- | --- |
| 호스트 | `ec2-3-39-9-111.ap-northeast-2.compute.amazonaws.com` (AWS 서울) |
| 접속 | `ssh -i C:\Users\82104\Downloads\detail-key.pem ec2-user@…` |
| EC2 Web | EC2 안에서 3000 포트로 동작 |
| EC2 API | EC2 안에서 4000 포트로 동작 |
| EC2 Database | **미확인** — `DATABASE_URL`을 직접 읽지 못함 (§4 참고) |

### 1.3 두 환경의 차이

| | 로컬 | 원격(EC2) |
| --- | --- | --- |
| 실행 코드 | 이 워크트리의 코드 | **미확인** (어느 커밋인지 확인 못 함) |
| 데이터베이스 | `localhost:5432/acos` | 로컬과 **다른 DB** (근거 §4-6) |
| Benchmark Project | **있음** | **없음** |
| 이번 스프린트 수정 반영 | **반영됨** | **반영 안 됨** — 배포하지 않았음 |

> **가장 중요한 차이**: 브라우저에서 3000번을 열면 **원격 데이터**를 본다.
> 로컬에서 만든 데이터는 거기에 없다.

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
| **9000** | `minio` (PID 22688) | **MinIO 오브젝트 저장소** | — | 버킷 `acos`. 이미지 원본·생성물 저장 |
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

### 실행 순서 (2026-08-08 실측)

```
1. 로컬 인프라 확인      PostgreSQL 5432 · MinIO 9000
2. Local API 실행        PORT=4100 node apps/api/dist/main.js
3. 로그인                admin@acos.local / admin1234
4. Product Profile 생성  POST /product-profile   ← 과금
5. 이미지 후보 생성      POST /image-gen/candidates   ← 과금
6. Local Web 실행        NEXT_PUBLIC_API_URL=http://localhost:4100, 포트 3100
7. 브라우저 확인         §8 체크리스트
8. 정리                  3100/4100 종료 → pnpm --filter web dev 로 원상 복구
```

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
| **`bridge/` 아래 전부가 git에 커밋된 적이 없다** | `git ls-files bridge/` → 빈 결과, `git status bridge/` → `?? bridge/` | 2026-08-09 |

마지막 항목은 새 PC·디스크 교체 시 Bridge의 작업 이력이 통째로 사라질
수 있다는 뜻이다. 고칠지(git에 포함)는 `bridge/`를 건드리는 결정이라
**사람이 정해야 한다** — 자세한 것은 `RECOVERY_GUIDE.md` §9-6.

# RECOVERY GUIDE — 프로젝트 복원 안내

> **가장 먼저 읽는 문서입니다.**
>
> 새 PC · 새 세션 · 새 Claude · 새 개발자 — 누구든 이 문서 하나로
> 프로젝트를 복원하고 작업을 이어갈 수 있어야 합니다.
>
> **여기 적힌 순서를 지키십시오.** 순서를 건너뛰면 환경을 추측하게 되고,
> 추측은 이 프로젝트에서 가장 큰 사고 원인이었습니다.

**마지막 업데이트: 2026-08-11** (T1-56 재실행 — C: 여유공간이
9.15GB→2.21GB로 다시 위험 수준 재발, `ACOS-Bridge` 재부팅 복구
스케줄러의 **실제 트리거·실패가 처음으로 실측됨**, 저장소 밖 백업
갱신 — `docs/PROJECT_STATE.md` §3-23)

> **2026-08-13 추가(T1-105)**: 위 `ACOS-Bridge` 실패의 **근본 원인을
> 확정하고 고쳤다** — 환경변수 해석 문제가 아니라, cloudflared를
> 띄우는 `Start-Process` 호출이 stdout/stderr을 같은 파일로
> 리다이렉트해서 그 자리에서 예외를 던지고 있었다(`bridge/
> start-bridge.ps1` 수정 완료). **다만 실제 재부팅으로 끝까지
> 검증되지는 않았다** — 다음 재부팅 후에는 여전히 사람이
> `http://localhost:4201`과 `https://bridge.magicclean79.com/health`을
> 직접 확인해야 한다. 상세는 `docs/DEVELOPMENT_ENVIRONMENT.md` §20,
> 교훈은 `docs/PROJECT_MEMORY.md` M-56.

> **2026-08-13 추가(T1-109)**: 재부팅 후 개발환경 자체를 되살리는
> **단일 진입점**을 만들었다 — 새 스케줄러 `ACOS-Recovery-Manager`
> (`scripts\acos-recovery-manager.ps1`)가 `ACOS-Bridge`·
> `ACOS-CTO-Worker`(그대로 유지)와 함께 PostgreSQL·MinIO·Bridge·
> CTO Worker·로컬 API/Web을 의존성 순서대로 확인하고, **죽어 있을
> 때만** 되살린다. 이미 정상인 것은 절대 재시작하지 않는다(Bridge
> 자기 자신을 죽이는 사고를 구조적으로 막기 위함). 재부팅 후 VS
> Code로 이 폴더를 열면 "ACOS 자동복구 상태 보기" 터미널 패널이
> 자동으로 최근 복구 결과(SUCCESS/PARTIAL/FAILED)를 보여준다.
> **다만 이번 세션은 실제 재부팅을 하지 않았다** — "이미 다 켜져
> 있는" 상태에서의 안전성(2회 연속 실행, PID 불변)만 검증했고,
> 콜드 스타트 자체는 다음 실제 재부팅에서 처음 확인된다. 상세는
> `docs/DEVELOPMENT_ENVIRONMENT.md` §22, 아래 §11-6, 교훈은
> `docs/PROJECT_MEMORY.md` M-60.

> **2026-08-13 추가(T1-107)**: "재부팅·VS Code 재실행·Claude Code
> 프로세스 재시작 후 어떻게 이어가는가"를 다루는 **새 §11**을
> 추가했다. `node scripts/bootstrap-context.mjs`(읽기 전용, 신규)가
> 현재 프로젝트 상태·Bridge health·taskId 실행 상태(RESUME
> CANDIDATE 포함)·최근 Task 결과·git 상태·장기기억 문서·작업 로그를
> 정해진 순서로 한 번에 요약한다. **Claude Code의 "대화" 자체는
> 자동 복구되지 않는다** — Bridge가 헤드리스 호출에 세션 ID를 넘기지
> 않아 taskId와 대화 transcript가 연결돼 있지 않다(실측, §11-2,
> `docs/PROJECT_MEMORY.md` M-57). 파일 기반 상태(Task 지시·실행
> 상태·변경 파일·테스트 결과)만 신뢰할 수 있는 복구 대상이다.

> **재부팅 직전이라면**: `docs/PROJECT_STATE.md` §3-12(T1-56)·§3-13
> (T1-58)·§3-14(T1-59)·§3-15(T1-61)·**§3-23(T1-56 재실행, 최신)**의
> "재부팅 전 체크리스트"를 먼저 본다 — GitHub 푸시 여부·미커밋
> 변경·C: 여유공간·자동 복구 스케줄러를 실측 증거로 PASS/FAIL 판정해
> 두었다. **C: 여유공간은 T1-57이 한 번 해소했다가(0.71→9.15GB)
> 2026-08-11 재확인 시점 다시 2.21GB로 떨어졌다** — 한 번 고쳐도
> 재발하는 문제이니 재부팅 전에 반드시 다시 실측한다(`Get-PSDrive C`).
> **`ACOS-Bridge`(Bridge 서버·현황판 재부팅 자동 복구) 스케줄러는
> 2026-08-11 10:09에 실제로 한 번 트리거됐고 종료 코드 1(실패)로
> 끝났다** — 재부팅 자체는 아니었지만(그 시각 이후로도 재부팅
> 없음, `LastBootUpTime` 2026-08-10 14:05) 이 스케줄러가 항상
> 성공한다는 보장이 없다는 첫 실측 증거다. **재부팅 후에는 반드시
> 사람이 `http://localhost:4201`이 실제로 뜨는지 직접 확인**하고,
> 안 뜨면 `bridge\start-bridge.ps1`을 사람이 직접(터미널에서) 다시
> 실행한다.
>
> **현재 브랜치(`agents/claude-chatbot-integration`)는 여전히
> GitHub에 푸시되지 않았다**(2026-08-11 재확인, 로컬 전용 커밋
> 2개 `35b1ea5`·`0df5dae`는 변화 없음) — T1-59가 실측 확인한 바, 이
> 세션 환경에서는 GitHub 인증 자체가 안 되어(캐시된 자격 증명 없음,
> 비대화형이라 로그인 불가) push가 기술적으로 불가능했다. 대신
> **T1-59가 로컬 전용 커밋 2개·미커밋 변경 전부를 저장소 바깥
> (`C:\Users\82104\Documents\ACOS-git-backup-T1-59\`)에 검증된
> git bundle + patch + 파일 복사로 백업**했다(복원 테스트까지
> 완료). **2026-08-11에 그 백업이 다시 최신화됐다**
> (`C:\Users\82104\Documents\ACOS-git-backup-2026-08-11\`, 커밋
> 이력은 그대로이고 그 사이 늘어난 미커밋 작업 트리 187건과, 처음
> 발견된 `.gitignore` 제외 `.vscode/tasks.json`까지 함께 보존) —
> 기존 T1-59 백업은 지우지 않고 그대로 남겨 두었다. **단, 두 백업
> 모두 같은 C: 드라이브 안에 있어 디스크 자체가 손상되는 시나리오는
> 막지 못한다** — 그건 별도 물리 매체가 필요한 문제(T1-36은
> 2026-08-11 사람이 직접 종료 지시해 SUPERSEDED됨, 대신 T1-74가
> D: 드라이브로 일부 데이터를 이전했다)다. 정식 원격 백업을 원하면
> 대화형 환경에서 사람이
> `git push -u origin agents/claude-chatbot-integration`을 한 번
> 실행해야 한다(`PROJECT_STATE.md` §3-14·§3-23 참고).

---

## 0. 지금 당장 무엇을 해야 하는가

사용자가 **"어디까지 했지?"** · **"이어서 작업하자"** · **"현재 상태
알려줘"** 라고 하면 — **아래 7개 문서를 순서대로 읽고**, §5의 형식으로
보고한 **다음에만** 작업을 시작합니다.

```
① docs/RECOVERY_GUIDE.md          ← 이 문서. 복원 순서
② docs/MASTER_GUIDE.md            ← 운영 헌법. 왜 이렇게 하는가
③ AGENTS.md                        ← Claude의 행동 규칙
④ docs/DEVELOPMENT_ENVIRONMENT.md  ← 환경 사실 (SSOT)
⑤ docs/PROJECT_STATE.md            ← 지금 어디까지 했는가
⑥ TASKS.md                         ← 현재 Sprint 작업 목록
⑦ docs/PROJECT_MEMORY.md           ← 겪어서 알게 된 것
```

**읽기 전에 코드를 건드리지 않습니다.**

그다음 **CTO Bridge에서 현재 작업 상태를 확인합니다.**

```bash
node bridge/bridge-cli.mjs status
```

어떤 작업이 어느 단계인지, 무엇이 사람 확인 대기 중인지 한 번에 나옵니다.
자세한 것은 [`bridge/README.md`](../bridge/README.md).

---

## 1. 이 프로젝트가 무엇인지 한 줄로

**AI Product Content OS** — 쇼핑몰 운영자가 상품 사진 몇 장만 올리면
판매용 상세페이지가 만들어지는 시스템.

자세한 것은 `docs/MASTER_GUIDE.md` §1.

---

## 2. 문서 지도 — 무엇이 어디에 있는가

| 문서 | 역할 | 언제 고치는가 |
| --- | --- | --- |
| `docs/RECOVERY_GUIDE.md` | 복원 순서 (이 문서) | 복원 절차가 바뀔 때 |
| `docs/MASTER_GUIDE.md` | **운영 헌법** — 철학·가치·AI 역할 | 거의 안 고침. 원칙이 바뀔 때만 |
| `AGENTS.md` | Claude 행동 규칙 + **ACOS 운영 구조 부트스트랩**(§0, T1-103) | 작업 규칙이 바뀔 때 |
| `docs/DEVELOPMENT_ENVIRONMENT.md` | **환경 SSOT** — 포트·DB·SSH·실행법·C/D 저장정책(§0 요약) | **환경이 바뀌면 가장 먼저** |
| `docs/PROJECT_STATE.md` | 현재 상태·진행률·다음 작업 | **세션 종료 시 반드시** |
| `TASKS.md` | 현재 Sprint 작업 목록 | 작업이 끝나거나 추가될 때 |
| `docs/PROJECT_MEMORY.md` | 경험·노하우·모르는 것 | **새 경험을 얻을 때마다** |
| `bridge/README.md` | **Bridge(실행 인프라) 계층·API·상태 전이·인증** | Bridge 동작이 바뀔 때 (사람 승인 필요) |
| `bridge/STATUS.md` | Bridge의 실시간 상태 (자동 생성) | **손으로 고치지 않는다** |

**우선순위**: MASTER_GUIDE > AGENTS > DEVELOPMENT_ENVIRONMENT > 나머지.
문서끼리 어긋나면 위쪽이 맞습니다. 다만 **"지금 이 순간 무슨 일이
일어나고 있는가"는 문서가 아니라 실제 코드·Bridge 상태가 기준**입니다
— Source of Truth 우선순위는 `AGENTS.md` §0.

---

## 3. 새 PC에서 처음부터 복원하기

### 3-1. 코드 받기

```
GitHub에서 저장소를 clone 한다
브랜치를 확인한다 — 현재 작업 브랜치는 PROJECT_STATE.md §11에 있다
pnpm install
```

### 3-2. 필요한 프로그램

| | 용도 | 비고 |
| --- | --- | --- |
| Node.js | 실행 | 24.x 확인됨 |
| pnpm | 패키지 관리 | |
| PostgreSQL | 로컬 DB | 포트 5432, DB 이름 `acos` |
| MinIO | 이미지 저장소 | 포트 9000, 버킷 `acos` |
| (선택) Redis | 분산 잠금 | **없어도 동작함** |

### 3-3. 환경 변수

`apps/api/.env` 가 필요합니다. **이 파일은 git에 올라가지 않습니다.**

필요한 값 (자세한 것은 `docs/DEVELOPMENT_ENVIRONMENT.md`):

```
DATABASE_URL           로컬 PostgreSQL 주소
S3_ENDPOINT / KEY      MinIO 접속 정보
S3_BUCKET              acos
OPENAI_API_KEY         GPT — 제품 분석
GEMINI_API_KEY         Gemini — 이미지 생성
GOOGLE_VISION_API_KEY  OCR
LLM_PROVIDER=openai
OCR_PROVIDER=google-vision
```

**키가 없으면 새로 발급받아야 합니다. 채팅에 붙여넣지 마십시오.**

### 3-4. 데이터베이스 준비

```
pnpm --filter api exec prisma migrate deploy
```

**반드시 확인**: `prisma migrate status` 가 "up to date" 여야 합니다.
밀려 있으면 엉뚱한 오류가 납니다 (`PROJECT_MEMORY.md` M-16).

### 3-5. 디스크 여유 확인

**최소 5GB 이상** 확보합니다. 부족하면 MinIO가 저장을 거부합니다
(`PROJECT_MEMORY.md` M-15).

### 3-6. Benchmark Dataset 복원

로컬 DB가 비어 있으면 Benchmark가 없습니다. **없으면 만들어야 합니다.**

```
1. Benchmark Project 생성
2. 베란다 호스 사진 7장 업로드
3. 7장 전부 OCR 실행          ← 반드시. 건너뛰면 제품 정보가 추측이 됨
4. Product Profile 생성
5. 새로 생긴 ID를 PROJECT_STATE.md §9 에 기록
```

**새 제품으로 대체하지 않습니다.** Benchmark는 베란다 호스로 고정입니다
(`docs/MASTER_GUIDE.md` §6).

---

## 4. 개발 환경 띄우기

### 4-1. 원격이 있는 경우 (현재 구성)

| 포트 | 정체 | 주의 |
| --- | --- | --- |
| 3000 | **SSH 터널 → EC2 Web** | **종료 금지** |
| 4000 | **SSH 터널 → EC2 API** | **종료 금지** |
| 5432 | 로컬 PostgreSQL | |
| 9000 | 로컬 MinIO | |

**포트가 로컬인지 터널인지 반드시 확인합니다** — 점유 프로세스 이름을
봅니다. `ssh.exe`면 터널입니다 (`PROJECT_MEMORY.md` M-11).

### 4-2. 로컬 검증용으로 띄우기

원격과 **다른 포트**를 씁니다. 3000·4000을 빼앗지 않습니다.

```
로컬 API   : PORT=4100 WEB_URL=http://localhost:3100 으로 실행
로컬 Web   : 포트 3100, NEXT_PUBLIC_API_URL 을 로컬 API(4100)로 지정
```

**`WEB_URL`을 빼먹지 않습니다** — `apps/api/.env`의 기본값
(`http://localhost:3000`) 그대로 로컬 API를 띄우면, 데이터가 있어도
브라우저(3100)에서 CORS로 막혀 "사진이 없다"처럼 보입니다. `curl`은
CORS를 검사하지 않아 이 문제를 재현하지 못합니다 — 반드시
`curl -H "Origin: http://localhost:3100"`으로 응답 헤더를 직접
비교합니다(`PROJECT_MEMORY.md` M-39, 2026-08-09 T1-62 실측).

**주의**: Next.js는 같은 폴더에서 개발 서버 2개를 거부합니다. 3100을
띄우려면 3000번 **로컬 Next.js를 잠시 멈춰야** 합니다. **SSH 터널은 그대로
둡니다** (`PROJECT_MEMORY.md` M-13).

**빌드 전에는 로컬 API를 내립니다** — 켜져 있으면 빌드가 실패합니다
(`PROJECT_MEMORY.md` M-14).

### 4-3. 끝나면 원래대로

확인이 끝나면 **반드시 복구**합니다.

```
3100·4100 종료
원래 개발 서버 재시작
임시로 바꾼 파일 복구 (예: benchmark/constants.ts)
```

---

## 5. "어디까지 했지?" 에 답하는 형식

7개 문서를 읽은 뒤 **아래 10개 항목**으로 보고합니다. 그 다음에만 작업을
시작합니다.

```
1.  현재 Sprint
2.  전체 진행률
3.  오늘까지 완료된 작업
4.  현재 진행 중인 작업
5.  남은 작업
6.  다음에 해야 할 작업
7.  현재 개발환경
8.  주의해야 할 사항
9.  최근 결정한 내용
10. PROJECT_MEMORY에서 반드시 기억해야 할 사항
```

출처: 1~6·9는 `PROJECT_STATE.md`, 7은 `DEVELOPMENT_ENVIRONMENT.md`,
8은 `PROJECT_STATE.md` §7 + `AGENTS.md`, 10은 `PROJECT_MEMORY.md`.

---

## 6. 절대 하지 말아야 하는 것

| | 금지 | 이유 |
| --- | --- | --- |
| 1 | **SSH 터널 종료** | 원격 환경이 끊깁니다 |
| 2 | **원격 EC2·원격 DB 수정** | 검증 안 된 코드가 원격에 반영됩니다 |
| 3 | **Benchmark 삭제·초기화·교체** | 비교 기준을 잃습니다 |
| 4 | **`benchmark/constants.ts` 무단 수정** | 회귀 테스트의 기준점입니다 |
| 5 | **환경 추측** | 가장 큰 사고 원인이었습니다 |
| 6 | **이미지 품질을 Claude가 판단** | AI가 만든 것을 AI가 검사하면 검증이 아닙니다 |
| 7 | **승인 없이 돈 나가는 호출** | GPT·Gemini·Vision은 실제 과금입니다 |
| 8 | **Sprint 건너뛰기** | 어느 층이 문제인지 못 찾게 됩니다 |

---

## 7. 세션을 끝내기 전에

**반드시 두 문서를 갱신합니다.**

### `docs/PROJECT_STATE.md`

- 오늘 무엇을 했는지
- 지금 무엇을 하고 있는지
- 다음에 무엇을 해야 하는지
- 남은 이슈와 **임시 상태**(반드시!)
- 마지막 업데이트 날짜

### `docs/PROJECT_MEMORY.md`

- 새로 알게 된 것
- 왜 그렇게 결정했는지
- 실패에서 배운 것
- 아직 모르는 것 (미확인 항목)

**갱신하지 않으면 다음 세션이 처음부터 다시 헤맵니다.** 이 두 문서가
프로젝트의 기억입니다.

---

## 8. 자주 겪는 문제

| 증상 | 먼저 볼 것 |
| --- | --- |
| 사진 업로드가 "DB 연결 실패"로 실패 | `prisma migrate status` (M-16) |
| 사진 업로드가 저장소 오류로 실패 | 디스크 여유 (M-15) |
| 빌드가 `EPERM` 으로 실패 | 로컬 API가 떠 있는지 (M-14) |
| 로컬 웹이 "Another next dev server" | 3000번 Next.js를 멈춰야 함 (M-13) |
| 화면에 사진이 "불러오기 실패" | `benchmark/constants.ts` ID가 로컬에 없음 (M-19) |
| 생성 이미지가 다른 제품 | Product Package부터 확인 (M-1, M-2) |
| 제품 정보가 전부 추측값 | OCR을 실행했는지 (M-2) |

---

## 9. 하드웨어 변경 대응 — PC 교체 · 드라이브 문자 변경 · 추가 SSD

**T1-30 (2026-08-09)** — 저장공간 부족으로 PC를 바꾸거나 내장 SSD를
추가할 가능성에 대비해 정리한 절차입니다. 아래는 **실제로 PC를 바꾸지
않고** 로컬에서 확인 가능한 범위(git 재현성 · 마이그레이션 재현성 · 경로
독립성)만 실측했습니다 — 실제 새 PC 검증은 하지 않았습니다.

### 9-1. 원칙 — 무엇이 "코드/저장소"이고 무엇이 "이 PC의 상태"인가

이 프로젝트가 새 PC·새 드라이브에서 재사용되려면 두 가지를 구분해야
합니다.

| | 무엇 | 어떻게 옮기는가 |
| --- | --- | --- |
| **저장소(코드)** | 이 git 저장소 전체 | `git clone` — 드라이브 문자·경로와 무관 |
| **이 PC의 상태** | DB 데이터 · MinIO 파일 · `.env` · Bridge 시크릿·터널 주소 · pnpm 캐시 | git에 없음. **PC마다 새로 만들어야 함** |

**실측(2026-08-09)**: 앱 코드(`apps/`·`packages/`) 전체를 검색해
`C:\Users\82104\...` 같은 이 PC 전용 절대경로가 **없음을 확인**했습니다
(`grep -r "C:\\\\Users\\\\82104"`). 유일하게 나온 곳은
`bridge/projects/*/project.json`의 `repoPath` 필드(등록 정보, 아래
9-3 참고)뿐입니다. **즉 앱 코드 자체는 이미 드라이브 문자와 무관하게
동작하도록 되어 있습니다** — 이번에 새로 고칠 필요가 없었습니다.

### 9-2. 새 PC 온보딩 — 이미 있는 절차(§3)에 빠진 것만 추가

§3의 순서(코드 받기 → 프로그램 설치 → 환경 변수 → DB → 디스크 → Benchmark)는
**여전히 맞습니다.** 그 순서에 없던, 이번에 확인한 추가 항목:

| # | 항목 | 확인한 사실 |
| --- | --- | --- |
| 1 | `.env` 템플릿이 git에 있는가 | **있음** — `.env.example`(루트) · `apps/api/.env.example` · `config/validation.env.example` 전부 git 추적됨. 새 PC에서는 이 파일을 복사해 실제 값만 채우면 됩니다 |
| 2 | DB 스키마가 git만으로 재현되는가 | **재현됨** — 로컬에서 `pnpm --filter api exec prisma migrate status` 실행 결과 "65 migrations found … Database schema is up to date" (마이그레이션 파일 65개가 전부 git에 있고, 새 DB에 `prisma migrate deploy`만 돌리면 같은 스키마가 나옵니다) |
| 3 | 설치가 lockfile만으로 재현되는가 | **재현됨** — `pnpm-lock.yaml`·`pnpm-workspace.yaml` 둘 다 git 추적 확인. `pnpm install`이 이 파일 기준으로 정확히 같은 버전을 설치합니다 |
| 4 | Claude Code 실행 파일 | VS Code 확장 안에 있음(`bridge/README.md` §1-1). **VS Code + 해당 확장을 새 PC에도 설치**해야 합니다 — git 저장소에 포함되지 않습니다 |
| 5 | Bridge 시크릿·공개 주소 | `bridge/.secrets/bridge-token.txt`·`bridge/tunnel-url.txt`·`bridge/openapi.live.yaml`은 **의도적으로 git에서 제외**(`.gitignore`). 새 PC에서는 `bridge/start-bridge.ps1`이 토큰을 새로 만들고, 터널 주소는 항상 새로 발급됩니다(`bridge/README.md` §7 "임시 터널의 한계") — ChatGPT Actions에 새 주소를 다시 등록해야 합니다. **Bridge 코드·작업 이력 자체는 이제 git에 포함되어 clone만으로 따라옵니다**(§9-6). 사람이 손으로 만들어야 하는 것 전체 목록은 §9-7 |

### 9-3. Bridge 프로젝트 등록 — 저장소 경로가 바뀌면

`bridge/projects/<프로젝트ID>/project.json`에 저장된 `repoPath`는
**등록 당시의 절대경로**입니다(예: `demo-widget`은
`C:\Users\82104\Documents\GitHub\...`로 등록돼 있음, 실측 확인). 드라이브
문자가 바뀌거나 저장소를 다른 폴더로 옮기면 이 값은 더 이상 맞지
않습니다.

**기본 프로젝트(`acos`)는 이 문제가 없습니다** — `bridge-projects.mjs`를
읽어 확인한 바, 기본 프로젝트의 `repoPath`는 등록 파일이 아니라 **Bridge
스크립트 자신의 위치를 기준으로 실행 시점에 계산**됩니다(`REPO_ROOT`).
즉 저장소 전체를 다른 드라이브로 옮겨도 `acos` 프로젝트는 별도 조치 없이
새 위치를 그대로 따라갑니다.

**추가로 등록한 프로젝트**(예: `demo-widget`)는 저장소를 옮기면
**재등록해야** 합니다. Bridge README(§1-0)에 이미 있는 절차를 그대로
씁니다 — 새로 만들 필요가 없습니다.

```bash
node bridge/bridge-cli.mjs project register <등록JSON파일>   # 같은 projectId로 다시 등록하면 갱신됨
node bridge/bridge-cli.mjs project show <프로젝트ID>          # repoPath가 새 경로로 바뀌었는지 확인
```

**이번 세션은 이 명령을 실행하지 않았습니다** — `bridge/` 아래는 사람
승인 없이 고치지 않는 대상이고, 지금은 경로가 바뀐 상황도 아니기
때문입니다. 실제로 드라이브를 옮긴 뒤 재등록이 필요합니다.

### 9-4. 추가 SSD 장착 시 — 무엇을 옮길 가치가 있는가

**실측(2026-08-09)**: `Get-PSDrive`로 확인한 현재 디스크 상태.

| 드라이브 | 여유 | 비고 |
| --- | --- | --- |
| C: | **3.0GB** | `docs/PROJECT_STATE.md` §7에 기록된 디스크 부족 문제가 **아직 해소되지 않음**(재확인) |
| E: | 28.9GB (거의 비어 있음) | 추가 저장공간으로 쓸 수 있음 |

옮길 후보를 무게 순으로 확인했습니다.

| 후보 | 이 PC의 현재 위치 | 옮기는 방법 | 실행 여부 |
| --- | --- | --- | --- |
| **pnpm 전역 캐시** | `C:\Users\82104\AppData\Local\pnpm\store\v10`(실측 확인) | `pnpm config set store-dir <새 드라이브 경로>` (pnpm 표준 기능) | **✅ 실행함(T1-74, 2026-08-10)** — `D:\dev-data\pnpm-store`로 설정. 아래 참고 |
| PostgreSQL 데이터 디렉터리 | 0.08GB(T1-74 실측, 작음) | PostgreSQL 공식 절차(데이터 디렉터리 이동 후 서비스 재시작) | 실행하지 않음 — DB가 켜져 있는 상태에서 시도하면 손상 위험, 크기도 작아 실익이 적음 |
| **MinIO 데이터 디렉터리** | `C:\Users\82104\Documents\GitHub\-\.tmp\minio-data`(T1-74 실측, 858,026,375바이트) | MinIO 실행 시 지정하는 경로를 바꾸고 기존 파일을 옮김 | **✅ 실행함(T1-74, 2026-08-10)** — `D:\dev-data\minio-data`로 이동, 새 시작 스크립트 `scripts/start-minio.ps1` 추가. 상세: `docs/DEVELOPMENT_ENVIRONMENT.md` §15-2 |
| 이 저장소 자체(`git clone` 위치) | 이 워크트리 | 폴더 복사 또는 새 위치에 `git clone` | 실행하지 않음 |

**2026-08-10 갱신(T1-74)**: 실제로 추가 SSD(D:, 내장 고정 디스크,
`docs/PROJECT_MEMORY.md` M-41)가 장착된 것을 확인해 위 표의 pnpm·
MinIO 두 항목을 실행했다. **당시(2026-08-09) "실행하지 않은 이유"로
적었던 동시 세션 위험은 여전히 유효한 전제**이므로, 이번에도 실행
직전 `node bridge/bridge-cli.mjs status`로 다른 작업 상태를 확인하고
`Get-CimInstance Win32_Process`로 pnpm/turbo/next build류의 활성
프로세스가 없는 순간을 골라 진행했다. **기존 pnpm 저장소(0.79GB)는
옮기지 않고 C:에 남겨 뒀다** — 콘텐츠 주소 저장소가 하드링크로 이 PC의
여러 프로젝트 `node_modules`에 걸쳐 있어, 기존 데이터를 실제로
"옮기려면" 그 `node_modules`들을 전부 다시 설치해야 하는 범위가
된다(`docs/PROJECT_MEMORY.md` M-42). `store-dir` 설정 변경은
**앞으로 새로 받는 패키지**만 D:에 쌓이게 할 뿐이다.

**필요할 때 실행할 절차(기존 pnpm 저장소를 마저 정리하고 싶으면)**:

```
1. 진행 중인 pnpm install·build가 없는지 확인 (bridge 현황판 4201에서 IN_PROGRESS 없음 확인)
2. pnpm store prune  (더 이상 어느 node_modules에서도 쓰지 않는 패키지만 정리)
3. Get-PSDrive 로 C: 여유공간이 늘었는지 확인
4. 남은 항목을 지우고 싶으면 사람이 내용을 확인한 뒤 직접 삭제 —
   이 PC의 다른 프로젝트 node_modules가 여전히 참조할 수 있으므로
   자동화하지 않는다
```

### 9-5. 자동 시작·복구 — 실제로 되는 것과 안 되는 것 (실측, T1-54에서 갱신 2026-08-09)

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| **PC 재부팅 시 CTO Worker 자동 시작** | ✅ **됨** | 작업 스케줄러 `ACOS-CTO-Worker`(로그온+시스템 시작 트리거, `bridge/start-cto-worker.ps1` 실행)가 이미 등록돼 있었습니다. T1-54가 `Start-ScheduledTask`로 실제 트리거해 확인 — 이미 떠 있던 worker를 중복 실행하지 않고 안전하게 스스로 멈췄고(`bridge/.worker-logs`), `LastTaskResult`가 `0`(성공)으로 갱신됐습니다 |
| **PC 재부팅 시 Bridge 서버(4200)·현황판(4201) 자동 시작** | ✅ **됨 (T1-54에서 신규 등록)** | 새 작업 스케줄러 `ACOS-Bridge`(로그온+시스템 시작 트리거, **수정하지 않은** 기존 `bridge/start-bridge.ps1`을 그대로 실행)를 등록했습니다. 라이브 4200/4201을 재시작하면 이 세션 자신이 자식 프로세스일 위험이 있어(`PROJECT_MEMORY` M-30) 실제 트리거는 하지 않았고, 대신 대체 포트(4210/4211)에서 같은 절차(포트 정리→기동→`/health` 폴링)를 실측해 health check 200·현황판 200·정리 후 잔여 프로세스 0건을 확인했습니다. **실제 재부팅으로 끝까지 검증하지는 못했습니다** — `docs/DEVELOPMENT_ENVIRONMENT.md` §3-3 참고 |
| **로컬 웹(3100)·API(4100) 자동 시작** | ❌ **의도적으로 미자동화** | 세션 단위 검증용으로 설계돼 있어(M-13·M-14) 상시 자동 기동하면 로컬 Next.js 3000번과 충돌하고 빌드가 실패합니다. **"필요 시" 사람이 수동으로 띄우는 것이 맞다고 판단**했습니다(§9, 실행 순서 절차 그대로) |
| **MinIO 자동 시작** | ❌ **안 됨(기존 상태 그대로)** | Windows 서비스가 아니라 사람이 직접 실행한 프로세스입니다(`Get-Service`로 재확인, 결과 없음). 로컬 API가 자동화 대상이 아니므로 MinIO도 이번에 서비스화하지 않았습니다 |
| **PostgreSQL 자동 시작** | ✅ **됨(기존 상태 그대로)** | Windows 서비스 `postgresql-x64-16`, 시작 유형 `Automatic` — 이미 그렇게 설정돼 있었습니다 |
| **Bridge 서버 재시작 시 멈춘 작업 복구** | ✅ **됨** | `bridge/README.md` §1-2 "서버가 다시 뜨면 갇힌 작업을 자동으로 되돌립니다" — T1-28에서 이미 검증된 내용(`recoverAbandonedRuns`). T1-54도 라이브 서버를 재시작해 재확인하지 않았습니다 — 같은 이유(M-30)입니다 |
| **DB·MinIO 재기동 후 데이터 유지** | ✅ **됨(전제부 충족 시)** | PostgreSQL·MinIO는 디스크에 데이터를 쓰는 일반적인 서버 프로세스입니다. 데이터 디렉터리를 그대로 두고 재시작하면 데이터가 유지됩니다 — 이번에도 재시작 자체는 실행하지 않았습니다 |
| **cloudflared 터널 공개 주소** | ⚠️ **부분 자동** | Bridge 서버·현황판은 자동으로 뜨지만, 터널 주소는 띄울 때마다 새로 발급되므로(§3-1) ChatGPT Actions 재등록은 **재부팅마다 사람이 직접** 해야 합니다 — 자동화할 수 없는 외부 서비스 설정입니다 |

**등록에 관리자 권한이 필요했는가**: T1-54를 실행한 세션은 이미 관리자
권한 PowerShell이었습니다(`IsInRole(Administrator)` → `True`). 새
`ACOS-Bridge`는 기존 `ACOS-CTO-Worker`와 같은 방식(로그인 계정의 S4U
인증, 암호 저장 없음)으로 등록해 오류 없이 성공했습니다 — 관리자 권한이
아닌 세션에서도 되는지는 비교 대상이 없어 **미확인**입니다.

**재부팅 후 사람이 직접 확인해야 하는 것** (요약, 전체는
`docs/DEVELOPMENT_ENVIRONMENT.md` §3-3):

1. 실제 재부팅 후 두 작업 스케줄러가 `LastTaskResult: 0`이고 4200·4201이
   실제로 응답하는지 (이번 세션은 재부팅 자체를 하지 않았다)
2. **C 드라이브 여유 공간**(확인 시점 0.76GB) — 부족하면 재부팅 후에도
   MinIO 저장 거부·빌드 실패가 재발할 수 있다
3. cloudflared 새 터널 주소를 ChatGPT Actions에 재등록
4. SSH 터널(3000/4000) 재연결 여부
5. 로컬 웹(3100)/API(4100)이 필요하면 §9 절차로 수동 기동

### 9-6. Bridge 데이터를 git으로 영속화함 — 해결됨 (사장님 결정, 2026-08-09)

**있었던 문제**: `git ls-files bridge/`가 빈 결과를 반환했다 —
`bridge/` 아래 전부(코드·작업 지시·결과·프로젝트 등록 정보)가 한
번도 git에 커밋된 적이 없었다. 디스크가 손상되거나 워크트리를 지우고
새로 clone하면 Bridge 이력이 통째로 사라지는 위험이었다.

**사장님 결정**: bridge/를 Git에 넣는다. 단 토큰·API 키·인증정보·
임시 터널 주소·개인정보 등 비밀/환경 종속 정보는 반드시 제외하고,
Bridge 코드·작업 지시·결과 기록·프로젝트 등록 정보·상태 요약 및
복구에 필요한 메타데이터만 영속화한다.

**실행한 것(커밋 `35b1ea5`, 83개 파일)**:

- `.gitignore`에 제외 규칙 추가 — `bridge/.secrets/` ·
  `bridge/tunnel-url.txt` · `bridge/openapi.live.yaml` ·
  `bridge/demo/` · `bridge/projects/demo-shop/` ·
  `bridge/projects/demo-widget/` · `.claude/`
- `bridge/check-secrets.mjs`(신규) — 커밋 전 비밀값 검사기. 토큰·
  OpenAI/Gemini API 키·GitHub 토큰·개인 키·임시 터널 주소·DB 접속
  문자열·Bearer 토큰을 정규식으로 찾는다. 걸리면 0이 아닌 값으로
  끝난다. `node bridge/check-secrets.mjs`(스테이징만) ·
  `node bridge/check-secrets.mjs --all`(추적 중인 파일 전체)
- `bridge/openapi.yaml`의 터널 주소를 자리표시자(`CHANGE-ME`)로
  바꾸고, 실제 주소가 채워진 `bridge/openapi.live.yaml`은
  `start-bridge.ps1`이 실행할 때마다 새로 만들도록 분리(git에는
  올리지 않음)
- 비밀값 검사 통과 후 커밋 완료

**이번 세션(T1-30 재실행)이 재확인한 것**:

- `git ls-files bridge/` — **41개 파일**이 추적 중(작업 15건·결과
  10건 포함). 더 이상 빈 결과가 아니다
- `node bridge/check-secrets.mjs --all` — 저장소 전체 기준 59건이
  걸렸으나 **전부 `bridge/` 밖의 기존 테스트 파일**(`ops.spec.ts`·
  `api-key.spec.ts` 등의 가짜 API 키·DB 문자열 픽스처)이고
  **`bridge/` 아래 파일은 0건** — 결과를 `grep '^  bridge/'`로 직접
  걸러 확인했다. 이 59건은 이번 작업 범위 밖의 기존 코드이며 손대지
  않았다
- 새 환경 복구 검증(사장님 확인): 저장소만 clone한 곳에서 작업
  15건·결과 10건이 그대로 보이고 Bridge 검사 86건이 전부 통과했다.
  비밀값 4종(토큰·터널 주소 등)은 의도한 대로 따라가지 않았다

**새 PC 온보딩이 무엇을 하지 않아도 되게 됐는가**: `git clone` 한
번으로 Bridge 코드·작업 이력·프로젝트 등록 정보가 전부 함께
따라온다. 예전처럼 "Bridge 이력이 이 PC에만 있다"는 걱정은
해소됐다 — §9-7에 새 PC에서 **여전히 사람이 손으로 만들어야 하는
것**만 남긴다.

### 9-7. 새 PC에서 git clone만으로 되지 않는 것 — 사람이 직접 만들어야 함

git으로 영속화된 것은 **코드·이력·설정**이다. **이 PC에서만 뜻이
있는 값**(비밀값·이 순간에만 유효한 주소·이 디스크의 절대경로)은
git에 없다 — 의도적으로 뺐다(§9-6). 새 PC에서 Bridge를 다시 쓰려면
아래를 **사람이 직접** 만든다.

| # | 무엇 | 왜 git에 없는가 | 어떻게 만드는가 |
| --- | --- | --- | --- |
| 1 | **Bridge 인증 토큰**(`bridge/.secrets/bridge-token.txt`, 64자) | 이 값이 있으면 누구나 Claude Code를 실행시킬 수 있다 | `bridge/start-bridge.ps1`을 실행하면 파일이 없을 때 **새로 만든다.** 예전 토큰을 그대로 쓰고 싶으면 옛 PC의 파일을 안전한 경로로(채팅·git이 **아닌** 곳으로) 옮겨 온다 |
| 2 | **cloudflared 터널 공개 주소**(`bridge/tunnel-url.txt`) | 터널을 다시 띄울 때마다 새로 발급되는 임시 값 — 옛 주소는 그 순간 죽는다 | `start-bridge.ps1` 실행 시 자동 생성. 사람이 지어내지 않는다 |
| 3 | **`bridge/openapi.live.yaml`**(실제 터널 주소가 채워진 명세) | 터널 주소가 바뀔 때마다 같이 바뀌는 파생 파일 | `start-bridge.ps1`이 `bridge/openapi.yaml`(자리표시자 `CHANGE-ME`)을 읽어 매번 새로 만든다 |
| 4 | **ChatGPT 커스텀 GPT → Actions 재등록** | 외부 서비스(ChatGPT) 쪽 설정이라 이 저장소에 속하지 않는다 | `bridge/openapi.live.yaml`을 다시 붙여넣고, Authentication의 API Key를 새 토큰 파일 값으로 갱신(`bridge/README.md` §7) |
| 5 | **`apps/api/.env`** 등 비밀 환경 변수 | `.gitignore`로 제외(§3-3와 동일한 이유) | `.env.example`을 복사해 실제 값을 채운다 |
| 6 | **추가로 등록한 Bridge 프로젝트의 `repoPath`**(기본 프로젝트 `acos`는 해당 없음, §9-3 참고) | 그 프로젝트를 등록한 PC의 절대경로였을 뿐, 새 PC에서는 다른 경로다 | `node bridge/bridge-cli.mjs project register <등록JSON파일>`로 같은 `projectId`에 새 `repoPath`를 다시 등록(갱신) |
| 7 | 로컬 DB(PostgreSQL)·MinIO 데이터 | 이 PC의 실행 중인 서비스 상태 — git이 다루는 대상이 아니다 | §3-4·§3-6(Benchmark) 순서대로 새로 구축 |

**1~4번을 마치지 않으면 무엇이 안 되는가**: Bridge 서버(`bridge/
bridge-server.mjs`)와 CLI(`bridge/bridge-cli.mjs`)는 로컬(같은 PC)
에서는 토큰 없이도 동작한다 — **ChatGPT가 외부에서 부르는 경로만**
1~4번이 필요하다. 로컬 검증(§4)만 할 때는 건너뛸 수 있다.

---

## 10. 한 문장으로

> **이 프로젝트는 AI가 기억하는 프로젝트가 아니라,
> 프로젝트 자체가 기억하는 프로젝트입니다.**
>
> Claude가 바뀌어도 · PC가 바뀌어도 · 세션이 끝나도 —
> 철학·환경·상태·경험·작업 방식·결정 이유·다음 작업이 문서로 남습니다.
>
> **읽고 시작하십시오. 추측하지 마십시오.**

---

## 11. Claude Code 프로세스가 재시작됐을 때 — 세션 복구 (T1-107)

**§9와 다른 상황이다.** §9는 "새 PC·새 clone"을 다룬다. 이 절은 **같은
PC, 같은 저장소인데 Claude Code 프로세스만 사라진 경우** — 재부팅,
VS Code 재실행, Claude Code 확장 크래시, Bridge 서버 재시작 등이다.

### 11-1. 무엇이 자동으로 남는가

| 무엇 | 어디 | git 추적 |
| --- | --- | --- |
| 공식 문서 7종(AGENTS·MASTER_GUIDE·PROJECT_STATE·PROJECT_MEMORY· DEVELOPMENT_ENVIRONMENT·TASKS·RECOVERY_GUIDE) | 저장소 루트/`docs/` | ✅ |
| Task 지시 원문 | `bridge/tasks/<taskId>.json` | ✅ (§9-6) |
| Task 실행 상태·결과(state·heartbeatAt·changedFiles·testResults·blockedOn·decisionNeeded 등) | `bridge/results/<taskId>.json` | ✅ (§9-6) |
| Claude Code 자체 대화 transcript(사람이 CLI로 직접 실행한 것 포함) | `~/.claude/projects/<이 저장소 경로를 정규화한 폴더>/<session-id>.jsonl` | ❌ 이 PC 로컬에만 |

**`bridge/tasks`·`bridge/results`가 이미 사실상의 체크포인트다.** 새
저장소를 따로 만들지 않는다(요청 원문의 "중복 생성 금지" 그대로) —
taskId·지시 요약·startedAt/heartbeatAt·현재 단계(`state`)·변경
파일·테스트 결과·blockedOn/decisionNeeded가 전부 이미 여기 있다
(`docs/PROJECT_MEMORY.md` M-57).

### 11-2. Claude Code "대화" 자체는 자동 복구되지 않는다 — 실제 한계

`claude.exe`는 `-c/--continue`·`-r/--resume [sessionId]`·
`--session-id <uuid>`를 공식 지원하고, 실행할 때마다 위 표의 `.jsonl`
경로에 전체 대화를 남긴다(실측, M-57). **다만 Bridge가 Claude Code를
무인으로 부를 때(`bridge/bridge-executor.mjs`)는 이 세 옵션 중
어느 것도 쓰지 않는다** — 매 실행이 완전히 새 세션이고, 세션 ID가
`bridge/results/<taskId>.json`에도 기록되지 않는다. 게다가 이
`.jsonl` 폴더는 taskId별이 아니라 **저장소 경로 전체가 공유**하므로,
여러 taskId(지금 이 순간도 T1-106·T1-107이 동시 실행 중)의 대화가
한 폴더에 뒤섞인다.

**그래서 실제로 가능한 범위는 이렇다** — 과장하지 않는다:

- ✅ **자동 복구되는 것**: Task의 상태·지시 원문·변경 파일·테스트
  결과·다음에 사람이 확인할 것·막힌 이유(blockedOn/decisionNeeded).
  전부 파일(git 추적)에서 나온다.
- ❌ **자동 복구되지 않는 것**: 이전 세션에서 Claude가 사람과 주고받은
  자연어 대화 그 자체(설명·중간 판단 과정·질문) — Bridge가 만든
  세션은 taskId와 연결되지 않고, 같은 폴더에 다른 taskId 대화와
  섞여 있어 "이 taskId의 대화가 이것"이라고 신뢰성 있게 짚어낼 수
  없다. 사람이 VS Code에서 직접 `claude --continue`나
  `claude --resume`을 대화형으로 실행하면 **그 세션 자체의 대화는**
  다시 볼 수 있지만, 그것이 특정 taskId의 무인 실행과 일치한다는
  보장은 없다 — 사람이 내용을 보고 판단해야 한다.
- **미확인**: VS Code Claude Code 확장의 채팅 패널이 확장 재시작
  후 UI 상에서 이전 대화를 자동으로 다시 여는지는 확장 자체의 동작이라
  이번 조사에서 코드로 확인하지 못했다 — 추측해서 "된다"고 적지
  않는다. 확실한 것은 CLI가 transcript 파일을 남긴다는 사실뿐이다.

### 11-3. 새 프로세스가 컨텍스트를 재구성하는 순서

```
node scripts/bootstrap-context.mjs
```

**읽기 전용**이다. 아무 파일도 쓰지 않고, 아무 Task도 실행·재개하지
않는다. 아래 순서로 한 번에 요약해 보여준다.

```
① docs/PROJECT_STATE.md 최상단(현재 프로젝트 상태)
② Bridge health (127.0.0.1:4200/health)
③ taskId별 실행 상태 (bridge/results/*.json — RUNNING NOW / RESUME CANDIDATE 구분)
④ 최근 Task 결과 5건 (workDone·testResults 요약)
⑤ 변경 파일 / git 상태 (branch·최근 커밋·미커밋 변경 목록)
⑥ 장기기억 문서 7종 포인터(각 문서 마지막 갱신 커밋)
⑦ 작업 로그(bridge/STATUS.md 머리말)
```

이 순서와 항목은 이 절 자체가 아니라 스크립트가 직접 실측해 만드는
것이다 — 문서와 실제가 어긋나면 스크립트 실행 결과가 맞다(`AGENTS.md`
§0 Source of Truth).

### 11-4. RESUME CANDIDATE — 표시만 한다, 실행하지 않는다

`bootstrap-context.mjs`는 `state`가 `IN_PROGRESS`/`TESTING`인데
`heartbeatAt`이 5분(`bridge/bridge-executor.mjs`의
`ABANDON_LIMIT_MS`) 넘게 갱신되지 않은 작업을 **RESUME CANDIDATE**로
표시한다 — 프로세스가 죽었을 가능성이 크다는 뜻이다. **이 목록에
있다고 스스로 재실행하지 않는다** — `AGENTS.md` §0 "지정 Task 실행
원칙"과 정확히 같은 규칙이다. Bridge 서버가 재시작되면
`recoverAbandonedRuns()`가 이런 작업을 자동으로 `REQUESTED`로
되돌리기는 하지만(`bridge/README.md` §1-2), **그 뒤에도 자동으로
다시 실행하지는 않는다.** 재개하려면 CTO/사람이 **그 taskId를
명시적으로 지정**해야 한다 — 대기열의 다른 `REQUESTED` 작업으로
임의 대체하지 않는다.

실제로 이 스크립트를 이번 작업에서 돌려 본 결과, T1-45·T1-55·
T1-56·T1-87·T1-91 다섯 건이 `TESTING` 상태로 수백~수천 분째 멈춰
있는 것을 확인했다(전부 이번 작업 이전부터 있던 것 — 이번에 손대지
않았다). 이것이 "resume candidate가 실제로 감지된다"는 실측 증거다.

### 11-5. VS Code 재실행 — 자동 복구되는 것과 아닌 것 (구분)

| | 자동 복구되는가 |
| --- | --- |
| VS Code workspace(열려 있던 폴더) | VS Code 자체 기능 — 이 프로젝트가 관여하지 않음 |
| 현황판(4201)을 Simple Browser로 자동으로 다시 엶 | ✅ `.vscode/tasks.json`의 `runOn: folderOpen` 작업(이미 있음, 이번에 새로 만들지 않음) — 단 Bridge(4200/4201)가 떠 있어야 화면이 뜬다 |
| 터미널 세션 | VS Code 자체 기능 — 이 프로젝트가 관여하지 않음 |
| **Claude Code 대화(채팅 패널) 자체** | **§11-2 참고 — 별개의 문제, 자동으로 이어지지 않는다(대화 자체는 taskId와 연결되지 않음)** |

### 11-6. 재부팅/프로세스 재시작 후 사람이 할 일 (체크리스트)

**2026-08-13 갱신(T1-109)**: 재부팅 후 Windows 개발환경 자체를
되살리는 일은 이제 사람이 손으로 하지 않는다 — `ACOS-Recovery-Manager`
(신규 스케줄러)가 `ACOS-Bridge`·`ACOS-CTO-Worker`와 함께 자동으로
확인·기동한다. 상세 구조는 `docs/DEVELOPMENT_ENVIRONMENT.md` §22.
아래는 그 이후에도 **여전히 사람이 해야 하는 것**만 남긴다.

```
1. 재부팅한다 → 몇 분 기다린다
2. VS Code로 이 워크트리 폴더를 다시 연다
   → "CTO Bridge 현황판 열기"(4201)와 "ACOS 자동복구 상태 보기"
     터미널 패널이 자동으로 뜬다(둘 다 이미 있던 기능 위에 추가됨,
     DEVELOPMENT_ENVIRONMENT.md §22)
   → 터미널 패널의 판정이 SUCCESS인지 본다. PARTIAL/FAILED면 어느
     단계가 왜 실패했는지 그 자리에 적혀 있다 — 그때만 아래 3번으로
3. (실패했을 때만) 수동 복구 명령을 최후 수단으로 실행한다:
   powershell -ExecutionPolicy Bypass -File scripts\acos-recovery-manager.ps1
4. node scripts/bootstrap-context.mjs 를 실행해 지금 무슨 작업이
   어디까지 진행됐는지 확인한다 — 이것은 자동화되지 않는다
   (무인 스케줄러가 Claude Code 대화 세션을 새로 열 수 없다, §11-2)
5. RESUME CANDIDATE로 뜬 taskId 중 실제로 이어야 할 작업이 있으면
   그 taskId를 명시적으로 지정해 다시 지시한다
   (임의로 다른 REQUESTED 작업을 시작하지 않는다)
6. §0(이 문서)·AGENTS.md §0 체크리스트대로 문서를 읽고 시작한다
```

**주의**: `ACOS-Recovery-Manager`는 이번 세션이 실제 재부팅 없이
"이미 다 켜져 있는" 상태에서만 검증했다 — 콜드 스타트(모든 서비스가
꺼진 상태에서 재기동)는 다음 실제 재부팅에서 처음 확인된다
(`docs/DEVELOPMENT_ENVIRONMENT.md` §22-5). 위 2번에서 PARTIAL/FAILED가
나오면 처음 겪는 실패일 수 있으니 `D:\dev-data\logs\
recovery-manager\latest.txt`와 각 하위 로그(`D:\dev-data\logs\
start-bridge-run.log` 등)를 함께 확인한다.

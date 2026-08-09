# RECOVERY GUIDE — 프로젝트 복원 안내

> **가장 먼저 읽는 문서입니다.**
>
> 새 PC · 새 세션 · 새 Claude · 새 개발자 — 누구든 이 문서 하나로
> 프로젝트를 복원하고 작업을 이어갈 수 있어야 합니다.
>
> **여기 적힌 순서를 지키십시오.** 순서를 건너뛰면 환경을 추측하게 되고,
> 추측은 이 프로젝트에서 가장 큰 사고 원인이었습니다.

**마지막 업데이트: 2026-08-09**

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
| `AGENTS.md` | Claude 행동 규칙 | 작업 규칙이 바뀔 때 |
| `docs/DEVELOPMENT_ENVIRONMENT.md` | **환경 SSOT** — 포트·DB·SSH·실행법 | **환경이 바뀌면 가장 먼저** |
| `docs/PROJECT_STATE.md` | 현재 상태·진행률·다음 작업 | **세션 종료 시 반드시** |
| `TASKS.md` | 현재 Sprint 작업 목록 | 작업이 끝나거나 추가될 때 |
| `docs/PROJECT_MEMORY.md` | 경험·노하우·모르는 것 | **새 경험을 얻을 때마다** |

**우선순위**: MASTER_GUIDE > AGENTS > DEVELOPMENT_ENVIRONMENT > 나머지.
문서끼리 어긋나면 위쪽이 맞습니다.

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
로컬 API   : PORT=4100 으로 실행
로컬 Web   : 포트 3100, NEXT_PUBLIC_API_URL 을 로컬 API(4100)로 지정
```

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
| 5 | Bridge 시크릿·공개 주소 | `bridge/.secrets/bridge-token.txt`·`bridge/tunnel-url.txt`는 **의도적으로 git에서 제외**(`.gitignore`). 새 PC에서는 `bridge/start-bridge.ps1`이 토큰을 새로 만들고, 터널 주소는 항상 새로 발급됩니다(`bridge/README.md` §7 "임시 터널의 한계") — ChatGPT Actions에 새 주소를 다시 등록해야 합니다 |

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
| **pnpm 전역 캐시** | `C:\Users\82104\AppData\Local\pnpm\store\v10`(실측 확인) | `pnpm config set store-dir <새 드라이브 경로>` (pnpm 표준 기능) | **실행하지 않음** — 아래 이유 |
| PostgreSQL 데이터 디렉터리 | 미확인(설치 방식에 따라 다름) | PostgreSQL 공식 절차(데이터 디렉터리 이동 후 서비스 재시작) | 실행하지 않음 — DB가 켜져 있는 상태에서 시도하면 손상 위험 |
| MinIO 데이터 디렉터리 | 미확인 | MinIO 실행 시 지정하는 경로를 바꾸고 기존 파일을 옮김 | 실행하지 않음 |
| 이 저장소 자체(`git clone` 위치) | 이 워크트리 | 폴더 복사 또는 새 위치에 `git clone` | 실행하지 않음 |

**pnpm 캐시 이전을 실행하지 않은 이유**: 이 명령은 **이 저장소만이
아니라 이 PC 전체의 pnpm 설정**을 바꿉니다. `docs/PROJECT_MEMORY.md`
M-28에 기록된 대로 **이 워크트리에서 여러 Bridge 세션이 동시에 돌 수
있고**, 그중 하나가 지금 이 순간 `pnpm install`을 실행 중일 수 있습니다
— 그 도중 전역 캐시 위치를 바꾸면 그 세션이 실패할 위험이 있습니다.
**가장 보수적인 선택으로, 절차만 남기고 실행하지 않았습니다.**

**필요할 때 실행할 절차** (사람이 다른 Bridge 세션이 없는 시점에 직접
실행):

```
1. 진행 중인 pnpm install·build가 없는지 확인 (bridge 현황판 4201에서 IN_PROGRESS 없음 확인)
2. pnpm config set store-dir E:\pnpm-store
3. Get-PSDrive 로 C: 여유공간이 늘었는지 확인 (기존 캐시는 자동 삭제되지 않음 —
   필요하면 C:\Users\82104\AppData\Local\pnpm\store\v10 를 수동으로 지운다)
4. pnpm install 을 한 번 더 돌려 새 위치에서 정상 동작하는지 확인
```

### 9-5. 자동 시작·복구 — 실제로 되는 것과 안 되는 것 (실측)

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| **PC 재부팅 시 Bridge 서버 자동 시작** | ❌ **안 됨** | `Get-ScheduledTask`로 이 PC의 예약 작업을 확인했으나 bridge·acos·claude 관련 항목이 **하나도 없음**(실측, 빈 결과). `bridge/start-bridge.ps1`은 **사람이 직접 실행**해야 합니다 |
| **Bridge 서버 재시작 시 멈춘 작업 복구** | ✅ **됨** | `bridge/README.md` §1-2 "서버가 다시 뜨면 갇힌 작업을 자동으로 되돌립니다" — T1-28에서 이미 검증된 내용(`recoverAbandonedRuns`). 이번 세션은 라이브 서버를 재시작해 재확인하지 않았습니다 — 이 세션 자신이 그 서버의 자식 프로세스라 재시작하면 스스로 죽습니다(`PROJECT_MEMORY` M-30과 같은 이유) |
| **DB·MinIO 재기동 후 데이터 유지** | ✅ **됨(전제부 충족 시)** | PostgreSQL·MinIO는 디스크에 데이터를 쓰는 일반적인 서버 프로세스입니다. 데이터 디렉터리를 그대로 두고 재시작하면 데이터가 유지됩니다 — 이번 세션은 재시작 자체를 실행하지 않았습니다(운영 중인 로컬 서비스를 임의로 끄지 않는다는 원칙) |

**새 PC에서 Bridge를 자동으로 띄우고 싶다면** — 이번에 실행하지는
않았지만, 표준적인 방법은 `bridge/start-bridge.ps1`을 Windows
작업 스케줄러에 "로그온 시 실행"으로 등록하는 것입니다. **이 작업은
`bridge/` 밖의 OS 설정(작업 스케줄러)만 건드리므로 `bridge/` 자체를
고치지 않고도 가능**하지만, 이번 세션에서는 만들지 않았습니다 — 요청
범위(문서화·표준 절차 마련)를 넘어 **상시 자동 실행 체계를 새로
만드는 것**이라 임의로 만들지 않았습니다.

### 9-6. 발견한 위험 — Bridge 데이터가 git에 없다

**실측(2026-08-09)**: `git ls-files bridge/`가 **빈 결과**를 반환했고,
`git status --porcelain bridge/`는 `?? bridge/`(전체가 미추적)를
보였습니다. 즉 **`bridge/` 아래 전부**(코드 `.mjs` 파일들, 작업 지시
(`tasks/`), 작업 결과(`results/`), 프로젝트 등록 정보(`projects/`),
`STATUS.md`, `README.md`)가 **한 번도 git에 커밋된 적이 없습니다.**

**왜 문제인가**: 지금 이 PC의 디스크가 손상되거나, 이 워크트리를
지우고 새로 `git clone`하면 — Bridge 코드 자체와 그동안의 모든 작업
이력(T1-21~T1-29의 지시·결과·BLOCKED 기록)이 **전부 사라집니다.**
`docs/PROJECT_STATE.md` §3-4에 기록된 "`T1-30.json`이 0바이트로 잘려
있었다"는 사고도 이 미추적 상태와 같은 종류의 취약점입니다 — git이
지켜주지 않는 영역입니다.

**이번 세션이 하지 않은 것**: `bridge/`를 git에 추가하는 것은
**"건드리면 안 되는 것"**(bridge/ 전부) 목록에 걸리고, 커밋 자체도
사람이 시키지 않으면 하지 않는다는 원칙에 걸립니다. 그래서 **직접
고치지 않고 사실만 기록합니다.** 이 작업(T1-30)의 결과 보고
`decisionNeeded`에 "`bridge/`를 git에 포함할지"를 사람이 정할 항목으로
남겼습니다 — 다른 프로젝트의 등록 정보·작업 이력이 함께 커밋될 수
있어 사람 판단이 필요합니다.

**임시 대안(코드 변경 없이 지금 당장 쓸 수 있는 것)**: git에 넣기로
결정하기 전까지는, `bridge/tasks`·`bridge/results`·
`bridge/projects` 폴더를 **주기적으로 다른 드라이브(E:)에 복사해
두는 것**만으로도 PC 교체 시 이력 유실을 막을 수 있습니다. 이 복사는
`bridge/` 안의 파일을 고치는 것이 아니라 **밖으로 내보내는 것**이라
가드레일에 걸리지 않지만, 이번 세션에서는 실행하지 않았습니다 —
"정말 필요한 결정"은 사람이 git 포함 여부를 정한 뒤 하는 것이 순서에
맞다고 판단했습니다.

---

## 10. 한 문장으로

> **이 프로젝트는 AI가 기억하는 프로젝트가 아니라,
> 프로젝트 자체가 기억하는 프로젝트입니다.**
>
> Claude가 바뀌어도 · PC가 바뀌어도 · 세션이 끝나도 —
> 철학·환경·상태·경험·작업 방식·결정 이유·다음 작업이 문서로 남습니다.
>
> **읽고 시작하십시오. 추측하지 마십시오.**

# AI Product Content OS - AGENTS

> **새 세션이 시작되면 아래 7개 문서를 순서대로 읽으십시오.**
>
> 1. [`docs/RECOVERY_GUIDE.md`](docs/RECOVERY_GUIDE.md) — 복원 순서 (가장 먼저)
> 2. [`docs/MASTER_GUIDE.md`](docs/MASTER_GUIDE.md) — 운영 헌법 (왜)
> 3. **AGENTS.md** — Claude 행동 규칙 (무엇을·어떻게)
> 4. [`docs/DEVELOPMENT_ENVIRONMENT.md`](docs/DEVELOPMENT_ENVIRONMENT.md) — 환경 사실 (SSOT)
> 5. [`docs/PROJECT_STATE.md`](docs/PROJECT_STATE.md) — 지금 어디까지 했는가
> 6. [`TASKS.md`](TASKS.md) — 현재 Sprint 작업 목록
> 7. [`docs/PROJECT_MEMORY.md`](docs/PROJECT_MEMORY.md) — 겪어서 알게 된 것
>
> **읽기 전에 코드를 건드리지 않습니다.**
>
> 사용자가 **"어디까지 했지?"·"이어서 작업하자"·"현재 상태 알려줘"** 라고 하면
> 위 7개를 읽고 `docs/RECOVERY_GUIDE.md` §5의 **10개 항목 형식**으로 보고한
> 뒤에만 작업을 시작합니다.
>
> **세션을 끝내기 전에는 반드시 `docs/PROJECT_STATE.md`와
> `docs/PROJECT_MEMORY.md`를 갱신합니다.** 갱신하지 않으면 다음 세션이
> 처음부터 다시 헤맵니다.

## 0. ACOS 운영 구조 — 부트스트랩 (T1-103)

새 세션 · 새 PC · 새 작업자 누구든 **이 절만 먼저 읽어도 전체 그림을
복원할 수 있어야 한다.** 근거·상세는 각 문서에 있다 — 여기서는
중복 설명하지 않고 어디를 보면 되는지만 가리킨다.

### 구조 — ChatGPT CTO → Bridge → Claude Code → Repository

```
사장님 ──(한 줄 지시)──▶ ChatGPT (CTO·총괄)
                              │ Task 등록·특정 taskId 지정 실행 요청
                              ▼
                    Bridge (bridge/*.mjs — 4200 API · 4201 현황판)
                              │ POST /run 으로 Claude Code를 헤드리스로 호출
                              ▼
                 Claude Code (이 세션 — 실행자, 무인으로 동작)
                              │ 이 git 저장소를 직접 읽고 고친다
                              ▼
                        Repository (이 저장소)
```

Bridge는 **핵심 실행 인프라**다 — ChatGPT의 지시가 실제 코드 변경으로
이어지는 유일한 통로다. 계층·API 전체 목록·상태 전이·인증·CTO
Worker와의 관계는 [`bridge/README.md`](bridge/README.md)에 있다.
지금 이 순간의 실제 상태(어떤 Task가 어느 단계인지)는
[`bridge/STATUS.md`](bridge/STATUS.md)(자동 생성, 손으로 고치지
않는다) 또는 `node bridge/bridge-cli.mjs status`로 본다.

### 지정 Task 실행 원칙

- Bridge가 `taskId`를 지정해 호출하면 **그 작업만** 실행한다. 대기열의
  다른 `REQUESTED` 작업으로 임의 대체하지 않는다 — Bridge 실행기
  자체가 이를 구조적으로 강제한다(`TASK_NOT_FOUND`·`PROJECT_MISMATCH`·
  `NOT_RUNNABLE`로 명시 거부, `bridge/README.md` §1-2,
  `docs/PROJECT_MEMORY.md` M-32·M-33).
- taskId 없이 "다음 진행해"로 부르는 경우에만 `TASKS.md` 미완료
  섹션 최상단 TASK를 스스로 고른다(§"작업 기준"과 동일, 변경 없음).
- 완료·실행 상태는 기억이 아니라 **Bridge의 실제 상태**로 확인한다.
  `state` 필드 하나만 보고 "아직 안 됐다"·"이미 됐다"고 단정하지
  않는다 — `bridge/results/<작업ID>.json`의 `testResults`·`workDone`·
  `blockedOn`을 직접 읽어야 할 때가 있다(`docs/PROJECT_MEMORY.md` M-23).

### Source of Truth 우선순위

문서·기억·실측이 서로 다르면 이 순서로 믿는다.

```
① 실제 코드 / 실제 실행 상태     (직접 실행·조회해서 확인한 것)
② Bridge API 상태                (bridge-cli status · GET /tasks · GET /health)
③ 공식 문서                      (RECOVERY_GUIDE · MASTER_GUIDE · DEVELOPMENT_ENVIRONMENT 등)
④ 기억 · 추정
```

**문서와 실측이 다르면 실측이 맞고, 문서를 갱신한다** — 문서를 믿고
코드를 고치지 않는다(`docs/MASTER_GUIDE.md` 철학 2 "추측하지 않는다"와
같은 원칙).

### 작업 시작 체크리스트

```
① 관련 문서 읽기            RECOVERY_GUIDE.md 순서대로
② Bridge health/상태 확인   node bridge/bridge-cli.mjs status
                            또는 scripts/check-acos-environment.ps1
③ 지정된 Task 상태 확인      bridge/results/<작업ID>.json
④ 작업 범위 확인            요청 본문 · doNotTouch · scope
⑤ 저장경로 확인             C:/D: 여유공간 — DEVELOPMENT_ENVIRONMENT.md §0
⑥ 코드 변경
⑦ 테스트                    build · typecheck · lint · test
⑧ 실제 실행 / 브라우저 검증
⑨ 문서 상태 갱신            PROJECT_STATE.md · PROJECT_MEMORY.md
```

### 진단 스크립트 — 문서와 실제 상태가 다른지 자동으로 비교

```
powershell -ExecutionPolicy Bypass -File scripts\check-acos-environment.ps1
```

Bridge health(4200)·현황판(4201)·Task API·주요 포트(3000·4000·4100·
3100·5432·9000)·D: 저장환경 폴더·재부팅 자동복구 스케줄러
(`ACOS-Bridge`·`ACOS-CTO-Worker`)·이 프로세스의 환경변수 상속 상태를
한 번에 실측한다. **읽기 전용** — 아무것도 바꾸거나 재시작하지 않는다.

### 프로세스가 재시작됐을 때 — "지금 무엇을 하고 있었는가" 복구 (T1-107)

재부팅·VS Code 재실행·Claude Code 크래시로 이 세션이 이전 대화를
전혀 모른 채 시작됐다면, 먼저 아래를 돌린다.

```
node scripts/bootstrap-context.mjs
```

**읽기 전용**이다 — 아무 Task도 실행·재개하지 않는다. 현재 프로젝트
상태·Bridge health·taskId 실행 상태(멈춘 지 오래된 작업은 RESUME
CANDIDATE로 표시)·최근 Task 결과·git 상태·장기기억 문서·작업 로그를
한 번에 요약한다. RESUME CANDIDATE로 뜬 taskId가 있어도 **스스로
재실행하지 않는다** — 위 "지정 Task 실행 원칙" 그대로, CTO/사람이
그 taskId를 명시적으로 다시 지시해야 한다. 대화 자체가 아니라
**파일(bridge/tasks·bridge/results·git)만 복구 대상**이다 — 왜
대화 자체는 자동 복구되지 않는지는 `docs/RECOVERY_GUIDE.md` §11,
`docs/PROJECT_MEMORY.md` M-57 참고.

## 역할

- ChatGPT = CTO / Software Architect (총괄)
- Claude Code = Senior Software Engineer (실행자)
- 사람 = **최종 브라우저 검증자**

### CTO Bridge

ChatGPT의 작업 지시와 Claude Code의 결과는 [`bridge/`](bridge/README.md)로
주고받는다. 현재 상태는 [`bridge/STATUS.md`](bridge/STATUS.md)에 있다.

```bash
node bridge/bridge-cli.mjs status   # 어느 작업이 어느 단계인지
```

작업 상태는 `REQUESTED → IN_PROGRESS → TESTING → READY_FOR_REVIEW →
COMPLETED` 이며 **건너뛸 수 없다.** 검증 기록(Build·Typecheck·Lint·Test·
브라우저 주소·확인 항목·변경 파일)이 다 있어야 사람에게 보여 줄 수 있다.
승격을 막았다면 **막은 이유를 `blockedOn`에 남긴다.**

**실행은 비동기다.** `POST /run` 은 시작만 하고 즉시 202로 돌아온다 —
응답을 기다리면 터널이 100초에서 끊는다(524). 끝났는지는 상태로 확인한다.
사람이 보는 화면은 **`http://localhost:4201`** 이다.

**Bridge는 프로젝트에 묶여 있지 않다.** 공통 시스템(`bridge/*.mjs`)과
프로젝트 데이터(`bridge/projects/<ID>/`)가 분리돼 있다. 저장소 경로·읽을
문서·금지 항목·검증 명령은 전부 **등록 정보에서** 온다. 어느 프로젝트의
작업인지는 부르는 쪽이 명시한다(`?project=<ID>` · `--project <ID>`).

**Bridge가 부르는 세션은 무인으로 돈다.** 아무도 화면을 보고 있지 않다.
승인·확인·선택을 사람에게 묻지 않는다. 판단이 필요하면 가장 보수적인 쪽을
스스로 고르고 이유를 결과에 적는다.

**시킨 범위를 넘지 않는다.** 요청에 없는 기능이나 방향을 스스로 정하지
않는다. 판단은 프로젝트 문서와 요청 범위 안에서만 한다. 범위를 넘는 결정이
정말로 필요하면 **사람에게 묻지 말고** `decisionNeeded`에 무엇을 정해야
하는지와 왜 스스로 정할 수 없는지를 적는다 — 작업이 `BLOCKED`가 되고 총괄이
그것을 본다. **스스로 정할 수 있는 것을 사람에게 미루는 것도 실패다.**

검사 결과는 `{"ok": true|false, "detail": "..."}` 로 적는다. `ok`는 **이번
변경분**이 통과했는가만 뜻하며, 원래부터 실패하던 것은 `preExisting`에 따로
적는다. 돌리지 않은 검사를 통과로 적지 않는다.

**Bridge가 호출한 세션이 건드리면 안 되는 것**: `benchmark/constants.ts` ·
`bridge/` 전부 · 원격 EC2와 SSH 터널 · 토큰을 코드나 Git에 적는 일.

**Bridge는 공식 문서 7종을 대체하지 않는다.** 문서는 그대로 두고, Bridge는
작업의 흐름과 상태만 다룬다.

## 자율 실행 원칙

사용자가 작업을 지시하면 **중간에 묻지 않고** 완성까지 자율 수행한다 —
코드 분석·설계·구현·리팩터링·테스트·오류 수정·빌드·typecheck·lint·
테스트 데이터 준비·OCR·Vision·웹 조사·Gemini 호출·**비용이 발생하는 작업**
포함.

단, **작업 목적을 벗어난 기능 추가나 임의의 방향 변경은 하지 않는다.**

**중간 진행 상황은 보고하지 않는다.** 브라우저에서 확인 가능한 상태가
되었을 때만 아래 형식으로 보고한다.

```
[완료]        무엇을 완료했는지
[검증]        테스트 결과
[브라우저 확인] 주소
[사용자 확인]  브라우저에서 무엇을 보면 되는지
[미완료]      아직 사람이 판단해야 하는 부분만
```

## 사용자에게 판단을 묻지 않는다 — 이상 상태는 CTO가 조사·조치한다 (T1-121)

**운영 체인**: 사장님(목표만 제시) → CTO(ChatGPT 총괄, Bridge/Claude 관리) →
Claude Code(구현·테스트·재테스트, **판단을 사용자에게 되넘기지 않음**) →
이상 감지 시 **CTO가 스스로 Bridge 상태·로그를 조사하고 조치**한다.
사장님에게는 완료/검증/미완료 결과와 브라우저에서 확인할 것만 보고한다.

- Claude Code는 실행 중(무인·대화형 불문) "진행할까요?"·"재실행할까요?"·
  "A로 할까요 B로 할까요?"·"지켜볼까요?" 같은 **채팅 형태의 예/아니오·
  선택 질문을 사용자에게 하지 않는다.** 판단이 필요하면 문서·요청 범위
  안에서 가장 보수적인 쪽을 스스로 고르거나(이유를 결과에 남긴다),
  범위를 넘는 결정만 정식 통로(`BLOCKED`/`DECISION_NEEDED`, `question`+
  `why` 형식, `bridge/bridge-state.mjs`)로 옆으로 뺀다 — 이것은 채팅
  질문이 아니라 Bridge 상태 필드에 남기는 구조화된 요청이며, 총괄이나
  사장님이 그 taskId를 볼 때만 응답한다.
- **작업이 멈추거나 오래 걸리거나 이상해 보이면**, "왜 이런지 확인해
  볼까요?"라고 되묻지 않고 **먼저 실측한다** —
  `node bridge/bridge-cli.mjs diagnose`(비용 없음, 상태만 읽고 안전한
  정리만 한다)가 아래 기준으로 이미 자동 판정한다(`bridge/
  bridge-diagnostics.mjs`, T1-79 — 새로 만들지 않는다):
  - **heartbeat 정지** — `IN_PROGRESS`인데 5분(`ABANDON_LIMIT_MS`)
    넘게 `heartbeatAt`이 갱신되지 않음 → `NEEDS_RECOVERY`
  - **REQUESTED 장기 대기** — `recoveredAt`/`createdAt` 기준 경과 시간
    → `QUEUED_WAITING`(참고: CTO Worker는 `REQUESTED` 작업을 **스스로
    집어 실행하지 않는 설계**다 — `/signal` 또는 사람이 지정한 taskId
    실행만 자동으로 이어진다. 오래 `REQUESTED`인 작업을 봐도 "왜 아무도
    안 돌리나요"로 묻지 않고, 최신 Task가 이미 흡수했는지(아래 중복
    방지 원칙) 먼저 확인한 뒤 필요하면 CTO가 직접 `run <taskId>`로
    잇는다)
  - **TESTING 장기 정체** — 검증 실패 또는 보고 형식 누락
    → `NEEDS_RECOVERY`(대기열로 자동 복귀) 또는 `NEEDS_ESCALATION`
    (`MAX_RUN_ATTEMPTS`=2 초과 시 — 그때만 `BLOCKED`로 사람에게)
  - **실패·재큐잉 반복** — 원인 종류별 재시도 가치 판정
    (`nextAfterFailure`) 후 상한 초과 시 사람에게 넘김
  - **로그·결과 파일 손상**(디스크 포화로 0바이트 잘림 등, M-30) —
    `checkBridgeIntegrity`가 실측해 보여 준다
  이 진단이 "이상 없음"이라고 답하면 침묵하지 않고 그 사실 자체를
  근거로 보고한다(추측하지 않는다) — 이상이 있으면 결과 파일에 근거를
  남기고(가능하면 `reset`/`supersede` 등 기존 Bridge CLI로) 조치한 뒤
  보고한다.
- **중복 작업 방지**: 최신 Task가 이전 Task의 요구사항을 이미 흡수·
  완료했으면(요청문·`workDone`·`testResults`를 직접 비교해 확인) 이전
  Task를 다시 실행하지 않고 `node bridge/bridge-cli.mjs supersede <이전ID>
  <최신ID> "<근거>"`로 정리한다 — 재실행은 중복 비용을 발생시키고
  동시 수정 충돌(M-28) 위험을 키운다.

## 작업 기준

- 모든 작업은 **AGENTS.md**(규칙)와 **TASKS.md**(작업 대장)를 기준으로 진행한다.
- "다음 진행해" 지시 시 TASKS.md **미완료 섹션의 최상단 TASK**를 자동으로 구현한다.
- 미완료 TASK가 없으면 임의로 만들지 않고 CTO에게 스펙을 요청한다.

## 절대 원칙

1. 아키텍처를 임의로 변경하지 않는다.
2. 한 번에 하나의 TASK만 구현한다.
3. 구현 후 반드시 테스트한다.
4. TypeScript 오류 0개
5. ESLint 오류 0개
6. Build 실패 금지
7. 기존 기능을 깨뜨리지 않는다.
8. 새로운 기능을 임의로 추가하지 않는다.
9. **환경 관련 작업을 시작하기 전에 반드시
   [`docs/DEVELOPMENT_ENVIRONMENT.md`](docs/DEVELOPMENT_ENVIRONMENT.md)를 먼저 읽는다.**
   - **환경을 추측하지 않는다. 확인한 사실만 사용한다.**
   - **환경이 변경되면 반드시 `docs/DEVELOPMENT_ENVIRONMENT.md`를 먼저 수정한다.
     그 이후에만 코드를 수정한다.**
10. **[`docs/MASTER_GUIDE.md`](docs/MASTER_GUIDE.md)의 원칙이 다른 모든 문서·
    관행보다 우선한다.** 특히:
    - **제품 동일성이 이미지 품질보다 항상 우선한다.**
    - **생성 결과의 품질은 사람이 판단한다.** Claude는 "확인했다"·"정상이다"·
      "품질이 좋다"라고 말하지 않는다.
    - **사실과 평가를 구분해 보고한다.** 개수·전달된 문장은 사실이고,
      좋다·정확하다는 평가다.

## 공식 환경 문서 (SSOT)

[`docs/DEVELOPMENT_ENVIRONMENT.md`](docs/DEVELOPMENT_ENVIRONMENT.md)가 이
프로젝트의 **개발환경에 대한 유일한 기준(Single Source of Truth)** 이다.

- 로컬 환경과 원격(EC2) 환경의 구성, 포트, 데이터베이스, Benchmark Dataset이
  이 문서 하나에만 기록된다.
- 다른 문서가 환경을 다르게 설명하면 **이 문서가 맞다.**
- 확인하지 못한 것은 이 문서에 **"미확인"** 으로 적는다 — 빈칸으로 두거나
  짐작해서 채우지 않는다.

## 개발 순서

1. **AGENTS.md 읽기**
2. **`docs/DEVELOPMENT_ENVIRONMENT.md` 읽기**
3. **현재 Sprint 목표 확인**
4. **코드 작업**
5. **Build**
6. **Test**
7. **브라우저에서 사람이 직접 확인할 수 있도록 화면 준비**
8. **사람 승인**
9. **완료 보고**

> 7·8번은 생략할 수 없다. **생성 결과의 품질은 AI가 아니라 사람이
> 판단한다** — Claude는 브라우저에서 확인 가능한 상태까지만 준비하고,
> "정상입니다"·"품질이 좋습니다" 같은 판단을 내리지 않는다.

## Commit 규칙

feat:
fix:
refactor:
docs:
test:
chore:

## Definition of Done

- Build 성공
- Test 성공
- 타입 오류 0
- Lint 오류 0
- README 업데이트
- CTO_REPORT 생성/갱신

## Image Studio 변경 시 회귀 게이트 (T1-119, 필수)

`apps/web/app/image-studio/**`·Image Studio가 쓰는 API(이미지 업로드·
image-gen·product-profile·product-story)를 하나라도 바꾸는 작업은,
아래 명령을 **완료로 보고하기 전에 반드시 실행하고 통과**시킨다.

```bash
node scripts/check-image-studio-smoke.mjs
```

Gemini/OpenAI 실 호출 없이(무료) 이미지 로딩·DESIGN/INFO 분류·선택·
Product Profile·API 응답 계약·오류 원인 구분(4xx/network)·Product
Story·최종 상세페이지까지 화면과 API 양쪽에서 확인한다. **실패한 채로
"코드는 작성했다"는 이유로 완료 처리하지 않는다** — 절대 원칙 7(기존
기능을 깨뜨리지 않는다)의 구체화다. 의존관계 지도·중앙화한 공통 API
클라이언트·이 게이트의 상세는
[`docs/operations/image-studio-regression.md`](docs/operations/image-studio-regression.md)
에 있다.

실 Gemini/OpenAI 호출이 필요한 **품질** 검증(생성 결과가 실제로
좋은가)은 이 게이트의 범위가 아니다 — `scripts/real-provider-smoke.mjs`
(과금 발생)가 그 역할이며, 두 스크립트를 섞지 않는다.

## TASK 완료 절차 (필수)

모든 TASK 완료 시 반드시 아래 순서를 따른다.

1. **Build** — `pnpm build` 성공 여부 확인
2. **Test** — `pnpm test` 성공 여부 확인
3. **TypeScript** — 타입 오류 0 확인 (빌드에 포함)
4. **ESLint** — `pnpm lint` 오류 0 확인

네 가지가 모두 성공한 뒤에만 다음을 수행한다.

- `/reports/CTO_REPORT.md` 자동 생성 또는 갱신
- `/reports/CTO_REQUEST.md` 자동 생성 또는 갱신

규칙:

- **CTO_REPORT는 프로젝트의 공식 기술 보고서이다.** 형식은 항상 동일하게
  유지한다. (형식 정의는 CTO_REPORT.md 상단 참조)
- CTO_REPORT에는 다음 4가지를 **반드시** 포함한다:
  **변경 사항 · 테스트 결과 · 아키텍처 변경 · 다음 권장 사항**
- CTO_REQUEST에는 아키텍트(CTO)의 결정이 필요한 질문·요청 사항을 기록한다.
- **모든 TASK는 CTO_REPORT가 생성/갱신되어야 완료된 것으로 간주한다.**

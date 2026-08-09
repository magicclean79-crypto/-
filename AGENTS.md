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

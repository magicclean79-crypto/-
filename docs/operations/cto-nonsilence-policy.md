# CTO 무응답 방지 정책 (T1-122)

> **문제**: CTO(ChatGPT)가 Claude/Bridge 작업을 실행시킨 뒤 "최종 결과가
> 나올 때까지" 사용자에게 아무 보고도 하지 않는 경우가 있었다.
>
> **이 문서가 하는 일**: 무엇을 언제 보고해야 하는지 규칙을 못박고, 그
> 규칙이 **이미 어떤 코드로 구현돼 있는지**(또는 구현 중인지) 정확히
> 가리킨다. 새 실행 엔진을 만들지 않는다 — 이미 있는 것을 흩어져 있던
> 자리에서 한 문서로 모은다(`docs/operations/reliability-expansion.md`와
> 같은 목적의 "안내" 문서).

## 0. 이 작업(T1-122)이 코드를 새로 만들지 않은 이유

이 작업을 시작한 시점(2026-08-13 10:25 UTC 전후), Bridge 상태를 실측하니
**같은 요청을 다루는 작업 두 건이 이미 실행 중**이었다.

| taskId | 제목 | 상태(확인 시점) |
| --- | --- | --- |
| T1-120 | CTO Worker 로그 D드라이브 전환 및 작업 상태 이력 보존 | IN_PROGRESS |
| T1-121 | CTO 자율 감시·개입 및 Claude 사용자 질문 차단 | IN_PROGRESS |

두 작업의 요청 원문(`bridge/tasks/T1-120.json`·`T1-121.json`)을 읽어보면
이 작업(T1-122)이 요구하는 것 — D: 영속 로그, 이상 감지 후 자율 조치,
사용자에게 판단을 묻지 않는 운영 원칙의 문서화 — 를 **거의 그대로**
다루고 있었다. 실제로 두 작업이 진행 중에 만든 신규 파일이 이미
워크트리에 있었다(`bridge/bridge-ops-log.mjs`(T1-120, D: 로그 writer),
`bridge/bridge-diagnostics.mjs`(T1-79, 이미 완료돼 있던 것) 등).

이 작업의 지시문 자체에 "T1-120 로그/상태 이력, T1-121 자율 감시 작업을
중복 실행하지 말고 실제 상태를 확인해 통합한다"는 조항이 있고, 이
저장소는 `bridge/` 전부를 사람 승인 없이 수정하지 못하게 막고 있다
(`AGENTS.md` "Bridge가 호출한 세션이 건드리면 안 되는 것"). 두 조건이
겹치면 결론은 하나다 — **`bridge/` 안에 새 코드를 더 쓰지 않는다.**
같은 워크트리에서 세 작업(T1-119·T1-120·T1-121)이 동시에 `bridge/`
파일을 고치는 중에 네 번째(T1-122)가 같은 파일을 또 고치면
`docs/PROJECT_MEMORY.md` M-28이 이미 경고한 사고(다른 세션의 실시간
수정과 충돌)가 재현된다 — 아래 §4가 그 사고가 **지금 이 순간 실제로
벌어지고 있다는 증거**를 남긴다.

그래서 이 작업의 산출물은 코드가 아니라 **①이미 있는 메커니즘을 이
요청의 12개 항목에 정확히 대응시키는 지도, ②실측으로 확인한 결함
보고**다.

## 1. 요청 12개 항목 → 실제 구현 위치

| # | 요청 | 구현 위치 | 상태 |
| --- | --- | --- | --- |
| 1 | 작업 시작 보고 | `bridge-events.mjs`(T1-41, 상태 전이 이벤트 큐) + `bridge-live-events.mjs`(T1-43, IN_PROGRESS 진입까지 포함하는 실시간 로그) | 기존 구현 |
| 2 | 정상 진행 중엔 불필요한 중간 보고 없음 | `bridge-events.mjs`의 `isNotableTransition` — heartbeat·TESTING 진입처럼 "지금 총괄이 할 일이 없는" 전이는 사용자 보고 큐에서 걸러진다 | 기존 구현 |
| 3 | heartbeat/output 정지·장시간 REQUESTED·장시간 TESTING·재실행 실패 감지 | `bridge-diagnostics.mjs`(T1-79) `diagnoseTask` — `STALLED`(heartbeat 정지)·`abandonedRun`(`bridge-executor.mjs:486` `ABANDON_LIMIT_MS = 5 * 60 * 1000`)·`MAX_RUN_ATTEMPTS` 초과 시 `BLOCKED` 승격 | 기존 구현 |
| 4 | 최종 완료 아니어도 상태/사실/조치/다음조치 보고 | `bridge-user-reports.mjs`(T1-51)가 Claude가 실제로 남긴 `rawResponse`·`blockedOn`을 원문 그대로 사용자 보고 큐에 투영 — 템플릿 요약이 아니라 실제 내용 | 기존 구현 |
| 5 | 정상 완료/실패 최종 보고, 장기 작업은 상태 변화마다 요약 | `bridge-events.mjs` + `bridge-user-reports.mjs` 조합, §4의 실측 사례(T1-116/T1-117 자동 SUPERSEDED)가 실제 동작 증거 | 기존 구현, 아래 §4 실측 |
| 6 | Claude Code가 사용자에게 판단을 요구하지 않음, CTO도 되묻지 않음 | `AGENTS.md` "Bridge가 부르는 세션은 무인으로 돈다 … 승인·확인·선택을 사람에게 묻지 않는다"(기존 문구) + `bridge-decisions.mjs`(T1-41, 선례 있는 BLOCKED 질문은 CTO가 재질문 없이 자동 재사용) + `bridge-cto-worker.mjs`(T1-44, `classifyBlocked`로 CTO가 스스로 풀 수 있는 결정만 자동 재개) | 기존 구현 |
| 7 | 확인되지 않은 내용을 성공으로 표현하지 않음 | `docs/PROJECT_MEMORY.md` M-27(판정을 명시값 `{ok:true|false}`로만 받음) — 이 작업의 결과 보고 형식 자체가 이미 이 규칙을 강제한다 | 기존 구현 |
| 8 | 최신 Task 우선/중복 금지, T1-83·T1-86 불가침 | `AGENTS.md` "지정 Task 실행 원칙" + `bridge-executor.mjs`의 `TASK_NOT_FOUND`/`PROJECT_MISMATCH`/`NOT_RUNNABLE` 명시적 거부(M-32) | 기존 구현, 이 작업도 준수(§0) |
| 9 | T1-118~T1-121 중복 실행 금지, 실제 상태 확인 후 통합 | 이 문서 §0·§4 | 이번에 수행 |
| 10 | taskId+제목·상태·마지막 heartbeat/output·이상 여부·CTO 조치·다음 조치를 담는 구조 | §2 — 이미 `bridge/results/<taskId>.json`에 존재하는 필드로 100% 구성 가능함을 확인 | 기존 구현, 이번에 스키마로 명문화 |
| 11 | D: 영속 상태/이벤트 기록, 재부팅 후에도 이어짐 | `bridge/bridge-ops-log.mjs`(T1-120, `D:\dev-data\logs\bridge\task-state.log`, 10MB 회전·백업 3개) | **T1-120이 구현 중** — 이 작업은 추가 구현하지 않는다(요청 11번 "중복 구현 금지") |
| 12 | fixture/mock으로 정상·장기 TESTING·REQUESTED 재대기·실패/로그중단 시나리오 검증 | `bridge-diagnostics.spec.mjs`·`bridge-events.spec.mjs`·`bridge-user-reports.spec.mjs`가 이미 이 네 시나리오를 순수 함수 단위로 검사한다 | **§4에 실행 결과와 발견한 결함을 남김** — 직접 고치지 않음(bridge/) |

## 2. 상태 보고 스키마 — 이미 있는 필드로 구성

요청 10번이 요구하는 최소 구조는 새로 설계할 필요가 없다.
`bridge/results/<taskId>.json`(모든 작업이 이미 이 파일을 쓴다)의
기존 필드를 그대로 조합하면 된다.

```
{
  "taskId":        "<taskId>",
  "title":         "<bridge/tasks/<taskId>.json 의 title>",
  "state":         "REQUESTED|IN_PROGRESS|TESTING|BLOCKED|DECISION_NEEDED|READY_FOR_REVIEW|COMPLETED|SUPERSEDED",
  "heartbeatAt":   "<마지막 심장박동, 30초 간격(HEARTBEAT_MS, bridge-executor.mjs:485)>",
  "lastOutputAt":  "<마지막 실제 출력 시각 — heartbeat와 별도(M-26)>",
  "anomaly": {
    "kind":  "STALLED|LONG_REQUESTED|LONG_TESTING|RETRY_EXHAUSTED|null",
    "since": "<이상이 시작된 시각>"
  },
  "ctoAction":     "<blockedOn 또는 supersededReason에 실제로 적힌 조치 원문>",
  "nextAutoAction":"<diagnose가 다음에 자동으로 할 일 — 대기열 복귀 / BLOCKED 승격 / 없음>"
}
```

`anomaly.kind`는 `bridge-diagnostics.mjs`의 `diagnoseTask` 판정
(`STALLED`·`abandonedRun`·재시도 상한 초과)을 그대로 옮긴 것이고,
`ctoAction`은 이미 `blockedOn`·`supersededReason` 필드에 자유 텍스트로
쌓이고 있다(§4의 실측 사례가 그 형태를 그대로 보여준다). **로그가
없으면 로그 부재 자체를 보고한다**는 요청 10번의 조건은 `heartbeatAt`·
`lastOutputAt`이 `null`인 경우를 그대로 보고하면 된다 — 값을 지어내지
않는다.

## 3. 이상 감지 기준값 (실측, 추측 아님)

| 기준 | 값 | 근거 |
| --- | --- | --- |
| heartbeat 간격 | 30초 | `bridge-executor.mjs:485` `HEARTBEAT_MS = 30 * 1000` |
| "버려진 실행" 판정 (STALLED) | heartbeat 5분 정지 | `bridge-executor.mjs:486` `ABANDON_LIMIT_MS = 5 * 60 * 1000` |
| 재시도 상한 | `MAX_RUN_ATTEMPTS`(코드 상수, `bridge-diagnostics.mjs` import) 초과 시 재큐잉 대신 BLOCKED 승격 | `bridge-diagnostics.mjs:53,156` |
| 사용자 보고 대상 전이 | 완료(READY_FOR_REVIEW·COMPLETED)·BLOCKED·DECISION_NEEDED·RESUMED만(IN_PROGRESS heartbeat·TESTING 진입은 제외) | `bridge-events.mjs` `isNotableTransition`(T1-41) |

## 4. 실측 — 이 작업을 실행하는 동안 실제로 관찰한 것

**추측이 아니라 이번 세션이 직접 실행/조회한 결과만 적는다.**

### 4-1. 자율 감시가 실시간으로 동작하는 것을 직접 목격했다

작업 시작 시점(10:25 UTC 전후) `node bridge/bridge-cli.mjs status`로 본
`T1-115`·`T1-116`·`T1-117`은 각각 `REQUESTED`(T1-115)·`IN_PROGRESS`
(T1-116, 이후 확인시 상태 오류로 멈춤)·`REQUESTED`(T1-117)였다. 같은
작업을 실행하는 도중(10:27 UTC 전후) 다시 `bridge/results/T1-116.json`·
`T1-117.json`을 읽으니 **둘 다 `SUPERSEDED`로 바뀌어 있었고**,
`supersededReason` 필드에 "왜 다시 실행하지 않고 통합 종료했는지"가
구체적으로(T1-118이 같은 요구사항을 이미 흡수해 완료했다는 근거,
동시 실행 중이던 5개 taskId의 프로세스 경합으로 heartbeat 기록이
지연돼 STALLED로 오판된 경위 등) 기록돼 있었다. **이것이 요청 6번·9번
("사용자에게 묻지 않고 CTO가 스스로 조사·조치")이 요구하는 동작이
실제로 일어나고 있다는 직접 증거다** — 이 작업이 새로 만든 것이
아니라, 기존 진단(T1-79)·통합 판단 로직이 이 세션이 지켜보는 동안
스스로 처리했다.

### 4-2. 지금 이 순간 `bridge/`를 건드리면 안 되는 이유의 실측 증거

`bridge-diagnostics.spec.mjs`·`bridge-events.spec.mjs`·
`bridge-user-reports.spec.mjs`를 각각 `node bridge/<파일>`로 직접
실행했다(읽기 전용 — 실행만 하고 어떤 `bridge/` 파일도 고치지
않았다). 셋 다 같은 오류로 실패했다.

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'...\bridge-ops-log.mjs' imported from '...\bridge-io.mjs'
```

원인을 코드로 확인했다 — 세 스펙 파일은 각자 `MODULES` 배열에 적힌
파일 목록만 임시 폴더(sandbox)로 복사해 그 안에서 격리 실행한다. 지금
`bridge-io.mjs`(다른 동시 작업이 진행 중인 파일)가 T1-120이 새로 만든
`bridge-ops-log.mjs`를 새로 import하도록 바뀌었는데, 세 스펙 파일의
`MODULES` 목록에는 아직 `bridge-ops-log.mjs`가 없다 — 그래서 sandbox
안에서 `bridge-io.mjs`가 자신의 새 의존 파일을 찾지 못해 즉시 죽는다.

**이것을 이 작업(T1-122)이 고치지 않았다.** 이유 두 가지다.

1. 세 스펙 파일 모두 `bridge/` 안에 있다 — 사람 승인 없이 수정
   금지 대상이다.
2. `MODULES` 목록에 새 파일을 추가하는 것은 그 파일을 만든 작업
   (T1-120)이 자신의 변경을 마무리하며 함께 해야 할 일이다 — 지금
   고치면 T1-120이 같은 파일을 다시 고칠 때 충돌한다(M-28).

**T1-120·T1-121이 `READY_FOR_REVIEW`로 올라가기 전에 반드시 확인해야
할 것**으로 이 문서에 남긴다: `node bridge/bridge-diagnostics.spec.mjs`·
`node bridge/bridge-events.spec.mjs`·`node bridge/bridge-user-reports.spec.mjs`
세 개가 다시 통과하는지(= `MODULES` 목록에 `bridge-ops-log.mjs`가
추가됐는지) 재확인 — 지금 이 상태로 완료 보고되면 검증 게이트가
실제로는 깨진 스펙을 통과로 오인할 위험이 있다.

## 5. 이번 작업(T1-122)이 실제로 한 일 — 요약

- `bridge/`·`AGENTS.md`(T1-121이 동시에 수정 중)를 포함해 **코드/기존
  문서를 수정하지 않았다** — §0의 이유.
- 요청 12개 항목을 기존 구현 위치에 1:1로 대응시켰다(§1).
- 이미 존재하는 필드만으로 요청 10번의 상태 보고 스키마를 명문화했다
  (§2, 새 컬럼·마이그레이션 없음).
- 이상 감지 기준값을 코드에서 직접 읽어 인용했다(§3).
- 자율 감시가 실제로 동작하는 순간을 실측했다(§4-1).
- `bridge/` 스펙 3개가 **지금 실제로 깨져 있다는 것**을 직접 실행해
  확인하고, 원인과 고쳐야 할 사람(T1-120)을 명시했다(§4-2) — "결과가
  없으니 아무 말도 하지 않는다"를 이 작업 스스로도 반복하지 않기
  위해서다.

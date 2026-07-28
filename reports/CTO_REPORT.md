# CTO_REPORT — AI Product Content OS 공식 기술 보고서

> 이 문서는 AGENTS.md의 TASK 완료 절차에 따라 모든 TASK 완료 시 갱신된다.
> 형식(섹션 구성)은 항상 동일하게 유지한다:
> 1. 보고 요약 → 2. 품질 게이트 → 3. **변경 사항** → 4. **테스트 결과**
> → 5. **아키텍처 변경**(+현황) → 6. 데이터 모델 → 7. API 표면
> → 8. 리스크·기술 부채 → 9. **다음 권장 사항**
> (굵은 항목 4가지는 AGENTS.md가 요구하는 필수 포함 항목)

---

## 1. 보고 요약

| 항목 | 값 |
| --- | --- |
| 보고 기준 TASK | **TASK-1003 — Routing Experiment & Traffic Control** (Sprint 10) |
| 보고일 | 2026-07-28 |
| 브랜치 | `claude/ai-product-content-os-setup-jb5oai` |
| 핵심 성과 | **feature 트래픽의 비율 분배**(Percentage·A/B·Canary·Weighted) + Experiment Dashboard + 변형별 비교 지표. **CTO 결정 1002-①·④ 이행** |
| 구현 중단 상태 | **TASK-1003 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 실험 표기법·종류 선언·고정 배정·배정 대 실행 → **CTO_REQUEST #40 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **439** — core 174(+15) · api 235(+11) · **web e2e 30(+4)** — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-1003 — Routing Experiment & Traffic Control

지시 5항목을 **하나의 가중 추첨 원리**로 구현했다. Percentage / A·B /
Canary / Weighted는 서로 다른 알고리즘이 아니라 **같은 메커니즘의 다른
사용법**이므로, 엔진을 하나로 두고 종류(kind)는 운영자가 **의도를 선언**하는
값으로 삼았다(대시보드 표시·검증에 사용). 네 가지를 각각 구현하면 같은 로직이
네 벌로 갈라져 유지보수만 늘어난다.

| 항목 | 설정 예 |
| --- | --- |
| **Percentage Routing** | `openai=90,anthropic=10` |
| **A/B Routing** | `ab-4o-vs-sonnet\|ab\|openai:gpt-4o=50,anthropic:claude-sonnet-5=50` |
| **Canary Routing** | `sonnet-canary\|canary\|openai=95,anthropic=5` |
| **Weighted Routing** | `openai=60,anthropic=30,gemini=10` |

- **형식**: `이름|종류|변형=가중치,…` — 이름·종류는 생략 가능하고, 생략 시
  변형 수와 가중치로 종류를 추정한다(2종·한쪽 10% 이하 = canary, 2종 = ab,
  3종 이상 = weighted). 변형은 라우팅과 같은 `provider` 또는 `provider:model`.
- **Dynamic**: 라우팅·Failover와 동일하게 **호출 시점마다 해석**한다.
- **Graceful degradation**: 쓸 수 없는 Provider의 변형은 제외하고 남은
  변형끼리 가중치를 **재정규화**한다. 전부 쓸 수 없으면 실험을 적용하지 않고
  기존 라우팅으로 내려간다 — 실험 설정이 호출을 실패시키지 않는다.
- **우선순위**: 호출자 `model` > **실험 변형** > 라우팅 규칙 > `LLM_MODEL_*`
  > Provider 기본. 실험이 걸린 feature는 추첨이 라우팅 결과를 대신한다.
- **Experiment Dashboard**: `GET /llm/experiments` + 웹 **`/experiments`** —
  종류 배지·적용 여부·설정 비율·배정 비율(재정규화)·실제 배정·변형별 실행 지표.
- **Experiment Metrics**: `GET /executions/stats`에 **`byVariant`** 추가 —
  변형(`feature→provider:model`)별 호출·성공률·지연·토큰·비용. 경로(`byRoute`)
  보다 한 단계 세밀해 **같은 Provider의 모델 변형까지** 비교된다.

**배정 ≠ 실행 (구현 중 확인된 상호작용)**: 배정은 추첨 결과(의도)이고 실제
실행은 Failover의 영향을 받는다. 변형이 불건강해지면 체인이 재정렬되어
배정된 변형 대신 건강한 Provider가 호출될 수 있다. 이는 가용성 우선 설계상
올바른 동작이므로, 감추지 않고 **대시보드에 배정과 실행을 나란히** 표시했다
— 두 값의 차이가 곧 그 변형의 실패 규모다.

### CTO 결정 1002-① 이행 — Failover 오류 분류 확정

승인과 함께 확정된 목록을 코드의 판정 규칙으로 옮겼다. 기존에는 "예산·검증이
아니면 전부 전환"이었으나, 이제 **분류된 4종만 전환**한다.

| 분류 | 판정 근거 | Failover |
| --- | --- | --- |
| `timeout` | `LlmTimeoutError` · HTTP 408 | **대상** |
| `server_error` | HTTP 5xx | **대상** |
| `rate_limit` | HTTP 429 · rate limit/overloaded 메시지 | **대상** |
| `network` | `ECONNRESET`·`ETIMEDOUT` 등 · socket hang up / fetch failed | **대상** |
| `budget` / `validation` / `auth`(401·403·잘못된 키) / `invalid_request` | 마커·예외형·상태 코드·메시지 | 제외 |
| `unknown` | 어느 것으로도 판정 불가 | **제외**(안전 측) |

판정은 상태 코드 → 오류 코드 → 메시지 순이며, SDK마다 다른 위치(`status` /
`statusCode` / `response.status`)를 모두 본다. 분류하지 못한 오류를 제외로 둔
것은 **잘못된 요청을 전 Provider에 반복하는 것보다 즉시 실패가 낫다**는
판단이다(#40 ①에 확인 요청). 제외 시 분류명을 로그에 남긴다.

### CTO 결정 1002-④ 이행 — Health 진단 호출 계측 분리

`GET /llm/health`는 이제 `attempts`/`failovers`/`exhausted`/`skipped`/
`byProvider`에 집계되지 않는다. 대신 `metrics.healthChecks`(ok/failed)로 따로
표시해 진단 활동 자체는 계속 보이게 했다. **Provider 건강 상태에는 그대로
반영**되므로 점검 결과가 Failover 체인 순서에 미치는 영향은 유지된다.

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 10 | **TASK-1003 — Routing Experiment & Traffic Control** | **완료 — 승인 대기** |
| Sprint 10 | TASK-1002 — Provider Failover Engine | 승인 (`b1c39bc`) |
| Sprint 10 | TASK-1001 — Cross-Provider Routing Engine | 승인 (`03dca0f`) |
| Sprint 9 | 0901~0903 실 Provider 연결·비용 거버넌스 | 전체 승인 · 공식 종료 |
| Sprint 1~8 | Foundation ~ 인증/보안 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 159 · **실험 엔진 11** · **오류 분류 4** | 174 | ✅ |
| `apps/api` | Service+API — 기존 224 · **실험 9** · **결정 ①④ 2** | 235 | ✅ |
| `apps/web` | Playwright e2e — 기존 26 · **Experiment Dashboard 4** | 30 | ✅ |
| **합계** | | **439** | **전체 통과** |

신규 테스트가 검증하는 것:
- **core(실험)**: 4종 표기법 파싱(최소형·이름/종류 지정·가중치 생략·불량 값
  선별 폐기) · 종류 추정 · **가중치 구간 배정**(경계값 포함) · 사용 불가 변형
  제외 후 재정규화 · 전부 불가 시 null · **1000회 결정적 스윕으로 분포가
  가중치와 정확히 일치**(900/100) · 표시용 해석(설정 비율 ↔ 실제 배정 비율)
- **core(분류)**: 대상 4종 8케이스(상태 코드·오류 코드·메시지 경로) · 제외
  5종 7케이스 · `unknown` 안전 제외 · `response.status` 인식
- **api**: Percentage 분배·배정 계측 · **A/B 변형별 모델이 호출·Execution에
  반영**(비교 지표 원천) · Canary 소수 분배 · Weighted 재정규화 · 실험 미설정
  시 기존 라우팅 · 전 변형 불가 시 라우팅 처리 · **실험 변형 실패 시 Failover
  체인 동작** · 호출자 모델 우선 · health는 실험 배정 없음
  / **인증 오류(401) 전환 안 함**(결정 ①) · **health 계측 분리**(결정 ④)
- **웹 e2e**: 종류 배지·설정/배정/실제 비율·변형별 실행 지표 · 미적용 실험의
  사유·사용 불가 배지 · 실험 없음 빈 상태 · API 오류 안내

라이브 검증 (실 PostgreSQL + 실스택, `LLM_EXPERIMENT_ANALYSIS=
sonnet-canary|canary|mock=80,openai=20`, `LLM_EXPERIMENT_CONTENT=gemini=50,
cohere=50`(전부 불가), openai는 무효 키):

- **Canary 실제 분배**: 분석 15회 실행 → 배정 mock 12 / openai 6(총 18 —
  실패 후 상위 계층 재시도 포함). 대시보드에 설정 80/20 ↔ 실제 66.7/33.3 표시
- **변형별 비교 지표**: `byVariant` 기준 mock 30회 **성공률 100%** vs
  openai 5회 **성공률 0%·37ms** — A/B 비교가 의도대로 성립
- **전 변형 불가 실험**: content-generation은 `미적용` + 사유 표시, 호출은
  기존 라우팅으로 정상 처리(실패 없음)
- **결정 ① 확인**: openai의 403은 **`auth`로 분류돼 Failover 미발생**
  (`failovers=0`, `skipped=3`) — 서버 로그에 분류명 기록
- **결정 ④ 확인**: health 3회(성공 2·실패 1) 후 `attempts` 18 → **18 그대로**,
  `byProvider` 불변, `healthChecks={ok:2,failed:1}`,
  openai `consecutiveFailures` 3 → **4로 증가**(건강 상태에는 반영)
- 브라우저 `/experiments` 렌더링 확인 (스크린샷 첨부)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 트래픽 분배 계층 추가**:

```
호출(feature) ─▶ LlmService (단일 관문)
                   ├─ 예산 검사 ─────────────▶ 초과 시 429 (전환 없음)
                   ├─ resolveRoute(1001)          ─▶ 기본 경로
                   ├─ pickVariant(1003, core)     ─▶ 실험이 있으면 경로를 대신함
                   │     가중 추첨 · 사용 불가 제외 후 재정규화 · 전부 불가면 미적용
                   ├─ buildFailoverChain(1002)    ─▶ 변형을 1순위로 하는 체인
                   └─ Execution 기록(feature, provider, model)
                        ├─▶ byRoute   (경로 지표)
                        └─▶ byVariant (변형 지표 — A/B 비교)
```

① 세 계층(라우팅·실험·Failover)이 **각각 core 순수 로직**으로 분리돼 조합
규칙이 단위 테스트로 고정된다. ② 세 계층 모두 **같은 단일 관문**에서 적용되고
같은 Execution에 기록되므로, 설정(무엇을 의도했나)과 실행(무엇이 일어났나)을
같은 데이터로 대조할 수 있다. ③ 모두 **환경변수 미설정 시 기존 동작**이
그대로 유지된다 — 계층이 늘어도 기본 경로는 변하지 않는다. ④ 오류 분류가
명시적 목록이 되면서 "재시도해도 소용없는 오류"가 코드로 구분됐다.

**유지되는 핵심 결정**: 단일 관문 · Code-first 설정 · 미설정 시 기존 동작 ·
잘림/예산 정책 · Anthropic JSON 방식(0903 승인 ①) · 운영 모델만 가격표
(0903 승인 ②) · Routing 단위 feature 3종(1001 승인 ①) · Failover 시 전환
Provider 기본 모델 사용(1002 승인 ②) · Health 기본값 3회/60초/half-open
(1002 승인 ③)

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 21건
(이번 TASK 스키마 변경 없음), drift 없음

## 6. 데이터 모델

변경 없음 — 실험 변형은 Execution의 기존 `feature`/`provider`/`model` 조합을
`byVariant`로 집계해 표현한다. 실험 설정·배정 계측은 인메모리다.

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 실험 | **`GET /llm/experiments`** — 종류·변형·가중치·적용 여부·실제 배정 |
| 지표 | `GET /executions/stats` — **`byVariant`** 추가 (`feature→provider:model`) |
| Failover | `GET /llm/failover` — `metrics.healthChecks` 추가 (진단 분리, 결정 ④) |
| 그 외 | 변경 없음 (호출 계약 동일 — 실험은 내부 동작) |

웹: **`/experiments`** (신설 — 홈 내비 "🧪 Experiment 현황")

## 8. 리스크·기술 부채

1. **1003 해석 미확인** — 실험 표기법·종류 선언 방식·고정 배정 필요 여부
   (CTO_REQUEST #40)
2. **무상태 배정** — 호출마다 독립 추첨이라 같은 사용자·프로젝트가 매번 다른
   변형을 받을 수 있다. 사용자 체감 일관성이 중요한 실험에는 고정 배정
   (sticky)이 필요하나, LLM 호출 계층에 주체 식별자가 없어 별도 스펙이 필요
3. **배정 계측은 인메모리·프로세스 단위** — 재기동 시 초기화되고 다중
   인스턴스 합산이 안 된다. 다만 **실행 지표(byVariant)는 DB 기반**이라
   품질·비용 비교 자체는 영속적이다
4. **통계적 유의성 판정 없음** — 대시보드는 원지표(성공률·지연·비용)만
   보여주고 "어느 변형이 유의하게 낫다"는 판단은 하지 않는다
5. **`unknown` 오류 제외 정책** — 분류하지 못한 오류는 전환하지 않는다.
   안전 측 선택이나, 미분류 일시적 오류의 가용성은 그만큼 손해다(#40 ①)
6. **실키 스모크(운영/스테이징)·Rate Limit 인메모리·건강 상태 인스턴스별
   학습** — 기존 부채 유지

## 9. 다음 권장 사항 (Sprint 10 후속 후보)

1. **CTO_REQUEST #40 확인** — TASK-1003 해석 확인 및 다음 지시
2. **고정 배정(sticky assignment)** — 프로젝트·사용자 단위로 변형을 고정해
   사용자 체감 일관성과 실험 신뢰도를 함께 확보
3. **실험 종료·승격 절차** — 승자 변형을 라우팅 기본으로 승격하는 운영 절차
   (현재는 환경변수 수동 변경)
4. **Provider 설정 ADMIN 화면** — 라우팅·우선순위·예산·실험의 화면 관리
   (현재 전부 환경변수 Code-first)
5. **운영/스테이징 실키 스모크** — 3사 각 1회 (0901 승인 ③ 정책)

# LLM Gateway Foundation (TASK-0501, Sprint 5 — AI Execution)

모든 LLM 호출이 통과하는 **단일 게이트웨이**입니다. Provider(OpenAI / Anthropic /
Google Gemini)는 환경변수 하나로 교체되며, **기본은 mock** — API 키가 없으면
실제 호출은 일어나지 않습니다.

```
호출 모듈 (향후: 콘텐츠 생성, 분석 …)
   └─▶ LlmService (api) ─▶ LlmGateway (@acos/core — 검증·재시도)
                               └─▶ LlmProvider (Port)
                                     ├── MockLlmProvider   (기본, @acos/core)
                                     ├── OpenAiLlmProvider    (openai SDK)
                                     ├── AnthropicLlmProvider (@anthropic-ai/sdk)
                                     └── GeminiLlmProvider    (@google/genai SDK)
```

## Provider 선택 (환경변수)

| 변수 | 값 | 비고 |
| --- | --- | --- |
| `LLM_PROVIDER` | `mock`(기본) · `openai` · `anthropic` · `gemini` | 키가 없으면 경고 후 mock으로 대체 |
| `OPENAI_API_KEY` / `LLM_OPENAI_MODEL` | — / 기본 `gpt-4o` | openai 선택 시 |
| `ANTHROPIC_API_KEY` / `LLM_ANTHROPIC_MODEL` | — / 기본 `claude-opus-5` | anthropic 선택 시 |
| `GEMINI_API_KEY` / `LLM_GEMINI_MODEL` | — / 기본 `gemini-2.5-flash` | gemini 선택 시 |
| `LLM_MAX_ATTEMPTS` | 기본 3 | 게이트웨이 재시도 횟수 (지수 백오프) |
| `LLM_CONTENT_MAX_TOKENS` | 기본 4096 | content-generation 출력 상한 (TASK-0901) |
| `LLM_ANALYSIS_MAX_TOKENS` | 기본 2048 | product-analysis 출력 상한 (TASK-0901) |
| `LLM_VISION_MAX_TOKENS` | 기본 2048 | vision-analysis 출력 상한 (TASK-0901) |

**Provider Factory (TASK-0903)**: Provider 선택은
`apps/api/src/llm/provider.factory.ts`가 담당한다 — Registry
(`LLM_PROVIDER_REGISTRY`, core) 기반 **테이블 드리븐** 생성으로, 키
환경변수는 Registry가 단일 정의하고 키가 없으면 경고 후 mock으로 대체한다.

새 Provider 추가는 **3곳**만 갱신하면 된다:
① Registry에 선언(core) ② `LlmProvider` 어댑터 구현 + Factory 테이블 1줄
③ 가격표(`DEFAULT_LLM_PRICING`)에 단가 등록 —
Registry의 모든 모델이 가격표에 있는지는 테스트가 보증한다.

## OpenAI Production (TASK-0901, Sprint 9)

실 OpenAI 연결로 운영하기 위한 확정 사항:

- **feature별 출력 상한**: 호출자가 maxTokens를 지정하지 않으면
  LlmService(단일 관문)가 feature 기본값을 채운다 — 어댑터 기본 1024는
  상세페이지 생성에서 잘림 위험이 있어 상향 (위 표). dev는 기본 유지
- **JSON 잘림 방어**: OpenAI 응답의 `finish_reason === "length"`이면서
  `responseFormat: "json"`이면 잘린 JSON 파싱 대신 **명확한 오류로 실패**
  시킨다 — Execution에 FAILED로 기록되어 원인 추적이 쉽다. 텍스트 출력은
  그대로 반환 (부분 결과 허용)
- **통합 검증**: 주입 클라이언트로 실 응답 형태(스냅샷 모델명·usage·
  finish_reason)를 재현해 3개 엔진 전 경로를 검증
  (`apps/api/src/llm/openai-production.spec.ts`). 실키 네트워크 검증은
  운영/스테이징 스모크(`docs/operations/real-provider-smoke.md`) 전용
- **비용**: Execution은 응답의 스냅샷 모델명(예: gpt-4o-2024-08-06)을
  기록하고, 가격표 최장 접두사 매칭으로 비용을 산정한다

## Cost Governance & Multi-Provider Foundation (TASK-0902, Sprint 9)

| 항목 | 동작 | 환경변수 (기본) |
| --- | --- | --- |
| **Daily/Monthly Budget** | Execution cost(USD) 합계를 UTC 일/월 예산과 비교. **초과 시 새 LLM 호출을 429로 차단**(호출 전 검사 — Execution 미기록). 미설정 = 무제한(검사 오버헤드 없음) | `LLM_DAILY_BUDGET_USD` / `LLM_MONTHLY_BUDGET_USD` (미설정) |
| **Cost Alert** | 예산의 80% 도달 시 경고 상태 — 상태 전이 시 서버 로그 + `/providers` 대시보드 배지 | `LLM_BUDGET_ALERT_RATIO` (0.8) |
| **Provider Registry** | Code-first 중앙 정의(`LLM_PROVIDER_REGISTRY`, core) — 연결 상태(official/adapter-ready/mock)·키 설정 여부·기본 모델. `GET /llm/providers` (키 값 비노출). **TASK-0903: openai·anthropic·gemini 3사 전부 `official`** | — |
| **Model Routing** | feature별 모델 지정 — 미지정 시 Provider 기본, 호출자 명시가 최우선. **같은 Provider일 때만 적용**(0902) | `LLM_MODEL_CONTENT` / `LLM_MODEL_ANALYSIS` / `LLM_MODEL_VISION` |
| **Provider Dashboard** | 웹 `/providers` — Registry·라우팅·예산 카드(진행 바/배지)·**Provider 비교**(호출·성공률·평균 지연·토큰·비용·비용/호출, TASK-0903). Playwright 3종 | — |

검사 지점은 LlmService 단일 관문(Execution 기록과 동일 지점) —
예산 로직은 core 순수 함수(`evaluateBudgetWindow`), 합산·차단은
`LlmBudgetService`(api). `GET /llm/budget`으로 현황 조회.

## Cross-Provider Routing Engine (TASK-1001, Sprint 10)

feature별로 **Provider 자체를 분리**한다 (0902의 "Provider 내부 모델 선택"
확장 — CTO 승인 ②의 후속 단계).

| 항목 | 동작 | 환경변수 |
| --- | --- | --- |
| **Feature별 Provider Mapping** | `provider` 또는 `provider:model` 값으로 feature → Provider 지정 | `LLM_ROUTE_CONTENT` / `LLM_ROUTE_ANALYSIS` / `LLM_ROUTE_VISION` |
| **Dynamic Routing** | **호출 시점마다 해석** — 환경 변경이 재기동 없이 다음 호출부터 반영 | — |
| **Graceful degradation** | 매핑된 Provider를 쓸 수 없으면(키 미설정) 기본 Provider로 내려가고 경고 로그 (`source: "fallback"`). 호출 실패 시 전환은 **Failover**가 담당 (TASK-1002) | — |
| **Routing Dashboard** | 웹 `/routing` — feature별 Provider·모델·결정 근거(feature/default/fallback)·환경변수명. `GET /llm/routing` | — |
| **Routing Metrics** | `GET /executions/stats`의 **`byRoute`** — 실제 실행된 경로(`feature→provider`)별 호출·성공률·지연·토큰·비용 | — |

**우선순위**: 호출자 `model` 명시 > 라우팅 규칙의 `:model` >
`LLM_MODEL_*`(같은 Provider일 때만) > Provider 기본 모델.
`dev` feature(개발용 `/llm/complete`·health)는 항상 기본 Provider.

**구조**: 해석은 core 순수 로직(`resolveRoute`/`buildRoutingTable`),
Provider 인스턴스는 `createLlmProviderMap()`(키가 설정된 것 전부),
선택·호출은 `LlmService`(Execution 기록과 동일 단일 관문).

## Provider Failover Engine (TASK-1002, Sprint 10)

라우팅으로 정해진 Provider가 **실행 중 실패**하면 우선순위에 따라 다음
Provider로 넘긴다 (1001의 설정 단계 Fallback과 구분 — CTO 결정 1001-②).

| 항목 | 동작 | 환경변수 |
| --- | --- | --- |
| **Provider Priority** | 넘어갈 Provider 순서. **미설정이면 Failover 비활성**(기존 동작 그대로) | `LLM_FAILOVER_PRIORITY` (예: `openai,anthropic,mock`) |
| **Retry Policy** | Provider별 게이트웨이 지수 백오프 재시도를 먼저 소진하고, 그래도 실패하면 다음 Provider로 전환 | `LLM_MAX_ATTEMPTS` (기본 3) |
| **Timeout Policy** | Provider 1회 호출 제한 시간. 초과 시 실패로 간주해 다음 Provider로 전환 | `LLM_TIMEOUT_MS` (기본 120000, `0`=무제한) |
| **Health Check Integration** | 연속 실패가 임계에 닿은 Provider는 쿨다운 동안 **체인 뒤로 밀린다**(제외가 아님 — 다른 후보가 모두 실패하면 여전히 시도). 쿨다운 경과 시 half-open으로 재시도하고 성공하면 즉시 회복 | `LLM_FAILOVER_HEALTH_THRESHOLD` (기본 3) · `LLM_FAILOVER_HEALTH_COOLDOWN_SEC` (기본 60) |
| **Failover Metrics** | `GET /llm/failover` — 우선순위·타임아웃·Provider 건강 상태·시도/전환/소진/제외 누계와 Provider별 성공·실패. 웹 `/routing` 하단에 표시 | — |

**오류 분류** (CTO 결정 1002-① 공식 표준):

| 분류 | 판정 근거 | Failover |
| --- | --- | --- |
| `timeout` | `LlmTimeoutError` · HTTP 408 | **대상** |
| `server_error` | HTTP 5xx | **대상** |
| `rate_limit` | HTTP 429 · rate limit/overloaded 메시지 | **대상** |
| `network` | `ECONNRESET`·`ETIMEDOUT` 등 · socket hang up / fetch failed | **대상** |
| `budget` | `markNoFailover()` 표시 (예산 초과 429) | 제외 |
| `validation` | `LlmValidationError` (요청 검증) | 제외 |
| `auth` | HTTP 401/403 · 잘못된 API Key 메시지 | 제외 |
| `invalid_request` | HTTP 4xx(400/404 등) · invalid request 메시지 | 제외 |
| `unknown` | 위 어느 것으로도 판정되지 않음 | 제외 (안전 측) |

판정은 상태 코드 → 오류 코드 → 메시지 순이며, SDK마다 다른 위치
(`status` / `statusCode` / `response.status`)를 모두 본다. 분류하지 못한
오류는 **제외**한다 — 잘못된 요청을 전 Provider에 반복하는 것보다 즉시
실패가 낫다. 제외된 오류는 계측의 `skipped`로 집계하고, 분류명을 로그에
남긴다. 예산 초과는 호출 전 검사이므로 Execution도 남지 않는다.

**체인 구성**: 라우팅이 정한 Provider가 항상 1순위, 그 뒤에
`LLM_FAILOVER_PRIORITY` 순서(중복 제거, 사용 불가 Provider 제외, 불건강
Provider는 뒤로). 2순위부터는 **호출자가 지정한 모델을 버리고** 각 Provider의
기본 모델로 호출한다 (모델명은 Provider 간 호환되지 않는다).

**관측**: 각 시도가 Execution 1건으로 남는다 — 실패한 1순위와 성공한 2순위가
모두 기록되므로 대시보드의 경로별 성공률이 실제 전환 이력을 보여준다.
`GET /llm/health?provider=`로 특정 Provider를 점검할 때는 **Failover를 쓰지
않고** 대상 Provider만 호출한다(진단 목적). 이 진단 호출은 **운영 계측에서
분리**되어 `attempts`/`failovers`/`exhausted`/`skipped`/`byProvider`에 들어가지
않고 `healthChecks`로 따로 집계된다 (CTO 결정 1002-④). 단, Provider 건강
상태에는 그대로 반영되어 체인 순서에 영향을 준다.

**이력 Provider 일치 (CTO 결정 1001-③)**: `AnalysisRun.provider`,
`VisionSummary.source` 등 이력 Provider 필드는 정적 기본값이 아니라
**실제 라우팅·Failover로 호출된 Provider**를 기록한다 (`llm:<provider>`) —
Execution의 `provider`와 같은 의미를 갖는다.

## Routing Experiment & Traffic Control (TASK-1003, Sprint 10)

라우팅이 feature → Provider **하나**를 정한다면, Experiment는 같은 feature의
트래픽을 **여러 변형에 비율로 나눈다**. Percentage / A·B / Canary / Weighted는
모두 "가중치 있는 변형 집합"이라는 **하나의 원리**로 동작하며, 종류(kind)는
운영자가 **의도를 선언**하는 값이다(대시보드 표시용 — 선택 알고리즘은 동일).

| 항목 | 동작 | 환경변수 |
| --- | --- | --- |
| **Percentage Routing** | 가중치 비율로 분배 (`openai=90,anthropic=10`) | `LLM_EXPERIMENT_CONTENT` / `LLM_EXPERIMENT_ANALYSIS` / `LLM_EXPERIMENT_VISION` |
| **A/B Routing** | 두 변형을 나눠 품질·비용 비교 (`ab\|openai:gpt-4o=50,anthropic:claude-sonnet-5=50`) | 〃 |
| **Canary Routing** | 새 변형에 소량만 (`canary\|openai=95,anthropic=5`) | 〃 |
| **Weighted Routing** | 3종 이상 가중 분배 (`openai=60,anthropic=30,gemini=10`) | 〃 |
| **Experiment Dashboard** | 웹 **`/experiments`** — 설정 비율·배정 비율·실제 배정·변형별 실행 지표. `GET /llm/experiments` | — |
| **Experiment Metrics** | `GET /executions/stats`의 **`byVariant`** — 변형(`feature→provider:model`)별 호출·성공률·지연·토큰·비용 | — |

**형식**: `이름|종류|변형=가중치,변형=가중치` (이름·종류 생략 가능, 가중치
생략 시 균등). 변형은 라우팅과 같은 `provider` 또는 `provider:model`.
종류를 생략하면 변형 수와 가중치로 추정한다(2종·한쪽 10% 이하 = canary,
2종 = ab, 3종 이상 = weighted).

**우선순위**: 호출자 `model` 명시 > **실험 변형** > 라우팅 규칙 `:model` >
`LLM_MODEL_*` > Provider 기본. 실험이 설정된 feature는 변형 추첨이 라우팅
결과를 **대신한다**.

**Graceful degradation**: 쓸 수 없는 Provider의 변형은 제외하고 남은 변형끼리
가중치를 **재정규화**한다. 전부 쓸 수 없으면 실험을 적용하지 않고 기존
라우팅으로 내려간다 — 실험 설정이 호출을 실패시키지 않는다.

**배정 ≠ 실행**: 배정은 추첨 결과(의도)이고, 실제 실행은 Failover의 영향을
받는다. 변형이 불건강해지면 체인이 재정렬되어 배정된 변형 대신 건강한
Provider가 호출될 수 있다. 대시보드는 **배정(추첨)** 과 **실행(Execution)** 을
나란히 보여주며, 두 값의 차이가 곧 그 변형의 실패 규모다.

**배정 계층** (TASK-1101에서 확장): `projectId`가 전달되면 **Project 기반
Sticky 배정**, 없으면 기존 무상태 추첨.

## Sticky Assignment & Experiment Lifecycle (TASK-1101, Sprint 11)

실험 **정의**(변형·가중치)는 환경변수가 원천이고(CTO 결정 1003-② 표기법
확정), 여기서 더하는 것은 **누가 어떤 변형을 받는지**와 **실험의 운영 상태**다.

### Project 기반 Sticky Assignment

같은 프로젝트는 항상 같은 변형을 받는다. 배정은 저장소가 아니라
**결정적 해시**로 정해진다:

```
변형 = 가중추첨(변형목록, random = hash(정의서명 + projectId))
```

- 해시는 FNV-1a + **fmix32 최종 혼합**이다. FNV만 쓰면 `proj-1`,`proj-2`처럼
  **연속적인 키가 뭉쳐** 배정이 한쪽으로 쏠린다(순번 ID 환경에서 실제로 발생).
- 저장소(`experiment_assignments`)가 비어 있어도, 재기동해도, 여러 인스턴스
  에서도 **같은 프로젝트는 같은 변형**을 받는다. 저장은 관측·감사용이며
  저장 실패가 호출을 실패시키지 않는다.
- **정의 서명**(`변형=가중치` 목록)이 바뀌면 기존 배정은 무효가 되어 다시
  배정된다. 이름·종류만 바꾸면 서명은 그대로다(표시용 메타데이터 —
  CTO 결정 1003-③).
- `projectId`는 Content Generation·Product Analysis·Vision Analysis 호출
  경로에서 전달된다. 없으면(개발용 호출 등) 기존 무상태 추첨.

### Lifecycle — Start / Stop / Promote / Rollback

| 상태 | 동작 |
| --- | --- |
| **RUNNING** (기본) | 변형 배정 진행. 행이 없으면 이 상태로 본다 (TASK-1003 동작 보존 — 실험을 켜려고 별도 조작이 필요 없다) |
| **STOPPED** | 실험을 적용하지 않고 **기존 라우팅**으로 처리. 배정 기록은 보존 |
| **PROMOTED** | 배정 없이 **승자 변형으로 전 트래픽**. 승자가 현재 정의에 없거나 Provider를 쓸 수 없으면 라우팅으로 내려간다 |

- **Promote**는 승자 변형이 **현재 정의에 있어야** 한다 (없으면 400).
- **Rollback**은 직전 전이의 **이전 상태**로 되돌린다(이력이 없으면 RUNNING).
  ROLLBACK 자체는 되돌리기 대상에서 제외해 무한 왕복을 막는다.
- 상태 갱신과 이력 기록은 **한 트랜잭션** — 감사 이력이 상태와 어긋나지 않는다.
- **권한** (CTO 결정 1101-④): **Start·Stop = EDITOR 이상**,
  **Promote·Rollback = ADMIN 전용**. 승격·되돌리기는 트래픽 100%의 목적지를
  바꾸는 조작이라 등급을 올렸다. 수행자(actor)는 이력에 남는다.

### 재배정 감사 (CTO 결정 1101-⑤)

실험 정의가 바뀌어 고정 배정이 다시 정해지면 `experiment_assignment_events`에
이력을 남긴다 — 어느 프로젝트가 어떤 변형에서 어떤 변형으로, 무슨 사유로
(`DEFINITION_CHANGED` / `VARIANT_UNAVAILABLE`) 옮겨졌는지. 배정이 조용히
흔들리지 않게 하려는 것이며, Assignment Dashboard에 함께 표시된다.

### Assignment Dashboard

웹 `/experiments` — 실험 카드에 상태 배지·조작 버튼(시작/중단/되돌리기/변형별
승격)·상태 변경 이력이 붙고, 하단에 **프로젝트별 배정 표**가 나온다.
`GET /llm/experiments/assignments`(`?feature=`로 좁힘)가 원천이다.

**배정과 실행은 별개다** (CTO 결정 1003-④): Assignment는 실험이 정한 결과,
Execution은 실제 수행 결과다. 변형이 실패하거나 불건강해지면 Failover가
개입해 둘이 달라질 수 있으므로 대시보드는 둘을 **나란히** 유지한다.

## Experiment Analytics & Recommendation (TASK-1102, Sprint 11)

"어느 변형이 나은가"를 **판단 근거와 함께** 제시한다. 승격 자체는 운영자의
수동 절차이므로(CTO 결정 1101-③), 분석은 결정을 대신하지 않고 근거를 만든다.

`GET /llm/experiments/:feature/analytics` — 변형별 성과·비교·추천.

### Variant Performance Summary

변형별 호출·성공/실패·성공률·평균 지연·비용·호출당 비용·토큰.
성공률에는 **Wilson 95% 신뢰구간**을 함께 준다 — "3/3 성공 = 100%"처럼
적은 표본을 과신해 표시하지 않기 위해서다.

**근거는 배정이 아니라 실행(Execution)** 이다 (CTO 결정 1003-④). 지연은
호출 수로 **가중 평균**한다(그룹 평균을 단순 평균하면 왜곡된다).

**관측 기간**은 **정의 서명이 마지막으로 바뀐 시각** 이후다 (CTO 결정 1102-③) —
START/STOP은 기간을 이어간다. 잠시 멈췄다 재개했다고 그동안 모은 근거를
버릴 이유가 없고, 변형 구성이 바뀌면 이전 이력은 비교 대상이 아니기 때문이다.

### Success Rate / Latency / Cost Comparison

가중치가 가장 큰 변형을 **기준(baseline)** 으로 삼아 나머지를 비교한다:
성공률 차이(%p), 지연 차이(ms), 호출당 비용 차이(USD), 그리고 성공률 차이가
우연이 아닐 **신뢰도**(양측 2-비율 z검정).

### Winner Recommendation & Confidence Score

| 순서 | 판단 |
| --- | --- |
| 0 | **모든 변형이 최소 표본(기본 30회, `LLM_EXPERIMENT_MIN_SAMPLES`)** 을 채워야 한다 — 아니면 추천하지 않는다 |
| 1 | 성공률 1·2위 차이의 신뢰도가 **95% 이상**이면 1위가 승자 (`success-rate`, 확정) |
| 2 | 성공률이 통계적으로 구분되지 않으면 **호출당 비용**이 싼 쪽 (`cost`, 참고) |
| 3 | 비용도 같으면 **평균 지연**이 짧은 쪽 (`latency`, 참고) |
| 4 | 어느 축에서도 차이가 없으면 **추천 보류** |

**품질 우선**이다 — 비용이 싸도 실패하는 변형은 이기지 못한다. 성공률로
결정된 추천만 `conclusive: true`(통계적 확정)이고, 비용·지연 근거는 참고로
표시한다. 모든 추천에 신뢰도(0~1)와 **사람이 읽는 근거 문장**이 붙는다.

통계 함수는 core 순수 로직이다 — `normalCdf`(erf 근사),
`wilsonInterval`, `proportionConfidence`.

## 구조

- **Port (`packages/core/src/llm/`)** — 프레임워크 무관
  - `LlmProvider`: `name` · `defaultModel` · `complete(request)`
  - `LlmRequest`: `messages`(system/user/assistant) · `model?` · `maxTokens?` ·
    `responseFormat?`("text" 기본 | "json" — 구조화 출력 요구, TASK-0504) ·
    `images?`(`{ mimeType, base64 }[]` — 멀티모달 첨부, TASK-0505.
    검증: mimeType은 "image/*", base64 비어 있지 않음)
  - `LlmResult`: `provider` · `model` · `text` · `usage`(input/outputTokens) · `raw`
  - `LlmGateway`: 요청 검증(빈 메시지·role·공백 content·maxTokens) +
    지수 백오프 재시도 — OcrExecutionService와 같은 결
  - `MockLlmProvider`: 결정적 응답(마지막 user 메시지 반영), 추정 usage.
    `responseFormat: "json"`이면 프롬프트의 마지막 ```json 블록(템플릿이 넣은
    초안)을 그대로 반환 — 구조화 파이프라인의 오프라인 검증용 (TASK-0504).
    첨부 이미지는 해석하지 않고 개수만 raw.imageCount에 기록 (TASK-0505)
- **어댑터 (`apps/api/src/llm/providers/`)** — 공식 SDK 사용, **3사 전부 공식 연결**
  - **OpenAI (TASK-0603 · Production 0901)**: chat.completions —
    `responseFormat "json"` → `response_format { type: "json_object" }` 매핑
    (프롬프트 지침과 이중 강제), 멀티모달 image_url, gpt-4o 계열 단가 등록
  - **Anthropic (TASK-0903 공식 연결)**: messages — system은 별도 파라미터,
    `responseFormat "json"` → **JSON 전용 system 지시 강화**로 매핑
    (Claude 4.6+는 assistant prefill이 400이므로 prefill 미사용 — 지시 +
    엄격 파싱·재시도가 공식 매핑), 멀티모달 `image` content block(base64),
    claude-opus-5/sonnet-5/haiku-4.5 단가 등록
  - **Gemini (TASK-0903 공식 연결)**: generateContent —
    systemInstruction/contents 분리, assistant → model role 매핑,
    `responseFormat "json"` → **`responseMimeType: "application/json"`**
    (Gemini 공식 JSON 모드), 멀티모달 `inlineData` part, 응답
    `modelVersion`(스냅샷) 기록으로 접두사 매칭 비용, gemini-2.5-flash 단가 등록
  - **이미지 매핑 (TASK-0505)**: `images`는 마지막 user 메시지에 Provider별
    형식으로 첨부된다 (위 3종)
  - **잘림 방어 (TASK-0901 정책 · 0903 3사 통일)**: 응답이 출력 한도에서
    잘렸고(`finish_reason=length` / `stop_reason=max_tokens` /
    `finishReason=MAX_TOKENS`) responseFormat이 json이면 **명확한 오류로 실패**
    → Execution FAILED. 텍스트 출력은 부분 결과 허용
  - **테스트용 클라이언트 주입**: 3사 어댑터 모두 지원 — 실 응답 형태를
    재현한 통합 검증(`multi-provider-production.spec.ts` 등)

## Health Check (TASK-0603)

`GET /llm/health` — 실제 최소 완성 호출("ping", maxTokens 16)로 키·네트워크·
모델 접근을 확인한다. 성공 시 `{ status: "ok", latencyMs }`, 실패 시 예외
대신 `{ status: "error", error }` 반환. 이 호출도 Execution(feature "dev")으로
기록되므로 실패 이력이 대시보드에 남는다.

## API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/llm` | 선택된 Provider 확인 — `{ provider, defaultModel }` |
| `GET` | `/llm/health` | **Provider 상태 점검 (TASK-0603)** — 최소 실호출 기반. `?provider=`로 특정 Provider 점검 (TASK-1002, Failover 미사용) |
| `GET` | `/llm/routing` | **Routing 현황 (TASK-1001)** — feature별 Provider·모델·결정 근거 |
| `GET` | `/llm/failover` | **Failover 현황 (TASK-1002)** — 우선순위·타임아웃·Provider 건강 상태·계측 |
| `GET` | `/llm/experiments` | **Experiment 현황 (TASK-1003)** — 실험 종류·변형·가중치·실제 배정 + 운영 상태(1101) |
| `GET` | `/llm/experiments/assignments` | **Assignment Dashboard (TASK-1101)** — Project별 Sticky 배정·변형 분포 |
| `POST` | `/llm/experiments/:feature/start` · `/stop` | **Lifecycle (TASK-1101)** — EDITOR 이상 |
| `POST` | `/llm/experiments/:feature/promote` · `/rollback` | **Lifecycle (TASK-1101)** — **ADMIN 전용**(결정 1101-④), promote는 `variantKey` 필요 |
| `GET` | `/llm/experiments/:feature/analytics` | **Analytics (TASK-1102)** — 변형 성과·비교·승자 추천·신뢰도 |
| `POST` | `/llm/complete` | `{ messages, model?, maxTokens? }` → `{ provider, model, text, usage }` (200) |

오류: `400` 빈 메시지·잘못된 role·공백 content·잘못된 maxTokens.

사용 예:

```json
POST /llm/complete
{
  "messages": [
    { "role": "system", "content": "너는 상품 카피라이터다." },
    { "role": "user", "content": "PVC 매트 상세페이지 도입부를 써줘." }
  ]
}
→ { "provider": "mock", "model": "mock-llm-1", "text": "[mock-llm] …", "usage": { … } }
```

## 원칙·경계

- **mock 기본**: 키 미설정 환경(테스트·CI 포함)에서 실제 API 호출이 절대
  일어나지 않는다. 실제 Provider는 `LLM_PROVIDER` + 해당 API 키를 모두
  설정했을 때만 활성화된다.
- **호출 관측 (TASK-0601)**: 모든 호출은 호출 1건당 **Execution 1건**
  (feature/provider/model/token/cost/latency/status)으로 기록된다 —
  [execution.md](execution.md). 요청/응답 본문은 저장하지 않는다.
- **소비 계층 연결 완료**: Content Generation(0502)·Analysis(0504)·
  Vision(0505)·구 Generator 경로(0506)가 전부 LLM Gateway를 사용한다.


## Provider Administration Console (TASK-1201, Sprint 12)

라우팅·예산·실험을 **운영 중에** 조정하는 ADMIN 콘솔이다. 설정 원칙은 그대로
**Code-first(환경변수)** 이고, 콘솔은 그 위에 얹는 **오버라이드**다:

```
유효값 = 오버라이드(DB) ?? 환경변수 ?? 기본값
```

오버라이드가 하나도 없으면 **기존 동작과 완전히 같다**. 값을 해제하면
환경변수로 되돌아가고, 화면은 각 값의 **출처(콘솔/환경변수/기본값)** 와
"해제하면 무엇으로 돌아가는지"를 함께 보여준다.

| 영역 | 설정 키 | 동작 |
| --- | --- | --- |
| **Provider Enable/Disable** | `provider.<name>.enabled` | 끄면 라우팅·실험·Failover 후보에서 빠진다. **마지막 하나는 끌 수 없다**(호출 전멸 방지) |
| **Model Management** | `model.<feature>` | feature별 모델 지정 — `LLM_MODEL_*`보다 우선 |
| **Budget Management** | `budget.daily` · `budget.monthly` · `budget.alertRatio` | 일/월 예산과 경고 임계 — `LLM_*_BUDGET_USD`보다 우선 |
| **Experiment Management** | `experiment.<feature>` | 실험 정의(`이름\|종류\|변형=가중치,…`) — `LLM_EXPERIMENT_*`보다 우선 |
| **Audit Log** | — | 모든 변경을 누가·무엇을·어떤 값에서 어떤 값으로 기록 |

**검증은 저장 시점에** 한다 — 잘못된 값이 들어가면 다음 호출부터 라우팅이
깨지므로, 알 수 없는 Provider·음수 예산·해석 불가한 실험 정의·지원하지 않는
키는 400으로 막는다.

**읽기 성능**: 설정은 LLM 호출마다 참조되므로 DB 왕복을 넣지 않는다. 기동 시
전부 인메모리로 적재하고, 쓰기 때 즉시 갱신하며, TTL(`ADMIN_SETTINGS_TTL_MS`,
기본 10초)이 지나면 **백그라운드로** 다시 읽는다. 다중 인스턴스에서는 다른
인스턴스의 변경이 최대 TTL만큼 늦게 보인다.

**권한**: 전부 **ADMIN 전용**이다. 전역 WriteProtectionGuard는 쓰기만 막으므로
**조회에도 AuthGuard를 건다** — 콘솔의 GET은 예산·모델 구성과 감사 이력
(수행자 이메일)을 노출하기 때문에 일반 조회 API의 비보호 정책을 그대로 둘 수
없다 (`/llm/health`와 같은 이유).

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/admin/console` | Provider·모델·예산·실험 현황 + 각 값의 출처 |
| `PUT` | `/admin/settings/:key` | 설정 변경 (`{value: null}`이면 해제 = 환경변수 복귀) |
| `GET` | `/admin/audit` | 변경 이력 (최신순) |

웹: **`/admin/console`** (신설 — 홈 내비 "⚙️ Provider 관리 콘솔")

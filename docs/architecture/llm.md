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
| `GET` | `/llm/providers/validate` | **API Key 검증 (TASK-1301)** — **ADMIN 전용**. `?live=1`이면 Provider마다 실호출 1회(과금) |
| `GET` | `/llm/cost-verification` | **비용 검증 (TASK-1301)** — **ADMIN 전용**. `?hours=`(기본 24, 1~720) |
| `GET` | `/llm/monitoring` | **운영 모니터링 (TASK-1301)** — **ADMIN 전용**. `?minutes=`(기본 60, 1~10080) |
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


## Real AI Provider Production Integration (TASK-1301, Sprint 13)

실 Provider로 **실제 돈이 나가는 운영**을 시작할 때 필요한 확인을 한곳에 모은
것이다. 웹 화면은 **`/admin/production`**(ADMIN 전용).

### API Key Validation

`GET /llm/providers/validate` — Provider별로 네 가지를 본다.

| 항목 | 의미 |
| --- | --- |
| `format` | `ok` / `missing` / `invalid` / `placeholder` — **형식만** 본다 |
| `required` | 설정(`LLM_PROVIDER`·`LLM_ROUTE_*`·`LLM_FAILOVER_PRIORITY`·`LLM_EXPERIMENT_*`)에서 이 Provider를 참조하는가 |
| `instantiated` | 어댑터가 실제로 만들어졌는가 (키가 있어야 만들어진다) |
| `live` | Live Check 결과 — `?live=1`일 때만 |

**키 값은 어떤 경로로도 나가지 않는다** — 앞 6자 힌트(`sk-pro…`)와 길이만
내보낸다. 형식 규칙은 `packages/core/src/llm/api-key.ts`에 한 곳으로 선언한다
(openai `sk-` / anthropic `sk-ant-` / gemini 길이만, 공통 20자 이상).

**플레이스홀더 탐지**가 별도 상태인 이유: `sk-xxxx…`·`your-api-key`·
`changeme` 같은 값은 형식 검사만 하면 통과해 버리는데, 배포 사고의 단골이다.

**Live Check는 기본으로 하지 않는다** — 실제 API를 호출해 과금되기 때문에
눌러야만 실행하고, 응답의 `liveChecked`로 실행 여부를 명시한다. 형식이 맞아도
유효한 키라는 보장은 없고, 메시지에 그렇게 적는다.

**CTO 결정 1202-② 이행**: 참조하는 Provider의 키는 **운영 필수**다.
`packages/core/src/ops/env-spec.ts`의 세 Provider 키 항목에 조건부 필수
(`requiredWhen`)와 형식 검사(`validate`)를 걸었으므로, 배포 준비 검증
(`/health/ready`)과 Fail Fast 기동에도 그대로 반영된다 — 참조하는데 키가 없으면
운영에서 서버가 뜨지 않는다. 쓰지 않는 Provider의 키는 없어도 된다.

### Cost Verification

`GET /llm/cost-verification` — 기록된 Execution 비용을 가격표로 **다시
계산해** 대조한다.

| 문제 | 뜻 | 조치 |
| --- | --- | --- |
| `unpriced` | 가격표에 없는 모델 | **예산 상한이 무력화된다** — `DEFAULT_LLM_PRICING`에 단가 등록 |
| `mismatch` | 기록 비용 ≠ 재계산 | 단가 변동 또는 기록 시점 가격표 차이 확인 |
| `missing-usage` | 토큰이 없어 산정 불가 | Provider 응답의 usage 확인 |

`unpriced`를 가장 크게 다루는 이유: 비용이 `null`로 남으면 예산 합계에서
빠지고, 그러면 **일/월 예산 상한이 조용히 무력화된다**. 응답에 가격표를 함께
실어 보내 화면에서 바로 조치할 수 있게 한다.

### Production Monitoring

`GET /llm/monitoring` — 관측 창 안의 Execution으로 Provider별 성공률·지연
분포·비용을 낸다.

- **표본이 적으면 판정하지 않는다** — 기본 5회 미만이면 `unknown`. 1회 실패로
  "장애"라고 말하지 않는다(실험 분석의 최소 표본 원칙과 같은 태도).
- **p50/p95/p99**를 함께 낸다 — 평균만 보면 꼬리 지연을 놓친다. 백분위수는
  **최근접 순위**(보간 없음)라 관측되지 않은 값을 지어내지 않는다.
- 상태: `healthy`(≥95%) / `degraded`(≥50%) / `down`(<50%) / `unknown`.
  전체 상태는 **가장 나쁜 Provider**를 따른다.
- 경보: 성공률 저하 / p95 지연 초과 / **성공했는데 비용이 없는 호출**
  (= 예산 상한 무력화).
- 실패 호출의 `cost=null`은 미산정으로 세지 않는다 — 실패는 usage가 없는 게
  정상이라 그러지 않으면 경보가 늘 울린다.
- 진단 호출(Health Check·Live Check)은 관측에서 **제외**된다
  (TASK-1302, CTO 결정 1301-③) — Provider를 실제로 호출하긴 하지만 사용자
  트래픽이 아니라서 성공률·지연 분포에 섞이면 판정이 왜곡된다. feature를 새로
  만들지 않고 `executions.diagnostic` 메타데이터로 구분하며, 제외된 수는
  `diagnosticCalls`로 함께 보여 준다(숨기지 않는다).
- 판정 기준은 환경변수로 조정할 수 있다 (CTO 결정 1301-②의 확정 기본값이
  미설정 시 그대로 쓰인다):

| 환경변수 | 기본값 | 뜻 |
| --- | --- | --- |
| `LLM_MONITOR_HEALTHY_RATE` | `0.95` | 정상 판정 성공률 하한 |
| `LLM_MONITOR_DEGRADED_RATE` | `0.5` | 저하 하한 — 이보다 낮으면 장애 |
| `LLM_MONITOR_MIN_SAMPLES` | `5` | 판정에 필요한 최소 호출 수 |
| `LLM_MONITOR_P95_WARN_MS` | `20000` | p95 지연 경고 기준 |

  해석할 수 없는 값이나 **순서가 뒤집힌 기준**(degraded > healthy)은 기본값으로
  되돌린다 — 이상한 기준으로 조용히 판정하지 않기 위해서다.

### Vision Production

Vision은 Provider마다 **이미지 전달 형식이 전부 다르다**.

| Provider | 형식 |
| --- | --- |
| OpenAI | `image_url` content part (data URL) |
| Anthropic | `image` content block (base64 + media_type) |
| Gemini | `inlineData` part (mimeType + data) |

하나만 맞고 나머지가 틀리면, 라우팅·Failover로 Provider가 바뀌는 순간 이미지가
조용히 사라지고 **"이미지 없이 추측한 결과"가 정상처럼 기록된다**. 그래서 세
Provider 전부에 같은 시나리오를 돌리는 회귀 테스트를 둔다
(`apps/api/src/llm/vision-production.spec.ts`).

### Provider Smoke Test

`scripts/real-provider-smoke.mjs`에 추가된 것:

- API Key 검증 (형식 + `SMOKE_LIVE_CHECK=1`이면 Live Check)
- **키가 설정된 모든 Provider**의 Health Check — 기본 하나만 확인하면 라우팅·
  Failover로 전환되는 순간에야 장애를 처음 알게 된다
- Vision(`vision-analysis`) 커버리지 필수화
- 비용 검증·운영 모니터링 판정 (critical 경보가 있으면 실패)

ADMIN 권한이 없어 건너뛴 항목은 `…`로 표시하고 **실패로 세지 않는다** —
확인하지 못한 것을 통과라고 하지 않기 위해서다.


## Production Automation & Alerting (TASK-1302, Sprint 13)

TASK-1301이 만든 점검들은 **사람이 화면을 열어야** 결과를 볼 수 있었다.
이 TASK는 그것을 주기적으로 돌리고, 문제가 생기면 **사람을 찾아가게** 한다.

### Scheduled Checks

| 점검 | 보는 것 | 책임지는 경보 | 기본 간격 |
| --- | --- | --- | --- |
| `cost-verification` | 비용 대조 + 예산 현황 | 예산 · 미산정 모델 | 15분 |
| `provider-validation` | 환경 검증 + Provider 키 | 설정 | 15분 |
| `health-check` | 운영 모니터링 | Provider 장애 | 1시간 |

- 간격은 `OPS_CHECK_COST_INTERVAL` 등으로 조정한다. `15m`·`1h`·`30s`·밀리초를
  모두 받고, 해석할 수 없으면 기본값으로 돈다 — 잘못 적은 값 때문에 점검이
  멈추거나 폭주하는 것보다 안전하다. `off`로 개별 중단, `OPS_SCHEDULED_CHECKS=off`로
  전체 중단.
- **점검마다 책임지는 경보 종류를 나눈다.** 해소 판정은 "이번에 감지되지
  않았다"로 하는데, 비용 점검이 돌 때 Provider 경보까지 해소해 버리면 실제로는
  죽어 있는 Provider가 조용히 사라진다.
- **Live Check는 하지 않는다** (CTO 결정 1301-①) — 예약 점검이 실 키를 자동으로
  호출하면 과금이 사람 모르게 발생한다. `health-check` 점검은 이미 쌓인
  Execution을 읽을 뿐 새 호출을 만들지 않는다.
- 점검은 **겹쳐 돌지 않는다**(이전 실행이 안 끝났으면 건너뜀). 타이머는
  `unref()`라서 프로세스 종료를 붙잡지 않는다.
- 점검 **자체가 실패한 것도 이력에 남긴다** — 조용히 안 도는 점검이 가장 위험하다.

### Alerts

| 종류 | 언제 | 심각도 |
| --- | --- | --- |
| `budget` | 경고 임계 도달 / 예산 초과 | warning / critical |
| `provider-failure` | 성공률 저하 / 사실상 중단 | warning / critical |
| `unpriced-model` | 가격표에 없는 모델 호출 | warning |
| `configuration` | 환경 오류 · Provider 키 문제 | critical |

- **같은 문제는 한 번만 알린다.** `key`가 같으면 같은 경보로 보고, 쿨다운
  (`ALERT_COOLDOWN_MS`, 기본 30분) 안에서는 다시 알리지 않는다. 같은 내용이
  반복해서 오면 사람이 경보를 무시하기 시작하고, **그 순간 경보 체계는 없는 것과
  같아진다**.
- **심각도가 올라가면**(warning → critical) 쿨다운과 무관하게 알린다 —
  상황이 나빠진 것은 새 정보다.
- **해소도 알린다.** 났다는 사실만 알리고 풀린 것을 알리지 않으면 지금 문제가
  있는지 없는지를 알 수 없다. 해소된 경보는 지우지 않고 `RESOLVED`로 남긴다 —
  언제 났다가 언제 풀렸는지가 사고 분석의 근거다.
- **판정할 수 없으면 경보하지 않는다** — 표본 부족(`unknown`)은 장애가 아니다.
- `unpriced` 모델은 **경보만 하고 호출을 막지 않는다** (CTO 결정 1301-⑤) —
  막으면 안전하지만 새 모델 도입이 불가능해진다.

전달 채널은 **로그**(항상)와 **웹훅**(`ALERT_WEBHOOK_URL`)이다. 웹훅 실패는
점검을 실패시키지 않는다 — 알림 채널이 죽었다고 감지까지 멈추면 상황이 더
나빠진다. 웹훅 **주소는 API로 노출하지 않는다**(설정 여부만).

### CI/CD Deployment Gate

`scripts/deployment-gate.mjs` — 파이프라인이 `/health/ready`를 호출해 배포
가능 여부를 자동 판정한다 (CTO 결정 1202-④).

| exit | 뜻 |
| --- | --- |
| `0` | 배포 가능 (blocking 실패 없음) |
| `1` | 배포 불가 (차단 항목 존재) |
| `2` | **판정 불가** (API 접근·인증 실패) |

판정할 수 없을 때 0을 돌려주면 게이트가 있으나 마나 하다 — 확인하지 못한 것은
통과가 아니다. `GATE_STRICT=1`이면 직접 확인 항목이 남아 있어도 막고,
`GATE_ALERTS=1`이면 활성 critical 경보가 있어도 막는다.

### API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/ops/alerts` | **경보 현황 (ADMIN)** — 활성·최근 경보, 예약 점검 구성·마지막 결과 |
| `POST` | `/ops/checks/run` | **점검 수동 실행 (ADMIN)** — `?job=`으로 하나만, 없으면 전부 |

웹: **`/admin/production`** 상단 "경보" 섹션 (지금 점검 버튼 포함).


## Production Operations Platform (TASK-1401, Sprint 14)

TASK-1302가 남긴 두 부채를 갚는다: **예약 점검이 인스턴스마다 중복 실행**되던
것과, **알림이 한 번 실패하면 아무도 모르는 채로 끝나던** 것.

### Distributed Scheduler · Leader Election · Distributed Lock

예약 실행은 **잠금을 잡은 인스턴스만** 수행한다 (CTO 결정 1302-②).
수동 실행(`POST /ops/checks/run`)은 사람이 지금 확인하려는 것이므로 잠금을
요구하지 않는다.

| 항목 | 값 |
| --- | --- |
| 저장소 | Redis (`REDIS_URL`) — 미설정 시 **단일 인스턴스 모드** |
| 잠금 이름 | `acos:lock:scheduler:<job>` |
| 임차 수명 | `OPS_LOCK_TTL_MS` (기본 30초) |
| 갱신 시점 | 남은 수명이 TTL의 1/3 이하 |

- **임차는 반드시 만료된다.** 리더가 죽으면 락이 영원히 잠기는 것이 가장 나쁜
  실패다 — TTL 없는 락은 쓰지 않는다. 리더가 사라지면 다른 인스턴스가 TTL 안에
  인계받는다.
- **만료 직전이 아니라 미리 갱신한다.** 만료 직전에 갱신하면 네트워크 지연 한
  번에 리더십을 잃는다.
- **소유자만 갱신·해제한다.** Redis Lua 스크립트로 값을 비교한 뒤에만 바꾼다 —
  비교 없이 지우면 남의 임차를 해제해 **리더가 둘이 된다**.
- **Redis가 끊기면 잠그지 못한 것으로 본다.** 잠금 여부를 모르는 채 "잡았다"고
  하면 중복 실행이 조용히 일어난다.
- 단일 인스턴스 모드는 **숨기지 않는다** — `/ops/alerts`의 `coordination.distributed`와
  화면에 그대로 드러난다. 다중 인스턴스인데 단일 모드로 돌고 있으면 그것이
  바로 사고다.

판정 로직(`decideLease`/`ownsLease`/`renewAfter`)은 core 순수 함수라 시계를
흉내 내지 않고 테스트한다.

### Notification Center — Slack · Email · Webhook

| 채널 | 설정 | 최소 심각도 | 해소 알림 |
| --- | --- | --- | --- |
| Slack | `ALERT_SLACK_WEBHOOK_URL` | `ALERT_SLACK_MIN_LEVEL` | `ALERT_SLACK_RESOLVED` |
| Email | `SMTP_HOST` + `ALERT_EMAIL_TO` | `ALERT_EMAIL_MIN_LEVEL` | `ALERT_EMAIL_RESOLVED` |
| Webhook | `ALERT_WEBHOOK_URL` | `ALERT_WEBHOOK_MIN_LEVEL` | `ALERT_WEBHOOK_RESOLVED` |

- **채널 하나가 죽어도 나머지는 보낸다** — 알림 체계가 단일 장애점이 되면 안 된다.
- **심각도로 채널을 고를 수 있다** — 모든 warning을 밤중에 슬랙으로 받으면
  사람이 알림을 끈다. 해소 알림은 심각도와 **별도 스위치**다("critical만
  받겠다"는 사람도 해소는 받고 싶을 수 있다).
- **주소는 어떤 응답에도 담지 않는다** — 웹훅 URL·수신자도 비밀이다.

### Webhook Retry

- 지수 백오프(1s → 2s → 4s …, 상한 30초), 최대 시도 `ALERT_RETRY_MAX_ATTEMPTS`
  (기본 4회, **최초 시도 포함**).
- **되돌릴 수 없는 실패는 재시도하지 않는다** — 4xx(429 제외)는 같은 요청을 다시
  보내도 같은 답이 온다. 매달려 있어 봐야 로그만 늘어난다.
- 네트워크 오류·5xx·429만 재시도한다.
- **모든 시도 결과를 `notification_deliveries`에 남긴다** — 채널·시도 횟수·마지막
  오류. "왜 아무도 못 받았는가"를 나중에 추적할 수 있어야 한다.
- 전송 실패가 **경보 감지를 실패시키지 않는다** (TASK-1302의 태도 유지).

### Alert History & Archive (CTO 결정 1302-④)

**경보는 삭제하지 않는다.** 해소 후 `ALERT_ARCHIVE_AFTER_DAYS`(기본 90일)가
지나면 `ARCHIVED`로 옮겨 현황에서 비켜 두되 이력에는 남긴다.

- **활성 경보는 절대 보관하지 않는다** — 아직 문제가 있는데 화면에서 사라지면
  그게 사고다.
- **해소 시각을 모르는 것은 건드리지 않는다** — 유예가 지났는지 알 수 없다.
- 이력 요약은 종류별 발생 횟수와 **평균 해소 시간**을 낸다. 경보가 많은 것보다
  **오래 방치되는 것**이 더 나쁜 신호이고, 건수만 세면 그게 안 보인다.

### 종류별 재알림 간격 (CTO 결정 1302-①)

`종류별 값 ?? ALERT_COOLDOWN_MS ?? 30분` — 설정 우선순위(1201-①)와 같은 결이다.

| 종류 | 환경변수 |
| --- | --- |
| 예산 | `ALERT_COOLDOWN_BUDGET_MS` |
| Provider 장애 | `ALERT_COOLDOWN_PROVIDER_MS` |
| 미산정 모델 | `ALERT_COOLDOWN_UNPRICED_MS` |
| 설정 | `ALERT_COOLDOWN_CONFIG_MS` |

### API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/ops/alerts/history` | **경보 이력 (ADMIN)** — 보관 포함, 종류·심각도·상태·기간 필터, 평균 해소 시간 |
| `POST` | `/ops/alerts/archive` | **보관 정리 (ADMIN)** — 유예가 지난 해소 경보를 `ARCHIVED`로 (삭제 아님) |
| `GET` | `/ops/notifications` | **전송 시도 이력 (ADMIN)** |
| `POST` | `/ops/notifications/test` | **채널 시험 (ADMIN)** — **실제로 전송한다** |

`GET /ops/alerts`에 `channels`·`deliveries`·`coordination`·`cooldownByKind`가 추가됐다.

### 배포 게이트 운영 기본값 (CTO 결정 1302-③)

`NODE_ENV=production`(또는 `GATE_ENV=production`)에서는 `GATE_STRICT`·
`GATE_ALERTS`가 **켜진 상태가 기본**이고, 끄려면 명시적으로 `=0`을 넘겨야 한다 —
안전한 쪽이 기본이어야 사람이 잊었을 때 사고가 나지 않는다. 그 외 환경에서는
꺼짐이 기본이다(개발·스테이징 반복 배포를 막지 않는다).


## High Availability & Operations Reliability (TASK-1501, Sprint 15)

TASK-1401이 남긴 부채 두 건(알림 큐잉·점검 정지 감지)을 갚고, 보관을 사람 손에서
떼어 낸다.

### Scheduler Stopped Alert (CTO 결정 1401-①)

Redis 장애 시 **단일 모드로 자동 폴백하지 않는다** — 폴백하면 여러 인스턴스가
동시에 점검을 돌린다. 대신 **멈춘 사실을 알린다**.

- 감시자는 **잠금 없이 돈다.** 멈춘 원인이 대개 잠금을 못 잡는 것이라, 감시까지
  잠금을 요구하면 정작 알려야 할 때 알리지 못한다. 여러 인스턴스가 동시에
  감지해도 경보 `key`가 같아 중복되지 않는다.
- 판정은 **관대하게** 한다 — 간격의 3배(`OPS_SCHEDULER_GRACE_FACTOR`)를 넘겨야
  멈춘 것으로 본다. 한 번 늦었다고 경보하면 사람이 경보를 무시하게 된다.
- 한 번도 안 돌았으면 **기동 시점부터** 센다 — 방금 뜬 서버를 장애라 하지 않는다.
- 원인이 잠금이면 그렇게 적는다 — 원인을 모르면 사람이 어디부터 봐야 할지 모른다.

### Persistent Notification Queue (CTO 결정 1401-②)

TASK-1401의 재시도는 **프로세스 안에서만** 돌아, 인스턴스가 재시작하면 진행
중이던 재시도가 사라졌다. 이제 경보는 큐(`notification_queue`)에 담기고 워커가
꺼내 보낸다 — **재시작을 견딘다**.

| 상태 | 뜻 |
| --- | --- |
| `PENDING` | 대기 — `nextAttemptAt`이 지나면 워커가 집어 간다 |
| `SENT` | 전송 성공 |
| `DEAD` | **Dead Letter** — 사람이 고쳐야 나간다. **지우지 않는다** |

- **워커는 리더만 돌린다** — 여러 인스턴스가 같은 항목을 집으면 같은 알림이
  여러 번 간다. 잠금을 못 잡으면 조용히 넘긴다(다른 인스턴스가 하고 있다는
  뜻이라 소음이 될 이유가 없다).
- **Dead Letter로 가는 경우는 둘**이다: 되돌릴 수 없는 실패(4xx)와 최대 시도
  소진. 둘 다 다시 보내 봐야 같은 결과이거나 채널이 죽은 것이다.
- `POST /ops/notifications/queue/requeue`로 **시도 횟수를 되돌려** 다시 보낸다 —
  설정을 고친 뒤 쓰는 절차다.
- 큐 적재 실패는 알림이 **아예 사라지는** 것이라 로그로 크게 남긴다.

### Alert Archive를 예약 점검으로 (CTO 결정 1401-③)

보관이 네 번째 예약 점검(`alert-archive`)이 됐고, **하루 1회 04:00**에 돈다
(`OPS_CHECK_ARCHIVE_AT=HH:MM`). 시각은 **운영 서버 로컬 시간대** 기준이다
(CTO 결정 1501-① — `TZ`를 따른다).

시각 기반 점검을 표현하려고 스케줄러를 **단일 티커**로 바꿨다 — 점검마다 타이머를
두면 "매일 몇 시"를 표현할 수 없고, 재기동할 때마다 시점이 밀린다. 티커는 짧은
주기로 한 번 깨어나 각 점검의 `shouldRun`을 묻는다.

- **그 시각 전에는 돌지 않는다 — 한 번도 안 돌았어도.** "새벽에 돌리라"는 지시를
  기동 시점에 어기지 않기 위해서다.
- 보관은 **경보를 만들지 않는다** — 정리 작업이다.

### 운영 기본 채널 정책 (CTO 결정 1401-④)

| 채널 | 최소 심각도 | 해소 알림 |
| --- | --- | --- |
| Slack | Warning 이상 | 포함 |
| **Email** | **Critical 이상** | 포함 |
| Webhook | Warning 이상 | 포함 |

메일만 Critical인 이유는 분명하다 — 메일은 지우기 번거롭고 쌓이면 읽지 않게 된다.
`ALERT_SLACK_MIN_LEVEL`·`ALERT_EMAIL_MIN_LEVEL`·`ALERT_WEBHOOK_MIN_LEVEL`과
`ALERT_*_RESOLVED`로 전부 바꿀 수 있고, 알 수 없는 값은 기본값으로 되돌린다.

### API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/ops/notifications/queue` | **큐 현황 (ADMIN)** — 대기·성공·Dead Letter |
| `POST` | `/ops/notifications/queue/drain` | **지금 보내기 (ADMIN)** — 워커를 기다리지 않는다 |
| `POST` | `/ops/notifications/queue/requeue` | **Dead Letter 재시도 (ADMIN)** — `{ ids? }` |

`GET /ops/alerts`의 `coordination`에 `lockHealthy`가 추가됐다 —
false면 예약 점검이 돌지 않는다는 뜻이다.

---

## Production Verification & Operational Readiness (TASK-1601, Sprint 16)

TASK-1501까지는 "잘 돌고 있는가"를 봤다. 이번은 **"지금 무너지면 되살릴 수
있는가"** 다. 실행 절차는 [운영 문서](../operations/disaster-recovery.md)에 있고,
여기서는 판정 규칙을 적는다.

### Real SMTP Validation

메일 경로는 그동안 **한 번도 살아 있는 서버로 확인된 적이 없었다**. 이제
`POST /ops/notifications/verify-smtp`가 실제 SMTP 연결과 인증까지 한다.

- **메일은 보내지 않는다.** `transporter.verify()`는 EHLO → AUTH → QUIT까지만
  한다 — 점검이 수신함을 채우면 사람이 점검 메일을 무시하게 된다.
- 설정이 없으면 `configured:false`로 알린다. **미구성과 실패는 다르다.**
- 결과에 `ALERT_EMAIL_TO`를 담지 않는다 — 수신자 주소는 비밀이다.

### Backup Automation

`pg_dump --format=custom`으로 하루 1회(`OPS_CHECK_BACKUP_AT`, 기본 03:00 로컬)
받는다.

- **크기를 기록한다.** `pg_dump`는 부분 실패에도 0에 가까운 파일을 남길 수 있고,
  그걸 "성공"으로 세면 복구 계획이 통째로 거짓이 된다. 1KB 미만은 `failed`다.
- 보존 기간(`BACKUP_RETENTION_DAYS`, 기본 14일)이 지난 덤프만 지우되,
  **최근 `BACKUP_KEEP_MINIMUM`개(기본 3)는 나이와 무관하게 남긴다** — 정리가
  마지막 백업을 지우면 안 된다.
- 실패해도 **예외를 던지지 않고 이력에 남긴다** — 예약 실행이 죽으면 다음 백업도
  못 받는다.
- 화면·API에는 **파일명만** 노출한다. 절대 경로는 서버 구조를 드러낸다.
- Prisma의 `DATABASE_URL`에 붙는 `?schema=public`은 `pg_dump`가
  `invalid URI query parameter`로 거부한다 — libpq가 아는 파라미터만 남기고
  걷어낸다(라이브 검증에서 발견).

### Restore Verification

**복원해 보지 않은 백업은 백업이 아니다.** 하루 1회(`OPS_CHECK_RESTORE_AT`,
기본 03:30 로컬) 최신 덤프를 복원하고 테이블 수를 센다.

- 복원은 **반드시 별도 DB**(`BACKUP_RESTORE_DB_URL`)에 한다. 운영 DB에 복원하는
  자동화는 만들지 않는다 — 검증하려다 데이터를 잃는 것이 최악이다.
- 대상이 없으면 `configured:false` — 실패가 아니라 **하지 못한 것**이다.
- `pg_restore`는 무해한 경고에도 비영점 종료할 수 있어, 판정은 종료 코드가 아니라
  **복원 후 테이블 수**로 한다. 0개면 실패다.

| 판정 | 백업 | 복원 검증 |
| --- | --- | --- |
| `ok` | 최근 성공·크기 정상 | 8일 안에 성공 |
| `stale` | 마지막 성공이 2일 초과 | 8일 초과 |
| `failed` | 실패 또는 1KB 미만 | 실패 또는 테이블 0개 |
| `missing` | **이력 없음 — 통과가 아니다** | **이력 없음 — 통과가 아니다** |

### Disaster Recovery Checklist

배포 체크리스트(1202)와 목적이 다르다 — 그쪽은 "지금 배포해도 되는가",
이쪽은 "지금 무너지면 되살릴 수 있는가"다.

`복구 가능`은 **복구 가능성을 좌우하는(critical) 항목에 실패가 없을 때만** true다.
백업·복원 검증·DB·저장소가 critical이고, Redis와 경보 채널은 아니다 — Redis가
죽어도 복구는 할 수 있다.

복구 절차 숙지·연락 체계는 자동 판정이 불가능하므로 **`manual`로 남긴다**.
모르는 것을 통과로 처리하지 않는다.

### Provider Smoke Automation

예약(`OPS_CHECK_SMOKE_AT`)에 자리는 있지만 **기본은 꺼져 있다** — 실제 API를
호출해 과금되기 때문이다(CTO 결정 1301-①). `POST /ops/checks/run`("지금 점검")도
**꺼진 작업은 건너뛴다** — 과금되는 동작이 "전체 점검"에 딸려 도는 일은 없어야
한다.

### Redis Health · 장애 지속 경보 (CTO 결정 1501-②)

Redis가 죽어도 **LLM 호출은 계속 허용한다.** 멈추는 것은 예약 점검뿐이다.
장애가 `OPS_LOCK_OUTAGE_THRESHOLD_MS`(기본 30분)를 넘기면 **Critical 경보가
반복**된다 — 비용은 나가는데 비용 점검은 멈춘 상태이기 때문이다.

### 일 1회 점검의 시간대 (CTO 결정 1501-①)

`alert-archive`·`backup`·`restore-verify`·`provider-smoke`는 **운영 서버 로컬
시각**으로 돈다(`TZ`). 예산 창 같은 다른 계산은 UTC지만, 이 넷은 "트래픽이 적은
새벽"을 노리는 것이라 운영자가 사는 시간대를 따라야 한다.

### Dead Letter 보관 (CTO 결정 1501-③)

Dead Letter도 **지우지 않는다** — 90일이 지난 것만 `ARCHIVED`로 옮겨 현황에서
비켜 둔다. `alert-archive` 점검이 경보와 Dead Letter를 함께 정리한다.

### Job별 여유 배수 (CTO 결정 1501-④)

정지 판정 여유는 기본 3배(`OPS_SCHEDULER_GRACE_FACTOR`)이고,
`OPS_SCHEDULER_GRACE_<JOB>`으로 점검별로 조정한다(예:
`OPS_SCHEDULER_GRACE_BACKUP`). 종류별 값 ?? 전체 값 ?? 3 순으로 결정된다.

### API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/ops/readiness` | **운영 대시보드 (ADMIN)** — 체크리스트·백업·복원·Redis·SMTP |
| `POST` | `/ops/backup/run` | **지금 백업 (ADMIN)** |
| `POST` | `/ops/backup/verify-restore` | **지금 복원 검증 (ADMIN)** — 별도 DB |
| `POST` | `/ops/notifications/verify-smtp` | **메일 경로 확인 (ADMIN)** — 메일은 보내지 않는다 |

웹 화면은 **`/admin/operations`**(ADMIN 전용).

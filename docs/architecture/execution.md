# Execution Domain 아키텍처 (TASK-0601 · Dashboard TASK-0602, Sprint 6)

**모든 LLM 호출은 호출 1건당 Execution 1건을 기록한다** — Content Generation ·
Analysis · Vision · 개발용 API가 대상이며, Provider/Model/Token/Cost/Latency/
Status의 단일 관측 지점이다. 기록은 **가용성 우선**: 저장 실패는 LLM 호출을
실패시키지 않는다(경고 로그만 남김).

## 구성 요소

| 계층 | 구성 요소 | 위치 |
| --- | --- | --- |
| Domain (Port) | `ExecutionStore`, `NewExecution`, `ExecutionRecord` | `packages/core/src/execution/execution.ts` |
| Domain (Service) | `ExecutionTracker` — 호출 감싸기(성공/실패/지연 측정), `estimateLlmCost` + `DEFAULT_LLM_PRICING` | 〃 |
| Domain (집계) | `buildExecutionStats` / `buildExecutionTotals` — (key, status) 행 병합 (TASK-0602) | `packages/core/src/execution/execution-stats.ts` |
| Adapter (저장소) | `PrismaExecutionStore` — `executions` 테이블 | `apps/api/src/execution/prisma-execution.store.ts` |
| 기록 지점 | **`LlmService.complete()`** — 모든 LLM 호출의 유일한 통로 | `apps/api/src/llm/llm.service.ts` |
| API | `GET /executions` · `GET /executions/stats` (조회 전용) | `apps/api/src/execution/` |

## 기록 흐름

```
Content Generation ──(feature: "content-generation")──┐
  · 공식 경로 / 구 Wrapper 경로 / SOP 전부 포함        │
Analysis ────────────(feature: "product-analysis")────┤
Vision ──────────────(feature: "vision-analysis")─────┼─▶ LlmService.complete(request, { feature })
POST /llm/complete ──(feature 미지정 → "dev")─────────┘        │
                                                              ▼
                                            ExecutionTracker.track()  (@acos/core)
                                              1. 검증 오류는 기록 제외 (호출 시도 아님)
                                              2. LlmGateway 호출 (재시도 포함) — 지연 측정
                                              3-a. 성공 → SUCCESS + provider/model/usage/cost
                                              3-b. 실패 → FAILED + 폴백 provider/model + error
                                              4. ExecutionStore.record() — 실패해도 호출은 성공 유지
```

- **호출 1건 = 레코드 1건**: LlmGateway의 내부 재시도는 하나의 호출로 집계된다
  (attempts 세분 기록은 스펙 없음 — CTO_REQUEST 참고).
- feature 태그는 각 호출 지점에서 명시한다 — 새 AI 기능은
  `llm.complete(request, { feature: "<기능>" })`로 합류하면 된다.

## 비용(Cost) 계산

`estimateLlmCost(model, usage)` — 코드 선언 가격표(`DEFAULT_LLM_PRICING`,
USD / 1M 토큰) 기준.

- `mock-llm-1`: 0 (실제 API 미호출)
- **가격표에 없는 모델·토큰 사용량 미상 → `cost: null`** — 임의 단가를
  기록하지 않는다. 실모델 공식 단가는 CTO 스펙 확정 후 가격표에 추가
  (CTO_REQUEST #22)

## 데이터 모델 (executions)

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| id | String (cuid) | PK |
| feature | String | `content-generation` `product-analysis` `vision-analysis` `dev` |
| provider | String | 성공 시 실제 응답 Provider, 실패 시 선택된 Provider |
| model | String | 성공 시 실제 응답 모델, 실패 시 요청/기본 모델 |
| status | enum | `SUCCESS` `FAILED` |
| inputTokens / outputTokens | Int? | 토큰 사용량 (실패 시 null) |
| cost | Decimal(12,6)? | 예상 비용 USD (가격표 없는 모델은 null) |
| latencyMs | Int | 호출 소요 시간 (재시도 포함) |
| error | String? | 실패 사유 |
| createdAt | DateTime | 기록 시각 |

인덱스: `(feature, createdAt)` — 기능별 최신순 조회.

## Dashboard 집계 (TASK-0602)

`GET /executions/stats?from=&to=` — 호출 수·성공률·실패율·토큰·비용·지연을
**전체(totals) + feature/provider/model별**로 제공한다.

- 각 그룹의 통계(`ExecutionStats`): `count` · `successCount`/`failedCount` ·
  `successRate`/`failureRate`(0~1, 표본 없으면 null) · `inputTokens`/
  `outputTokens` · `cost`(USD 합계 — 가격 산정된 호출이 없으면 null) ·
  `avgLatencyMs`(호출 수 가중 평균) · `maxLatencyMs`
- 집계 경로: DB에서 (차원, status) 단위 `groupBy` → @acos/core의 순수 병합
  로직(`buildExecutionStats`) — 병합 규칙은 DB 없이 단위 테스트된다
- `from`/`to`(ISO)로 기간 필터 (미지정 시 전체 기간). 잘못된 날짜·역전 기간은 400
- 그룹 정렬: 호출 수 내림차순

## API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/executions?feature=&limit=` | 이력 조회 (최신순, limit 기본 50·최대 200) |
| `GET` | `/executions/stats?from=&to=` | **Dashboard 집계** — totals + byFeature/byProvider/byModel |

기록용 쓰기 API는 없다 — 기록은 LlmService 내부에서만 일어난다.

## 테스트

- Unit: `packages/core/src/execution/execution.spec.ts` — Tracker 성공/실패/기록
  실패 격리, 비용 계산(가격표·미상 처리)
- Unit: `packages/core/src/execution/execution-stats.spec.ts` — 병합·성공/실패율·
  가중 평균 지연·cost null 규칙·빈 표본 (TASK-0602)
- Service: `apps/api/src/llm/llm.service.spec.ts` — feature 태깅, FAILED 기록,
  검증 오류 비기록, 저장소 미주입 동작
- API: `apps/api/src/execution/execution.controller.spec.ts` — 목록/필터/limit ·
  stats 집계/기간 필터/날짜 검증

```bash
pnpm test
```

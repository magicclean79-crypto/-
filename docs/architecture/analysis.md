# AI 분석(Analysis) 아키텍처

상품 이미지의 OCR 텍스트 + Company Brain 컨텍스트로부터 **구조화된 상품
정보**(이름, 카테고리, 키워드, 설명, 속성, 신뢰도)를 추출하는 기능이다.

**TASK-0504(Sprint 5 — AI Execution)에서 공식 분석 엔진이 LLM 기반으로
교체되었다.** 구 `MockAnalysisProvider`(규칙 기반 단독 mock)는 제거되었고,
공식 엔진 `LlmAnalysisProvider`가 CTO 지시대로 세 계층을 사용한다:

1. **Prompt Engine** — `product-analysis` 템플릿 렌더링 (TASK-0503)
2. **LLM Gateway** — `responseFormat: "json"` 호출, Provider 교체 구조 (TASK-0501)
3. **Company Brain** — 상품 이름 기준 지식/결정/설정 컨텍스트 (Sprint 4)

모델 선택은 이제 **`LLM_PROVIDER` 환경 변수 하나**로 관리된다(기본 mock —
실제 API 미호출). `ANALYSIS_PROVIDER` 환경 변수는 제거되었다.

## 구성 요소

| 계층 | 구성 요소 | 위치 |
| --- | --- | --- |
| Domain (Port) | `AnalysisProvider`, `AnalysisInput`, `ProductAnalysis`, `AnalysisRun`, `AnalysisRunStore` | `packages/core/src/analysis/analysis-provider.ts` |
| Domain (Service) | `AnalysisExecutionService` — 상태 전이 + 재시도 | `packages/core/src/analysis/analysis-execution.service.ts` |
| Domain (공식 엔진) | `LlmAnalysisProvider` — Prompt Engine + LLM Gateway + Company Brain | `packages/core/src/analysis/llm-analysis.provider.ts` |
| Domain (계약) | `ProductAnalysisContext` · `buildDraftProductAnalysis` · `parseProductAnalysisResponse` | `packages/core/src/analysis/product-analysis.ts` |
| Prompt 템플릿 | `product-analysis` (초안 JSON 포함) | `packages/core/src/prompt/templates/product-analysis.template.ts` |
| Adapter (Company Brain) | `createAnalysisCompanyBrainSource` — CompanyBrainService 연결 | `apps/api/src/analysis/analysis-company-brain.ts` |
| Adapter (저장소) | `PrismaAnalysisRunStore` — `analysis_results` 테이블 | `apps/api/src/analysis/prisma-analysis-run.store.ts` |
| API | `AnalysisController`, `AnalysisService`, DI 조립(`AnalysisModule`) | `apps/api/src/analysis/` |

## 분석 흐름

```
POST /products/:productId/analysis   { apply?: boolean }
        │
        ▼
AnalysisService (apps/api)
  1. 상품 + 이미지 + 이미지별 최신 OCR SUCCESS 텍스트 조회
  2. AnalysisInput 구성 (product.projectId 포함 — Company Brain 조회용)
        │
        ▼
AnalysisExecutionService (@acos/core)     ← 상태 전이·재시도, 프레임워크 무관
  3. AnalysisRunStore.start()             → analysis_results에 RUNNING 레코드
  4. LlmAnalysisProvider.analyze()        ← 공식 엔진 (TASK-0504)
       4-a. Company Brain 조회 — 상품 이름 질의, PROJECT 스코프
       4-b. PromptEngine.render("product-analysis", context)
            → 규칙 기반 초안 JSON을 포함한 system+user 메시지
       4-c. LLM Gateway complete({ messages, responseFormat: "json" })
       4-d. parseProductAnalysisResponse() — 엄격 파싱 (실패 시 reject)
       실패 → 지수 백오프 재시도 (ANALYSIS_MAX_ATTEMPTS, 기본 3회)
  5-a. 성공 → markSuccess()               → SUCCESS + result/rawJson/completedAt
  5-b. 최종 실패 → markFailed()           → FAILED + error
        │
        ▼
  6. apply=true && SUCCESS → 상품 name/description 갱신 + applied=true
        │
        ▼
AnalysisResultDto 응답
```

- 상태 전이: `PENDING → RUNNING → SUCCESS | FAILED`
- **실행할 때마다 새 레코드**가 생성되어 Product당 이력이 1:N으로 쌓인다.
  구 mock 이력(`provider: "mock"`)은 그대로 보존된다 — 새 실행은
  `provider: "llm:<LLM Provider>"`(예: `llm:mock`, `llm:openai`)로 기록된다.
- **AnalysisResult 모델은 변경 없음** (CTO 지시).

## 초안(Draft) + 검증·보강 설계

프롬프트에는 `buildDraftProductAnalysis()`가 만든 **규칙 기반 초안 JSON**
(OCR 첫 줄 → 이름, category "미분류", confidence 0.3)이 포함된다.

- **실제 모델**: 초안을 OCR·Company Brain에 근거해 검증·보강한 최종 JSON을 출력
- **mock LLM**: `responseFormat: "json"`이면 프롬프트의 마지막 ```json 블록
  (= 초안)을 그대로 반환 — **키 없는 오프라인 환경에서도 전체 파이프라인이
  결정적으로 동작**한다 (Company Brain 조회 → 렌더링 → Gateway 호출 → 파싱)

응답 파싱(`parseProductAnalysisResponse`)은 엄격하다:

- JSON 객체를 찾지 못하거나 `name`이 없으면 오류 → 재시도 → FAILED 기록
- 나머지 필드는 타입 검증 후 보정 (category "미분류" · keywords [] ·
  description "" · confidence 0~1 클램프, 누락 시 0.5)

## 모델 교체 방법

분석용 모델 선택은 LLM Gateway에 위임되었다 — `LLM_PROVIDER` 환경 변수로
openai/anthropic/gemini를 선택하면 분석도 해당 모델을 사용한다
(docs/architecture/llm.md 참고). 분석 전용 절차가 더는 필요 없다.

프롬프트를 바꾸려면 `product-analysis` 템플릿을 수정하면 되고(코드 선언,
렌더링은 결정적으로 단위 테스트됨), Vision 입력(이미지 바이트) 활용·Provider별
구조화 출력 옵션(response_format 등) 매핑은 향후 확장 지점이다 —
`AnalysisInput.images[].getBytes()` 로더와 `LlmRequest.responseFormat`이
그 자리를 잡아 두었다.

## 데이터 모델 (analysis_results — 변경 없음)

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| id | String (cuid) | PK |
| productId | String (FK → products, Cascade) | **1:N** — 상품당 실행 이력 다건 |
| provider | String | `llm:mock`, `llm:openai`, … (구 이력: `mock`) |
| status | enum | `PENDING` `RUNNING` `SUCCESS` `FAILED` |
| result | Json? | 구조화된 `ProductAnalysis` |
| rawJson | Json? | LLM Provider/모델·응답 텍스트·Company Brain 컨텍스트 요약 |
| error | String? | 실패 사유 |
| attempts | Int | Provider 호출 시도 횟수 |
| applied | Boolean | 결과가 상품 name/description에 반영되었는지 |
| startedAt / completedAt | DateTime? | 실행 구간 |
| createdAt / updatedAt | DateTime | 감사 필드 |

## 테스트

- Unit: `packages/core/src/analysis/analysis.spec.ts` — LlmAnalysisProvider(mock LLM 경로·Company Brain 반영·파싱 실패), 상태 전이, 재시도
- Unit: `packages/core/src/analysis/product-analysis.spec.ts` — 초안 규칙, 응답 파서, `product-analysis` 템플릿 렌더링
- Service: `apps/api/src/analysis/analysis.service.spec.ts` — OCR 텍스트 입력, Company Brain 로드, apply 반영
- API: `apps/api/src/analysis/analysis.controller.spec.ts` — supertest HTTP 계약

```bash
pnpm test
```

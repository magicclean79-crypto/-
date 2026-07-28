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

새 Provider 추가: `@acos/core`의 `LlmProvider`를 구현하고
`apps/api/src/llm/llm.module.ts`의 팩토리에 case 하나를 추가하면 됩니다.

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
| **Provider Registry** | Code-first 중앙 정의(`LLM_PROVIDER_REGISTRY`, core) — 연결 상태(official/adapter-ready/mock)·키 설정 여부·기본 모델. `GET /llm/providers` (키 값 비노출) | — |
| **Model Routing** | feature별 모델 지정 — 미지정 시 Provider 기본, 호출자 명시가 최우선. 현 단계는 선택된 Provider 안의 모델 선택 (cross-provider 라우팅은 다음 단계) | `LLM_MODEL_CONTENT` / `LLM_MODEL_ANALYSIS` / `LLM_MODEL_VISION` |
| **Provider Dashboard** | 웹 `/providers` — Registry·라우팅·예산 카드(진행 바/배지)·Provider별 호출 통계. Playwright 3종 | — |

검사 지점은 LlmService 단일 관문(Execution 기록과 동일 지점) —
예산 로직은 core 순수 함수(`evaluateBudgetWindow`), 합산·차단은
`LlmBudgetService`(api). `GET /llm/budget`으로 현황 조회.

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
- **어댑터 (`apps/api/src/llm/providers/`)** — 공식 SDK 사용
  - Anthropic: system은 별도 파라미터, 응답은 content 블록에서 text 추출
  - **OpenAI (TASK-0603 공식 연결)**: chat.completions —
    `responseFormat "json"` → `response_format { type: "json_object" }` 매핑
    (프롬프트 지침과 이중 강제), 멀티모달 image_url, gpt-4o 계열 단가가
    가격표에 등록되어 Execution Cost 활성화. 테스트용 클라이언트 주입 지원
  - Gemini: systemInstruction/contents 분리, assistant → model role 매핑
  - **이미지 매핑 (TASK-0505)**: `images`는 마지막 user 메시지에 Provider별
    형식으로 첨부된다 — Anthropic `image` content block(base64) · OpenAI
    `image_url`(data URL) · Gemini `inlineData` part
  - Anthropic/Gemini의 `responseFormat` 구조화 출력 옵션 매핑은 해당 Provider
    공식 연결 시 적용한다 (CTO 결정, TASK-0504 승인 — OpenAI는 0603에서 완료)

## Health Check (TASK-0603)

`GET /llm/health` — 실제 최소 완성 호출("ping", maxTokens 16)로 키·네트워크·
모델 접근을 확인한다. 성공 시 `{ status: "ok", latencyMs }`, 실패 시 예외
대신 `{ status: "error", error }` 반환. 이 호출도 Execution(feature "dev")으로
기록되므로 실패 이력이 대시보드에 남는다.

## API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/llm` | 선택된 Provider 확인 — `{ provider, defaultModel }` |
| `GET` | `/llm/health` | **Provider 상태 점검 (TASK-0603)** — 최소 실호출 기반 |
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
